import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chromium } from "playwright";
import {
  DashboardConnection,
  createScheduler,
  exportCalendarUrl,
} from "../dashboard.mjs";
import { createPilot } from "../server.mjs";

const feed = (id) =>
  `https://usosapps.ideis.pl/services/tt/upcoming_ical?user_id=${id}&key=synthetic-export-key&lang=pl`;
const fragment = (id) =>
  `<text-field id="plan_export_link" readonly value="${feed(id).replaceAll("&", "&amp;")}"></text-field>`;
const ical = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
class Worker extends EventEmitter {
  constructor(id = "1001") {
    super();
    this.expectedAccount = id;
    this.state = "connected";
    this.calls = [];
    this.exportStatus = 200;
    this.body = fragment(id);
    this.api = {
      get: async (url, opts) => {
        this.calls.push(url);
        assert.equal(opts.maxRedirects, 0);
        const exporting =
          new URL(url).searchParams.get("_action") === "home/eksportujPlan";
        if (exporting && this.wait) await this.wait;
        return {
          status: () => (exporting ? this.exportStatus : 200),
          text: async () => (exporting ? this.body : `user_id: '${id}'`),
          dispose: async () => {
            this.disposals = (this.disposals || 0) + 1;
          },
        };
      },
      dispose: async () => {
        this.apiDisposed = true;
      },
    };
  }
  record() {}
  status() {
    return {
      state: this.state,
      requests: [],
      backendVerified: this.state === "connected",
    };
  }
  async start() {
    this.state = "login";
  }
  async verify() {
    this.state = "connected";
    return true;
  }
  async close() {
    this.state = "disconnected";
  }
  async startStream() {}
  async stopStream() {}
  async input() {}
}
function connection(worker) {
  const requests = [];
  const dashboard = new DashboardConnection(worker, {
    schedule: createScheduler(0),
    fetchPublic: async (url, options) => {
      requests.push(url);
      assert.equal(url, feed(worker.expectedAccount));
      assert.equal(options.redirect, "error");
      return new Response(ical);
    },
  });
  return { dashboard, requests };
}

test("export fragment decodes HTML entities, binds owner, and rejects missing/duplicate/foreign links", () => {
  assert.equal(exportCalendarUrl(fragment("1001"), "1001"), feed("1001"));
  for (const html of [
    "",
    fragment("1002"),
    fragment("1001") + fragment("1001"),
    fragment("1001").replace("usosapps.ideis.pl", "example.test"),
  ])
    assert.throws(() => exportCalendarUrl(html, "1001"));
});
test("auto connection accepts marker-free fragment only after full account verification; concurrent calls coalesce", async () => {
  const worker = new Worker(),
    { dashboard, requests } = connection(worker);
  const results = await Promise.all([
    dashboard.connectCalendarAutomatically(),
    dashboard.connectCalendarAutomatically(),
  ]);
  assert.deepEqual(results, [true, true]);
  assert.equal(worker.calls.length, 2);
  assert.equal(requests.length, 1);
  assert.equal(
    new URL(worker.calls[0]).searchParams.get("_action"),
    "home/index",
  );
  assert.equal(
    new URL(worker.calls[1]).searchParams.get("_action"),
    "home/eksportujPlan",
  );
  assert.equal(dashboard.calendarState, "connected");
  assert.deepEqual((await dashboard.plan()).data.entries, []);
  await dashboard.connectCalendarAutomatically();
  assert.equal(requests.length, 1);
  assert.equal(worker.disposals, 2);
});
test("failed export preserves working dashboard, exposes no key, and limits retries", async () => {
  const worker = new Worker();
  worker.body = fragment("1002");
  const { dashboard, requests } = connection(worker);
  assert.equal(await dashboard.connectCalendarAutomatically(), false);
  assert.equal(worker.state, "connected");
  assert.equal(dashboard.calendarState, "error");
  assert.equal(requests.length, 0);
  assert.equal(dashboard.ical, null);
  await assert.rejects(
    dashboard.connectCalendarAutomatically(),
    (error) =>
      error.status === 429 && !error.message.includes("synthetic-export-key"),
  );
});
test("login redirect expires session; disconnect while exporting discards result", async () => {
  const worker = new Worker();
  worker.exportStatus = 302;
  const { dashboard, requests } = connection(worker);
  await assert.rejects(
    dashboard.connectCalendarAutomatically(),
    (error) => error.status === 401,
  );
  assert.equal(worker.state, "expired");
  assert.equal(worker.apiDisposed, true);
  assert.equal(requests.length, 0);
  const second = new Worker();
  let release;
  second.wait = new Promise((resolve) => {
    release = resolve;
  });
  const c = connection(second);
  const run = c.dashboard.connectCalendarAutomatically();
  await new Promise((resolve) => setTimeout(resolve, 10));
  c.dashboard.close();
  release();
  await assert.rejects(run);
  assert.equal(c.requests.length, 0);
  assert.equal(c.dashboard.ical, null);
});
test("POST verify automatically connects each owner calendar without exposing credential URLs; retry is owner/Origin protected", async (t) => {
  let id = 1000;
  const pilot = await createPilot({
    allowAnonymousForTests: true,
    port: 0,
    workerFactory: () => new Worker(String(++id)),
    dashboardFactory: (worker) => connection(worker).dashboard,
  });
  t.after(() => pilot.close());
  const owners = [];
  for (let index = 0; index < 2; index++) {
    const cookie = (await fetch(pilot.origin)).headers
      .get("set-cookie")
      .split(";")[0];
    owners.push(cookie);
    const post = (route) =>
      fetch(pilot.origin + "/api/" + route, {
        method: "POST",
        headers: { cookie, origin: pilot.origin },
      });
    assert.equal((await post("start")).status, 200);
    const res = await post("verify");
    assert.equal(res.status, 200);
    const raw = await res.text();
    const status = JSON.parse(raw);
    assert.equal(status.calendarConfigured, true);
    assert.equal(status.calendarState, "connected");
    assert.doesNotMatch(raw, /synthetic-export-key|upcoming_ical/);
    const plan = await fetch(pilot.origin + "/api/plan", {
      headers: { cookie },
    }).then((r) => r.json());
    assert.deepEqual(plan.data.entries, []);
    if (index === 0) await new Promise((resolve) => setTimeout(resolve, 1250));
  }
  assert.notEqual(owners[0], owners[1]);
  const retry = await fetch(pilot.origin + "/api/calendar/auto", {
    method: "POST",
    headers: { cookie: owners[0], origin: "https://example.test" },
  });
  assert.equal(retry.status, 403);
});

test("viewer Verify button connects calendar without manual input and keeps exported key out of DOM", async (t) => {
  const pilot = await createPilot({
    allowAnonymousForTests: true,
    port: 0,
    workerFactory: () => new Worker(),
    dashboardFactory: (worker) => connection(worker).dashboard,
  });
  t.after(() => pilot.close());
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1560, height: 1100 },
  });
  await page.goto(pilot.origin);
  await page.locator("#start-main").click();
  await page.waitForFunction(
    () => document.querySelector("#connection").textContent === "LIVE",
  );
  await page.locator("#verify").click();
  await page.locator("#open-dashboard").waitFor();
  assert.equal(
    await page.locator("#calendar-status").textContent(),
    "Calendar connected to this account.",
  );
  assert.equal(await page.locator("#calendar-url").inputValue(), "");
  assert.equal(await page.locator("#auto-calendar").isHidden(), true);
  assert.doesNotMatch(await page.content(), /synthetic-export-key/);
});

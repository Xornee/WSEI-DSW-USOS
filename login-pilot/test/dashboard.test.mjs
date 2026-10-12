import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chromium } from "playwright";
import {
  DashboardConnection,
  DashboardError,
  calendarUrl,
  createScheduler,
} from "../dashboard.mjs";
import { createPilot } from "../server.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const endpoint = (path) => new URL(path, "http://127.0.0.1");
const feed = (id) =>
  `https://usosapps.ideis.pl/services/tt/upcoming_ical?user_id=${id}&key=synthetic-calendar-key&lang=pl`;
const EMPTY_ICAL = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
const activeIcal = (name) =>
  `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:synthetic\nDTSTART:20260920T100000Z\nDTEND:20260920T110000Z\nSUMMARY:${name}\nEND:VEVENT\nEND:VCALENDAR`;

function source(id, name, action) {
  const marker = `<script>const demo={user_id: '${id}'};</script>`;
  if (action === "home/index")
    return (
      marker +
      `<usos-frame id="info-frame"><ul><li>Numer albumu: <b>${id}</b></li><li>Role/Uprawnienia: <ul><li><b>student</b></li></ul></li></ul><a href="?pokazJednostke=1">Synthetic Faculty</a></usos-frame>`
    );
  if (action === "katalog2/osoby/pokazOsobe")
    return (
      marker +
      `<title>${name} - Profil</title><a href="mailto:fixture@example.test">E-mail</a>`
    );
  if (action.includes("oceny"))
    return (
      marker +
      `<usos-frame id="oceny"><usos-frame-section section-title="Synthetic semester"><table><tr><th>Przedmiot</th><th>Program</th><th>Ocena</th><th>Akcje</th></tr><tr><td>${name} course [TEST]</td><td>Test</td><td><div>Egzamin: <span>5</span></div></td><td></td></tr></table></usos-frame-section></usos-frame>`
    );
  if (action.includes("zaliczenia"))
    return (
      marker +
      '<usos-frame><h2 slot="title">Synthetic programme [TEST]</h2><usos-frame-section section-title="Etap"><div class="inline-keyvalue-list"><div><div>Status</div><div>Zaliczony</div></div></div></usos-frame-section></usos-frame>'
    );
  return (
    marker +
    `<main id="layout-main-content"><div class="usos-ui"><p>Nie masz żadnych pozycji.</p></div></main>`
  );
}

class Worker extends EventEmitter {
  constructor(id = "1001", name = "Fixture Alpha") {
    super();
    this.expectedAccount = id;
    this.name = name;
    this.state = "connected";
    this.calls = [];
    this.replyId = id;
    this.httpStatus = 200;
    this.requests = [];
    this.closed = false;
    this.api = {
      get: async (url, options) => {
        assert.equal(new URL(url).origin, "https://usosweb.ideis.pl");
        assert.equal(options.maxRedirects, 0);
        this.calls.push(url);
        if (this.wait) await this.wait;
        return {
          status: () => this.httpStatus,
          text: async () =>
            source(
              this.replyId,
              this.name,
              new URL(url).searchParams.get("_action"),
            ),
          dispose: async () => {},
        };
      },
      dispose: async () => {
        this.apiDisposed = true;
      },
    };
  }
  record(method, url) {
    this.requests.push({
      destination: `${method} ${new URL(url).origin}`,
      count: 1,
    });
  }
  status() {
    return {
      state: this.state,
      requests: this.requests,
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
  async startStream() {}
  async stopStream() {}
  async input() {}
  async close() {
    this.closed = true;
    this.state = "disconnected";
  }
}
function data(worker, extra = {}) {
  return new DashboardConnection(worker, {
    schedule: createScheduler(0),
    ...extra,
  });
}
const publicResponse = (body) => new Response(body);

test("same endpoint has separate per-account caches and concurrent loads coalesce", async () => {
  const wa = new Worker(),
    wb = new Worker("1002", "Fixture Beta");
  const a = data(wa),
    b = data(wb);
  const results = await Promise.all([
    a.handle(endpoint("/api/grades")),
    a.handle(endpoint("/api/grades")),
    b.handle(endpoint("/api/grades")),
  ]);
  assert.match(JSON.stringify(results[0]), /Fixture Alpha/);
  assert.doesNotMatch(JSON.stringify(results[0]), /Fixture Beta/);
  assert.match(JSON.stringify(results[2]), /Fixture Beta/);
  assert.equal(wa.calls.length, 1);
  assert.equal(wb.calls.length, 1);
  assert.equal((await a.handle(endpoint("/api/grades"))).meta.source, "cache");
});

test("disconnect during a load discards result and never repopulates closed cache", async () => {
  const worker = new Worker();
  let release;
  worker.wait = new Promise((resolve) => {
    release = resolve;
  });
  const connection = data(worker);
  const run = connection.handle(endpoint("/api/grades"));
  await delay(10);
  connection.close();
  release();
  await assert.rejects(run, (error) => error.status === 401);
  assert.equal(connection.cache.size, 0);
});

test("account mismatch expires jar and refuses even previously cached grades", async () => {
  const worker = new Worker(),
    connection = data(worker);
  await connection.handle(endpoint("/api/grades"));
  worker.replyId = "9999";
  await assert.rejects(
    connection.handle(endpoint("/api/student")),
    (error) => error.status === 401,
  );
  await assert.rejects(
    connection.handle(endpoint("/api/grades")),
    (error) => error.status === 401,
  );
  assert.equal(worker.apiDisposed, true);
  assert.equal(connection.cache.size, 0);
});

test("shared queue spaces different accounts and survives a failed request", async () => {
  const schedule = createScheduler(30),
    times = [];
  const first = schedule(async () => {
    times.push(Date.now());
    throw new Error("synthetic");
  }).catch(() => {});
  const second = schedule(async () => {
    times.push(Date.now());
  });
  const third = schedule(async () => {
    times.push(Date.now());
  });
  await Promise.all([first, second, third]);
  assert.ok(times[1] - times[0] >= 25);
  assert.ok(times[2] - times[1] >= 25);
});

test("calendar URL binds host, path and account; rejects redirects/foreign identities without fetching", async () => {
  assert.equal(calendarUrl(feed("1001"), "1001"), feed("1001"));
  for (const url of [
    "http://127.0.0.1:8080",
    feed("1002"),
    feed("1001").replace("usosapps.ideis.pl", "example.test"),
    feed("1001") + "&user_id=1002",
    feed("1001") + "&target=evil",
    feed("1001").replace("upcoming_ical", "anything"),
  ]) {
    assert.throws(() => calendarUrl(url, "1001"), DashboardError);
  }
  let called = false;
  const connection = data(new Worker(), {
    fetchPublic: async () => {
      called = true;
      return publicResponse(EMPTY_ICAL);
    },
  });
  await assert.rejects(
    connection.setCalendar(feed("1002")),
    (error) => error.status === 400,
  );
  assert.equal(called, false);
});

test("missing calendar is explicit; connected empty and populated calendars stay account-local", async () => {
  const a = data(new Worker(), {
    fetchPublic: async () => publicResponse(EMPTY_ICAL),
  });
  const b = data(new Worker("1002", "Fixture Beta"), {
    fetchPublic: async () => publicResponse(activeIcal("Only Beta class")),
  });
  await assert.rejects(a.plan(), (error) => error.status === 409);
  await Promise.all([a.setCalendar(feed("1001")), b.setCalendar(feed("1002"))]);
  assert.deepEqual((await a.plan()).data.entries, []);
  assert.equal((await b.plan()).data.entries[0].courseName, "Only Beta class");
  assert.doesNotMatch(
    JSON.stringify(await a.handle(endpoint("/api/home"))),
    /synthetic-calendar-key|Only Beta/,
  );
  a.close();
  assert.equal(a.ical, null);
  assert.ok(b.ical);
});

test("all read-only dashboard data routes use existing parsers and supported section allowlist", async () => {
  const connection = data(new Worker(), {
    fetchPublic: async (url) =>
      publicResponse(
        url.includes("/terms/")
          ? "[]"
          : '<main id="layout-main-content"><div class="usos-ui"><hr><b>Synthetic news</b><p>University test announcement.</p><hr></div></main>',
      ),
  });
  for (const path of [
    "/api/session",
    "/api/student",
    "/api/grades",
    "/api/stages",
    "/api/news",
    "/api/terms",
    ...[
      "dues",
      "paid",
      "remittances",
      "accounts",
      "installments",
      "courses",
      "tests",
      "registrations",
      "applications",
      "decisions",
      "diplomas",
      "scholarships",
      "card",
    ].map((id) => `/api/sections/${id}`),
    "/api/directory?q=Fixture&kind=people",
  ]) {
    const result = await connection.handle(endpoint(path));
    assert.ok(path === "/api/session" ? result.loggedIn : result.ok);
  }
  await assert.rejects(
    connection.handle(endpoint("/api/sections/__proto__")),
    (error) => error.status === 404,
  );
  await assert.rejects(
    connection.handle(endpoint("/api/directory?q=x")),
    (error) => error.status === 400,
  );
});

async function owner(pilot) {
  return (await fetch(pilot.origin)).headers.get("set-cookie").split(";")[0];
}
async function post(pilot, cookie, route, body, origin = pilot.origin) {
  return fetch(`${pilot.origin}/api/${route}`, {
    method: "POST",
    headers: {
      cookie,
      origin,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function testPilot() {
  let next = 0;
  return createPilot({
    allowAnonymousForTests: true,
    port: 0,
    dashboardIntervalMs: 0,
    workerFactory: () =>
      ++next === 1 ? new Worker() : new Worker("1002", "Fixture Beta"),
    dashboardFactory: (worker) =>
      data(worker, { fetchPublic: async () => publicResponse(EMPTY_ICAL) }),
  });
}

test("HTTP dashboard requires login; two owners receive only their own parsed data", async (t) => {
  const pilot = await testPilot();
  t.after(() => pilot.close());
  const a = await owner(pilot),
    b = await owner(pilot);
  assert.equal(
    (await fetch(`${pilot.origin}/dashboard/`, { redirect: "manual" })).status,
    303,
  );
  assert.equal(
    (await fetch(`${pilot.origin}/api/grades`, { headers: { cookie: a } }))
      .status,
    401,
  );
  await post(pilot, a, "start");
  await post(pilot, a, "verify");
  await delay(1250);
  await post(pilot, b, "start");
  await post(pilot, b, "verify");
  for (const [cookie, name, other] of [
    [a, "Fixture Alpha", "Fixture Beta"],
    [b, "Fixture Beta", "Fixture Alpha"],
  ]) {
    const response = await fetch(`${pilot.origin}/api/grades`, {
      headers: { cookie },
    });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.ok(text.includes(name));
    assert.ok(!text.includes(other));
  }
  assert.equal(
    (
      await post(
        pilot,
        a,
        "calendar",
        { url: feed("1001") },
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (await post(pilot, a, "calendar", { url: feed("1002") })).status,
    400,
  );
  const saved = await post(pilot, a, "calendar", { url: feed("1001") });
  assert.equal(saved.status, 200);
  assert.doesNotMatch(await saved.text(), /synthetic-calendar-key/);
  const statusB = await fetch(`${pilot.origin}/api/status`, {
    headers: { cookie: b },
  }).then((r) => r.json());
  assert.equal(statusB.calendarConfigured, false);
  await post(pilot, a, "disconnect");
  assert.equal(
    (await fetch(`${pilot.origin}/api/grades`, { headers: { cookie: a } }))
      .status,
    401,
  );
  assert.equal(
    (await fetch(`${pilot.origin}/api/grades`, { headers: { cookie: b } }))
      .status,
    200,
  );
});

test("built React dashboard renders both owners independently, keeps dark mode, clears disconnected tab", async (t) => {
  const pilot = await testPilot();
  t.after(() => pilot.close());
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1560, height: 1100 } }),
    browser.newContext({ viewport: { width: 1560, height: 1100 } }),
  ]);
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const errors = [];
  pages.forEach((page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  for (const [index, page] of pages.entries()) {
    await page.goto(pilot.origin);
    await page.locator("#start-main").click();
    await page.waitForFunction(
      () => document.querySelector("#connection").textContent === "LIVE",
    );
    await page.locator("#verify").click();
    await page.locator("#open-dashboard").waitFor();
    await page.locator("#open-dashboard").click();
    await page
      .getByRole("heading", { name: "Mój profil", exact: true })
      .waitFor();
    await page
      .getByText(index === 0 ? "Fixture Alpha" : "Fixture Beta", {
        exact: true,
      })
      .first()
      .waitFor();
    if (index === 0) await delay(1250);
  }
  assert.doesNotMatch(
    await pages[0].locator("body").innerText(),
    /Fixture Beta/,
  );
  assert.doesNotMatch(
    await pages[1].locator("body").innerText(),
    /Fixture Alpha/,
  );
  if (process.env.PILOT_SCREENSHOT_DIR)
    await pages[0].screenshot({
      path: `${process.env.PILOT_SCREENSHOT_DIR}/dashboard-light.png`,
      fullPage: true,
    });
  await pages[0]
    .getByRole("button", { name: "Włącz tryb ciemny", exact: true })
    .click();
  await pages[0].reload();
  await pages[0]
    .getByRole("button", { name: "Włącz tryb jasny", exact: true })
    .waitFor();
  if (process.env.PILOT_SCREENSHOT_DIR) {
    await pages[0]
      .getByText("Fixture Alpha", { exact: true })
      .first()
      .waitFor();
    await pages[0].waitForTimeout(250);
    await pages[0].screenshot({
      path: `${process.env.PILOT_SCREENSHOT_DIR}/dashboard-dark.png`,
      fullPage: true,
    });
  }
  // A signed-out/background dashboard is cleared and redirected, not left displaying cached PII.
  const response = await contexts[0].request.post(
    `${pilot.origin}/api/disconnect`,
    { headers: { origin: pilot.origin } },
  );
  assert.equal(response.status(), 200);
  await pages[0].waitForURL(pilot.origin + "/");
  assert.doesNotMatch(
    await pages[0].locator("body").innerText(),
    /Fixture Alpha/,
  );
  assert.match(await pages[1].locator("body").innerText(), /Fixture Beta/);
  assert.deepEqual(errors, []);
});

test("old dashboard document is rejected after a same-owner fresh connection generation", async (t) => {
  const pilot = await testPilot();
  t.after(() => pilot.close());
  const cookie = await owner(pilot);
  await post(pilot, cookie, "start");
  await post(pilot, cookie, "verify");
  const old = await fetch(`${pilot.origin}/api/status`, {
    headers: { cookie },
  }).then((r) => r.json());
  const oldHtml = await fetch(`${pilot.origin}/dashboard/`, {
    headers: { cookie },
  }).then((r) => r.text());
  assert.ok(oldHtml.includes(`content="${old.connectionId}"`));
  await delay(1250);
  await post(pilot, cookie, "start");
  await post(pilot, cookie, "verify");
  const newer = await fetch(`${pilot.origin}/api/status`, {
    headers: { cookie },
  }).then((r) => r.json());
  assert.notEqual(newer.connectionId, old.connectionId);
  const result = await fetch(`${pilot.origin}/api/grades`, {
    headers: { cookie },
  }).then((r) => r.text());
  assert.match(result, /Fixture Beta/);
  assert.doesNotMatch(result, /Fixture Alpha/);
});

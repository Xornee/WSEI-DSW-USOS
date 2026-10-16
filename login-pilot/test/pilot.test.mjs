import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import http from "node:http";
import { WebSocket } from "ws";
import { chromium } from "playwright";
import { createPilot } from "../server.mjs";
import {
  BrowserWorker,
  HOME,
  accountId,
  sessionCookies,
  verifyHandoff,
  findLoginUrl,
} from "../browser.mjs";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SYNTHETIC_SECRET = "synthetic-cookie-never-serialize";
const cookie = {
  name: "PHPSESSID",
  value: SYNTHETIC_SECRET,
  domain: "usosweb.ideis.pl",
  path: "/",
  expires: -1,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
};
const FIXTURE = `<!doctype html><html><body style="margin:0;padding:50px"><h1>Synthetic browser fixture</h1>
<input id="entry" aria-label="Fixture input" style="display:block;width:300px;height:40px" />
<button id="submit" onclick="document.getElementById('result').textContent=document.getElementById('entry').value">Submit</button><output id="result"></output></body></html>`;

class FakeWorker extends EventEmitter {
  constructor() {
    super();
    this.state = "idle";
    this.closed = false;
    this.events = [];
    this.expectedAccount = "12345";
    this.api = {
      get: async () => ({
        status: () => 200,
        text: async () => "user_id: '12345'",
        dispose: async () => {},
      }),
      dispose: async () => {},
    };
  }
  record() {}
  async start() {
    this.state = "login";
  }
  status() {
    return {
      state: this.state,
      backendVerified: this.state === "connected",
      requests: [],
    };
  }
  async startStream() {}
  async stopStream() {}
  async input(event) {
    this.events.push(event);
  }
  async verify() {
    this.state = "connected";
    return true;
  }
  async close() {
    this.closed = true;
    this.state = "disconnected";
  }
}
async function owner(pilot) {
  const response = await fetch(pilot.origin);
  assert.equal(response.status, 200);
  return response.headers.get("set-cookie").split(";")[0];
}
function post(pilot, cookie, path, headers = {}) {
  return fetch(`${pilot.origin}/api/${path}`, {
    method: "POST",
    headers: { cookie, origin: pilot.origin, ...headers },
  });
}
async function rejectedSocket(url, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.on("unexpected-response", (_req, res) => {
      res.resume();
      ws.terminate();
      resolve(res.statusCode);
    });
    ws.on("open", () => {
      ws.close();
      reject(new Error("Unexpected socket access"));
    });
    ws.on("error", () => {});
  });
}

test("account parser rejects logged-out HTML and reads account marker", () => {
  assert.equal(accountId("user_id: null"), null);
  assert.equal(accountId("user_id: '12345'"), "12345");
  assert.equal(accountId("<h1>Sign in</h1>"), null);
});

test("only exact-host USOS PHP cookie is eligible; never Microsoft/CAS storage", () => {
  assert.deepEqual(
    sessionCookies([
      cookie,
      { ...cookie, domain: "login.microsoftonline.com" },
      { ...cookie, name: "MS_TOKEN" },
      { ...cookie, domain: "evil-usosweb.ideis.pl" },
    ]),
    [cookie],
  );
});

test("backend handoff uses isolated jar and fixed GET, no redirects; checks same account", async () => {
  let options,
    disposed = false,
    bodyDisposed = false;
  const api = {
    get: async (url, args) => {
      assert.equal(url, HOME);
      assert.equal(args.maxRedirects, 0);
      return {
        status: () => 200,
        text: async () => "user_id: '12345'",
        dispose: async () => {
          bodyDisposed = true;
        },
      };
    },
    dispose: async () => {
      disposed = true;
    },
  };
  const result = await verifyHandoff(
    [cookie, { ...cookie, domain: "login.wsb.pl" }],
    "12345",
    async (config) => {
      options = config;
      return api;
    },
  );
  assert.equal(result, api);
  assert.equal(disposed, false);
  assert.equal(bodyDisposed, true);
  assert.deepEqual(options.storageState, { cookies: [cookie], origins: [] });
});

test("failed/mismatched/redirected backend session is discarded", async () => {
  for (const [status, html] of [
    [200, "user_id:'999'"],
    [200, "user_id:null"],
    [302, "user_id:'12345'"],
  ]) {
    let disposed = false;
    const result = await verifyHandoff([cookie], "12345", async () => ({
      get: async () => ({
        status: () => status,
        text: async () => html,
        dispose: async () => {},
      }),
      dispose: async () => {
        disposed = true;
      },
    }));
    assert.equal(result, null);
    assert.equal(disposed, true);
  }
  assert.equal(await verifyHandoff([], "12345"), null);
});

test("HTTP ownership, CSRF/Host validation and owner-only mutations", async (t) => {
  const workers = [];
  const pilot = await createPilot({
    allowAnonymousForTests: true,
    port: 0,
    workerFactory: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
  });
  t.after(() => pilot.close());
  const a = await owner(pilot),
    b = await owner(pilot);
  assert.notEqual(a, b);
  const noAuth = await fetch(`${pilot.origin}/api/status`);
  assert.equal(noAuth.status, 401);
  assert.equal(
    (await post(pilot, a, "start", { origin: "https://example.org" })).status,
    403,
  );
  assert.equal((await post(pilot, a, "start", { origin: "" })).status, 403);
  const wrongHost = await new Promise((resolve) => {
    const req = http.request(
      `${pilot.origin}/api/start`,
      {
        method: "POST",
        headers: { host: "evil.example", origin: pilot.origin, cookie: a },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal(
    (
      await fetch(`${pilot.origin}/api/start?owner=other`, {
        method: "POST",
        headers: { cookie: a, origin: pilot.origin },
      })
    ).status,
    404,
  );
  assert.equal((await post(pilot, a, "start")).status, 200);
  const statusB = await fetch(`${pilot.origin}/api/status`, {
    headers: { cookie: b },
  }).then((r) => r.json());
  assert.equal(statusB.state, "idle");
  assert.equal((await post(pilot, b, "verify")).status, 409);
  assert.equal((await post(pilot, a, "verify")).status, 200);
  assert.equal((await post(pilot, a, "verify")).status, 429);
  assert.equal((await post(pilot, b, "disconnect")).status, 200);
  assert.equal(workers[0].closed, false);
  const statusText = await fetch(`${pilot.origin}/api/status`, {
    headers: { cookie: a },
  }).then((r) => r.text());
  assert.ok(!statusText.includes(SYNTHETIC_SECRET));
  assert.ok(!statusText.includes(a.split("=")[1]));
  assert.equal((await post(pilot, a, "disconnect")).status, 200);
  assert.equal(workers[0].closed, true);
});

test("viewer needs owner cookie and exact Origin, rejects cross-owner input", async (t) => {
  const workers = [];
  const pilot = await createPilot({
    allowAnonymousForTests: true,
    port: 0,
    workerFactory: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
  });
  t.after(() => pilot.close());
  const a = await owner(pilot),
    b = await owner(pilot);
  await post(pilot, a, "start");
  const url = pilot.origin.replace("http", "ws") + "/viewer";
  assert.equal(await rejectedSocket(url, { origin: pilot.origin }), 403);
  assert.equal(
    await rejectedSocket(url, { cookie: b, origin: pilot.origin }),
    403,
  );
  assert.equal(
    await rejectedSocket(url, { cookie: a, origin: "https://example.org" }),
    403,
  );
  const ws = new WebSocket(url, {
    headers: { cookie: a, origin: pilot.origin },
  });
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "text", text: "synthetic-input" }));
  await delay(80);
  assert.equal(workers[0].events[0].text, "synthetic-input");
  ws.close();
});

test("two workers are independent, third slot is rejected, disposal frees capacity", async (t) => {
  const workers = [];
  const pilot = await createPilot({
    allowAnonymousForTests: true,
    port: 0,
    maxBrowsers: 2,
    workerFactory: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
  });
  t.after(() => pilot.close());
  const a = await owner(pilot),
    b = await owner(pilot),
    c = await owner(pilot);
  assert.equal((await post(pilot, a, "start")).status, 200);
  await delay(1250);
  assert.equal((await post(pilot, b, "start")).status, 200);
  assert.equal((await post(pilot, c, "start")).status, 429);
  assert.notEqual(workers[0], workers[1]);
  await post(pilot, a, "disconnect");
  assert.equal(workers[0].closed, true);
  assert.equal(workers[1].closed, false);
  await delay(1250);
  assert.equal((await post(pilot, c, "start")).status, 200);
});

test("idle expiry disposes worker; passive polling does not extend lifetime", async (t) => {
  const w = new FakeWorker();
  const pilot = await createPilot({
    allowAnonymousForTests: true,
    port: 0,
    ttlMs: 150,
    workerFactory: () => w,
  });
  t.after(() => pilot.close());
  const a = await owner(pilot);
  await post(pilot, a, "start");
  await delay(90);
  assert.equal(
    (await fetch(`${pilot.origin}/api/status`, { headers: { cookie: a } }))
      .status,
    200,
  );
  await delay(250);
  assert.equal(
    (await fetch(`${pilot.origin}/api/status`, { headers: { cookie: a } }))
      .status,
    401,
  );
  assert.equal(w.closed, true);
});

test("real sandboxed Chromium renders frames and accepts mouse, typing, paste, select-all, Tab/Enter", async (t) => {
  const worker = new BrowserWorker({ fixtureHtml: FIXTURE });
  t.after(() => worker.close());
  await worker.start();
  const frame = once(worker, "frame");
  await worker.startStream();
  assert.ok((await frame)[0].length > 1000);
  await worker.input({ type: "mouse", action: "mousePressed", x: 100, y: 150 });
  await worker.input({
    type: "mouse",
    action: "mouseReleased",
    x: 100,
    y: 150,
  });
  // Use measured fixture coordinates, not assumptions about font metrics.
  const box = await worker.page.locator("#entry").boundingBox();
  for (const action of ["mousePressed", "mouseReleased"])
    await worker.input({ type: "mouse", action, x: box.x + 10, y: box.y + 10 });
  await worker.input({ type: "text", text: "first" });
  await worker.input({ type: "selectAll" });
  await worker.input({ type: "text", text: "fixture@example.test" });
  await worker.input({ type: "key", key: "Backspace" });
  assert.equal(
    await worker.page.locator("#entry").inputValue(),
    "fixture@example.tes",
  );
  await worker.input({ type: "key", key: "Tab" });
  await worker.input({ type: "key", key: "Enter" });
  assert.equal(
    await worker.page.locator("#result").textContent(),
    "fixture@example.tes",
  );
  await assert.rejects(
    worker.input({ type: "mouse", action: "mousePressed", x: -1, y: 3 }),
  );
  await assert.rejects(worker.input({ type: "key", key: "F12" }));
  await assert.rejects(worker.input({ type: "text", text: "x".repeat(2049) }));
  await worker.page.evaluate(() => {
    const node = document.createElement("div");
    document.body.append(node);
    node.attachShadow({ mode: "open" }).innerHTML =
      '<a href="https://usosweb.ideis.pl/kontroler.php?_action=logowaniecas/index">zaloguj się</a>';
  });
  assert.equal(
    await worker.page.evaluate(() => document.querySelector("a")),
    null,
  );
  assert.equal(
    (await findLoginUrl(worker.page)).searchParams.get("_action"),
    "logowaniecas/index",
  );
  await worker.stopStream();
});

test("actual separate Chromium processes have isolated cookies and close independently", async (t) => {
  const a = new BrowserWorker({ fixtureHtml: FIXTURE }),
    b = new BrowserWorker({ fixtureHtml: FIXTURE });
  t.after(() => Promise.all([a.close(), b.close()]));
  await Promise.all([a.start(), b.start()]);
  assert.notEqual(a.browser, b.browser);
  await a.context.addCookies([
    { name: "fixture", value: "owner-a", url: "https://example.test" },
  ]);
  assert.equal((await b.context.cookies("https://example.test")).length, 0);
  await a.close();
  assert.equal(b.browser.isConnected(), true);
});

test("synthetic end-to-end handoff closes browser, backend recheck works, account drift expires jar", async (t) => {
  let expected = "12345",
    apiClosed = false,
    calls = 0;
  const worker = new BrowserWorker({
    fixtureHtml: FIXTURE,
    createRequest: async (options) => {
      assert.deepEqual(options.storageState.cookies, [cookie]);
      return {
        get: async (url) => {
          assert.equal(url, HOME);
          calls++;
          return {
            status: () => 200,
            text: async () => `user_id: '${expected}'`,
            dispose: async () => {},
          };
        },
        dispose: async () => {
          apiClosed = true;
        },
      };
    },
  });
  t.after(() => worker.close());
  await worker.start();
  await worker.context.route("https://usosweb.ideis.pl/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<h1>Synthetic USOS page</h1><script>const demo = {user_id: '12345'};</script>",
    }),
  );
  await worker.context.addCookies([cookie]);
  await worker.page.goto(HOME);
  assert.equal(await worker.verify(), true);
  assert.equal(worker.browser, null);
  assert.equal(worker.status().backendVerified, true);
  assert.equal(await worker.verify(), true);
  assert.equal(calls, 2);
  expected = "99999";
  assert.equal(await worker.verify(), false);
  assert.equal(worker.status().state, "expired");
  assert.equal(apiClosed, true);
});

test("full viewer UI forwards synthetic keyboard/paste; dark mode persists and disconnect clears frame", async (t) => {
  let worker;
  const pilot = await createPilot({
    allowAnonymousForTests: true,
    port: 0,
    workerFactory: () => (worker = new BrowserWorker({ fixtureHtml: FIXTURE })),
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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pilot.origin);
  await page.getByRole("button", { name: "Toggle dark mode" }).click();
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.locator("#start-main").click();
  await page.waitForFunction(
    () => document.querySelector("#connection").textContent === "LIVE",
  );
  await delay(200);
  const inputBox = await worker.page.locator("#entry").boundingBox();
  const canvas = await page.locator("#screen").boundingBox();
  await page.mouse.click(
    canvas.x + ((inputBox.x + 10) * canvas.width) / 1280,
    canvas.y + ((inputBox.y + 10) * canvas.height) / 800,
  );
  await page.keyboard.type("test");
  await page.keyboard.press("Control+a");
  await page.locator("#screen").evaluate((node) => {
    const data = new DataTransfer();
    data.setData("text/plain", "fixture@university.test");
    node.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
    );
  });
  await worker.page.waitForFunction(
    () => document.querySelector("#entry").value === "fixture@university.test",
  );
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await worker.page.waitForFunction(
    () =>
      document.querySelector("#result").textContent ===
      "fixture@university.test",
  );
  await page.locator("#disconnect").click();
  await page.waitForFunction(
    () => document.querySelector("#state").textContent === "Ready to connect",
  );
  assert.equal(worker.closed, true);
  assert.equal(await page.locator("#screen").isHidden(), true);
  assert.deepEqual(errors, []);
});

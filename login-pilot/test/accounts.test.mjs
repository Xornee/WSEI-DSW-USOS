import { REGISTRATION_CODE } from './registration-fixture.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter, once } from "node:events";
import { WebSocket } from "ws";
import { chromium } from "playwright";
import { AccountStore } from "../accounts.mjs";
import { createPilot } from "../server.mjs";

const password = "synthetic test passphrase 2026";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class Worker extends EventEmitter {
  state = "idle";
  closed = false;
  events = [];
  async start() {
    this.state = "login";
  }
  status() {
    return { state: this.state, requests: [] };
  }
  async verify() {
    this.state = "connected";
    return true;
  }
  async input(event) {
    this.events.push(event);
  }
  async startStream() {}
  async stopStream() {}
  async close() {
    this.closed = true;
    this.state = "disconnected";
  }
}
async function pilot(t, options = {}) {
  const workers = [];
  const app = await createPilot({ registrationCode: REGISTRATION_CODE,
    port: 0,
    accountsPath: ":memory:",
    authLimit: 100,
    workerFactory: () => {
      const worker = new Worker();
      workers.push(worker);
      return worker;
    },
    dashboardFactory: (worker) => ({
      ical: true,
      close() {},
      handle: async () => ({ owner: workers.indexOf(worker) }),
    }),
    ...options,
  });
  t.after(() => app.close());
  return { ...app, workers };
}
async function call(app, path, cookie, body, method = "POST", extra = {}) {
  if (path === '/api/auth/register' && body && typeof body === 'object') body = { ...body, registrationCode: REGISTRATION_CODE };
  return fetch(app.origin + path, {
    method,
    redirect: "manual",
    headers: {
      origin: app.origin,
      ...(cookie ? { cookie } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function register(app, username = "alpha") {
  const response = await call(app, "/api/auth/register", null, {
    username,
    password,
    name: `Fixture ${username}`,
  });
  assert.equal(response.status, 201);
  const user = (await response.json()).user;
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly; SameSite=Strict/);
  return { user, cookie: setCookie.split(";")[0] };
}
async function deniedSocket(app, cookie) {
  const ws = new WebSocket(app.origin.replace("http:", "ws:") + "/viewer", {
    headers: { origin: app.origin, ...(cookie ? { cookie } : {}) },
  });
  ws.on("error", () => {});
  return new Promise((resolve, reject) => {
    ws.on("unexpected-response", (_req, response) => {
      response.resume();
      ws.terminate();
      resolve(response.statusCode);
    });
    ws.on("open", () => {
      ws.close();
      reject(new Error("Unexpected viewer access"));
    });
  });
}

test("internal account store persists hashed passwords and local roles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "usos-account-store-"));
  const path = join(directory, "accounts.sqlite");
  let store = new AccountStore(path);
  try {
    const admin = await store.register({
      username: "Alpha",
      name: "Fixture Alpha",
      password,
    });
    assert.equal(admin.role, "admin");
    const member = await store.register({
      username: "beta",
      name: "Fixture Beta",
      password,
    });
    assert.equal(member.role, "member");
    assert.equal(
      store.db
        .prepare("SELECT name FROM sqlite_master WHERE name='invites'")
        .get(),
      undefined,
    );
    await assert.rejects(
      store.login({ username: "alpha", password: "wrong synthetic password" }),
      /Nieprawidłowy/,
    );
    await assert.rejects(
      store.login({ username: "missing", password }),
      /Nieprawidłowy/,
    );
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.equal((await readFile(path)).includes(Buffer.from(password)), false);
    store.close();
    store = new AccountStore(path);
    assert.deepEqual(await store.login({ username: "ALPHA", password }), admin);
    assert.deepEqual(await store.login({ username: "beta", password }), member);
    // Legacy invitation rows are inert: no destructive migration of existing databases.
    store.db.exec(
      "CREATE TABLE invites(hash TEXT PRIMARY KEY, expires INTEGER, used INTEGER)",
    );
    store.db
      .prepare("INSERT INTO invites VALUES (?,?,?)")
      .run("synthetic-legacy", 0, 1);
    assert.equal(
      (await store.register({ username: "gamma", password, name: "Gamma" }))
        .role,
      "member",
    );
    assert.equal(store.needsSetup(), false);
  } finally {
    store.close();
    await rm(directory, { recursive: true });
  }
});

test("concurrent open registrations yield one administrator and reject duplicate names", async () => {
  const store = new AccountStore(":memory:");
  try {
    const users = await Promise.all(
      ["alpha", "beta"].map((username) =>
        store.register({ username, password, name: username }),
      ),
    );
    assert.equal(users.filter((user) => user.role === "admin").length, 1);
    assert.equal(users.filter((user) => user.role === "member").length, 1);
    await assert.rejects(
      store.register({
        username: users[0].username,
        password,
        name: "duplicate",
      }),
      /inny login/,
    );
    assert.equal(
      (
        await store.register({
          username: "member",
          password,
          name: "Member",
          role: "admin",
        })
      ).role,
      "member",
    );
    await assert.rejects(
      store.register({ username: "bad", password: "short", name: "Bad" }),
      /minimum/,
    );
  } finally {
    store.close();
  }
});

test("anonymous HTTP and websocket access is denied; code-gated registration retains CSRF and app authentication", async (t) => {
  const app = await pilot(t);
  const root = await call(app, "/", null, undefined, "GET");
  assert.equal(root.status, 303);
  assert.equal(root.headers.get("location"), "/account");
  assert.equal(
    (await call(app, "/api/status", null, undefined, "GET")).status,
    401,
  );
  assert.equal((await call(app, "/api/start")).status, 401);
  assert.equal(await deniedSocket(app), 403);
  assert.equal(
    (await call(app, "/api/auth/me", null, undefined, "GET")).status,
    200,
  );
  assert.equal(
    (
      await call(
        app,
        "/api/auth/register",
        null,
        { username: "alpha", password, name: "Alpha" },
        "POST",
        { origin: "http://other.invalid" },
      )
    ).status,
    403,
  );
  const a = await register(app);
  assert.equal(a.user.role, "admin");
  const b = await register(app, "beta");
  assert.equal(b.user.role, "member");
  for (const cookie of [undefined, a.cookie, b.cookie])
    assert.equal((await call(app, "/api/auth/invite", cookie)).status, 404);
  assert.equal(
    (await call(app, "/api/auth/me", b.cookie, undefined, "GET")).status,
    200,
  );
  assert.equal(
    (
      await call(app, "/api/auth/login", a.cookie, {
        username: "beta",
        password,
      })
    ).status,
    409,
  );
});

test("two authenticated accounts own separate workers, viewer input and dashboard data; logout only closes the owner", async (t) => {
  const app = await pilot(t);
  const a = await register(app);
  const b = await register(app, "beta");
  assert.equal((await call(app, "/api/start", a.cookie)).status, 200);
  await delay(1250);
  assert.equal((await call(app, "/api/start", b.cookie)).status, 200);
  assert.notEqual(app.workers[0], app.workers[1]);
  const ws = new WebSocket(app.origin.replace("http:", "ws:") + "/viewer", {
    headers: { origin: app.origin, cookie: a.cookie },
  });
  ws.on("error", () => {});
  await once(ws, "open");
  ws.send(JSON.stringify({ type: "text", text: "fixture-input" }));
  await delay(50);
  assert.equal(app.workers[0].events.length, 1);
  assert.equal(app.workers[1].events.length, 0);
  assert.equal(
    (await call(app, "/api/start", a.cookie, { userId: b.user.id })).status,
    400,
  );
  assert.equal((await call(app, "/api/verify", a.cookie)).status, 200);
  assert.equal((await call(app, "/api/verify", b.cookie)).status, 200);
  assert.equal(
    (await (await call(app, "/api/student", a.cookie, undefined, "GET")).json())
      .owner,
    0,
  );
  assert.equal(
    (await (await call(app, "/api/student", b.cookie, undefined, "GET")).json())
      .owner,
    1,
  );
  assert.equal((await call(app, "/api/auth/logout", a.cookie)).status, 200);
  assert.equal(app.workers[0].closed, true);
  assert.equal(app.workers[1].closed, false);
  assert.equal(
    (await call(app, "/api/student", a.cookie, undefined, "GET")).status,
    401,
  );
  assert.equal(
    (await call(app, "/api/status", b.cookie, undefined, "GET")).status,
    200,
  );
});

test("login rotates sessions, rejects legacy cookies and closes the old worker", async (t) => {
  const app = await pilot(t);
  const a = await register(app);
  await call(app, "/api/start", a.cookie);
  const response = await call(app, "/api/auth/login", null, {
    username: "alpha",
    password,
  });
  assert.equal(response.status, 200);
  const current = response.headers.get("set-cookie").split(";")[0];
  assert.notEqual(current, a.cookie);
  assert.equal(app.workers[0].closed, true);
  assert.equal(
    (await call(app, "/api/status", a.cookie, undefined, "GET")).status,
    401,
  );
  assert.equal(await deniedSocket(app, a.cookie), 403);
  assert.equal(
    (await call(app, "/api/status", current, undefined, "GET")).status,
    200,
  );
  assert.equal(
    (
      await call(
        app,
        "/api/status",
        `usos_dashboard_owner=${"a".repeat(64)}`,
        undefined,
        "GET",
      )
    ).status,
    401,
  );
});

test("authentication attempts are bounded and malformed bodies do not crash the server", async (t) => {
  const app = await pilot(t, { authLimit: 1 });
  assert.equal((await call(app, "/api/auth/login", null, null)).status, 400);
  assert.equal(
    (await call(app, "/api/auth/login", null, { username: "alpha", password }))
      .status,
    401,
  );
  const limited = await call(app, "/api/auth/login", null, {
    username: "alpha",
    password,
  });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get("retry-after"));
  assert.equal(
    (await call(app, "/api/auth/me", null, undefined, "GET")).status,
    200,
  );
});

test("expiry and server restart invalidate app sessions but preserve account login", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "usos-account-restart-"));
  const path = join(directory, "accounts.sqlite");
  let app = await createPilot({ registrationCode: REGISTRATION_CODE, port: 0, accountsPath: path, ttlMs: 100 });
  try {
    const a = await register(app);
    await delay(150);
    assert.equal(
      (await call(app, "/api/status", a.cookie, undefined, "GET")).status,
      401,
    );
    await app.close();
    app = await createPilot({ registrationCode: REGISTRATION_CODE, port: 0, accountsPath: path });
    assert.equal(
      (await call(app, "/api/status", a.cookie, undefined, "GET")).status,
      401,
    );
    assert.equal(
      (
        await call(app, "/api/auth/login", null, {
          username: "alpha",
          password,
        })
      ).status,
      200,
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true });
  }
});

test("real browser account registration, dark theme, menu launch and logout run end to end without remote requests", async (t) => {
  const app = await pilot(t);
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const remote = [];
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== app.origin) {
      remote.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(app.origin);
  await page.waitForSelector("#signed-out:not([hidden])");
  await page.waitForFunction(
    () => document.getElementById("account-notice").textContent === "",
  );
  await page.locator("#theme").click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.locator("#username").fill("browserfixture");
  await page.locator("#name").fill("Fixture Account");
  await page.locator("#password").fill(password);
  await page.locator("#registration-code").fill(REGISTRATION_CODE);
  await page.locator("#submit-account").click();
  await page.waitForSelector("#signed-in:not([hidden])");
  assert.equal(
    await page.locator("#profile-name").textContent(),
    "Fixture Account",
  );
  assert.equal(await page.locator("#invitations").count(), 0);
  assert.equal(await page.getByText("Zaproś znajomego").count(), 0);
  await page.locator("#launch-connection").click();
  await page.waitForURL(app.origin + "/");
  await page.waitForSelector("#screen:not([hidden])");
  assert.equal(app.workers.length, 1);
  await page.locator("#account-menu").click();
  await page.waitForSelector("#signed-in:not([hidden])");
  await page.locator("#logout").click();
  await page.waitForSelector("#signed-out:not([hidden])");
  assert.equal(app.workers[0].closed, true);
  assert.deepEqual(remote, []);
  assert.deepEqual(errors, []);
});

test("concurrent same-account logins keep the authentication lock until the original operation completes", async (t) => {
  const app = await pilot(t);
  await register(app);
  const input = { username: "alpha", password };
  const first = call(app, "/api/auth/login", null, input);
  await delay(30);
  assert.equal((await call(app, "/api/auth/login", null, input)).status, 429);
  assert.equal((await call(app, "/api/auth/login", null, input)).status, 429);
  assert.equal((await first).status, 200);
});

test("account replacement and logout wait for an active browser operation", async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let started = false;
  const app = await pilot(t, {
    workerFactory: () => {
      const worker = new Worker();
      worker.start = async () => {
        started = true;
        await gate;
        worker.state = "login";
      };
      return worker;
    },
  });
  const a = await register(app);
  const opening = call(app, "/api/start", a.cookie);
  while (!started) await delay(5);
  try {
    assert.equal((await call(app, "/api/auth/logout", a.cookie)).status, 409);
    assert.equal(
      (
        await call(app, "/api/auth/login", null, {
          username: "alpha",
          password,
        })
      ).status,
      409,
    );
  } finally {
    release();
  }
  assert.equal((await opening).status, 200);
  assert.equal((await call(app, "/api/auth/logout", a.cookie)).status, 200);
});

test("password boundary accepts eight characters and rejects seven in backend and form", async () => {
  const store = new AccountStore(":memory:");
  try {
    await assert.rejects(
      store.register({
        username: "boundary",
        name: "Fixture",
        password: "1234567",
      }),
      /minimum 8/,
    );
    const user = await store.register({
      username: "boundary",
      name: "Fixture",
      password: "12345678",
    });
    assert.deepEqual(
      await store.login({ username: "boundary", password: "12345678" }),
      user,
    );
    await assert.rejects(
      store.login({ username: "boundary", password: "1234567" }),
      error => error.status === 401,
    );
    const html = await readFile(
      new URL("../public/account.html", import.meta.url),
      "utf8",
    );
    assert.match(html, /id="password"[\s\S]*?minlength="8"/);
    assert.match(html, /Minimum 8 znaków/);
  } finally {
    store.close();
  }
});

test("second user registers with a code in a fresh browser and can log back in without it", async (t) => {
  const app = await pilot(t);
  await register(app, "existinguser");
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    chromiumSandbox: true,
  });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const remote = [];
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== app.origin) {
      remote.push("off-origin");
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(app.origin + "/account");
  await page.waitForSelector("#signed-out:not([hidden])");
  await page.getByRole("button", { name: "Utwórz nowe konto" }).click();
  assert.equal(await page.locator("#registration-code").isVisible(), true);
  await page.locator("#username").fill("newuser");
  await page.locator("#name").fill("New Fixture");
  await page.locator("#password").fill("12345678");
  await page.locator("#registration-code").fill(REGISTRATION_CODE);
  const registered = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/register"),
  );
  await page.locator("#submit-account").click();
  assert.equal((await registered).status(), 201);
  await page.waitForSelector("#signed-in:not([hidden])");
  assert.equal(
    await page.locator("#profile-name").textContent(),
    "New Fixture",
  );
  await page.locator("#logout").click();
  await page.waitForSelector("#signed-out:not([hidden])");
  await page.locator("#username").fill("newuser");
  await page.locator("#password").fill("12345678");
  await page.locator("#submit-account").click();
  await page.waitForSelector("#signed-in:not([hidden])");
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
});

import { TrackCatalog, publicPlan } from '../server/usos/timetable-selection.mjs';
import { TimetableRepository, TimetableError } from "../server/usos/timetable.mjs";
import { createCleanup } from "./cleanup.mjs";
import http from "node:http";
import { KubernetesPool, KubernetesBrowserWorker } from "./kubernetes.mjs";
import { AccountStore, AccountError, usernameOf } from "./accounts.mjs";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import { BrowserWorker } from "./browser.mjs";
import {
  DashboardConnection,
  DashboardError,
  createScheduler,
} from "./dashboard.mjs";

const COOKIE = "usos_dashboard_owner";
const STATIC = new Map([
  ["/account", ["account.html", "text/html; charset=utf-8"]],
  ["/account.js", ["account.js", "text/javascript; charset=utf-8"]],
  ["/account.css", ["account.css", "text/css; charset=utf-8"]],
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/style.css", ["style.css", "text/css; charset=utf-8"]],
  [
    "/dashboard-session.js",
    ["dashboard-session.js", "text/javascript; charset=utf-8"],
  ],
  [
    "/dashboard-session.css",
    ["dashboard-session.css", "text/css; charset=utf-8"],
  ],
]);

export async function createPilot({
  port = 8788,
  bindHost = "127.0.0.1",
  publicOrigin,
  workerFactory = () => new BrowserWorker(),
  ttlMs = 30 * 60_000,
  maxBrowsers = 2,
  verifyIntervalMs = 12_000,
  dashboardFactory,
  dashboardIntervalMs = 1200,
  workerRuntime = "local",
  timetable = null,
  allowAnonymousForTests = false,
  accountsPath = fileURLToPath(
    new URL("./.data/accounts.sqlite", import.meta.url),
  ),
  cleanupRetryMs = 1000,
  authLimit = 12,
  authWindowMs = 60_000,
} = {}) {
  if (!["127.0.0.1", "0.0.0.0"].includes(bindHost))
    throw new Error("Invalid bind host");
  if (publicOrigin !== undefined) {
    const url = new URL(publicOrigin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== publicOrigin ||
        url.username || url.password)
      throw new Error("Invalid public origin");
  }
  if (bindHost !== "127.0.0.1" && !publicOrigin)
    throw new Error("A public origin is required for non-loopback binding");
  const sessions = new Map();
  const accounts = allowAnonymousForTests
    ? null
    : new AccountStore(accountsPath);
  const authBusy = new Set();
  const authAttempts = new Map();
  const cleanup = createCleanup({ retryMs: cleanupRetryMs });
  function budget(key, limit) {
    const now = Date.now();
    for (const [name, item] of authAttempts) if (now >= item.until) authAttempts.delete(name);
    const old = authAttempts.get(key);
    if (!old && authAttempts.size >= 4096) return false;
    const item = old || { count: 0, until: now + authWindowMs };
    authAttempts.set(key, item);
    return ++item.count <= limit;
  }
  let origin;
  let lastUpstreamStart = 0;
  const schedule = createScheduler(dashboardIntervalMs);
  const trackCatalog = timetable ? new TrackCatalog(timetable) : null;
  const makeDashboard =
    dashboardFactory ||
    ((worker) => new DashboardConnection(worker, { schedule, timetable, trackCatalog }));
  const dashboardAssets = new Map();
  try {
    const files = JSON.parse(
      await readFile(
        new URL("./dashboard-dist/files.json", import.meta.url),
        "utf8",
      ),
    );
    for (const file of files) {
      if (!/^(index\.html|theme\.js|favicon\.svg|assets\/[\w.-]+)$/.test(file))
        throw new Error("Invalid build asset");
      const type = file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : file.endsWith(".svg")
            ? "image/svg+xml"
            : "text/html";
      dashboardAssets.set(`/dashboard/${file === "index.html" ? "" : file}`, {
        type,
        body: await readFile(
          new URL(`./dashboard-dist/${file}`, import.meta.url),
        ),
      });
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const assets = new Map(
    await Promise.all(
      [...STATIC].map(async ([path, [file, type]]) => [
        path,
        {
          type,
          body: await readFile(new URL(`./public/${file}`, import.meta.url)),
        },
      ]),
    ),
  );
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false,
  });

  function owner(req) {
    const value = req.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1);
    const session = value && /^[a-f0-9]{64}$/.test(value) ? sessions.get(value) : undefined;
    if (session?.user && accounts) {
      const current = accounts.security(session.user.id);
      if (current.disabled || current.version !== session.version) {
        sessions.delete(value);
        void dispose(session).catch(() => console.error('REVOKED_SESSION_CLEANUP_FAILED'));
        return undefined;
      }
    }
    return session;
  }
  function validHost(req) {
    return req.headers.host === new URL(origin).host;
  }
  function validOrigin(req) {
    return req.headers.origin === origin;
  }
  function status(session) {
    return {
      ...(session.worker?.status() || { state: "idle", requests: [] }),
      user: session.user || null,
      busy: session.busy,
      expiresAt: new Date(session.createdAt + ttlMs).toISOString(),
      localPilot: true,
      workerRuntime,
      maxBrowsers,
      dashboardReady: dashboardAssets.has("/dashboard/"),
      calendarConfigured: Boolean(timetable || session.dashboard?.ical),
      timetableSource: timetable ? "ideis-krakow" : null,
      calendarState: session.dashboard?.calendarState || "not_connected",
      connectionId: session.generation || null,
    };
  }
  function send(ws, message) {
    if (ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < 1_000_000)
      ws.send(JSON.stringify(message));
  }
  async function dispose(session) {
    session.dashboard?.close();
    session.dashboard = null;
    const worker = session.worker;
    session.worker = null;
    session.ws?.close(1000, "Session closed");
    session.ws = null;
    await cleanup.release(worker);
  }
  function newSession(user = null) {
    return {
      user,
      version: user && accounts ? accounts.security(user.id).version : 0,
      createdAt: Date.now(),
      touched: Date.now(),
      busy: false,
      worker: null,
      ws: null,
      lastVerify: 0,
    };
  }
  function setOwnerCookie(res, id) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil(ttlMs / 1000)}${origin.startsWith("https:") ? "; Secure" : ""}`,
    );
  }
  async function authRoute(req, res, json, session) {
    if (req.method === "GET" && req.url === "/api/auth/me")
      return json(200, {
        user: session?.user || null,
        setupRequired: accounts.needsSetup(),
      });
    if (
      req.method !== "POST" ||
      !["/api/auth/register", "/api/auth/login", "/api/auth/logout", "/api/auth/password", "/api/auth/recovery-code", "/api/auth/recover", "/api/auth/revoke", "/api/auth/lock"].includes(
        req.url,
      )
    )
      return json(404, { error: "Not found" });
    if (!validOrigin(req)) return json(403, { error: "Origin required" });
    const credentials = req.url !== "/api/auth/logout";
    const securityAction = ["password", "recovery-code", "revoke", "lock"].find(action => req.url === `/api/auth/${action}`);
    if (
      req.headers["transfer-encoding"] ||
      Number(req.headers["content-length"] || 0) > (credentials ? 2048 : 0)
    )
      return json(400, { error: "Invalid body size" });
    if (req.url === "/api/auth/logout") {
      if (session?.busy)
        return json(409, { error: "Poczekaj na zakończenie operacji." });
      for (const [id, item] of sessions)
        if (item === session) sessions.delete(id);
      if (session) await dispose(session);
      res.setHeader(
        "Set-Cookie",
        `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${origin.startsWith("https:") ? "; Secure" : ""}`,
      );
      return json(200, { ok: true });
    }
    if (securityAction && !session?.user) return json(401, { error: "Zaloguj się ponownie." });
    if (session && !securityAction) return json(409, { error: "Wyloguj się przed zmianą konta." });
    let key;
    let locked = false;
    try {
      if (!req.headers["content-type"]?.startsWith("application/json"))
        throw new AccountError(400, "Wymagany JSON.");
      let body = "";
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 2048)
          throw new AccountError(400, "Żądanie jest zbyt duże.");
      }
      let input;
      try {
        input = JSON.parse(body);
      } catch {
        throw new AccountError(400, "Nieprawidłowy JSON.");
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new AccountError(400, "Nieprawidłowy formularz.");
      key = securityAction ? session.user.username : usernameOf(input.username);
      // Only socket identity is trusted; forwarded headers never select a budget.
      if (!budget(`account:${key}`, authLimit) ||
          !budget(`source:${req.socket.remoteAddress}`, Math.max(96, authLimit * 8))) {
        res.setHeader("Retry-After", String(Math.ceil(authWindowMs / 1000)));
        throw new AccountError(429, "Za dużo prób. Spróbuj ponownie za minutę.");
      }
      if (authBusy.has(key) || authBusy.size >= 2)
        throw new AccountError(429, "Logowanie jest już w toku.");
      authBusy.add(key);
      locked = true;
      // Never replace an account connection while a browser operation is still running.
      const prior = [...sessions.values()].find(
        (s) => s.user?.username === key,
      );
      if (prior?.busy)
        throw new AccountError(
          409,
          "Operacja USOS trwa. Spróbuj ponownie za chwilę.",
        );
      if (sessions.size >= 32 && !prior)
        throw new AccountError(429, "Limit aktywnych sesji.");
      if (securityAction) {
        const result = await accounts.securityAction(session.user, input, securityAction);
        if (securityAction !== 'recovery-code') {
          for (const [id, item] of sessions) if (item.user?.id === session.user.id) {
            sessions.delete(id); await dispose(item);
          }
          res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${origin.startsWith('https:') ? '; Secure' : ''}`);
        }
        return json(200, result);
      }
      if (req.url === '/api/auth/recover') {
        const user = await accounts.recover(input);
        for (const [id, item] of sessions) if (item.user?.id === user.id) {
          sessions.delete(id); await dispose(item);
        }
        return json(200, { ok: true });
      }
      const user =
        await accounts[req.url.endsWith("register") ? "register" : "login"](
          input,
        );
      if (prior?.busy)
        throw new AccountError(
          409,
          "Operacja USOS trwa. Spróbuj ponownie za chwilę.",
        );
      // A new login rotates the token and invalidates all old tabs/viewers for this account.
      for (const [id, item] of sessions) {
        if (item.user?.id === user.id) {
          sessions.delete(id);
          await dispose(item);
        }
      }
      const id = randomBytes(32).toString("hex");
      sessions.set(id, newSession(user));
      setOwnerCookie(res, id);
      return json(req.url.endsWith("register") ? 201 : 200, { user });
    } catch (error) {
      return json(error instanceof AccountError ? error.status : 500, {
        error:
          error instanceof AccountError
            ? error.message
            : "Operacja konta nie powiodła się.",
      });
    } finally {
      if (locked) authBusy.delete(key);
    }
  }
  const server = http.createServer((req, res) => {
    void handleRequest(req, res).catch(() => {
      console.error("HTTP_HANDLER_FAILED");
      if (!res.headersSent) res.writeHead(500, { "Content-Type": "application/json" });
      if (!res.writableEnded) res.end(JSON.stringify({ error: "Operacja nie powiodła się." }));
    });
  });
  async function handleRequest(req, res) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    const json = (code, body) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (!validHost(req) || (req.headers.origin && !validOrigin(req)))
      return json(403, { error: "Origin rejected" });
    if (req.headers["sec-fetch-site"] === "cross-site")
      return json(403, { error: "Cross-site request rejected" });
    if (req.method === "GET" && req.url === "/healthz")
      return json(200, { status: "ok" });
    if (req.method === "GET" && req.url === "/readyz")
      return json(dashboardAssets.has("/dashboard/") ? 200 : 503, {
        status: dashboardAssets.has("/dashboard/") ? "ready" : "missing_dashboard",
      });
    const path = req.url;
    let session = owner(req);
    if (session && Date.now() - session.createdAt > ttlMs) {
      for (const [id, item] of sessions)
        if (item === session) sessions.delete(id);
      await dispose(session);
      session = undefined;
    }
    const requestUrl = new URL(req.url, origin);
    if (timetable && req.method === "GET" && requestUrl.pathname === "/api/plan") {
      try {
        if (requestUrl.searchParams.getAll("trackId").length > 1 || [...requestUrl.searchParams.keys()].some(key => !["trackId", "scope"].includes(key)))
          throw new TimetableError(400, "Nieprawidłowy wybór toku.");
        if (requestUrl.searchParams.getAll("scope").length > 1 || (requestUrl.searchParams.has("scope") && requestUrl.searchParams.get("scope") !== "public"))
          throw new TimetableError(400, "Nieprawidłowy zakres planu.");
        const selected = requestUrl.searchParams.get("trackId") ?? undefined;
        if (requestUrl.searchParams.get("scope") !== "public" && session?.worker?.state === "connected") {
          const worker = session.worker;
          session.dashboard ??= makeDashboard(worker);
          const plan = await session.dashboard.plan(selected);
          if (session.worker !== worker || worker.state !== "connected") throw new DashboardError(401, "Sesja została rozłączona.");
          return json(200, plan);
        }
        return json(200, await publicPlan(timetable, selected));
      } catch (error) {
        return json(error instanceof TimetableError || error instanceof DashboardError ? error.status : 502, {
          ok: false, data: null, error: error instanceof TimetableError || error instanceof DashboardError ? error.message : "Import planu nie powiódł się.",
          meta: { source: "live", stale: false, fetchedAt: new Date().toISOString() },
        });
      }
    }
    if (timetable && req.method === "GET" && (req.url === "/schedule" || (req.url !== "/dashboard/" && dashboardAssets.has(req.url)))) {
      const asset = dashboardAssets.get(req.url === "/schedule" ? "/dashboard/" : req.url);
      if (!asset) return json(503, { error: "Brak zbudowanego panelu." });
      res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
      res.writeHead(200, { "Content-Type": asset.type });
      return res.end(req.url === "/schedule" ? asset.body.toString().replace("</head>", '<meta name="usos-public-plan" content="true"></head>') : asset.body);
    }
    if (accounts && path.startsWith("/api/auth/"))
      return authRoute(req, res, json, session);
    if (req.method === "GET" && assets.has(path)) {
      if (accounts && path === "/" && !session) {
        res.writeHead(303, { Location: "/account" });
        return res.end();
      }
      if (!accounts && path === "/" && !session) {
        if (sessions.size >= 32)
          return json(429, { error: "Pilot session limit reached" });
        const id = randomBytes(32).toString("hex");
        session = newSession();
        sessions.set(id, session);
        setOwnerCookie(res, id);
      }
      const asset = assets.get(path);
      res.writeHead(200, { "Content-Type": asset.type });
      return res.end(asset.body);
    }
    if (req.method === "GET" && req.url.startsWith("/dashboard/")) {
      if (
        !session ||
        Date.now() - session.createdAt > ttlMs ||
        session.worker?.state !== "connected"
      ) {
        res.writeHead(303, { Location: "/" });
        return res.end();
      }
      const asset = dashboardAssets.get(req.url);
      if (!asset)
        return json(404, {
          error: "Build the dashboard with npm run build:dashboard first.",
        });
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
      res.writeHead(200, { "Content-Type": asset.type });
      return res.end(
        req.url === "/dashboard/"
          ? asset.body
              .toString()
              .replace(
                "</head>",
                `<meta name="usos-connection" content="${session.generation}"></head>`,
              )
          : asset.body,
      );
    }
    if (!session || Date.now() - session.createdAt > ttlMs)
      return json(401, { error: "Session expired. Reload this page." });
    if (req.method === "GET" && path === "/api/status")
      return json(200, status(session));
    if (req.method === "GET" && path.startsWith("/api/")) {
      const worker = session.worker;
      try {
        if (worker?.state !== "connected")
          throw new DashboardError(401, "Połącz USOS na stronie logowania.");
        session.dashboard ??= makeDashboard(worker);
        const data = await session.dashboard.handle(new URL(path, origin));
        if (session.worker !== worker || worker.state !== "connected")
          throw new DashboardError(401, "Sesja została rozłączona.");
        return json(200, data);
      } catch (error) {
        return json(error instanceof DashboardError || error instanceof TimetableError ? error.status : 502, {
          ok: false,
          data: null,
          error:
            (error instanceof DashboardError || error instanceof TimetableError)
              ? error.message
              : "Dane chwilowo niedostępne. Spróbuj ponownie.",
          meta: {
            source: "live",
            stale: false,
            fetchedAt: new Date().toISOString(),
          },
        });
      }
    }
    if (
      req.method !== "POST" ||
      ![
        "/api/start",
        "/api/verify",
        "/api/disconnect",
        "/api/calendar",
        "/api/calendar/auto",
      ].includes(path)
    )
      return json(404, { error: "Not found" });
    if (!validOrigin(req)) return json(403, { error: "Origin required" });
    // Mutations accept no body and no user/connection selector.
    if (
      req.headers["transfer-encoding"] ||
      (path === "/api/calendar"
        ? Number(req.headers["content-length"] || 0) > 4096
        : Number(req.headers["content-length"] || 0) !== 0)
    )
      return json(400, { error: "This route accepts no body" });
    if (session.busy)
      return json(409, { error: "An operation is already running" });
    session.busy = true;
    session.operation = path;
    session.touched = Date.now();
    try {
      if (path === "/api/calendar/auto") {
        if (session.worker?.state !== "connected")
          throw new DashboardError(401, "Najpierw połącz USOS.");
        session.dashboard ??= makeDashboard(session.worker);
        await session.dashboard.connectCalendarAutomatically();
      } else if (path === "/api/calendar") {
        if (session.worker?.state !== "connected")
          throw new DashboardError(401, "Najpierw połącz USOS.");
        if (!req.headers["content-type"]?.startsWith("application/json"))
          throw new DashboardError(400, "Wymagany format JSON.");
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 4096)
            throw new DashboardError(400, "Żądanie jest zbyt duże.");
        }
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new DashboardError(400, "Nieprawidłowy JSON.");
        }
        session.dashboard ??= makeDashboard(session.worker);
        await session.dashboard.setCalendar(parsed?.url);
      } else if (path === "/api/disconnect") {
        await dispose(session);
      } else if (path === "/api/start") {
        const active = [...sessions.values()].filter(
          (s) => s !== session && (s.operation === "/api/start" || (s.worker && !["connected", "expired", "disconnected"].includes(s.worker.state))),
        ).length;
        if (active + cleanup.size >= maxBrowsers)
          return json(429, {
            error: "Przeglądarki są zajęte lub trwa ich sprzątanie. Spróbuj za chwilę.",
          });
        if (Date.now() - lastUpstreamStart < 1200)
          return json(429, {
            error: "Wait a moment before starting another login.",
          });
        lastUpstreamStart = Date.now();
        await dispose(session);
        session.generation = randomBytes(16).toString("hex");
        session.lastVerify = 0;
        session.worker = workerFactory();
        await session.worker.start();
      } else {
        if (!session.worker)
          return json(409, { error: "Start a login first." });
        if (Date.now() - session.lastVerify < verifyIntervalMs)
          return json(429, { error: "Wait 12 seconds before checking again." });
        session.lastVerify = Date.now();
        const verified = await session.worker.verify();
        if (!verified)
          return json(409, {
            error:
              "Finish Microsoft login and return to USOS first. An expired session needs a new login.",
            ...status(session),
          });
        session.ws?.close(1000, "Backend connected");
        session.dashboard ??= makeDashboard(session.worker);
        if (
          !timetable && !session.dashboard.ical &&
          Date.now() - session.dashboard.lastAutoAttempt >= 30_000
        ) {
          await session.dashboard.connectCalendarAutomatically();
        }
      }
      session.busy = false;
      return json(200, status(session));
    } catch (error) {
      // Browser errors can include URLs, form data or cookies; never serialize them.
      if (path === "/api/start") {
        // Only a closed set of operation labels is logged, never browser errors/URLs.
        const phases = new Set(["create-job", "create-capability", "pod-readiness",
          "worker-transport", "browser-protocol", "browser-start"]);
        console.error("CHROMIUM_START_FAILED", phases.has(error.code) ? error.code : "unknown");
        await dispose(session);
      }
      return json(error instanceof DashboardError || error instanceof TimetableError ? error.status : 502, {
        error:
          error instanceof DashboardError
            ? error.message
            : "The operation did not complete. Retry or start a fresh login.",
      });
    } finally {
      session.busy = false;
      session.operation = null;
    }
  }
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;

  server.on("upgrade", (req, socket, head) => {
    const session = owner(req);
    if (
      req.url !== "/viewer" ||
      !validHost(req) ||
      !validOrigin(req) ||
      !session?.worker ||
      Date.now() - session.createdAt > ttlMs ||
      session.worker.status().state !== "login"
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      session.ws?.close(1000, "Viewer replaced");
      session.ws = ws;
      const worker = session.worker;
      const frame = (data) => send(ws, { type: "frame", data });
      const changed = () => send(ws, { type: "status", ...status(session) });
      worker.on("frame", frame);
      worker.on("status", changed);
      changed();
      let pending = 0;
      let queue = Promise.resolve();
      ws.on("message", (data) => {
        if (
          session.ws !== ws ||
          session.worker !== worker ||
          pending >= 64 ||
          session.busy
        )
          return;
        let event;
        try {
          event = JSON.parse(data.toString());
          if (!event || typeof event !== "object") throw new Error();
        } catch {
          ws.close(1008, "Invalid input");
          return;
        }
        session.touched = Date.now();
        pending++;
        queue = queue
          .then(() => worker.input(event))
          .catch(() => ws.close(1008, "Invalid input"))
          .finally(() => pending--);
      });
      ws.on("error", () => {});
      ws.on("close", () => {
        worker.off("frame", frame);
        worker.off("status", changed);
        if (session.ws === ws) {
          session.ws = null;
          void worker.stopStream().catch(() => {});
        }
      });
      void worker
        .startStream()
        .catch(() => ws.close(1011, "Viewer interrupted"));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bindHost, resolve);
  });
  origin = publicOrigin || `http://127.0.0.1:${server.address().port}`;
  const timer = setInterval(
    () => {
      for (const [id, session] of sessions) {
        if (!session.busy && Date.now() - session.createdAt > ttlMs) {
          sessions.delete(id);
          void dispose(session).catch(() => console.error("SESSION_CLEANUP_FAILED"));
        }
      }
    },
    Math.min(ttlMs, 15_000),
  );
  timer.unref();
  return {
    origin,
    address: server.address(),
    async close() {
      clearInterval(timer);
      await Promise.all([...sessions.values()].map(dispose));
      sessions.clear();
      await cleanup.close();
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
      await new Promise((resolve) => server.close(resolve));
      accounts?.close();
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PILOT_PORT || 8789);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid PILOT_PORT");
  const runtime = process.env.WORKER_BACKEND || "local";
  if (!["local", "kubernetes"].includes(runtime))
    throw new Error("Invalid WORKER_BACKEND");
  const pool =
    runtime === "kubernetes"
      ? new KubernetesPool({
          kubeconfig: process.env.USOS_KUBECONFIG,
          inCluster: process.env.USOS_IN_CLUSTER === "true",
          image: process.env.USOS_WORKER_IMAGE || "usos-chromium:2026-09-14-security-v3",
        })
      : null;
  if (pool) await pool.assertTarget();
  const pilot = await createPilot({
    port,
    bindHost: process.env.PILOT_BIND_HOST || "127.0.0.1",
    publicOrigin: process.env.PILOT_PUBLIC_ORIGIN,
    ...(process.env.PILOT_ACCOUNTS_PATH ? { accountsPath: process.env.PILOT_ACCOUNTS_PATH } : {}),
    workerRuntime: runtime,
    timetable: new TimetableRepository({ defaultTrackId: process.env.TIMETABLE_TRACK_ID || "958" }),
    ...(pool
      ? { workerFactory: () => new KubernetesBrowserWorker({ pool }) }
      : {}),
  });
  console.log(
    `USOS login pilot: ${pilot.origin} (two isolated slots; workers=${runtime})`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await pilot.close();
      await pool?.close();
      process.exit(0);
    });
}

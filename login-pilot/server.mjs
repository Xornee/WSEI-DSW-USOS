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
import { WorkflowError } from './workflows.mjs';
import { PlanPreferenceError } from './personal-plan.mjs';
import { serializePlan } from '../shared/plan-calendar.mjs';
import { registrationGate } from './registration.mjs';
import { SocialLogin, SocialLoginError, socialConfiguration } from './social-login.mjs';
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
  maxBrowsers = 5,
  registrationCode = process.env.PILOT_REGISTRATION_CODE || '',
  loginIdleMs = 5 * 60_000,
  loginHardMs = 10 * 60_000,
  loginStartIntervalMs = 1200,
  socialConfig = socialConfiguration(),
  socialFetch = fetch,
  socialProvidersForTests = null,
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
  if (!Number.isInteger(maxBrowsers) || maxBrowsers < 1 || maxBrowsers > 8 ||
      !Number.isFinite(loginIdleMs) || loginIdleMs < 1 || !Number.isFinite(loginHardMs) || loginHardMs < loginIdleMs ||
      !Number.isFinite(loginStartIntervalMs) || loginStartIntervalMs < 0) throw new Error('Invalid login capacity configuration');
  if (!["127.0.0.1", "0.0.0.0"].includes(bindHost))
    throw new Error("Invalid bind host");
  if (publicOrigin !== undefined) {
    const url = new URL(publicOrigin);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== publicOrigin ||
        url.username || url.password || (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname)))
      throw new Error("Invalid public origin");
  }
  if (bindHost !== "127.0.0.1" && !publicOrigin)
    throw new Error("A public origin is required for non-loopback binding");
  const registration = registrationGate(registrationCode);
  const sessions = new Map();
  const accounts = allowAnonymousForTests
    ? null
    : new AccountStore(accountsPath);
  const authBusy = new Set();
  const authAttempts = { source: new Map(), account: new Map(), social: new Map(), public: new Map(), unknown: new Map() };
  const publicImports = new Map();
  let publicImportCount = 0, anonymousImportCount = 0;
  const cleanup = createCleanup({ retryMs: cleanupRetryMs });
  const completedSocial = new Map();
  const social = new SocialLogin({ config: socialConfig, fetcher: socialFetch, providersForTests: socialProvidersForTests });
  function budget(key, limit) {
    const now = Date.now();
    const map = authAttempts[key.split(':', 1)[0]] || authAttempts.source;
    for (const [name, item] of map) if (now >= item.until) map.delete(name);
    const old = map.get(key);
    if (!old && map.size >= 4096) {
      if (map === authAttempts.account) return false; // Never evict a live known-account limit.
      map.delete(map.keys().next().value);
    }
    const item = old || { count: 0, until: now + authWindowMs };
    map.delete(key); map.set(key, item);
    return ++item.count <= limit;
  }
  let origin;
  let lastUpstreamStart = 0;
  let launchQueue = Promise.resolve();
  function waitForLaunch() {
    const next = launchQueue.then(async () => {
      const wait = loginStartIntervalMs - (Date.now() - lastUpstreamStart);
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      lastUpstreamStart = Date.now();
    });
    launchQueue = next.catch(() => {}); return next;
  }
  const schedule = createScheduler(dashboardIntervalMs);
  const trackCatalog = timetable ? new TrackCatalog(timetable) : null;
  const makeDashboard =
    dashboardFactory ||
    ((worker, session) => new DashboardConnection(worker, { schedule, timetable, trackCatalog,
      planPreferences: accounts && session.user ? accounts.planPreferences(session.user.id) : null }));
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
    const values = (req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(`${ownerCookie()}=`));
    const value = values.length === 1 ? values[0].slice(ownerCookie().length + 1) : '';
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
  function ownerCookie() { return origin.startsWith('https:') ? '__Host-usos_dashboard_owner' : COOKIE; }
  function setOwnerCookie(res, id) {
    res.setHeader(
      "Set-Cookie",
      `${ownerCookie()}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil(ttlMs / 1000)}${origin.startsWith("https:") ? "; Secure" : ""}`,
    );
  }
  function flowCookie() { return origin.startsWith('https:') ? '__Host-usos_oidc_flow' : 'usos_oidc_flow'; }
  function setFlowCookie(res, value, maxAge = 300) {
    res.setHeader('Set-Cookie', `${flowCookie()}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`);
  }
  function readFlowCookie(req) {
    const values = (req.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith(flowCookie() + '='));
    return values.length === 1 ? values[0].slice(flowCookie().length + 1) : '';
  }
  async function socialRoute(req, res, json, session, url) {
    if (!accounts) return json(404, { error: 'Logowanie zewnętrzne wymaga kont platformy.' });
    if (req.method === 'GET' && url.pathname === '/api/auth/providers')
      return json(200, { providers: social.publicProviders(), linked: session?.user ? accounts.socialIdentities(session.user.id) : [] });
    for (const [key, proof] of completedSocial) if (proof.expires <= Date.now()) completedSocial.delete(key);
    if (url.pathname === '/api/auth/oauth/complete') {
      let key, acquired = false;
      try {
        if (req.method !== 'POST' || !validOrigin(req) || url.search || Number(req.headers['content-length']) > 0 || req.headers['transfer-encoding'])
          throw new SocialLoginError(403, 'Potwierdź logowanie na stronie platformy.');
        const browser = readFlowCookie(req), proof = completedSocial.get(browser);
        if (!proof) throw new SocialLoginError(410, 'Logowanie wygasło lub zostało już wykorzystane.');
        completedSocial.delete(browser); setFlowCookie(res, '', 0);
        const { flow, identity } = proof;
        const user = flow.action === 'link' ? session?.user : accounts.loginSocial(identity);
        if (!user) throw new SocialLoginError(401, 'Zaloguj się i rozpocznij powiązanie ponownie.');
        key = user.username;
        if (authBusy.has(key) || authBusy.size >= 2) throw new SocialLoginError(429, 'Operacja konta jest w toku. Rozpocznij ponownie.');
        authBusy.add(key); acquired = true;
        if (flow.action === 'link') {
          const prior = sessions.get(flow.owner.sessionId), security = accounts.security(user.id);
          if (session !== prior || user.id !== flow.owner.userId || Date.now() - prior.createdAt > ttlMs || prior.busy ||
              security.disabled || security.version !== flow.owner.version)
            throw new SocialLoginError(401, 'Sesja powiązania wygasła. Zaloguj się i rozpocznij ponownie.');
          accounts.linkSocial(user.id, identity);
          sessions.delete(flow.owner.sessionId);
          const id = randomBytes(32).toString('hex'); sessions.set(id, prior); setOwnerCookie(res, id);
        } else {
          if (session) throw new SocialLoginError(409, 'Wyloguj się przed zmianą konta.');
          const existing = [...sessions.values()].filter(item => item.user?.id === user.id);
          if (existing.some(item => item.busy)) throw new SocialLoginError(409, 'Operacja konta jest w toku.');
          if (sessions.size >= 32 && !existing.length) throw new SocialLoginError(429, 'Limit aktywnych sesji.');
          const version = accounts.security(user.id).version;
          for (const [id, item] of sessions) if (item.user?.id === user.id) { sessions.delete(id); await dispose(item); }
          // Recheck after asynchronous cleanup: revocation/unlink cannot race a new cookie.
          if (accounts.security(user.id).version !== version) throw new SocialLoginError(401, 'Konto zmieniło stan. Rozpocznij ponownie.');
          accounts.loginSocial(identity);
          const id = randomBytes(32).toString('hex'); sessions.set(id, newSession(user)); setOwnerCookie(res, id);
        }
        res.setHeader('Set-Cookie', [res.getHeader('Set-Cookie'), `${flowCookie()}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${origin.startsWith('https:') ? '; Secure' : ''}`]);
        return json(200, { ok: true });
      } catch (error) {
        const known = error instanceof SocialLoginError || error instanceof AccountError;
        return json(known ? error.status : 502, { error: known ? error.message : 'Logowanie nie zostało potwierdzone. Rozpocznij ponownie.' });
      } finally { if (acquired) authBusy.delete(key); }
    }
    const match = url.pathname.match(/^\/api\/auth\/oauth\/(google|microsoft)\/(start|link|unlink|callback)$/);
    if (!match) return json(404, { error: 'Nieznany dostawca lub czynność.' });
    const [, provider, action] = match;
    let locked = false;
    try {
      if (action === 'callback') {
        if (req.method !== 'GET') return json(405, { error: 'Callback wymaga GET.' });
        const allowed = ['state', 'code', 'error', 'error_description', 'error_uri', 'session_state', 'iss', 'scope', 'authuser', 'prompt'];
        if ([...url.searchParams.keys()].some(key => !allowed.includes(key) || url.searchParams.getAll(key).length !== 1) || url.search.length > 8192)
          throw new SocialLoginError(400, 'Nieprawidłowa odpowiedź logowania.');
        const browser = readFlowCookie(req);
        const flow = social.consume(provider, url.searchParams.get('state'), browser);
        if (url.searchParams.has('error')) throw new SocialLoginError(401, 'Dostawca nie potwierdził logowania.');
        if (url.searchParams.has('iss') && !social.providers[provider].issuers.includes(url.searchParams.get('iss')))
          throw new SocialLoginError(403, 'Odpowiedź pochodzi od innego dostawcy.');
        const identity = await social.verify(provider, flow, url.searchParams.get('code'));
        if (completedSocial.size >= 256) throw new SocialLoginError(429, 'Za dużo logowań. Rozpocznij ponownie później.');
        completedSocial.set(browser, { flow, identity, expires: Math.min(flow.expires, Date.now() + 60_000) });
        // A same-origin POST sees the Strict app cookie, preventing silent account switches during a cross-site redirect.
        res.writeHead(303, { Location: '/account?oauth=complete' }); return res.end();
      }
      if (req.method !== 'POST') return json(405, { error: 'Rozpoczęcie logowania wymaga POST.' });
      if (!validOrigin(req) || url.search || !(req.headers['content-type'] || '').startsWith('application/json'))
        throw new SocialLoginError(403, 'Rozpocznij czynność w interfejsie platformy.');
      if (!budget(`social:${req.socket.remoteAddress}`, 36)) throw new SocialLoginError(429, 'Za dużo prób logowania.');
      if (action === 'start' && session) throw new SocialLoginError(409, 'Wyloguj się przed zmianą konta.');
      if (action !== 'start' && !session?.user) throw new SocialLoginError(401, 'Zaloguj się do platformy.');
      if (session?.busy) throw new SocialLoginError(409, 'Operacja konta jest w toku.');
      if (authBusy.size >= 2) throw new SocialLoginError(429, 'Inne logowanie jest w toku.');
      const key = session?.user?.username || `social:${req.socket.remoteAddress}`;
      if (authBusy.has(key)) throw new SocialLoginError(429, 'Operacja konta jest w toku.');
      authBusy.add(key); locked = key;
      let body = '', input;
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 2048) throw new SocialLoginError(413, 'Żądanie jest zbyt duże.'); }
      try { input = JSON.parse(body); } catch { throw new SocialLoginError(400, 'Nieprawidłowy JSON.'); }
      if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(name => name !== 'currentPassword'))
        throw new SocialLoginError(400, 'Nieprawidłowe dane czynności.');
      if (action !== 'start') {
        if (!budget(`account:${session.user.username}`, authLimit)) throw new SocialLoginError(429, 'Za dużo prób. Spróbuj później.');
        await accounts.login({ username: session.user.username, password: input.currentPassword });
      }
      const sessionId = session ? [...sessions].find(([, item]) => item === session)?.[0] : null;
      if (session && (!sessionId || session.busy || Date.now() - session.createdAt > ttlMs ||
          accounts.security(session.user.id).version !== session.version || accounts.security(session.user.id).disabled))
        throw new SocialLoginError(401, 'Sesja wygasła. Zaloguj się ponownie.');
      if (action === 'unlink') {
        for (const [browser, proof] of completedSocial) {
          if (proof.identity.provider !== provider) continue;
          let userId = proof.flow.owner?.userId;
          if (proof.flow.action === 'login') { try { userId = accounts.loginSocial(proof.identity).id; } catch {} }
          if (userId === session.user.id) completedSocial.delete(browser);
        }
        accounts.unlinkSocial(session.user.id, provider); social.cancelOwner(session.user.id, provider);
        return json(200, { ok: true });
      }
      const result = social.begin(provider, origin, action === 'link' ? 'link' : 'login', session ?
        { sessionId, userId: session.user.id, version: session.version } : null);
      setFlowCookie(res, result.browser); return json(200, { url: result.url });
    } catch (error) {
      const known = error instanceof SocialLoginError || error instanceof AccountError;
      return json(known ? error.status : 502, { error: known ? error.message : 'Logowanie nie zostało potwierdzone. Rozpocznij ponownie.' });
    } finally { if (locked) authBusy.delete(locked); }
  }
  async function authRoute(req, res, json, session) {
    if (req.method === "GET" && req.url === "/api/auth/me")
      return json(200, {
        user: session?.user || null,
        setupRequired: accounts.needsSetup(),
        registrationRequiresCode: true,
        registrationEnabled: registration.enabled,
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
        `${ownerCookie()}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${origin.startsWith("https:") ? "; Secure" : ""}`,
      );
      return json(200, { ok: true });
    }
    if (securityAction && !session?.user) return json(401, { error: "Zaloguj się ponownie." });
    if (session && !securityAction) return json(409, { error: "Wyloguj się przed zmianą konta." });
    let key;
    let locked = false;
    const claimed = [];
    const claimAccount = userId => {
      const owners = [...sessions.values()].filter(item => item.user?.id === userId);
      if (owners.some(item => item.busy)) throw new AccountError(409, 'Operacja USOS trwa. Spróbuj ponownie za chwilę.');
      for (const item of owners) { item.busy = true; claimed.push(item); }
    };
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
      if (!budget(`source:${req.socket.remoteAddress}`, Math.max(96, authLimit * 8)) ||
          !budget(`unknown:${req.socket.remoteAddress}:${key}`, authLimit)) {
        res.setHeader("Retry-After", String(Math.ceil(authWindowMs / 1000)));
        throw new AccountError(429, "Za dużo prób. Spróbuj ponownie za minutę.");
      }
      if (req.url === '/api/auth/register') registration.require(input.registrationCode);
      const accountBlocked = (req.url === '/api/auth/login' || securityAction) && accounts.hasUser(key) && !budget(`account:${key}`, authLimit);
      if (authBusy.has(key) || authBusy.size >= 2)
        throw new AccountError(429, "Logowanie jest już w toku.");
      authBusy.add(key);
      locked = true;
      // Protected-account exhaustion stays indistinguishable from a wrong password, including KDF cost.
      if (accountBlocked) await accounts.login({username: key, password: securityAction ? input.currentPassword : input.password}, true);
      // Never replace an account connection while a browser operation is still running.
      const prior = [...sessions.values()].find(
        (s) => s.user?.username === key,
      );
      if (req.url === '/api/auth/register' && sessions.size >= 32)
        throw new AccountError(429, "Limit aktywnych sesji.");
      if (securityAction) {
        const result = await accounts.securityAction(session.user, input, securityAction, claimAccount);
        if (securityAction !== 'recovery-code') {
          for (const [id, item] of sessions) if (item.user?.id === session.user.id) {
            sessions.delete(id); await dispose(item);
          }
          res.setHeader('Set-Cookie', `${ownerCookie()}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${origin.startsWith('https:') ? '; Secure' : ''}`);
        }
        return json(200, result);
      }
      if (req.url === '/api/auth/recover') {
        const user = await accounts.recover(input, claimAccount);
        for (const [id, item] of sessions) if (item.user?.id === user.id) {
          sessions.delete(id); await dispose(item);
        }
        return json(200, { ok: true });
      }
      const user =
        await accounts[req.url.endsWith("register") ? "register" : "login"](
          input,
        );
      if (sessions.size >= 32 && !prior) throw new AccountError(429, 'Limit aktywnych sesji.');
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
      for (const item of claimed) item.busy = false;
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
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (origin.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
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
    const oauthCallback = req.method === 'GET' && /^\/api\/auth\/oauth\/(google|microsoft)\/callback(?:\?|$)/.test(req.url);
    const oauthLanding = req.method === 'GET' && req.url === '/account?oauth=complete' &&
      req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document';
    if (req.headers["sec-fetch-site"] === "cross-site" && !oauthCallback && !oauthLanding)
      return json(403, { error: "Cross-site request rejected" });
    if (req.method === "GET" && req.url === "/healthz")
      return json(200, { status: "ok" });
    if (req.method === "GET" && req.url === "/readyz")
      return json(dashboardAssets.has("/dashboard/") ? 200 : 503, {
        status: dashboardAssets.has("/dashboard/") ? "ready" : "missing_dashboard",
      });
    const path = req.method === 'GET' && req.url === '/account?oauth=complete' ? '/account' : req.url;
    let session = owner(req);
    if (session && Date.now() - session.createdAt > ttlMs) {
      for (const [id, item] of sessions)
        if (item === session) sessions.delete(id);
      await dispose(session);
      session = undefined;
    }
    const requestUrl = new URL(req.url, origin);
    if (requestUrl.pathname === '/api/auth/providers' || requestUrl.pathname.startsWith('/api/auth/oauth/'))
      return socialRoute(req, res, json, session, requestUrl);
    if (timetable && req.method === "GET" && requestUrl.pathname === "/api/plan") {
      try {
        if (requestUrl.searchParams.getAll("trackId").length > 1 || [...requestUrl.searchParams.keys()].some(key => !["trackId", "scope"].includes(key)))
          throw new TimetableError(400, "Nieprawidłowy wybór toku.");
        if (requestUrl.searchParams.getAll("scope").length > 1 || (requestUrl.searchParams.has("scope") && requestUrl.searchParams.get("scope") !== "public"))
          throw new TimetableError(400, "Nieprawidłowy zakres planu.");
        const selected = requestUrl.searchParams.get("trackId") ?? undefined;
        if (requestUrl.searchParams.get("scope") !== "public" && session?.worker?.state === "connected") {
          const worker = session.worker;
          session.dashboard ??= makeDashboard(worker, session);
          const plan = await session.dashboard.plan(selected);
          if (session.worker !== worker || worker.state !== "connected") throw new DashboardError(401, "Sesja została rozłączona.");
          return json(200, plan);
        }
        const source = req.socket.remoteAddress;
        const id = selected ?? timetable.defaultTrackId;
        const cached = timetable.cache?.get(id);
        const cold = !cached || Date.now() - cached.at >= timetable.ttl;
        if (cold) {
          const anonymous = !session?.user;
          const owner = anonymous ? `source:${source}` : `user:${session.user.id}`;
          // Public imports (including signed-in callers) cannot fill all eight repository slots.
          if ((publicImports.get(owner) || 0) >= 2 || publicImportCount >= 6 || (anonymous && anonymousImportCount >= 4) || !budget(`public:${owner}`, 12))
            throw new TimetableError(429, 'Importy publiczne są zajęte. Spróbuj później lub zaloguj się.');
          publicImports.set(owner, (publicImports.get(owner) || 0) + 1); publicImportCount++; if (anonymous) anonymousImportCount++;
          try { return json(200, await publicPlan(timetable, selected)); }
          finally { publicImportCount--; if (anonymous) anonymousImportCount--; const left = publicImports.get(owner) - 1; if (left) publicImports.set(owner, left); else publicImports.delete(owner); }
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
    if (requestUrl.pathname === '/api/plan/groups' || requestUrl.pathname === '/api/plan/export') {
      const worker = session.worker;
      let locked = false;
      try {
        if (worker?.state !== 'connected') throw new DashboardError(401, 'Połącz USOS ponownie.');
        session.dashboard ??= makeDashboard(worker, session);
        if (requestUrl.pathname.endsWith('/export')) {
          if (req.method !== 'GET') return json(405, { error: 'Wymagane pobranie GET.' });
          if ([...requestUrl.searchParams.keys()].some(key => key !== 'trackId') || requestUrl.searchParams.getAll('trackId').length > 1)
            throw new PlanPreferenceError(400, 'Nieprawidłowy wybór toku.');
          const plan = await session.dashboard.plan(requestUrl.searchParams.get('trackId') ?? undefined);
          if (session.worker !== worker || worker.state !== 'connected') throw new DashboardError(401, 'Sesja została rozłączona.');
          if (!plan.data.from || !plan.data.to) throw new PlanPreferenceError(409, 'Najpierw rozpoznaj tok w planie.');
          res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': 'attachment; filename="moj-plan.ics"' });
          return res.end(serializePlan(plan.data));
        }
        if (req.method !== 'POST') return json(405, { error: 'Wymagane wysłanie POST.' });
        if (!validOrigin(req) || req.headers['x-usos-connection'] !== session.generation)
          throw new PlanPreferenceError(403, 'Odśwież panel przed zapisaniem grup.');
        if (session.busy) throw new PlanPreferenceError(409, 'Inna czynność jest w toku.');
        if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new PlanPreferenceError(415, 'Wymagany format JSON.');
        session.busy = true; session.operation = '/api/plan/groups'; locked = true;
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 50_000) throw new PlanPreferenceError(413, 'Wybór grup jest zbyt duży.');
          chunks.push(chunk);
        }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new PlanPreferenceError(400, 'Nieprawidłowy wybór grup.'); }
        const result = await session.dashboard.setPlanGroups(input);
        if (session.worker !== worker || worker.state !== 'connected') throw new DashboardError(401, 'Sesja została rozłączona.');
        return json(200, result);
      } catch (error) {
        const known = error instanceof PlanPreferenceError || error instanceof DashboardError || error instanceof TimetableError;
        return json(known ? error.status : 502, { ok: false, data: null, error: known ? error.message : 'Zapis lub eksport planu nie został potwierdzony.',
          meta: { source: 'live', stale: false, fetchedAt: new Date().toISOString() } });
      } finally { if (locked) { session.busy = false; session.operation = null; } }
    }
    if (requestUrl.pathname === '/api/workflows/submit' || requestUrl.pathname === '/api/workflows/download') {
      const worker = session.worker;
      let locked = false;
      try {
        if (worker?.state !== 'connected') throw new WorkflowError(401, 'Połącz USOS ponownie.');
        session.dashboard ??= makeDashboard(worker, session);
        if (requestUrl.pathname.endsWith('/download')) {
          if (req.method !== 'GET') return json(405, { error: 'Wymagane pobranie GET.' });
          const result = await session.dashboard.workflows.download(requestUrl.searchParams.get('target'));
          if (session.worker !== worker || worker.state !== 'connected') throw new WorkflowError(401, 'Sesja została rozłączona.');
          res.writeHead(200, { 'Content-Type': result.type,
            'Content-Disposition': `attachment; filename="${result.filename.replace(/[^a-zA-Z0-9_. -]/g, '_')}"`,
            'Content-Length': result.bytes.length });
          return res.end(result.bytes);
        }
        if (req.method !== 'POST') return json(405, { error: 'Wymagane wysłanie POST.' });
        if (!validOrigin(req) || req.headers['x-usos-connection'] !== session.generation)
          throw new WorkflowError(403, 'Odśwież panel i potwierdź czynność w aktualnej sesji.');
        if (session.busy) throw new WorkflowError(409, 'Inna czynność jest w toku.');
        const type = req.headers['content-type'] || '';
        if (!type.startsWith('application/json') && !type.startsWith('multipart/form-data;'))
          throw new WorkflowError(415, 'Nieprawidłowy format formularza.');
        const limit = type.startsWith('multipart/') ? 10_000_000 : 100_000;
        if (Number(req.headers['content-length']) > limit) throw new WorkflowError(413, 'Formularz jest zbyt duży.');
        session.busy = true; session.operation = '/api/workflows/submit'; locked = true;
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > limit) throw new WorkflowError(413, 'Formularz jest zbyt duży.');
          chunks.push(chunk);
        }
        const body = Buffer.concat(chunks, size);
        let input, files = [];
        try {
          if (type.startsWith('multipart/')) {
            const data = await new Request(origin, { method: 'POST', headers: { 'content-type': type }, body }).formData();
            if (data.getAll('payload').length !== 1 || typeof data.get('payload') !== 'string') throw new Error();
            input = JSON.parse(data.get('payload'));
            for (const [name, blob] of data) if (name !== 'payload') {
              if (!name.startsWith('file:') || typeof blob === 'string') throw new Error();
              files.push({ name: name.slice(5), blob });
            }
            if (files.length > 8) throw new Error();
          } else input = JSON.parse(body.toString('utf8'));
        } catch { throw new WorkflowError(400, 'Nieprawidłowy formularz.'); }
        const data = await session.dashboard.workflows.submit(input, files);
        if (session.worker !== worker || worker.state !== 'connected') throw new WorkflowError(401, 'Sesja została rozłączona.');
        return json(200, { ok: true, data, error: null, meta: { source: 'live', stale: false, fetchedAt: new Date().toISOString() } });
      } catch (error) {
        return json(error instanceof WorkflowError || error instanceof DashboardError ? error.status : 502, {
          ok: false, data: null, error: error instanceof WorkflowError || error instanceof DashboardError ? error.message : 'Sprawdź stan sprawy — odpowiedź czynności nie została potwierdzona.',
          meta: { source: 'live', stale: false, fetchedAt: new Date().toISOString() },
        });
      } finally { if (locked) { session.busy = false; session.operation = null; } }
    }
    if (req.method === "GET" && path.startsWith("/api/")) {
      const worker = session.worker;
      try {
        if (worker?.state !== "connected")
          throw new DashboardError(401, "Połącz USOS na stronie logowania.");
        session.dashboard ??= makeDashboard(worker, session);
        const data = await session.dashboard.handle(new URL(path, origin));
        if (session.worker !== worker || worker.state !== "connected")
          throw new DashboardError(401, "Sesja została rozłączona.");
        return json(200, data);
      } catch (error) {
        return json(error instanceof DashboardError || error instanceof TimetableError || error instanceof WorkflowError ? error.status : 502, {
          ok: false,
          data: null,
          error:
            (error instanceof DashboardError || error instanceof TimetableError || error instanceof WorkflowError)
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
        session.dashboard ??= makeDashboard(session.worker, session);
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
        session.dashboard ??= makeDashboard(session.worker, session);
        await session.dashboard.setCalendar(parsed?.url);
      } else if (path === "/api/disconnect") {
        await dispose(session);
      } else if (path === "/api/start") {
        const active = [...sessions.values()].filter(
          (s) => s !== session && (s.operation === "/api/start" || (s.worker && (s.worker.browser || !["connected", "expired", "disconnected"].includes(s.worker.state)))),
        ).length;
        if (active + cleanup.size >= maxBrowsers)
          return json(429, {
            error: "Przeglądarki są zajęte lub trwa ich sprzątanie. Spróbuj za chwilę.",
          });
        await dispose(session);
        const reserved = [...sessions.values()].filter(s => s !== session &&
          (s.operation === '/api/start' || (s.worker && (s.worker.browser || !['connected','expired','disconnected'].includes(s.worker.state))))).length;
        if (reserved + cleanup.size >= maxBrowsers) return json(429, { error: 'Przeglądarki są zajęte lub trwa ich sprzątanie. Spróbuj za chwilę.' });
        session.generation = randomBytes(16).toString("hex");
        session.lastVerify = 0;
        session.worker = workerFactory();
        session.loginStartedAt = session.touched = Date.now();
        await waitForLaunch();
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
        session.dashboard ??= makeDashboard(session.worker, session);
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
        if (!session.busy && session.worker && session.worker.state !== 'connected' &&
            (Date.now() - session.touched > loginIdleMs || Date.now() - session.loginStartedAt > loginHardMs))
          void dispose(session).catch(() => console.error('LOGIN_CLEANUP_FAILED'));
        if (!session.busy && Date.now() - session.createdAt > ttlMs) {
          sessions.delete(id);
          void dispose(session).catch(() => console.error("SESSION_CLEANUP_FAILED"));
        }
      }
    },
    Math.min(ttlMs, loginIdleMs, 15_000),
  );
  timer.unref();
  return {
    origin,
    address: server.address(),
    async close() {
      social.clear(); completedSocial.clear();
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
  const loginCapacity = Number(process.env.PILOT_MAX_BROWSERS || (runtime === 'kubernetes' ? '2' : '5'));
  if (runtime === 'kubernetes' && (!Number.isInteger(loginCapacity) || loginCapacity < 1 || loginCapacity > 2))
    throw new Error('Kubernetes login capacity exceeds the shipped worker quota (max 2).');
  const pool =
    runtime === "kubernetes"
      ? new KubernetesPool({
          kubeconfig: process.env.USOS_KUBECONFIG,
          inCluster: process.env.USOS_IN_CLUSTER === "true",
          maxWorkers: loginCapacity,
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
    maxBrowsers: loginCapacity,
    ...(pool
      ? { workerFactory: () => new KubernetesBrowserWorker({ pool }) }
      : {}),
  });
  console.log(
    `USOS login pilot: ${pilot.origin} (max login browsers=${loginCapacity}; workers=${runtime})`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await pilot.close();
      await pool?.close();
      process.exit(0);
    });
}

import { browserNetwork } from './browser-network.mjs';
import { EventEmitter } from "node:events";
import { chromium } from "playwright";
import { createUsosRequest } from "./upstream.mjs";

export const HOME = "https://usosweb.ideis.pl/kontroler.php?_action=home/index";
const NEWS = "https://usosweb.ideis.pl/kontroler.php?_action=news/default";
const USOS_ORIGIN = new URL(HOME).origin;
export const VIEWPORT = { width: 1280, height: 800 };

export function accountId(html) {
  return html.match(/\buser_id\s*:\s*['"]?(\d+)/)?.[1] ?? null;
}

export function sessionCookies(cookies) {
  return cookies.filter(
    (cookie) =>
      cookie.name === "PHPSESSID" &&
      cookie.domain.replace(/^\./, "") === "usosweb.ideis.pl",
  );
}

export async function findLoginUrl(page) {
  // USOS puts this link inside an open shadow root. Playwright locators pierce
  // that root; document.querySelectorAll and role visibility checks do not.
  const link = page
    .locator(
      'a[href*="_action=logowaniecas/index"],usos-link[href*="_action=logowaniecas/index"]',
    )
    .first();
  await link.waitFor({ state: "attached", timeout: 15_000 });
  const login = new URL(await link.getAttribute("href"), page.url());
  if (login.origin !== USOS_ORIGIN) throw new Error("Unexpected login origin");
  return login;
}

// Separate HTTP cookie jar: Microsoft/CAS cookies and browser storage stay out.
export async function verifyHandoff(
  cookies,
  expectedAccount,
  createRequest = createUsosRequest,
) {
  const selected = sessionCookies(cookies);
  if (!expectedAccount || selected.length !== 1) return null;
  const api = await createRequest({
    storageState: { cookies: selected, origins: [] },
    timeout: 20_000,
    userAgent: "USOS-Local-Login-Pilot/0.1",
  });
  let response;
  try {
    response = await api.get(HOME, { maxRedirects: 0 });
    if (
      response.status() !== 200 ||
      accountId(await response.text()) !== expectedAccount
    ) {
      await api.dispose();
      return null;
    }
    return api;
  } catch {
    await api.dispose();
    return null;
  } finally {
    await response?.dispose().catch(() => {});
  }
}

export class BrowserWorker extends EventEmitter {
  constructor({
    executablePath = process.env.CHROMIUM_PATH || (process.env.PLAYWRIGHT_BROWSERS_PATH ? chromium.executablePath() : "/usr/bin/chromium"),
    fixtureHtml,
    createRequest,
    networkFactory = browserNetwork,
    launch = (options) => chromium.launch(options),
  } = {}) {
    super();
    this.executablePath = executablePath;
    this.launch = launch;
    this.networkFactory = networkFactory;
    // Constructor injection is for synthetic tests, never a route/query parameter.
    this.fixtureHtml = fixtureHtml;
    this.createRequest = createRequest;
    this.requests = new Map();
    this.origin = null;
    this.state = "starting";
    this.streaming = false;
    this.closed = false;
    this.api = null;
    this.expectedAccount = null;
    this.lastCheckedAt = null;
  }

  record(method, url) {
    try {
      const origin = new URL(url).origin;
      if (!origin.startsWith("http")) return;
      const key = `${method} ${origin}`;
      if (this.requests.size < 80 || this.requests.has(key)) {
        this.requests.set(key, (this.requests.get(key) || 0) + 1);
      }
    } catch {
      /* Non-network browser URL. */
    }
  }

  status() {
    return {
      state: this.state,
      origin: this.origin,
      lastCheckedAt: this.lastCheckedAt,
      backendVerified: this.state === "connected",
      viewport: VIEWPORT,
      requests: [...this.requests].map(([destination, count]) => ({
        destination,
        count,
      })),
    };
  }

  async start() {
    const network = this.network = await this.networkFactory();
    if (this.closed) { await network?.close(); this.network = null; return; }
    this.browser = await this.launch({
      ...(network ? { proxy: { server: network.server, bypass: network.bypass } } : {}),
      args: ['--disable-quic', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
      executablePath: this.executablePath,
      headless: true,
      chromiumSandbox: true,
    });
    if (this.closed) { await this.close(); return; }
    this.context = await this.browser.newContext({
      viewport: VIEWPORT,
      locale: "pl-PL",
      acceptDownloads: false,
    });
    this.context.on("request", (req) => this.record(req.method(), req.url()));
    this.context.on("page", (page) => {
      if (this.page) void this.attach(page).catch(() => this.fail());
    });
    await this.attach(await this.context.newPage());
    if (this.fixtureHtml !== undefined) {
      await this.page.setContent(this.fixtureHtml);
    } else {
      await this.page.goto(NEWS, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      const login = await findLoginUrl(this.page);
      await this.page.goto(login.href, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
    }
    this.state = "login";
    this.emit("status");
  }

  fail() {
    if (!this.closed && this.state !== "connected") {
      this.state = "error";
      this.emit("status");
    }
  }

  async attach(page) {
    await this.cdp?.detach().catch(() => {});
    this.page = page;
    this.cdp = await this.context.newCDPSession(page);
    page.on("framenavigated", (frame) => {
      if (page !== this.page || frame !== page.mainFrame()) return;
      try {
        this.origin = new URL(page.url()).origin;
      } catch {
        this.origin = null;
      }
      this.emit("status");
    });
    page.on("dialog", (dialog) => void dialog.dismiss().catch(() => {}));
    page.on("close", () => {
      if (this.closed || page !== this.page || this.state === "connected")
        return;
      const remaining = this.context
        .pages()
        .filter((candidate) => !candidate.isClosed());
      if (remaining.length)
        void this.attach(remaining.at(-1)).catch(() => this.fail());
      else this.fail();
    });
    const cdp = this.cdp;
    cdp.on("Page.screencastFrame", (frame) => {
      if (this.streaming && page === this.page) this.emit("frame", frame.data);
      void cdp
        .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
        .catch(() => {});
    });
    if (this.streaming) await this.startStream();
  }

  async startStream() {
    this.streaming = true;
    if (!this.cdp || !this.page || this.page.isClosed()) return;
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 75,
      maxWidth: VIEWPORT.width,
      maxHeight: VIEWPORT.height,
      everyNthFrame: 1,
    });
    // A reconnect also receives a frame when the remote page is static.
    this.emit(
      "frame",
      (await this.page.screenshot({ type: "jpeg", quality: 75 })).toString(
        "base64",
      ),
    );
  }

  async stopStream() {
    this.streaming = false;
    await this.cdp?.send("Page.stopScreencast").catch(() => {});
  }

  async input(event) {
    if (!this.cdp || this.closed || this.state !== "login") return;
    if (event.type === "text") {
      if (typeof event.text !== "string" || event.text.length > 2048)
        throw new Error("Invalid text");
      await this.cdp.send("Input.insertText", { text: event.text });
    } else if (event.type === "key") {
      const allowed = [
        "Backspace",
        "Tab",
        "Enter",
        "Escape",
        "Delete",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
        "PageUp",
        "PageDown",
      ];
      if (!allowed.includes(event.key)) throw new Error("Invalid key");
      await this.page.keyboard.press(
        `${event.shift ? "Shift+" : ""}${event.key}`,
      );
    } else if (event.type === "selectAll") {
      await this.page.keyboard.press("Control+a");
    } else if (event.type === "mouse") {
      if (
        !["mousePressed", "mouseReleased", "mouseMoved", "mouseWheel"].includes(
          event.action,
        ) ||
        !Number.isFinite(event.x) ||
        !Number.isFinite(event.y) ||
        event.x < 0 ||
        event.x > VIEWPORT.width ||
        event.y < 0 ||
        event.y > VIEWPORT.height
      ) {
        throw new Error("Invalid pointer");
      }
      const params = { type: event.action, x: event.x, y: event.y };
      if (event.action === "mouseWheel") {
        if (!Number.isFinite(event.deltaY) || Math.abs(event.deltaY) > 3000)
          throw new Error("Invalid wheel");
        Object.assign(params, { deltaX: 0, deltaY: event.deltaY });
      } else if (event.action !== "mouseMoved") {
        Object.assign(params, { button: "left", clickCount: 1 });
      }
      await this.cdp.send("Input.dispatchMouseEvent", params);
    } else throw new Error("Invalid input");
  }

  async verify() {
    if (this.state === "connected") {
      const response = await this.api.get(HOME, { maxRedirects: 0 });
      this.record("GET", HOME);
      try {
        if (
          response.status() === 200 &&
          accountId(await response.text()) === this.expectedAccount
        ) {
          this.lastCheckedAt = new Date().toISOString();
          return true;
        }
        this.state = "expired";
        await this.api.dispose();
        this.api = null;
        this.expectedAccount = null;
        return false;
      } finally {
        await response.dispose();
      }
    }
    if (
      this.state !== "login" ||
      new URL(this.page.url()).origin !== USOS_ORIGIN
    )
      return false;
    const expected = accountId(await this.page.content());
    if (!expected) return false;
    const cookies = await this.context.cookies(HOME);
    this.record("GET", HOME);
    const api = await verifyHandoff(cookies, expected, this.createRequest);
    if (!api) return false;
    // A failed browser close must remain retryable and must not expose a connected dashboard.
    try {
      await this.stopStream();
      try { await this.browser.close(); }
      finally { await this.network?.close(); this.network = null; }
    }
    catch (error) { await api.dispose().catch(() => {}); throw error; }
    this.api = api;
    this.expectedAccount = expected;
    this.lastCheckedAt = new Date().toISOString();
    this.state = "connected";
    this.browser = null;
    this.context = null;
    this.page = null;
    this.cdp = null;
    this.emit("status");
    return true;
  }

  async close() {
    this.closed = true;
    this.state = "disconnected";
    await this.api?.dispose().catch(() => {});
    try { await this.browser?.close(); }
    finally { await this.network?.close(); this.network = null; }
    this.api =
      this.browser =
      this.context =
      this.page =
      this.cdp =
      this.expectedAccount =
        null;
    this.requests.clear();
    this.removeAllListeners();
  }
}

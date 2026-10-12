// Opt-in: verifies the deployed app using two temporary synthetic app accounts.
// No Microsoft credentials are entered. Test accounts are removed in finally.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
const exec = promisify(execFile);
const args = ["--kubeconfig", process.env.HOME + "/.kube/usos-local/config", "--context", "usos-local"];
const origin = "http://127.0.0.1:8789";
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function kube(...rest) {
  const { stdout } = await exec("kubectl", [...args, ...rest], { timeout: 180_000, maxBuffer: 1_000_000 });
  return stdout;
}
async function coordinates() {
  const c = JSON.parse(await kube("config", "view", "--minify", "-o", "json"));
  assert.equal(c.clusters[0].cluster.server, "https://192.168.49.2:8443");
  const a = JSON.parse(await kube("auth", "whoami", "-o", "json"));
  assert.equal(a.status.userInfo.username, "minikube-user");
}
async function inApp(code, ...params) {
  return kube("-n", "usos-app", "exec", "deployment/usos-app", "--", "node", "--input-type=module", "-e", code, ...params);
}
async function fingerprint() {
  return (await inApp('import {DatabaseSync} from "node:sqlite"; import {createHash} from "node:crypto"; const d=new DatabaseSync(process.env.PILOT_ACCOUNTS_PATH); console.log(createHash("sha256").update(JSON.stringify(d.prepare("SELECT * FROM users ORDER BY id").all())).digest("hex"));d.close();')).trim();
}
async function ready() {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origin + "/readyz", { signal: AbortSignal.timeout(1500) })).status === 200) return; } catch {}
    await sleep(1000);
  }
  throw Error("App did not recover");
}
async function jobs() {
  return JSON.parse(await kube("-n", "usos-login", "get", "jobs", "-o", "json")).items;
}
await coordinates(); await ready();
assert.equal((await jobs()).length, 0, "Run this test with no active browser logins");
const originalFingerprint = await fingerprint();
const fixtures = [0, 1].map(() => ({
  username: "kubecheck-" + randomBytes(6).toString("hex"),
  name: "Temporary Kubernetes check",
  password: randomBytes(24).toString("hex"),
}));
let browser;
const contexts = [];
async function post(context, path, body) {
  return context.request.post(origin + path, {
    headers: { Origin: origin },
    ...(body ? { data: body } : {}),
    timeout: 150_000,
  });
}
try {
  browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, chromiumSandbox: true });
  for (const fixture of fixtures) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    const response = await post(context, "/api/auth/register", fixture);
    assert.equal(response.status(), 201);
    const status = await (await context.request.get(origin + "/api/status")).json();
    fixture.id = status.user.id;
    assert.equal(status.workerRuntime, "kubernetes");
    assert.equal(status.dashboardReady, true);
  }
  console.log("DEPLOYED APP: two registrations without invitations; dashboard bundle ready; Kubernetes backend; PASS");
  for (const context of contexts) {
    const page = await context.newPage();
    await page.goto(origin);
    await page.locator("#theme").click();
    await page.reload();
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    const started = page.waitForResponse(r => r.url() === origin + "/api/start", { timeout: 150_000 });
    await page.locator("#start-main").click();
    const response = await started;
    console.log("START HTTP: " + response.status());
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => document.querySelector("#connection").textContent === "LIVE", undefined, { timeout: 15000 });
    await page.waitForFunction(() => {
      const c = document.querySelector("#screen");
      return !c.hidden && c.getContext("2d").getImageData(10, 10, 1, 1).data[3] > 0;
    }, undefined, { timeout: 30000 });
  }
  const created = await jobs();
  assert.equal(created.length, 2);
  console.log("LIVE UI: dark mode persists; two separate Chromium Jobs launched by deployed backend; both viewers receive frames; PASS");
  for (const context of contexts) {
    const verify = await post(context, "/api/verify");
    assert.equal(verify.status(), 409);
    const status = await (await context.request.get(origin + "/api/status")).json();
    // Status audit has only method/origin/count, never full URLs or credentials.
    console.log("ANONYMOUS UPSTREAM REQUESTS: " + JSON.stringify(status.requests));
  }
  await post(contexts[0], "/api/auth/logout");
  assert.equal((await jobs()).length, 1);
  const other = await (await contexts[1].request.get(origin + "/api/status")).json();
  assert.equal(other.state, "login");
  await post(contexts[1], "/api/disconnect");
  assert.equal((await jobs()).length, 0);
  console.log("LIFECYCLE: pre-login verification rejected; logout removes only its own worker; disconnect cleans remaining Job; PASS");
  for (const action of ["restart", "undo"]) {
    await coordinates();
    await kube("-n", "usos-app", "rollout", action, "deployment/usos-app");
    await kube("-n", "usos-app", "rollout", "status", "deployment/usos-app", "--timeout=150s");
    await ready();
    for (let i = 0; i < contexts.length; i++) {
      assert.equal((await contexts[i].request.get(origin + "/api/status")).status(), 401);
      const r = await post(contexts[i], "/api/auth/login", fixtures[i]);
      assert.equal(r.status(), 200);
      const status = await (await contexts[i].request.get(origin + "/api/status")).json();
      assert.equal(status.user.id, fixtures[i].id);
      assert.equal(status.state, "idle");
    }
    console.log(`PVC ${action.toUpperCase()}: both accounts survive; old sessions expire; login works; PASS`);
  }
} finally {
  for (const context of contexts) {
    await post(context, "/api/disconnect").catch(() => {});
    await post(context, "/api/auth/logout").catch(() => {});
  }
  await browser?.close();
  // Delete only the two uniquely named records created by this test; keep actual users unchanged.
  await inApp('import {DatabaseSync} from "node:sqlite"; const d=new DatabaseSync(process.env.PILOT_ACCOUNTS_PATH);for(const u of process.argv.slice(1)) {if(!/^kubecheck-[a-f0-9]{12}$/.test(u))throw Error("Invalid fixture"); d.prepare("DELETE FROM users WHERE username=? AND name=?").run(u,"Temporary Kubernetes check");}d.close();', ...fixtures.map(f => f.username));
  assert.equal(await fingerprint(), originalFingerprint, "Actual accounts must remain unchanged");
  assert.equal((await jobs()).length, 0);
  console.log("CLEANUP: temporary accounts/jobs removed; original account records unchanged; PASS");
}
console.log("APP KUBERNETES E2E: PASS; exit=0");

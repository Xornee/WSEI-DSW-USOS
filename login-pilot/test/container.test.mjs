import { REGISTRATION_CODE } from './registration-fixture.mjs';
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { createPilot } from "../server.mjs";
import { KubernetesPool } from "../kubernetes.mjs";

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, res => {
      res.resume(); res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject); req.end();
  });
}
test("container binding requires explicit canonical origin and rejects malformed origin", async () => {
  await assert.rejects(createPilot({ registrationCode: REGISTRATION_CODE, bindHost: "0.0.0.0" }), /public origin/);
  for (const publicOrigin of ["file:///tmp/test", "https://app.test/path", "https://user:pass@app.test"]) {
    await assert.rejects(createPilot({ registrationCode: REGISTRATION_CODE, publicOrigin }), /origin/);
  }
});
test("canonical host/origin remain enforced when container binds all interfaces", async t => {
  const app = await createPilot({ registrationCode: REGISTRATION_CODE, port: 0, bindHost: "0.0.0.0",
    publicOrigin: "https://app.test", accountsPath: ":memory:" });
  t.after(() => app.close());
  // The listener address is exposed only to the caller, not through an API.
  assert.equal(app.origin, "https://app.test");
  const port = app.address.port;
  assert.equal(await get(port, "/healthz", { Host: "app.test" }), 200);
  assert.equal(await get(port, "/healthz", { Host: "attacker.test" }), 403);
  assert.equal(await get(port, "/account", { Host: "app.test", Origin: "https://attacker.test" }), 403);
  assert.equal(await get(port, "/api/status", { Host: "app.test" }), 401);
});
test("in-cluster client uses rotated token file, exact endpoint and dedicated app identity", async () => {
  const config = JSON.parse(await readFile(new URL("../k8s/incluster.json", import.meta.url)));
  assert.equal(config.users[0].user.token, undefined);
  assert.equal(config.users[0].user.tokenFile, "/var/run/secrets/kubernetes.io/serviceaccount/token");
  const pool = new KubernetesPool({ kubeconfig: "/synthetic/config", inCluster: true });
  let identity = "system:serviceaccount:usos-app:usos-app";
  pool.run = async args => JSON.stringify(args[0] === "config" ? config :
    { status: { userInfo: { username: identity } } });
  await pool.assertTarget();
  identity = "system:serviceaccount:default:default";
  await assert.rejects(pool.assertTarget(), /identity/);
  config.clusters[0].cluster.server = "https://elsewhere.test";
  await assert.rejects(pool.assertTarget(), /endpoint/);
});

test("HTTPS canonical origin adds Secure to owner cookies including logout", async t => {
  const app = await createPilot({ registrationCode: REGISTRATION_CODE, port: 0, publicOrigin: "https://app.test",
    accountsPath: ":memory:" });
  t.after(() => app.close());
  async function post(path, data) {
    return new Promise((resolve, reject) => {
      if (path === '/api/auth/register') data = { ...data, registrationCode: REGISTRATION_CODE };
      const body = JSON.stringify(data);
      const req = request({ host: "127.0.0.1", port: app.address.port, path, method: "POST",
        headers: { Host: "app.test", Origin: "https://app.test", "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
      }, res => { res.resume(); res.on("end", () => resolve({ status: res.statusCode, secure: res.headers["set-cookie"]?.every(c => c.includes("; Secure")) })); });
      req.on("error", reject); req.end(body);
    });
  }
  const registered = await post("/api/auth/register", { username: "fixture-container", name: "Fixture", password: "fixture-passphrase" });
  assert.equal(registered.status, 201);
  assert.equal(registered.secure, true);
});

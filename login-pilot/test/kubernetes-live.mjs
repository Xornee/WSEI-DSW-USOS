// Explicit local-cluster integration test. Never included by npm test.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "playwright";
import { KubernetesPool, KubernetesBrowserWorker } from "../kubernetes.mjs";
import { createPilot } from "../server.mjs";
import { HOME } from "../browser.mjs";
const exec = promisify(execFile);
const home = process.env.HOME;
const admin = [
  "--kubeconfig",
  `${home}/.kube/usos-local/config`,
  "--context",
  "usos-local",
  "-n",
  "usos-login",
];
const kube = async (...args) =>
  (await exec("kubectl", [...admin, ...args], { maxBuffer: 1_000_000 })).stdout;
const identity = JSON.parse(await kube("auth", "whoami", "-o", "json"));
assert.equal(identity.status.userInfo.username, "minikube-user");
const config = JSON.parse(
  await kube("config", "view", "--minify", "-o", "json"),
);
assert.equal(config.contexts[0].context.cluster, "usos-local");
const pool = new KubernetesPool({
  image: process.env.USOS_WORKER_IMAGE || "usos-chromium:2026-09-14-security-v3",
  kubeconfig: `${home}/.kube/usos-local/controller.json`,
});
const workers = [];
let reads = 0;
const app = await createPilot({
  port: 0,
  accountsPath: ":memory:",
  workerRuntime: "kubernetes",
  authLimit: 100,
  verifyIntervalMs: 0,
  workerFactory: () => {
    const id = String(12345 + workers.length);
    const worker = new KubernetesBrowserWorker({
      pool,
      fixtureHtml: `<h1>Synthetic pod ${workers.length + 1}</h1><input id="entry" />`,
      createRequest: async ({ storageState }) => {
        assert.equal(storageState.cookies.length, 1);
        assert.equal(storageState.cookies[0].value, `synthetic-${id}`);
        return {
          get: async () => {
            reads++;
            return {
              status: () => 200,
              text: async () => `user_id: '${id}'`,
              dispose: async () => {},
            };
          },
          dispose: async () => {},
        };
      },
    });
    workers.push(worker);
    return worker;
  },
  dashboardFactory: (worker) => ({
    ical: true,
    close() {},
    handle: async () => ({ account: worker.expectedAccount }),
  }),
});
async function post(path, cookie, body) {
  return fetch(app.origin + path, {
    method: "POST",
    headers: {
      origin: app.origin,
      ...(cookie ? { cookie } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
let client;
try {
  const cookies = [];
  for (const username of ["fixturealpha", "fixturebeta"]) {
    const registered = await post("/api/auth/register", null, {
      username,
      name: username,
      password: "synthetic test password",
    });
    assert.equal(registered.status, 201);
    cookies.push(registered.headers.get("set-cookie").split(";")[0]);
    assert.equal((await post("/api/start", cookies.at(-1))).status, 200);
  }
  assert.notEqual(workers[0].lease.podName, workers[1].lease.podName);
  assert.equal(pool.leases.size, 2);
  const pods = JSON.parse(
    await kube("get", "pods", "-l", "app=usos-browser", "-o", "json"),
  ).items;
  assert.equal(pods.length, 2);
  assert.ok(pods.every((pod) => pod.status.containerStatuses[0].ready));
  console.log(
    "LIVE TWO USERS: two authenticated accounts -> two Ready Chromium pods; PASS",
  );

  const a = workers[0];
  const b = workers[1];
  await a.context.addCookies([
    {
      name: "PHPSESSID",
      value: "synthetic-12345",
      domain: "usosweb.ideis.pl",
      path: "/",
      secure: true,
    },
  ]);
  assert.equal((await b.context.cookies(HOME)).length, 0);
  await a.page.locator("#entry").focus();
  await a.input({ type: "text", text: "alpha-only" });
  assert.equal(await a.page.locator("#entry").inputValue(), "alpha-only");
  assert.equal(await b.page.locator("#entry").inputValue(), "");
  await assert.rejects(
    chromium.connect(
      a.lease.endpoint.replace(/\/[a-f0-9]{64}$/, "/invalid-capability"),
      { timeout: 2000 },
    ),
  );
  console.log(
    "ISOLATION: cookies/input separate; wrong browser capability rejected; PASS",
  );

  const target = pods.find((pod) => pod.metadata.name === b.lease.podName)
    .status.podIP;
  const probe = `const net=require('net');const s=net.connect(Number(process.argv[2]),process.argv[1]);s.setTimeout(1800);s.on('connect',()=>{console.log('CONNECTED');s.destroy()});s.on('timeout',()=>{console.log('BLOCKED');s.destroy()});s.on('error',()=>console.log('BLOCKED'));`;
  assert.equal(
    (
      await kube(
        "exec",
        a.lease.podName,
        "--",
        "node",
        "-e",
        probe,
        "127.0.0.1",
        "3000",
      )
    ).trim(),
    "CONNECTED",
  );
  assert.equal(
    (
      await kube(
        "exec",
        a.lease.podName,
        "--",
        "node",
        "-e",
        probe,
        target,
        "3000",
      )
    ).trim(),
    "BLOCKED",
  );
  assert.equal(
    (
      await kube(
        "exec",
        a.lease.podName,
        "--",
        "node",
        "-e",
        probe,
        "10.96.0.1",
        "443",
      )
    ).trim(),
    "BLOCKED",
  );
  console.log(
    "NETWORK: localhost positive control passed; peer pod and Kubernetes API blocked; PASS",
  );

  client = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    chromiumSandbox: true,
  });
  const context = await client.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const [cookieName, cookieValue] = cookies[0].split("=");
  await context.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      url: app.origin,
      httpOnly: true,
      sameSite: "Strict",
    },
  ]);
  const page = await context.newPage();
  await page.goto(app.origin);
  await page.waitForSelector("#screen:not([hidden])");
  await page.waitForFunction(() => {
    const canvas = document.getElementById("screen");
    return canvas.getContext("2d").getImageData(10, 10, 1, 1).data[3] > 0;
  });
  console.log(
    "VIEWER: authenticated web UI receives real pod Chromium frames; PASS",
  );

  for (let index = 0; index < workers.length; index++) {
    const worker = workers[index];
    const id = String(12345 + index);
    await worker.context.addCookies([
      {
        name: "PHPSESSID",
        value: `synthetic-${id}`,
        domain: "usosweb.ideis.pl",
        path: "/",
        secure: true,
      },
    ]);
    await worker.page.route("**/*", (route) =>
      route.fulfill({ contentType: "text/html", body: `user_id: '${id}'` }),
    );
    await worker.page.goto(HOME);
    assert.equal((await post("/api/verify", cookies[index])).status, 200);
    assert.equal(worker.browser, null);
    assert.ok(worker.api);
    assert.equal((await post("/api/verify", cookies[index])).status, 200);
    const data = await (
      await fetch(app.origin + "/api/student", {
        headers: { cookie: cookies[index] },
      })
    ).json();
    assert.equal(data.account, id);
  }
  assert.equal(pool.leases.size, 0);
  assert.equal(reads, 4);
  assert.equal(
    JSON.parse(
      await kube(
        "get",
        "jobs",
        "-l",
        "app.kubernetes.io/managed-by=usos-local",
        "-o",
        "json",
      ),
    ).items.length,
    0,
  );
  assert.equal(
    JSON.parse(await kube("get", "secrets", "-o", "json")).items.length,
    0,
  );
  console.log(
    "HANDOFF: synthetic verified USOS jars recheck after both pods removed; per-account data preserved; PASS",
  );
} finally {
  await client?.close();
  await app.close();
  await pool.close();
}

const expiringPool = new KubernetesPool({
  kubeconfig: `${home}/.kube/usos-local/controller.json`,
  deadline: 12,
});
const expiring = new KubernetesBrowserWorker({
  pool: expiringPool,
  fixtureHtml: "<h1>Deadline fixture</h1>",
});
try {
  await expiring.start();
  const name = expiring.lease.name;
  const until = Date.now() + 75_000;
  let gone = false;
  while (Date.now() < until) {
    const jobs = JSON.parse(
      await kube(
        "get",
        "jobs",
        "-l",
        "app.kubernetes.io/managed-by=usos-local",
        "-o",
        "json",
      ),
    );
    if (!jobs.items.some((job) => job.metadata.name === name)) {
      gone = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  assert.equal(gone, true);
  assert.equal(
    JSON.parse(await kube("get", "secrets", "-o", "json")).items.length,
    0,
  );
  console.log(
    "DEADLINE: Kubernetes independently terminated and garbage-collected abandoned job, pod and secret; PASS",
  );
} finally {
  await expiring.close();
  await expiringPool.close();
}
console.log("KUBERNETES INTEGRATION: PASS; exit=0");

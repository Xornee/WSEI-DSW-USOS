import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  browserJob,
  KubernetesPool,
  KubernetesBrowserWorker,
  NAMESPACE,
} from "../kubernetes.mjs";
import { HOME } from "../browser.mjs";

test("job specification is bounded, sandboxed, non-root and contains no shared browser profile or API token", () => {
  const job = browserJob(
    "usos-browser-" + "a".repeat(24),
    "usos-chromium:test",
  );
  const pod = job.spec.template.spec;
  assert.equal(job.metadata.namespace, NAMESPACE);
  assert.equal(job.spec.activeDeadlineSeconds, 900);
  assert.equal(job.spec.ttlSecondsAfterFinished, 30);
  assert.equal(pod.automountServiceAccountToken, false);
  assert.equal(pod.securityContext.runAsNonRoot, true);
  assert.equal(pod.securityContext.seccompProfile.type, "Localhost");
  assert.equal(
    pod.containers[0].securityContext.allowPrivilegeEscalation,
    false,
  );
  assert.deepEqual(pod.containers[0].securityContext.capabilities.drop, [
    "ALL",
  ]);
  assert.equal(
    pod.volumes.some((v) => v.hostPath || v.persistentVolumeClaim),
    false,
  );
  assert.equal(
    pod.volumes.find((v) => v.name === "tmp").emptyDir.medium,
    "Memory",
  );
  assert.throws(() => browserJob("user-input", "image"));
  assert.throws(() =>
    browserJob("usos-browser-" + "a".repeat(24), "image", 901),
  );
  assert.throws(() => new KubernetesPool());
});

function fakePool() {
  const pool = new KubernetesPool({ kubeconfig: "/synthetic/config" });
  const mutations = [];
  pool.assertTarget = async () => {};
  pool.run = async (args, input) => {
    if (args[0] === "create") {
      mutations.push(input);
      return input.kind === "Job"
        ? JSON.stringify({ metadata: { uid: "synthetic-job-uid" } })
        : "secret/created";
    }
    if (args[0] === "get")
      return JSON.stringify({
        items: [
          {
            metadata: { name: "synthetic-pod" },
            status: { conditions: [{ type: "Ready", status: "True" }] },
          },
        ],
      });
    mutations.push(args);
    return "";
  };
  pool.forward = async () => 12345;
  return { pool, mutations };
}

test("pool reserves distinct capabilities, enforces capacity and deletes only its own jobs idempotently", async () => {
  const { pool, mutations } = fakePool();
  const a = await pool.acquire();
  const b = await pool.acquire();
  assert.notEqual(a.name, b.name);
  assert.notEqual(a.endpoint, b.endpoint);
  assert.equal(
    mutations[1].metadata.ownerReferences[0].uid,
    "synthetic-job-uid",
  );
  assert.equal(mutations[1].stringData.token.length, 64);
  assert.equal(
    JSON.stringify(mutations[0]).includes(mutations[1].stringData.token),
    false,
  );
  await assert.rejects(pool.acquire(), /capacity/);
  await a.release();
  await a.release();
  assert.equal(pool.leases.size, 1);
  await pool.close();
  assert.equal(pool.leases.size, 0);
  assert.equal(
    mutations.filter((m) => Array.isArray(m) && m[0] === "delete").length,
    2,
  );
});

test("failed capability creation cleans job; cleanup failures remain retryable", async () => {
  const { pool } = fakePool();
  const original = pool.run;
  pool.run = async (args, input) => {
    if (input?.kind === "Secret") throw new Error("synthetic failure");
    return original(args, input);
  };
  await assert.rejects(pool.acquire(), /Kubernetes/);
  assert.equal(pool.leases.size, 0);
  pool.run = original;
  const lease = await pool.acquire();
  pool.run = async (args) => {
    if (args[0] === "delete") throw new Error("synthetic delete failure");
  };
  await assert.rejects(lease.release());
  assert.equal(pool.leases.size, 1);
  pool.run = original;
  await lease.release();
  assert.equal(pool.leases.size, 0);
});

test("pool shutdown during provisioning waits and removes the eventual job", async () => {
  const { pool } = fakePool();
  const original = pool.run;
  let resolve;
  const gate = new Promise((r) => {
    resolve = r;
  });
  pool.run = async (args, input) => {
    if (input?.kind === "Job") await gate;
    return original(args, input);
  };
  const acquiring = pool.acquire();
  const stopped = pool.close();
  resolve();
  await assert.rejects(acquiring);
  await stopped;
  assert.equal(pool.leases.size, 0);
  assert.equal(pool.pending.size, 0);
});

test("worker handoff releases pod while retaining only verified backend jar; recheck works without browser", async () => {
  let released = 0;
  let reads = 0;
  const lease = {
    async release() {
      released = 1;
    },
  };
  const worker = new KubernetesBrowserWorker({
    pool: { acquire: async () => lease },
    fixtureHtml: "<p>fixture</p>",
    createRequest: async ({ storageState }) => {
      assert.equal(storageState.cookies.length, 1);
      return {
        get: async () => {
          reads++;
          return {
            status: () => 200,
            text: async () => "user_id: '12345'",
            dispose: async () => {},
          };
        },
        dispose: async () => {},
      };
    },
  });
  worker.launch = () =>
    chromium.launch({
      executablePath: "/usr/bin/chromium",
      headless: true,
      chromiumSandbox: true,
    });
  try {
    await worker.start();
    await worker.context.addCookies([
      {
        name: "PHPSESSID",
        value: "synthetic-only",
        domain: "usosweb.ideis.pl",
        path: "/",
        secure: true,
      },
    ]);
    await worker.page.route("**/*", (route) =>
      route.fulfill({ contentType: "text/html", body: "user_id: '12345'" }),
    );
    await worker.page.goto(HOME);
    assert.equal(await worker.verify(), true);
    assert.equal(released, 1);
    assert.equal(worker.browser, null);
    assert.ok(worker.api);
    assert.equal(await worker.verify(), true);
    assert.equal(reads, 2);
    assert.equal(worker.status().runtime, "kubernetes");
    assert.equal(
      JSON.stringify(worker.status()).includes("synthetic-only"),
      false,
    );
  } finally {
    await worker.close();
  }
});

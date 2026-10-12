import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { BrowserWorker } from "./browser.mjs";

export const NAMESPACE = "usos-login";
export const CONTEXT = "usos-worker-controller";
const MANAGED = "usos-local";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// These manifests never contain app-account IDs, Microsoft data or USOS cookies.
export function browserJob(name, image, deadline = 900) {
  if (
    !/^usos-browser-[a-f0-9]{24}$/.test(name) ||
    !/^[a-zA-Z0-9./_:@-]+$/.test(image)
  )
    throw new Error("Invalid worker specification");
  if (!Number.isInteger(deadline) || deadline < 10 || deadline > 900)
    throw new Error("Invalid worker deadline");
  return {
    apiVersion: "batch/v1",
    kind: "Job",
    metadata: {
      name,
      namespace: NAMESPACE,
      labels: { "app.kubernetes.io/managed-by": MANAGED },
    },
    spec: {
      backoffLimit: 0,
      activeDeadlineSeconds: deadline,
      ttlSecondsAfterFinished: 30,
      template: {
        metadata: {
          labels: {
            app: "usos-browser",
            "app.kubernetes.io/managed-by": MANAGED,
          },
        },
        spec: {
          automountServiceAccountToken: false,
          restartPolicy: "Never",
          terminationGracePeriodSeconds: 10,
          securityContext: {
            runAsNonRoot: true,
            runAsUser: 1000,
            runAsGroup: 1000,
            fsGroup: 1000,
            seccompProfile: {
              type: "Localhost",
              localhostProfile: "usos/chromium.json",
            },
          },
          containers: [
            {
              name: "chromium",
              image,
              imagePullPolicy: "Never",
              securityContext: {
                allowPrivilegeEscalation: false,
                readOnlyRootFilesystem: true,
                capabilities: { drop: ["ALL"] },
              },
              ports: [{ name: "browser", containerPort: 3000 }],
              readinessProbe: {
                tcpSocket: { port: 3000 },
                initialDelaySeconds: 1,
                periodSeconds: 1,
              },
              resources: {
                requests: { cpu: "250m", memory: "512Mi" },
                limits: { cpu: "2", memory: "1536Mi" },
              },
              volumeMounts: [
                { name: "tmp", mountPath: "/tmp" },
                { name: "shm", mountPath: "/dev/shm" },
                {
                  name: "capability",
                  mountPath: "/run/worker-token",
                  readOnly: true,
                },
              ],
            },
          ],
          volumes: [
            { name: "tmp", emptyDir: { medium: "Memory", sizeLimit: "512Mi" } },
            { name: "shm", emptyDir: { medium: "Memory", sizeLimit: "256Mi" } },
            {
              name: "capability",
              secret: { secretName: name, defaultMode: 0o440 },
            },
          ],
        },
      },
    },
  };
}

export class KubernetesPool {
  constructor({
    kubeconfig,
    inCluster = false,
    image = "usos-chromium:2026-09-14-security-v3",
    deadline = 900,
    maxWorkers = 2,
  } = {}) {
    if (!kubeconfig?.startsWith("/"))
      throw new Error("An explicit dedicated kubeconfig is required");
    this.args = [
      "--kubeconfig",
      kubeconfig,
      "--context",
      CONTEXT,
      "--namespace",
      NAMESPACE,
      "--request-timeout=30s",
    ];
    this.inCluster = inCluster;
    this.image = image;
    this.deadline = deadline;
    this.maxWorkers = maxWorkers;
    this.leases = new Set();
    this.pending = new Set();
    this.closed = false;
  }
  run(args, input, timeout = 45_000) {
    return new Promise((resolve, reject) => {
      const child = spawn("kubectl", [...this.args, ...args], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      let size = 0;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(new Error("Kubernetes operation timed out"));
      }, timeout);
      child.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size > 1_000_000) {
          child.kill();
          finish(new Error("Kubernetes response too large"));
        } else output += chunk;
      });
      // kubectl errors may contain transport data. Do not expose raw output to clients/logs.
      child.stderr.on("data", () => {});
      child.once("error", () =>
        finish(new Error("Could not run Kubernetes client")),
      );
      child.once("close", (code) =>
        finish(
          code === 0 ? null : new Error("Kubernetes operation failed"),
          output,
        ),
      );
      child.stdin.on("error", () => {});
      child.stdin.end(input === undefined ? undefined : JSON.stringify(input));
    });
  }
  async assertTarget() {
    const config = JSON.parse(
      await this.run(["config", "view", "--minify", "-o", "json"]),
    );
    if (
      config["current-context"] !== CONTEXT ||
      config.contexts?.[0]?.context?.cluster !== "usos-local" ||
      config.contexts?.[0]?.context?.namespace !== NAMESPACE
    )
      throw new Error("Unexpected Kubernetes context");
    if (this.inCluster &&
        config.clusters?.[0]?.cluster?.server !== "https://kubernetes.default.svc")
      throw new Error("Unexpected in-cluster API endpoint");
    const identity = JSON.parse(
      await this.run(["auth", "whoami", "-o", "json"]),
    );
    if (
      identity.status?.userInfo?.username !==
      (this.inCluster ? "system:serviceaccount:usos-app:usos-app" : `system:serviceaccount:${NAMESPACE}:browser-controller`)
    )
      throw new Error("Unexpected Kubernetes identity");
  }
  async mutate(args, input) {
    await this.assertTarget();
    return this.run(args, input);
  }
  async acquire() {
    if (this.closed || this.leases.size >= this.maxWorkers)
      throw new Error("Browser capacity reached");
    const name = "usos-browser-" + randomBytes(12).toString("hex");
    const token = randomBytes(32).toString("hex");
    const lease = { name, tunnel: null, release: () => this.release(lease) };
    this.leases.add(lease);
    const task = this.provision(lease, token);
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task)).catch(() => {});
    return task;
  }
  async provision(lease, token) {
    const { name } = lease;
    let phase = "create-job";
    try {
      const job = JSON.parse(
        await this.mutate(
          ["create", "-f", "-", "-o", "json"],
          browserJob(name, this.image, this.deadline),
        ),
      );
      phase = "create-capability";
      await this.mutate(["create", "-f", "-", "-o", "name"], {
        apiVersion: "v1",
        kind: "Secret",
        type: "Opaque",
        metadata: {
          name,
          namespace: NAMESPACE,
          ownerReferences: [
            {
              apiVersion: "batch/v1",
              kind: "Job",
              name,
              uid: job.metadata.uid,
              controller: true,
              blockOwnerDeletion: false,
            },
          ],
        },
        stringData: { token },
      });
      phase = "pod-readiness";
      const until = Date.now() + 90_000;
      let pod;
      while (Date.now() < until && !this.closed) {
        const list = JSON.parse(
          await this.run([
            "get",
            "pods",
            "-l",
            `job-name=${name}`,
            "-o",
            "json",
          ]),
        );
        pod = list.items.find((item) =>
          item.status?.conditions?.some(
            (c) => c.type === "Ready" && c.status === "True",
          ),
        );
        if (pod) break;
        if (
          list.items.some((item) =>
            ["Failed", "Succeeded"].includes(item.status?.phase),
          )
        )
          throw new Error("Browser pod stopped before readiness");
        await pause(750);
      }
      if (!pod || this.closed)
        throw new Error("Browser pod did not become ready");
      lease.podName = pod.metadata.name;
      phase = "worker-transport";
      const port = await this.forward(lease);
      lease.endpoint = `ws://127.0.0.1:${port}/${token}`;
      return lease;
    } catch (error) {
      await lease.release().catch(() => {});
      const failure = new Error(
        "Uruchomienie Chromium w Kubernetes nie powiodło się. Sprawdź lokalny klaster.",
      );
      failure.code = phase;
      throw failure;
    }
  }
  forward(lease) {
    return new Promise((resolve, reject) => {
      const child = spawn(
        "kubectl",
        [
          ...this.args,
          "port-forward",
          "--address=127.0.0.1",
          `pod/${lease.podName}`,
          ":3000",
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      lease.tunnel = child;
      let output = "";
      let ready = false;
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Browser transport timed out"));
      }, 15_000);
      child.stdout.on("data", (chunk) => {
        output = (output + chunk).slice(-2000);
        const match = output.match(
          /Forwarding from 127\.0\.0\.1:(\d+) -> 3000/,
        );
        if (match && !ready) {
          ready = true;
          clearTimeout(timer);
          resolve(Number(match[1]));
        }
      });
      child.stderr.on("data", () => {});
      child.on("error", () => {
        clearTimeout(timer);
        reject(new Error("Browser transport failed"));
      });
      child.on("close", () => {
        clearTimeout(timer);
        if (!ready) reject(new Error("Browser transport closed"));
      });
    });
  }
  async release(lease) {
    if (!this.leases.has(lease)) return;
    if (lease.releasing) return lease.releasing;
    lease.releasing = (async () => {
      lease.tunnel?.kill("SIGTERM");
      lease.endpoint = undefined;
      await this.mutate([
        "delete",
        "job",
        lease.name,
        "--ignore-not-found=true",
        "--cascade=foreground",
        "--wait=true",
        "--timeout=25s",
      ]);
      this.leases.delete(lease);
    })();
    try {
      await lease.releasing;
    } finally {
      lease.releasing = null;
    }
  }
  async close() {
    this.closed = true;
    await Promise.allSettled([...this.pending]);
    await Promise.all([...this.leases].map((lease) => lease.release()));
  }
}

export class KubernetesBrowserWorker extends BrowserWorker {
  constructor({ pool, ...options }) {
    super(options);
    this.pool = pool;
    this.lease = null;
    this.launch = async () => {
      let browser;
      try {
        browser = await chromium.connect(this.lease.endpoint, { timeout: 20_000 });
      } catch {
        const failure = new Error("Browser protocol connection failed");
        failure.code = "browser-protocol";
        throw failure;
      }
      browser.on("disconnected", () => this.fail());
      return browser;
    };
  }
  status() {
    return { ...super.status(), runtime: "kubernetes" };
  }
  async start() {
    this.starting = (async () => {
      try {
        this.lease = await this.pool.acquire();
        if (this.closed) throw new Error("Worker already closed");
        await super.start();
      } catch (error) {
        await super.close();
        await this.lease?.release();
        const failure = new Error("Chromium worker startup failed");
        failure.code = error.code || "browser-start";
        throw failure;
      }
    })();
    return this.starting;
  }
  async verify() {
    const verified = await super.verify();
    if (verified) await this.lease?.release();
    return verified;
  }
  async close() {
    this.closed = true;
    await this.starting?.catch(() => {});
    await super.close();
    await this.lease?.release();
  }
}

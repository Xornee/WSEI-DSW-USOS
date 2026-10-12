import { readFile } from "node:fs/promises";
import { chromium } from "playwright";
// Capability is injected through a per-job Secret, never returned to a browser user.
const token = (await readFile("/run/worker-token/token", "utf8")).trim();
if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Invalid worker capability");
let server;
try {
  server = await chromium.launchServer({
    chromiumSandbox: true,
    headless: true,
    host: "0.0.0.0",
    port: 3000,
    wsPath: token,
  });
  console.log("Chromium ready; sandbox enabled");
} catch {
  console.error("Chromium startup failed");
  process.exit(1);
}
server.on("close", () => process.exit(0));
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, async () => {
    await server.close().catch(() => {});
    process.exit(0);
  });

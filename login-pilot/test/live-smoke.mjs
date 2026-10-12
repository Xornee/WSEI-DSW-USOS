// Explicit opt-in smoke test. Visits public login pages; never enters credentials.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { BrowserWorker } from "../browser.mjs";
import { createPilot } from "../server.mjs";

let worker;
const pilot = await createPilot({
  allowAnonymousForTests: true,
  port: 0,
  workerFactory: () => (worker = new BrowserWorker()),
});
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  chromiumSandbox: true,
});
try {
  const page = await browser.newPage({
    viewport: { width: 1560, height: 1100 },
  });
  await page.goto(pilot.origin);
  await page.locator("#start-main").click();
  await page.waitForFunction(
    () => document.querySelector("#connection").textContent === "LIVE",
    undefined,
    { timeout: 90_000 },
  );
  console.log("LIVE: isolated Chromium opened the university login page");
  if (new URL(worker.page.url()).hostname === "login.wsb.pl") {
    const link = worker.page.getByRole("link", {
      name: /Przejdź do logowania Microsoft/i,
    });
    await link.waitFor({ timeout: 15_000 });
    const box = await link.boundingBox();
    const canvas = await page.locator("#screen").boundingBox();
    await page.mouse.click(
      canvas.x + ((box.x + box.width / 2) * canvas.width) / 1280,
      canvas.y + ((box.y + box.height / 2) * canvas.height) / 800,
    );
  }
  await worker.page.waitForURL(
    (url) => url.hostname === "login.microsoftonline.com",
    { timeout: 45_000 },
  );
  await worker.page
    .locator('input[name="loginfmt"]')
    .waitFor({ timeout: 30_000 });
  assert.equal(
    await worker.page.locator('input[name="loginfmt"]').inputValue(),
    "",
  );
  console.log(
    "LIVE: Microsoft email form visible through remote viewer; credential fields untouched",
  );
  await page.locator("#verify").click();
  await page.waitForFunction(() =>
    document
      .querySelector("#notice")
      .textContent.includes("Finish Microsoft login"),
  );
  assert.equal(worker.status().backendVerified, false);
  console.log(
    "LIVE: verification before login rejected; no authenticated handoff claimed",
  );
  console.log("LIVE_REQUESTS: " + JSON.stringify(worker.status().requests));
  await page.locator("#disconnect").click();
  await page.waitForFunction(
    () => document.querySelector("#state").textContent === "Ready to connect",
  );
  assert.equal(worker.closed, true);
  console.log("LIVE: browser closed and temporary session cleared; exit=0");
} finally {
  await browser.close();
  await pilot.close();
}

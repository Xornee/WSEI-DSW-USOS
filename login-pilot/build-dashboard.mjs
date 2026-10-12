import { execFileSync } from "node:child_process";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Separate build directory: the original Vite site and sources are unchanged.
execFileSync(
  process.execPath,
  [
    fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url)),
    "build",
    "--base=/dashboard/",
    "--outDir=../login-pilot/dashboard-dist",
  ],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    stdio: "inherit",
  },
);
const target = new URL("./dashboard-dist/index.html", import.meta.url);
const html = await readFile(target, "utf8");
const bootstrap = html.match(/<script>\s*([\s\S]*?)<\/script>/);
if (!bootstrap) throw new Error("Expected theme bootstrap in dashboard HTML");
await writeFile(
  new URL("./dashboard-dist/theme.js", import.meta.url),
  bootstrap[1],
);
await writeFile(
  target,
  html
    .replace(bootstrap[0], '<script src="/dashboard/theme.js"></script>')
    .replace(
      "</head>",
      '<link rel="stylesheet" href="/dashboard-session.css"><script src="/dashboard-session.js" defer></script></head>',
    ),
);
const files = [
  "index.html",
  "favicon.svg",
  "theme.js",
  ...(await readdir(new URL("./dashboard-dist/assets/", import.meta.url))).map(
    (file) => `assets/${file}`,
  ),
];
await writeFile(
  new URL("./dashboard-dist/files.json", import.meta.url),
  JSON.stringify(files),
);
console.log("DASHBOARD_BUILD: separate desktop bundle ready");

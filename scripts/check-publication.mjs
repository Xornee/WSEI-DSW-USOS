#!/usr/bin/env node
import { readdir, readFile, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const ignoredDirectory = new Set(['node_modules', '.git', '.data', '.cache', '.audits', 'dist', 'dashboard-dist', 'coverage', '.frontend-redesign']);
const forbidden = path => path.split('/').some(part => ignoredDirectory.has(part) && part !== '.git') || path.startsWith('fixtures/') || /(^|\/)\.env(?:\.|$)/.test(path) && !['.env.example', '.env.legacy.example'].includes(path) || /\.(?:sqlite(?:-.*)?|db(?:-.*)?|har|log|pem|key|p12|pfx|kubeconfig|zip|tar|gz|7z)$/.test(path) || /(?:^|\/)controller\.json$/.test(path);
async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name), rel = relative(root, path).replaceAll('\\', '/');
    if (entry.name === '.git' || forbidden(rel)) continue;
    if (entry.isDirectory()) paths.push(...await walk(path)); else paths.push(rel);
  }
  return paths;
}
const files = existsSync(join(root, '.git')) ? execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean) : await walk(root);
const rules = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['github-token', /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ['cloud-key', /\bAKIA[A-Z0-9]{16}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/],
  ['embedded-session', /PHPSESSID\s*=\s*[a-z0-9]{24,}/i],
  ['absolute-user-path', /\/(?:home|Users)\/[A-Za-z0-9_.-]+\/(?:usos-local|\.kube|\.codex)(?:\/|$)/],
];
const findings = [];
for (const file of new Set(files)) {
  if (forbidden(file)) { findings.push({ file, rule: 'private-file-tracked' }); continue; }
  const path = join(root, file), info = await lstat(path);
  if (!info.isFile()) { findings.push({ file, rule: 'non-regular-file' }); continue; }
  const content = await readFile(path, 'utf8');
  for (const [rule, pattern] of rules) if (pattern.test(content)) findings.push({ file, rule });
}
if (findings.length) { console.error(JSON.stringify({ status: 'FAIL', findings })); process.exitCode = 1; }
else console.log(`PUBLICATION_CHECK: ${new Set(files).size} eligible files; forbidden paths=0; secret-pattern matches=0; PASS`);

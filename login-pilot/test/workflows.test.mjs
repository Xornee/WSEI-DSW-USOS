import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import { DashboardConnection, createScheduler } from '../dashboard.mjs';
import { createPilot } from '../server.mjs';
import { workflowUrl } from '../workflows.mjs';
import { createUsosRequest } from '../upstream.mjs';
import { WorkflowWorker, applications, page, validFields } from './workflows-fixture.mjs';
const connection = worker => new DashboardConnection(worker, { schedule: createScheduler(0) });
const open = c => c.workflows.open({ entry: 'applications' });
const input = form => ({ formId: form.id, fields: validFields, confirmed: true });

for (const url of ['http://127.0.0.1/kontroler.php?_action=dodatki/wnioski/index',
 'https://usosweb.ideis.pl.evil.test/kontroler.php?_action=dodatki/wnioski/index',
 'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/index&_action=home/index',
 'https://usosweb.ideis.pl/kontroler.php?_action=logowaniecas/index',
 'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/../index',
 'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/usun']) {
 test(`workflow target rejects ${new URL(url).hostname} / ${new URL(url).searchParams.get('_action')}`, () => assert.throws(() => workflowUrl(url)));
}
test('read view contains local forms and opaque targets, never hidden CSRF or upstream HTML', async () => {
 const w = new WorkflowWorker(), c = connection(w), p = await open(c);
 assert.equal(p.forms.length, 1); assert.equal(p.forms[0].fields.length, 4); assert.equal(w.writes.length, 0);
 assert.doesNotMatch(JSON.stringify(p), /synthetic-hidden-csrf|synthetic-url-csrf|<script>|user_id/);
 assert.ok(p.links.some(l => l.workflow.kind === 'download'));
 assert.ok(p.tables[0].rows[0][1].links.every(link => link.workflow));
});
test('detail and form handles are isolated between owners and destroyed on disconnect', async () => {
 const a = connection(new WorkflowWorker()), b = connection(new WorkflowWorker('1002')), p = await open(a);
 await assert.rejects(b.workflows.open({ target: p.target }), e => e.status === 410);
 await assert.rejects(b.workflows.submit(input(p.forms[0])), e => e.status === 410);
 a.close(); assert.equal(a.workflows.forms.size, 0); assert.equal(a.workflows.targets.size, 0);
});
test('unconfirmed mutation performs no identity check and no write', async () => {
 const w = new WorkflowWorker(), c = connection(w), p = await open(c), before = w.calls.length;
 await assert.rejects(c.workflows.submit({ ...input(p.forms[0]), confirmed: false }), e => e.status === 409);
 assert.equal(w.calls.length, before); assert.equal(w.writes.length, 0);
});
for (const fields of [{ ...validFields, csrf: ['attacker'] }, { ...validFields, kind: ['foreign'] }, { ...validFields, reason: [] }, { ...validFields, consent: [] }, { ...validFields, reason: ['x'.repeat(1001)] }]) {
 test('forged fields/options/empty required values never reach USOS', async () => {
  const w = new WorkflowWorker(), c = connection(w), p = await open(c);
  await assert.rejects(c.workflows.submit({ ...input(p.forms[0]), fields }), e => e.status === 400);
  assert.equal(w.writes.length, 0);
 });
}
test('confirmed form submits captured hidden fields once; result/back/refresh never replay POST', async () => {
 const w = new WorkflowWorker(), c = connection(w), p = await open(c), result = await c.workflows.submit(input(p.forms[0]));
 assert.equal(w.writes.length, 1); assert.equal(w.writes[0].body.get('csrf'), 'synthetic-hidden-csrf');
 assert.equal(w.writes[0].body.get('reason'), validFields.reason[0]); assert.match(result.paragraphs.join(' '), /Przyjęto/);
 await c.workflows.open({ target: result.target }); await c.workflows.open({ target: result.target, refresh: true }); assert.equal(w.writes.length, 1);
 await assert.rejects(c.workflows.submit(input(p.forms[0])), e => e.status === 410);
});
test('concurrent duplicate submissions execute one mutation', async () => {
 const w = new WorkflowWorker(), c = connection(w), p = await open(c);
 const results = await Promise.allSettled([c.workflows.submit(input(p.forms[0])), c.workflows.submit(input(p.forms[0]))]);
 assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(w.writes.length, 1);
});
test('uncertain write consumes its action, never retries', async () => {
 const w = new WorkflowWorker(), c = connection(w), p = await open(c); w.failWrite = true;
 await assert.rejects(c.workflows.submit(input(p.forms[0])));
 await assert.rejects(c.workflows.submit(input(p.forms[0])), e => e.status === 410); assert.equal(w.writes.length, 1);
});
test('identity mismatch expires jar before any write', async () => {
 const w = new WorkflowWorker(), c = connection(w), p = await open(c); w.replyId = '9999';
 await assert.rejects(c.workflows.submit(input(p.forms[0])), e => e.status === 401);
 assert.equal(w.writes.length, 0); assert.equal(c.workflows.forms.size, 0);
});
test('expired form never reaches transport', async () => {
 const w = new WorkflowWorker(), c = connection(w), p = await open(c); c.workflows.forms.get(p.forms[0].id).expires = 0;
 await assert.rejects(c.workflows.submit(input(p.forms[0])), e => e.status === 410); assert.equal(w.writes.length, 0);
});
test('GET search runs locally with server-captured target', async () => {
 const w = new WorkflowWorker(), c = connection(w), p = await c.workflows.open({ entry: 'course-catalog' });
 const result = await c.workflows.submit({ formId: p.forms[0].id, fields: { _pattern: ['test'] }, confirmed: false });
 assert.match(result.paragraphs.join(' '), /Wynik wyszukiwania/); assert.equal(w.writes.length, 0);
});
test('state-changing GET link becomes a confirmation form, not navigation', async () => {
 const w = new WorkflowWorker(), c = connection(w), p = await open(c), link = p.links.find(l => l.workflow.kind === 'action');
 const action = await c.workflows.open({ target: link.workflow.target }); assert.equal(w.writes.length, 0);
 await assert.rejects(c.workflows.submit({ formId: action.forms[0].id, fields: {}, confirmed: false }), e => e.status === 409);
 await c.workflows.submit({ formId: action.forms[0].id, fields: {}, confirmed: true }); assert.equal(w.writes.length, 1);
});
test('PDF download stays owner-scoped and rejects login HTML', async () => {
 const w = new WorkflowWorker(), c = connection(w), p = await open(c), target = p.links.find(l => l.workflow.kind === 'download').workflow.target;
 const document = await c.workflows.download(target); assert.equal(document.type, 'application/pdf'); assert.equal(document.filename, 'synthetic.pdf');
 assert.ok(document.bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
 w.badDownload = true; await assert.rejects(c.workflows.download(target), e => e.status === 502);
});
test('POST redirect is followed only to same-origin read page', async () => {
 const w = new WorkflowWorker(), c = connection(w), p = await open(c); w.redirect = '?_action=dodatki/wnioski/pokaz&id=10';
 const result = await c.workflows.submit(input(p.forms[0])); assert.equal(result.title, 'Szczegóły wniosku');
 const w2 = new WorkflowWorker(), c2 = connection(w2), p2 = await open(c2); w2.redirect = 'https://evil.test/';
 await assert.rejects(c2.workflows.submit(input(p2.forms[0])), e => e.status === 400);
 assert.ok(w2.calls.every(call => new URL(call.url).origin === 'https://usosweb.ideis.pl'));
});
test('unsupported dynamic/password controls are explicit, not fake functional forms', () => {
 const c = connection(new WorkflowWorker());
 const result = c.workflows.render(page('1001', '<h1>Dynamiczny formularz</h1><form method="post" action="?_action=dodatki/wnioski/index"><input name="secret" type="password"><button>Wyślij</button></form>'), 'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/index', 'Test');
 assert.equal(result.forms.length, 0); assert.equal(result.notices.length, 1);
});
test('file attachments use multipart and hidden fields stay server-side', async () => {
 const w = new WorkflowWorker(), c = connection(w), p = await open(c);
 await c.workflows.submit(input(p.forms[0]), [{ name: 'attachment', blob: new File(['%PDF-test'], 'test.pdf', { type: 'application/pdf' }) }]);
 assert.ok(w.writes[0].body instanceof FormData); assert.equal(w.writes[0].body.get('attachment').name, 'test.pdf');
 assert.equal(w.writes[0].body.get('csrf'), 'synthetic-hidden-csrf');
});
test('native transport supports bounded bytes and POST without forwarding cookies to another host', async () => {
 let calls = 0;
 const api = await createUsosRequest({ storageState: { cookies: [{ name: 'PHPSESSID', value: 'synthetic', domain: 'usosweb.ideis.pl' }] } }, async (url, options) => {
  calls++; assert.equal(url.origin, 'https://usosweb.ideis.pl'); assert.equal(options.redirect, 'manual');
  if (options.method === 'POST') assert.equal(options.headers.origin, 'https://usosweb.ideis.pl');
  return new Response('%PDF-test', { headers: { 'content-type': 'application/pdf' } });
 });
 assert.equal((await (await api.post('https://usosweb.ideis.pl/kontroler.php', { body: new URLSearchParams({ x: 'test' }) })).body()).toString(), '%PDF-test');
 await assert.rejects(api.post('https://evil.test/kontroler.php', { body: 'x' })); assert.equal(calls, 1);
 await assert.rejects(api.get('https://usosweb.ideis.pl/kontroler.php', { maxBytes: 3 }), /byte limit/); await api.dispose();
});
async function pilotFixture(t) {
 let index = 0; const workers = [];
 const pilot = await createPilot({ port: 0, allowAnonymousForTests: true, dashboardIntervalMs: 0,
  workerFactory: () => { const worker = new WorkflowWorker(String(1001 + index++)); workers.push(worker); return worker; },
  dashboardFactory: worker => connection(worker) });
 t.after(() => pilot.close()); return { pilot, workers };
}
async function owner(pilot) {
 const opened = await fetch(pilot.origin), cookie = opened.headers.get('set-cookie').split(';')[0];
 for (const action of ['start', 'verify']) assert.equal((await fetch(`${pilot.origin}/api/${action}`, { method: 'POST', headers: { cookie, origin: pilot.origin } })).status, 200);
 const status = await (await fetch(`${pilot.origin}/api/status`, { headers: { cookie } })).json();
 return { cookie, connection: status.connectionId };
}
test('HTTP write route requires Origin, current connection and owner; no side effects on rejection', async t => {
 const { pilot, workers } = await pilotFixture(t), auth = await owner(pilot);
 const p = (await (await fetch(`${pilot.origin}/api/workflows?entry=applications`, { headers: { cookie: auth.cookie } })).json()).data;
 const options = { method: 'POST', headers: { cookie: auth.cookie, origin: pilot.origin, 'content-type': 'application/json', 'x-usos-connection': auth.connection }, body: JSON.stringify(input(p.forms[0])) };
 assert.equal((await fetch(`${pilot.origin}/api/workflows/submit`, { ...options, headers: { ...options.headers, 'x-usos-connection': 'stale' } })).status, 403);
 assert.equal((await fetch(`${pilot.origin}/api/workflows/submit`, { ...options, headers: { ...options.headers, origin: 'https://evil.test' } })).status, 403);
 assert.equal((await fetch(`${pilot.origin}/api/workflows/submit`, { ...options, headers: { ...options.headers, cookie: '' } })).status, 401);
 assert.equal(workers[0].writes.length, 0);
 assert.equal((await fetch(`${pilot.origin}/api/workflows/submit`, options)).status, 200);
 assert.equal((await fetch(`${pilot.origin}/api/workflows/submit`, options)).status, 410);
 assert.equal(workers[0].writes.length, 1);
});
test('React native workflows complete application, registration, catalogue and download without USOS navigation', async t => {
 const { pilot, workers } = await pilotFixture(t);
 const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, chromiumSandbox: true });
 t.after(() => browser.close()); const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
 const errors = [], external = []; const tab = await context.newPage(); tab.on('pageerror', e => errors.push(e.message));
 tab.on('request', req => { if (req.isNavigationRequest() && new URL(req.url()).origin !== pilot.origin) external.push(req.url()); });
 await context.request.get(pilot.origin);
 for (const action of ['start', 'verify']) assert.equal((await context.request.post(`${pilot.origin}/api/${action}`, { headers: { origin: pilot.origin } })).status(), 200);
 await tab.goto(`${pilot.origin}/dashboard/#documents`);
 await tab.getByRole('link', { name: 'Szczegóły i działania', exact: true }).click();
 await tab.getByRole('heading', { name: 'Wniosek demonstracyjny', exact: true, level: 1 }).waitFor();
 await tab.getByLabel('Uzasadnienie').fill('Testowy wniosek z aplikacji'); await tab.getByLabel('Akceptuję').check();
 await tab.getByRole('button', { name: 'Wyślij wniosek', exact: true }).click(); assert.equal(workers[0].writes.length, 0);
 assert.equal(await tab.locator('.workflow-unavailable').count(), 0);
 const audit = process.env.WORKFLOW_SCREENSHOTS;
 if (audit) { await mkdir(audit, { recursive: true }); await tab.screenshot({ path: `${audit}/desktop-confirmation.png`, fullPage: true });
  await tab.setViewportSize({ width: 390, height: 844 }); await tab.screenshot({ path: `${audit}/mobile-confirmation.png`, fullPage: true });
  assert.ok(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await tab.setViewportSize({ width: 1440, height: 1000 }); await tab.getByRole('button', { name: 'Włącz tryb ciemny', exact: true }).click(); await tab.screenshot({ path: `${audit}/dark-confirmation.png`, fullPage: true }); await tab.getByRole('button', { name: 'Włącz tryb jasny', exact: true }).click(); }
 await tab.getByRole('button', { name: 'Potwierdzam i wykonuję' }).click(); await tab.getByText('Przyjęto wniosek testowy.', { exact: true }).waitFor();
 assert.equal(workers[0].writes.length, 1);
 await tab.goto(`${pilot.origin}/dashboard/#workflow/entry/registration-subjects`);
 await tab.getByLabel('Grupa', { exact: true }).selectOption('lab-b'); await tab.getByRole('button', { name: 'Zapisz do grupy' }).click();
 assert.equal(workers[0].writes.length, 1); await tab.getByRole('button', { name: 'Potwierdzam i wykonuję' }).click();
 await tab.getByText('Testowy zapis: Laboratorium B.', { exact: true }).waitFor(); assert.equal(workers[0].writes.length, 2);
 await tab.goto(`${pilot.origin}/dashboard/#workflow/entry/course-catalog`); await tab.getByLabel('Nazwa przedmiotu').fill('test'); await tab.getByRole('button', { name: 'Szukaj', exact: true }).click();
 await tab.getByText('Wynik wyszukiwania: przedmiot testowy.', { exact: true }).waitFor();
 await tab.goto(`${pilot.origin}/dashboard/#workflow/entry/applications`);
 const downloaded = tab.waitForEvent('download'); await tab.getByRole('button', { name: 'Pobierz PDF', exact: true }).click();
 const file = await downloaded; assert.equal(file.suggestedFilename(), 'synthetic.pdf'); assert.match((await readFile(await file.path())).toString(), /^%PDF-/);
 for (const screen of ['documents', 'payments', 'registrations', 'courses', 'contacts', 'resources', 'news', 'progress']) {
  await tab.goto(`${pilot.origin}/dashboard/#${screen}`); await tab.waitForTimeout(100);
  assert.equal(await tab.locator('a[href*="usosweb.ideis.pl"]').count(), 0, screen);
 }
 assert.deepEqual(external, []); assert.deepEqual(errors, []);
});

test('HTTP multipart upload reaches captured form with one owned attachment', async t => {
 const { pilot, workers } = await pilotFixture(t), auth = await owner(pilot);
 const p = (await (await fetch(`${pilot.origin}/api/workflows?entry=applications`, { headers: { cookie: auth.cookie } })).json()).data;
 const body = new FormData(); body.append('payload', JSON.stringify(input(p.forms[0]))); body.append('file:attachment', new File(['%PDF-test'], 'fixture.pdf', { type: 'application/pdf' }));
 const response = await fetch(`${pilot.origin}/api/workflows/submit`, { method: 'POST', headers: { cookie: auth.cookie, origin: pilot.origin, 'x-usos-connection': auth.connection }, body });
 assert.equal(response.status, 200); assert.equal(workers[0].writes.length, 1); assert.equal(workers[0].writes[0].body.get('attachment').name, 'fixture.pdf');
});
test('courses entry and decorated table details use real local capabilities', async () => {
 const w = new WorkflowWorker(), c = connection(w);
 assert.ok(await c.workflows.open({ entry: 'courses' }));
 const section = (await c.handle(new URL('http://local.test/api/sections/applications'))).data;
 const link = section.tables[0].rows[0][1].links.find(link => link.label === 'Szczegóły wniosku');
 assert.ok(link.workflow); assert.equal((await c.workflows.open({ target: link.workflow.target })).title, 'Szczegóły wniosku');
});

test('unknown GET actions are confirmation-only, never fetched by ordinary detail navigation', async () => {
 const worker = new WorkflowWorker(), c = connection(worker), url = 'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/zmienStan';
 assert.throws(() => workflowUrl(url), e => e.status === 409);
 const link = c.workflows.discoveredLink(url, 'Zmień stan', 'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/index');
 assert.equal(link.workflow.kind, 'action');
 const result = await c.workflows.open({ target: link.workflow.target }); assert.equal(result.forms[0].changesAccount, true); assert.equal(worker.calls.length, 0);
});

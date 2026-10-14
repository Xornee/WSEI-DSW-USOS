import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { AccountStore } from '../accounts.mjs';
import { createPilot } from '../server.mjs';
import { DashboardConnection, createScheduler } from '../dashboard.mjs';
import { personalizePlan, groupOptions, planScope, validateChoices } from '../personal-plan.mjs';
import { serializePlan } from '../../shared/plan-calendar.mjs';
import { discoverStudentServices } from '../student-services.mjs';
import { WorkflowWorker, page } from './workflows-fixture.mjs';

const envelope = data => ({ ok: true, data, error: null, meta: { source: 'live', stale: false, fetchedAt: new Date().toISOString() } });
function fixturePlan() {
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' });
  const entry = (id, courseName, kind, group, hour) => ({ id, courseName, courseCode: null, kind, kindLabel: kind === 'wyklad' ? 'Wykład' : 'Laboratorium', group,
    start: `${day}T${hour}:00:00+02:00`, end: `${day}T${hour}:45:00+02:00`, room: 'Sala testowa', lecturer: 'Prowadzący testowy', building: null });
  return { from: `${day}T00:00:00+02:00`, to: `${day}T23:59:00+02:00`, timetable: { trackId: '958', title: 'Tok testowy', url: 'https://harmonogram.krakow.ideis.pl/Plany/PlanyTokow/958', timezone: 'Europe/Warsaw' }, entries: [
    entry('shared', 'Wykład wspólny', 'wyklad', null, '18'), entry('single', 'Wykład z jedną grupą', 'wyklad', 'Cały tok', '19'),
    entry('alpha-a', 'Analiza testowa', 'laboratorium', 'A', '20'), entry('alpha-b', 'Analiza testowa', 'laboratorium', 'B', '21'),
    entry('beta-x', 'Programowanie testowe', 'laboratorium', 'X', '22'), entry('beta-y', 'Programowanie testowe', 'laboratorium', 'Y', '23'),
  ] };
}
const choicesOf = plan => Object.fromEntries(groupOptions(plan.entries).map(option => [option.key, [option.groups[0]]]));
function connection(worker, preferences = null) {
  const c = new DashboardConnection(worker, { schedule: createScheduler(0), planPreferences: preferences,
    timetable: { get: async () => envelope(fixturePlan()) }, trackCatalog: { candidates: async () => [{ trackId: '958', title: 'Tok testowy' }] } });
  c.stages = async () => envelope({ programmes: [] });
  c.student = async () => envelope({ id: worker.expectedAccount, displayName: 'Student testowy', albumNumber: null, libraryCard: null, roles: [], faculty: null, accessExpires: null, email: null, photoUrl: null, programmes: [] });
  return c;
}

test('personal groups preserve shared lectures and independently filter each course/class kind', () => {
  const plan = fixturePlan(), chosen = choicesOf(plan), personal = personalizePlan(plan, '1001', chosen);
  assert.deepEqual(personal.entries.map(entry => entry.id), ['shared', 'single', 'alpha-a', 'beta-x']);
  assert.equal(personal.personal.state, 'selected'); assert.equal(plan.entries.length, 6);
  assert.equal(personalizePlan(plan, '1001').personal.state, 'choice_required');
});
test('group scope isolates USOS identity, track and semester', () => {
  const plan = fixturePlan(), scope = planScope(plan, '1001');
  assert.notEqual(scope, planScope(plan, '1002'));
  assert.notEqual(scope, planScope({ ...plan, from: '2027-02-01' }, '1001'));
  assert.notEqual(scope, planScope({ ...plan, timetable: { ...plan.timetable, trackId: '959' } }, '1001'));
});
test('stale group labels fall back to all alternatives with explicit outdated state', () => {
  const plan = fixturePlan(), options = groupOptions(plan.entries);
  const result = personalizePlan(plan, '1001', { [options[0].key]: ['Removed group'] });
  assert.equal(result.entries.length, 6); assert.equal(result.personal.state, 'outdated');
});
for (const value of [null, [], { foreign: ['A'] }, { [groupOptions(fixturePlan().entries)[0].key]: [] },
  { [groupOptions(fixturePlan().entries)[0].key]: ['A', 'A'] }, { [groupOptions(fixturePlan().entries)[0].key]: ['foreign'] }]) {
  test('invalid/foreign/empty/duplicate group selections are rejected', () => {
    assert.throws(() => validateChoices(value, groupOptions(fixturePlan().entries)), error => error.status === 400);
  });
}
test('Start, Plan and ICS share the same persisted selection; group save makes zero university writes', async () => {
  const worker = new WorkflowWorker(), c = connection(worker), plan = (await c.plan()).data;
  await c.setPlanGroups({ scope: plan.personal.scope, choices: choicesOf(plan) });
  const selected = (await c.plan()).data, home = (await c.handle(new URL('http://fixture.test/api/home'))).data;
  assert.equal(home.todayCount, 4); assert.equal(home.personalPlan.state, 'selected');
  assert.ok(!home.nextClass || selected.entries.some(entry => entry.id === home.nextClass.id));
  assert.equal(serializePlan(selected).match(/BEGIN:VEVENT/g).length, 4); assert.equal(worker.writes.length, 0);
});
test('identity mismatch and stale semester reject selection before preferences are stored', async () => {
  const worker = new WorkflowWorker(), c = connection(worker), plan = (await c.plan()).data;
  await assert.rejects(c.setPlanGroups({ scope: '0'.repeat(64), choices: {} }), error => error.status === 409);
  worker.replyId = '1002';
  await assert.rejects(c.setPlanGroups({ scope: plan.personal.scope, choices: choicesOf(plan) }), error => error.status === 401);
});
test('SQLite preferences survive reopening and remain isolated by app account', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'usos-parity-store-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'accounts.sqlite'); let store = new AccountStore(path);
  const a = await store.register({ username: 'alpha', name: 'Alpha test', password: 'fixture-password-only' });
  const b = await store.register({ username: 'beta', name: 'Beta test', password: 'fixture-password-only' });
  const plan = fixturePlan(), scope = planScope(plan, '1001'), choices = choicesOf(plan);
  store.planPreferences(a.id).set(scope, choices); store.close(); store = new AccountStore(path); t.after(() => store.close());
  assert.deepEqual(store.planPreferences(a.id).get(scope), choices); assert.deepEqual(store.planPreferences(b.id).get(scope), {});
  assert.equal(store.db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal((await store.login({ username: 'alpha', password: 'fixture-password-only' })).id, a.id);
});
test('ICS escapes injection, uses actual UTC instants over DST, folds UTF-8 and has stable UIDs', () => {
  const plan = fixturePlan(); plan.entries = [{ ...plan.entries[0], courseName: 'ą'.repeat(90) + ',;\r\nEND:VCALENDAR',
    start: '2026-10-25T01:30:00+02:00', end: '2026-10-25T03:30:00+01:00' }];
  const a = serializePlan(plan, new Date('2026-10-14T12:00:00Z')), b = serializePlan(plan, new Date('2026-10-15T12:00:00Z'));
  assert.match(a, /DTSTART:20261024T233000Z/); assert.match(a, /DTEND:20261025T023000Z/);
  assert.equal(a.split('\r\n').filter(line => line === 'END:VCALENDAR').length, 1);
  assert.ok(a.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
  const unfold = value => value.replace(/\r\n /g, '');
  assert.equal(unfold(a).match(/UID:[^\r]+/)[0], unfold(b).match(/UID:[^\r]+/)[0]);
  assert.match(unfold(a), /\\,\\;\\nEND:VCALENDAR/);
  assert.throws(() => serializePlan({ ...plan, entries: [{ ...plan.entries[0], end: 'bad' }] }));
});
test('services inventory follows real menu links only; does not execute mutations or probe guessed endpoints', () => {
  const worker = new WorkflowWorker(), c = connection(worker), html = page('1001', `
    <a href="?_action=dla_stud/studia/podpiecia/lista">Podpięcia</a>
    <a href="?_action=dla_stud/studia/ankiety/index">Ankiety</a>
    <a href="?_action=dla_stud/studia/ankiety/wyslij">Wyślij</a>
    <a href="https://evil.test/kontroler.php?_action=dla_stud/studia/egzaminy/index">Obcy host</a>
    <a href="?_action=dla_stud/spotkania/wyborJednostki">Spotkania</a>`);
  const inventory = discoverStudentServices(html, c.workflows, 'https://usosweb.ideis.pl/kontroler.php?_action=dla_stud/index');
  assert.deepEqual(inventory.services.filter(service => service.state === 'discovered').map(service => service.id), ['allocations', 'surveys', 'meetings']);
  assert.equal(worker.calls.length, 0); assert.equal(worker.writes.length, 0);
  assert.ok(inventory.services.filter(service => service.link).every(service => service.link.workflow.kind === 'page'));
});
for (const root of ['dla_stud/studia/podpiecia', 'dla_stud/studia/ankiety', 'dla_stud/spotkania', 'dla_stud/studia/egzaminy']) {
  test(`captured standard ${root} form confirms once and reads result locally`, async () => {
    const worker = new WorkflowWorker(), c = connection(worker);
    worker.override = async (method, raw) => ({ status: () => 200, dispose: async () => {}, text: async () => page('1001',
      method === 'POST' ? '<h1>Stan sprawy testowej</h1><p>Testowa czynność przyjęta.</p>' : `<h1>Sprawa testowa</h1><form method="post" action="?_action=${root}/zapisz"><input type="hidden" name="csrf" value="fixture-only"><label for="answer">Wybór</label><input id="answer" name="answer" required><button>Zapisz</button></form>`) });
    const link = c.workflows.discoveredLink(`?_action=${root}/index`, 'Sprawa', 'https://usosweb.ideis.pl/kontroler.php');
    const form = (await c.workflows.open({ target: link.workflow.target })).forms[0]; assert.ok(form);
    await assert.rejects(c.workflows.submit({ formId: form.id, fields: { answer: ['test'] }, confirmed: false }), error => error.status === 409);
    const result = await c.workflows.submit({ formId: form.id, fields: { answer: ['test'] }, confirmed: true });
    assert.match(result.paragraphs.join(' '), /Testowa czynność/); assert.equal(worker.writes.length, 1);
    await assert.rejects(c.workflows.submit({ formId: form.id, fields: { answer: ['test'] }, confirmed: true }), error => error.status === 410);
  });
}
test('draft keys survive form handle refresh, isolate owners and distinguish hidden record IDs', async () => {
  const a = connection(new WorkflowWorker()), b = connection(new WorkflowWorker());
  const first = (await a.workflows.open({ entry: 'applications' })).forms[0];
  const again = (await a.workflows.open({ entry: 'applications' })).forms[0];
  assert.notEqual(first.id, again.id); assert.equal(first.draftKey, again.draftKey);
  assert.notEqual(first.draftKey, (await b.workflows.open({ entry: 'applications' })).forms[0].draftKey);
  const definition = { title: 'Fixture', submitLabel: 'Send', url: 'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/wyslij', method: 'POST', fields: [], hidden: [['id', '1']] };
  assert.notEqual(a.workflows.registerForm(definition).draftKey, a.workflows.registerForm({ ...definition, hidden: [['id', '2']] }).draftKey);
});

async function pilotFixture(t) {
  const workers = []; let nextId = 1001;
  const pilot = await createPilot({ port: 0, allowAnonymousForTests: true, dashboardIntervalMs: 0, timetable: { defaultTrackId: '958', get: async () => envelope(fixturePlan()) },
    workerFactory: () => {
      const worker = new WorkflowWorker(String(nextId++)), reply = worker.reply.bind(worker);
      worker.reply = async (method, raw, options) => new URL(raw).searchParams.get('_action') === 'dla_stud/index'
        ? { status: () => 200, text: async () => page(worker.expectedAccount, '<a href="?_action=dla_stud/studia/ankiety/index">Ankiety testowe</a>'), dispose: async () => {} }
        : reply(method, raw, options);
      workers.push(worker); return worker;
    }, dashboardFactory: worker => connection(worker) });
  t.after(() => pilot.close()); return { pilot, workers };
}
async function owner(pilot) {
  const response = await fetch(pilot.origin), cookie = response.headers.get('set-cookie').split(';')[0];
  for (const action of ['start', 'verify']) assert.equal((await fetch(`${pilot.origin}/api/${action}`, { method: 'POST', headers: { cookie, origin: pilot.origin } })).status, 200);
  const status = await (await fetch(`${pilot.origin}/api/status`, { headers: { cookie } })).json();
  return { cookie, connection: status.connectionId };
}
test('HTTP group route checks owner/Origin/generation/scope; private export cannot expose another selection', async t => {
  const { pilot, workers } = await pilotFixture(t), a = await owner(pilot);
  await new Promise(resolve => setTimeout(resolve, 1250)); const b = await owner(pilot);
  const plan = (await (await fetch(`${pilot.origin}/api/plan`, { headers: { cookie: a.cookie } })).json()).data;
  const input = { scope: plan.personal.scope, choices: choicesOf(plan) }, options = { method: 'POST', headers: { cookie: a.cookie, origin: pilot.origin,
    'content-type': 'application/json', 'x-usos-connection': a.connection }, body: JSON.stringify(input) };
  for (const [field, value, expected] of [['cookie', '', 401], ['origin', 'https://evil.test', 403], ['x-usos-connection', b.connection, 403]])
    assert.equal((await fetch(`${pilot.origin}/api/plan/groups`, { ...options, headers: { ...options.headers, [field]: value } })).status, expected);
  assert.equal((await fetch(`${pilot.origin}/api/plan/groups`, options)).status, 200);
  assert.equal((await (await fetch(`${pilot.origin}/api/home`, { headers: { cookie: a.cookie } })).json()).data.todayCount, 4);
  assert.equal((await (await fetch(`${pilot.origin}/api/home`, { headers: { cookie: b.cookie } })).json()).data.todayCount, 6);
  const exported = await fetch(`${pilot.origin}/api/plan/export`, { headers: { cookie: a.cookie } });
  assert.equal(exported.status, 200); assert.match(exported.headers.get('content-type'), /text\/calendar/);
  assert.equal((await exported.text()).match(/BEGIN:VEVENT/g).length, 4);
  assert.equal((await fetch(`${pilot.origin}/api/plan/export?scope=public`, { headers: { cookie: a.cookie } })).status, 400);
  assert.equal((await fetch(`${pilot.origin}/api/plan/export`, { headers: { cookie: '' } })).status, 401);
  assert.equal(workers.reduce((sum, worker) => sum + worker.writes.length, 0), 0);
  const publicView = (await (await fetch(`${pilot.origin}/api/plan?scope=public`, { headers: { cookie: a.cookie } })).json()).data;
  assert.equal(publicView.entries.length, 6); assert.equal(publicView.personal, undefined);
});

test('browser: groups survive navigation, ICS matches, native services/drafts work, mobile shell fits', async t => {
  const { pilot, workers } = await pilotFixture(t);
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, chromiumSandbox: true }); t.after(() => browser.close());
  const tab = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = []; tab.on('pageerror', error => errors.push(error.message));
  await tab.goto(pilot.origin);
  for (const action of ['start', 'verify']) assert.equal((await tab.request.post(`${pilot.origin}/api/${action}`, { headers: { origin: pilot.origin } })).status(), 200);
  await tab.goto(`${pilot.origin}/dashboard/#plan`);
  await tab.getByText('Wybierz grupy dla poszczególnych zajęć', { exact: true }).click();
  const fields = tab.locator('.personal-group-options fieldset');
  await fields.nth(0).getByRole('checkbox', { name: 'B', exact: true }).uncheck();
  await fields.nth(1).getByRole('checkbox', { name: 'Y', exact: true }).uncheck();
  await tab.getByRole('button', { name: 'Zapisz mój plan', exact: true }).click();
  await tab.getByText('Twój wybór grup obowiązuje na Start, w planie i w eksporcie ICS.', { exact: true }).waitFor();
  const download = tab.waitForEvent('download'); await tab.getByRole('button', { name: 'Pobierz plan ICS' }).click();
  const file = await download; assert.equal(file.suggestedFilename(), 'moj-plan.ics');
  assert.equal((await readFile(await file.path(), 'utf8')).match(/BEGIN:VEVENT/g).length, 4);
  await tab.evaluate(() => { location.hash = '#home'; });
  await tab.waitForFunction(() => document.querySelector('.stats-grid')?.textContent.includes('04'));
  await tab.evaluate(() => { location.hash = '#plan'; });
  await tab.getByText('Twój wybór grup obowiązuje na Start, w planie i w eksporcie ICS.', { exact: true }).waitFor();
  await tab.evaluate(() => { location.hash = '#services'; });
  await tab.getByRole('link', { name: 'Otwórz Ankiety', exact: true }).click();
  assert.ok(tab.url().includes('#workflow/target/')); assert.equal(await tab.locator('a[href*="usosweb.ideis.pl"]').count(), 0);
  await tab.evaluate(() => { location.hash = '#workflow/entry/applications'; });
  await tab.getByLabel('Uzasadnienie', { exact: false }).fill('Szkic testowy bez wysyłania');
  await tab.getByLabel('Akceptuję', { exact: false }).check();
  await tab.evaluate(() => { location.hash = '#services'; }); await tab.getByRole('heading', { name: 'Sprawy uczelniane', exact: true }).waitFor();
  await tab.evaluate(() => { location.hash = '#workflow/entry/applications'; });
  await tab.getByText('Przywrócono szkic z tej sesji.', { exact: false }).waitFor();
  assert.equal(await tab.getByLabel('Uzasadnienie', { exact: false }).inputValue(), 'Szkic testowy bez wysyłania');
  assert.equal(await tab.getByLabel('Akceptuję', { exact: false }).isChecked(), true);
  assert.equal(workers[0].writes.length, 0);
  const audit = process.env.USOS_PARITY_AUDIT;
  if (audit) await mkdir(audit, { recursive: true });
  for (const width of [1440, 390]) {
    await tab.setViewportSize({ width, height: 1000 });
    for (const screen of ['home', 'plan', 'courses', 'grades', 'tests', 'payments', 'registrations', 'documents', 'progress', 'student', 'news', 'academic', 'contacts', 'resources', 'services']) {
      await tab.evaluate(screen => { location.hash = '#' + screen; }, screen);
      await tab.waitForTimeout(160);
      assert.deepEqual(errors, [], `${screen} render errors`); await tab.locator('#main-content').waitFor();
      assert.ok(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${screen} viewport=${width}`);
      if (audit && ['plan', 'services', 'home'].includes(screen)) await tab.screenshot({ path: `${audit}/${screen}-${width}.png`, fullPage: true });
    }
  }
  await tab.getByRole('button', { name: 'Otwórz menu' }).click(); await tab.getByRole('navigation', { name: 'Nawigacja główna' }).getByRole('link', { name: 'Plan zajęć' }).click();
  assert.equal(await tab.getByRole('button', { name: 'Otwórz menu' }).getAttribute('aria-expanded'), 'false');
  await tab.goto(`${pilot.origin}/schedule#plan`);
  await tab.getByText('Podgląd publicznego planu', { exact: true }).waitFor();
  assert.equal(await tab.locator('.personal-groups').count(), 0);
  assert.ok((await tab.locator('.timetable-source').innerText()).includes('6 zajęć'));
  assert.deepEqual(errors, []);
});

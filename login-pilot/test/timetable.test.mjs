import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TimetableRepository } from '../../server/usos/timetable.mjs';
import { createPilot } from '../server.mjs';
import { DashboardConnection } from '../dashboard.mjs';
const page = await readFile(new URL('../../server/usos/timetable-fixtures/track.html', import.meta.url), 'utf8');
const grid = await readFile(new URL('../../server/usos/timetable-fixtures/semester.html', import.meta.url), 'utf8');
test('public timetable works without app/USOS login; private APIs stay protected', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'usos-timetable-test-'));
  const timetable = new TimetableRepository({ intervalMs: 0, fetchImpl: async url => new Response(String(url).includes('GridCustom') ? grid : page) });
  const pilot = await createPilot({ port: 0, accountsPath: join(dir, 'accounts.sqlite'), timetable });
  t.after(async () => { await pilot.close(); await rm(dir, { recursive: true, force: true }); });
  const response = await fetch(pilot.origin + '/api/plan?trackId=958');
  assert.equal(response.status, 200); assert.equal((await response.json()).data.entries.length, 49);
  assert.equal(response.headers.get('set-cookie'), null);
  const schedule = await fetch(pilot.origin + '/schedule');
  assert.equal(schedule.status, 200); assert.match(await schedule.text(), /usos-public-plan/);
  assert.equal((await fetch(pilot.origin + '/dashboard/theme.js')).status, 200);
  assert.equal((await fetch(pilot.origin + '/api/grades')).status, 401);
  assert.equal((await fetch(pilot.origin + '/dashboard/', { redirect: 'manual' })).status, 303);
  for (const query of ['trackId=https://127.0.0.1/', 'trackId=958&trackId=1', 'url=https://localhost']) {
    const res = await fetch(pilot.origin + '/api/plan?' + query); assert.equal(res.status, 400); assert.equal((await res.json()).ok, false);
  }
});
const hintsProfile = (specialty = 'Programowanie i analiza danych', mode = 'niestacjonarne') => ({ programmes: [{ name: `Informatyka stosowana, studia inżynierskie, ${mode}`, code: 'k-ins-In', stages: [{ name: `7 semestr, 4 rok; ${specialty}`, code: 'INS-In-E7', fields: [{ label: 'Cykl realizacji', value: '2026/27Z', kind: 'text' }, { label: 'Status zaliczenia', value: 'w trakcie', kind: 'status' }] }] }] });
test('connected home and plan automatically resolve the same track without query input', async () => {
  const ids = [];
  const timetable = { get: async id => { ids.push(id); return { ok: true, data: { entries: [] }, meta: { source: 'live' } }; } };
  const candidate = { trackId: '958', title: 'Public synthetic track' };
  const connection = new DashboardConnection({ state: 'connected', api: {}, expectedAccount: 'fixture' }, { timetable, trackCatalog: { candidates: async () => [candidate] } });
  connection.student = async () => ({ data: { displayName: 'Synthetic' } });
  connection.stages = async () => ({ data: hintsProfile() });
  const home = await connection.handle(new URL('http://127.0.0.1/api/home'));
  const plan = await connection.handle(new URL('http://127.0.0.1/api/plan'));
  assert.deepEqual(ids, ['958', '958']); assert.equal(home.data.timetableSelection.state, 'automatic'); assert.equal(plan.data.selection.state, 'automatic');
});
test('expired connection cannot serve automatic plans or private account selection', async () => {
  const worker = { state: 'connected', api: {}, expectedAccount: 'fixture' };
  let release; const wait = new Promise(resolve => { release = resolve; });
  const connection = new DashboardConnection(worker, { timetable: { get: async () => { await wait; return { data: { entries: [] } }; } }, trackCatalog: { candidates: async () => [{ trackId: '958', title: 'Fixture' }] } });
  connection.stages = async () => ({ data: hintsProfile() });
  const pending = connection.plan(); await new Promise(r => setImmediate(r)); connection.close(); release();
  await assert.rejects(pending, { status: 401 });
});
const filters = await readFile(new URL('../../server/usos/timetable-fixtures/track-search.html', import.meta.url), 'utf8');
const candidates = await readFile(new URL('../../server/usos/timetable-fixtures/track-candidates.html', import.meta.url), 'utf8');
class AcademicWorker {
  constructor(id, specialty, mode = 'niestacjonarne') {
    this.expectedAccount = id; this.specialty = specialty; this.mode = mode; this.state = 'idle';
    this.api = { get: async url => ({ status: () => 200, text: async () => this.page(new URL(url).searchParams.get('_action')), dispose: async () => {} }), dispose: async () => {} };
  }
  page(action) {
    const marker = `<script>const fixture={user_id: '${this.expectedAccount}'};</script>`;
    if (action.includes('zaliczenia')) return marker + `<usos-frame><h2 slot="title">Informatyka stosowana, studia inżynierskie, ${this.mode} [k-ins-In]</h2><usos-frame-section section-title="7 semestr, 4 rok; ${this.specialty} [INS-In-E7]"><div class="inline-keyvalue-list"><div><div>Cykl realizacji:</div><div>2026/27Z</div></div><div><div>Status:</div><div><usos-tag>w trakcie</usos-tag></div></div></div></usos-frame-section></usos-frame>`;
    if (action === 'home/index') return marker + '<usos-frame id="info-frame"><ul><li>Numer albumu: <b>synthetic</b></li></ul></usos-frame>';
    return marker + '<title>Fixture - Profil</title>';
  }
  record() {}
  status() { return { state: this.state, requests: [] }; }
  async start() { this.state = 'login'; }
  async verify() { this.state = 'connected'; return true; }
  async close() { this.state = 'disconnected'; }
}
function publicTimetable() {
  return new TimetableRepository({ intervalMs: 0, fetchImpl: async value => {
    const url = new URL(value);
    if (url.pathname === '/Plany/ZnajdzTok') return new Response(url.searchParams.has('Ukryj') ? filters : candidates);
    if (url.pathname.includes('GridCustom')) return new Response(grid);
    return new Response(url.pathname.endsWith('/959') ? page.replaceAll('Programowanie i analiza danych', 'Sieci komputerowe') : page);
  } });
}
const get = (pilot, cookie, path) => fetch(pilot.origin + path, { headers: cookie ? { cookie } : {} });
const post = (pilot, cookie, path, body) => fetch(pilot.origin + path, { method: 'POST', headers: { cookie, origin: pilot.origin, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
async function signedOwner(pilot, username) {
  const response = await post(pilot, '', '/api/auth/register', { username, name: 'Synthetic test', password: 'synthetic-only-password' });
  assert.equal(response.status, 201); return response.headers.get('set-cookie').split(';')[0];
}
async function connect(pilot, cookie) {
  assert.equal((await post(pilot, cookie, '/api/start')).status, 200);
  assert.equal((await post(pilot, cookie, '/api/verify')).status, 200);
}
test('real HTTP route chooses separate tracks for two account sessions without trackId; public stays explicit', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'usos-auto-track-http-')); let count = 0;
  const pilot = await createPilot({ port: 0, accountsPath: join(dir, 'accounts.sqlite'), timetable: publicTimetable(), dashboardIntervalMs: 0, verifyIntervalMs: 0, workerFactory: () => ++count === 1 ? new AcademicWorker('1101', 'Programowanie i analiza danych') : new AcademicWorker('1102', 'Sieci komputerowe') });
  t.after(async () => { await pilot.close(); await rm(dir, { recursive: true, force: true }); });
  const a = await signedOwner(pilot, 'fixture-alpha'), b = await signedOwner(pilot, 'fixture-beta');
  await connect(pilot, a); await new Promise(r => setTimeout(r, 1250)); await connect(pilot, b);
  for (const [cookie, track] of [[a, '958'], [b, '959']]) {
    const response = await get(pilot, cookie, '/api/plan'); assert.equal(response.status, 200);
    const result = await response.json(); assert.equal(result.data.timetable.trackId, track); assert.equal(result.data.selection.state, 'automatic'); assert.equal(result.data.entries.length, 49);
    const home = await (await get(pilot, cookie, '/api/home')).json(); assert.equal(home.data.timetableSelection.trackId, track);
  }
  assert.equal((await get(pilot, a, '/api/plan?trackId=959')).status, 400);
  assert.equal((await get(pilot, b, '/api/home?trackId=958')).status, 400);
  const publicResult = await (await get(pilot, a, '/api/plan?scope=public')).json(); assert.equal(publicResult.data.selection.state, 'public');
  const anonymous = await (await get(pilot, null, '/api/plan')).json(); assert.equal(anonymous.data.selection.state, 'public');
  assert.equal((await get(pilot, null, '/api/grades')).status, 401);
  await post(pilot, a, '/api/disconnect'); const disconnected = await (await get(pilot, a, '/api/plan')).json(); assert.equal(disconnected.data.selection.state, 'public');
  const stillB = await (await get(pilot, b, '/api/plan')).json(); assert.equal(stillB.data.timetable.trackId, '959');
});
test('ambiguous profile offers named candidates and validates a choice without falling back to default', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'usos-auto-track-ambiguous-'));
  const pilot = await createPilot({ port: 0, accountsPath: join(dir, 'accounts.sqlite'), timetable: publicTimetable(), dashboardIntervalMs: 0, verifyIntervalMs: 0, workerFactory: () => new AcademicWorker('1101', 'Programowanie i analiza danych', '') });
  t.after(async () => { await pilot.close(); await rm(dir, { recursive: true, force: true }); });
  const cookie = await signedOwner(pilot, 'fixture-ambiguous'); await connect(pilot, cookie);
  const result = await (await get(pilot, cookie, '/api/plan')).json(); assert.equal(result.data.selection.state, 'choice_required'); assert.deepEqual(result.data.selection.candidates.map(x => x.trackId).sort(), ['954', '958']); assert.equal(result.data.timetable, undefined);
  const chosen = await (await get(pilot, cookie, '/api/plan?trackId=954')).json(); assert.equal(chosen.data.selection.state, 'confirmed'); assert.equal(chosen.data.timetable.trackId, '954');
  const home = await (await get(pilot, cookie, '/api/home')).json(); assert.equal(home.data.timetableSelection.state, 'choice_required');
});

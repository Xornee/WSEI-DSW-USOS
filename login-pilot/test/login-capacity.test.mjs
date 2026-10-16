import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowWorker } from './workflows-fixture.mjs';
import { createPilot } from '../server.mjs';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function anonymous(app) {
  const r = await fetch(app.origin); return r.headers.get('set-cookie').split(';')[0];
}
const post = (app, cookie, path) => fetch(app.origin + '/api/' + path, { method: 'POST', headers: { origin: app.origin, cookie } });
async function fixture(t, options = {}) {
  const workers = [];
  const app = await createPilot({ port: 0, allowAnonymousForTests: true, loginStartIntervalMs: 0,
    workerFactory: () => { const w = new WorkflowWorker(); workers.push(w); return w; },
    dashboardFactory: () => ({ ical: true, close() {} }), ...options });
  t.after(() => app.close()); return { ...app, workers };
}
test('five concurrent starts reserve all slots atomically; sixth gets 429, disconnect frees one', async t => {
  let release; const ready = new Promise(resolve => release = resolve);
  const app = await fixture(t, { workerFactory: () => { const w = new WorkflowWorker(); w.start = async () => { await ready; w.state = 'login'; }; return w; } });
  const owners = []; for (let i = 0; i < 6; i++) owners.push(await anonymous(app));
  const starts = owners.slice(0,5).map(c => post(app,c,'start'));
  await delay(50); assert.equal((await post(app,owners[5],'start')).status,429);
  release(); assert.deepEqual(await Promise.all(starts.map(async p => (await p).status)), [200,200,200,200,200]);
  assert.equal((await post(app,owners[0],'disconnect')).status,200);
  assert.equal((await post(app,owners[5],'start')).status,200);
});
test('twenty connected users have no Chromium slot occupancy', async t => {
  const app = await fixture(t), owners = [];
  for (let i = 0; i < 20; i++) {
    const c = await anonymous(app); owners.push(c);
    assert.equal((await post(app,c,'start')).status,200);
    assert.equal((await post(app,c,'verify')).status,200);
  }
  const extra = []; for (let i = 0; i < 6; i++) extra.push(await anonymous(app));
  assert.deepEqual(await Promise.all(extra.slice(0,5).map(async c => (await post(app,c,'start')).status)), [200,200,200,200,200]);
  assert.equal((await post(app,extra[5],'start')).status,429);
});
test('connected state with a still-closing browser continues to occupy a slot', async t => {
  const app = await fixture(t, { maxBrowsers: 1 });
  const a = await anonymous(app), b = await anonymous(app);
  await post(app,a,'start'); app.workers[0].state='connected'; app.workers[0].browser={};
  assert.equal((await post(app,b,'start')).status,429);
  app.workers[0].browser=null; assert.equal((await post(app,b,'start')).status,200);
});
test('abandoned MFA expires without logging out the platform session; polling does not extend login', async t => {
  const app = await fixture(t,{ maxBrowsers:1, loginIdleMs:60, loginHardMs:120 }), a=await anonymous(app), b=await anonymous(app);
  await post(app,a,'start');
  for (let i=0;i<6;i++) { await fetch(app.origin+'/api/status',{ headers:{ cookie:a } }); await delay(30); }
  assert.equal(app.workers[0].state,'disconnected');
  assert.equal((await fetch(app.origin+'/api/status',{ headers:{cookie:a} })).status,200);
  assert.equal((await post(app,b,'start')).status,200);
});
test('failed cleanup retains a capacity slot, including restarting the same owner', async t => {
  let failing=true; const app = await fixture(t,{maxBrowsers:1,cleanupRetryMs:20});
  const a=await anonymous(app), b=await anonymous(app); await post(app,a,'start');
  app.workers[0].close=async()=>{if(failing) throw Error('Synthetic cleanup failure');};
  assert.equal((await post(app,a,'start')).status,429);
  assert.equal((await post(app,b,'start')).status,429);
  failing=false; await delay(150);
  assert.equal((await post(app,b,'start')).status,200);
});
test('capacity settings reject invalid limits rather than silently removing limits', async () => {
  for (const maxBrowsers of [0,9,1.5,NaN]) await assert.rejects(createPilot({ maxBrowsers }), /Invalid login capacity/);
});

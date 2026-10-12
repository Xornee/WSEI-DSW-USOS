import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPilot } from '../server.mjs';
import { createScheduler } from '../dashboard.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
class Worker extends EventEmitter {
  state = 'idle'; attempts = 0;
  status() { return { state: this.state, requests: [] }; }
  async start() { this.state = 'login'; }
  async verify() { this.state = 'connected'; return true; }
  async close() { this.attempts++; this.state = 'disconnected'; }
}
async function app(t, options = {}) {
 const a = await createPilot({ port:0, accountsPath:':memory:', dashboardFactory:()=>({ical:true,close(){}}), ...options });
 t.after(()=>a.close()); return a;
}
async function post(a, path, body, cookie) {
 return fetch(a.origin+path,{method:'POST',headers:{origin:a.origin,'content-type':'application/json',...(cookie?{cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
}
async function register(a,name) {
 const r=await post(a,'/api/auth/register',{username:name,name,password:'synthetic-password'});
 assert.equal(r.status,201); return r.headers.get('set-cookie').split(';')[0];
}
test('C02 malformed requests and account A failures do not consume B budget',async t=>{
 const a=await app(t,{authLimit:2});
 for(let i=0;i<12;i++) assert.equal((await post(a,'/api/auth/login',null)).status,400);
 for(let i=0;i<2;i++) assert.equal((await post(a,'/api/auth/login',{username:'alpha',password:'wrong-password'})).status,401);
 assert.equal((await post(a,'/api/auth/login',{username:'alpha',password:'wrong-password'})).status,429);
 await register(a,'beta');
});
test('C01 failed worker cleanup is retained and retried without breaking HTTP',async t=>{
 const w=new Worker(); w.close=async()=>{ if(++w.attempts===1) throw Error('synthetic delete unavailable'); w.state='disconnected'; };
 const a=await app(t,{workerFactory:()=>w,cleanupRetryMs:20}); const cookie=await register(a,'cleanup');
 assert.equal((await post(a,'/api/start',undefined,cookie)).status,200);
 assert.equal((await post(a,'/api/disconnect',undefined,cookie)).status,200);
 await sleep(150);
 assert.ok(w.attempts>=2); assert.equal((await fetch(a.origin+'/healthz')).status,200);
});
test('C04 connected backend sessions do not occupy Chromium slots',async t=>{
 const a=await app(t,{maxBrowsers:1,workerFactory:()=>new Worker()});
 const one=await register(a,'one'), two=await register(a,'two');
 assert.equal((await post(a,'/api/start',undefined,one)).status,200);
 assert.equal((await post(a,'/api/verify',undefined,one)).status,200);
 await sleep(1250);
 assert.equal((await post(a,'/api/start',undefined,two)).status,200);
});
test('C05 per-owner queue limit reserves capacity for other owners; cancellation',async()=>{
 const schedule=createScheduler(0); const order=[]; let release;
 const gate=new Promise(r=>release=r);
 const running=schedule(()=>gate,{owner:'A'});
 await sleep(5);
 const jobs=Array.from({length:8},(_,i)=>schedule(async()=>order.push('A'+i),{owner:'A'}));
 assert.throws(()=>schedule(async()=>{}, {owner:'A'}), /zapyt/);
 const b=schedule(async()=>order.push('B'),{owner:'B'});
 const controller=new AbortController(); const c=schedule(async()=>order.push('C'),{owner:'C',signal:controller.signal});
 const cancelled=assert.rejects(c); controller.abort(); release();
 await Promise.all([running,...jobs,b,cancelled]);
 assert.ok(order.indexOf('B')<=1); assert.ok(!order.includes('C'));
});
test('C10 status reports a fixed cookie expiry, not a later activity time',async t=>{
 const a=await app(t,{workerFactory:()=>new Worker()}); const cookie=await register(a,'expiry');
 const status=()=>fetch(a.origin+'/api/status',{headers:{cookie}}).then(r=>r.json());
 const before=await status(); await sleep(20); await post(a,'/api/start',undefined,cookie);
 assert.equal((await status()).expiresAt,before.expiresAt);
});

test('C15 password rotation, recovery, replay rejection and lock/revoke lifecycle',async t=>{
 const a=await app(t,{authLimit:50}); let cookie=await register(a,'security');
 assert.equal((await post(a,'/api/auth/password',{currentPassword:'wrong-password',newPassword:'new-password'},cookie)).status,401);
 const r=await post(a,'/api/auth/recovery-code',{currentPassword:'synthetic-password'},cookie);
 assert.equal(r.status,200); const {recoveryCode}=await r.json(); assert.equal(recoveryCode.length,64);
 assert.equal((await post(a,'/api/auth/password',{currentPassword:'synthetic-password',newPassword:'new-password'},cookie)).status,200);
 assert.equal((await fetch(a.origin+'/api/status',{headers:{cookie}})).status,401);
 assert.equal((await post(a,'/api/auth/login',{username:'security',password:'synthetic-password'})).status,401);
 const login=await post(a,'/api/auth/login',{username:'security',password:'new-password'}); assert.equal(login.status,200); cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal((await post(a,'/api/auth/lock',{currentPassword:'new-password'},cookie)).status,200);
 assert.equal((await post(a,'/api/auth/login',{username:'security',password:'new-password'})).status,401);
 assert.equal((await post(a,'/api/auth/recover',{username:'security',recoveryCode,newPassword:'recovered-password'})).status,200);
 assert.equal((await post(a,'/api/auth/recover',{username:'security',recoveryCode,newPassword:'replay-password'})).status,401);
 const recovered=await post(a,'/api/auth/login',{username:'security',password:'recovered-password'}); assert.equal(recovered.status,200);
 cookie=recovered.headers.get('set-cookie').split(';')[0];
 assert.equal((await post(a,'/api/auth/revoke',{currentPassword:'recovered-password'},cookie)).status,200);
 assert.equal((await fetch(a.origin+'/api/status',{headers:{cookie}})).status,401);
});

test('C06 byte-stream limit cancels before consuming the full UTF-8 body',async()=>{
 const {readLimitedText}=await import('../../server/usos/transport.mjs');
 let pulls=0,cancelled=false;
 const response=new Response(new ReadableStream({pull(c){pulls++;c.enqueue(new TextEncoder().encode('ą'.repeat(100)));},cancel(){cancelled=true;}}));
 await assert.rejects(readLimitedText(response,300),/byte limit/);
 assert.equal(cancelled,true); assert.ok(pulls<=3);
});
test('C06 native private jar is scoped, rotates PHP session and rejects redirects/large body',async()=>{
 const {createUsosRequest}=await import('../upstream.mjs'); let calls=0;
 const api=await createUsosRequest({storageState:{cookies:[{name:'PHPSESSID',value:'synthetic',domain:'usosweb.ideis.pl'}]}},async(url,options)=>{
  assert.equal(url.origin,'https://usosweb.ideis.pl'); assert.equal(options.redirect,'manual');
  assert.equal(options.headers.cookie,calls++===0?'PHPSESSID=synthetic':'PHPSESSID=rotated');
  return new Response('user_id: 42',{headers:{'set-cookie':'PHPSESSID=rotated; Path=/; Secure; HttpOnly'}});
 });
 assert.equal((await api.get('https://usosweb.ideis.pl/kontroler.php')).status(),200);
 await api.get('https://usosweb.ideis.pl/kontroler.php');
 await assert.rejects(api.get('https://other.invalid/kontroler.php'));
 await api.dispose(); await assert.rejects(api.get('https://usosweb.ideis.pl/kontroler.php'));
});

test('C01 expiration retries a rejected cleanup while other HTTP stays available', async t=>{
 const w = new Worker(); w.close=async()=>{if(++w.attempts===1)throw Error('synthetic cleanup');};
 const a=await app(t,{allowAnonymousForTests:true,ttlMs:80,cleanupRetryMs:10,workerFactory:()=>w});
 const opened=await fetch(a.origin);const cookie=opened.headers.get('set-cookie').split(';')[0];
 assert.equal((await post(a,'/api/start',undefined,cookie)).status,200);
 await sleep(200);assert.ok(w.attempts>=2);assert.equal((await fetch(a.origin+'/healthz')).status,200);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { createPilot } from '../server.mjs';
import { registrationGate } from '../registration.mjs';
import { REGISTRATION_CODE } from './registration-fixture.mjs';
const password = 'synthetic registration test password';
const input = (username='alpha',code=REGISTRATION_CODE) => ({username,name:'Synthetic '+username,password,registrationCode:code});
async function app(t,options={}) {
  const a=await createPilot({port:0,accountsPath:':memory:',registrationCode:REGISTRATION_CODE,...options});
  t.after(()=>a.close());return a;
}
function register(a,body,extra={}) {
  return fetch(a.origin+'/api/auth/register',{method:'POST',headers:{origin:a.origin,'content-type':'application/json',...extra},body:JSON.stringify(body),redirect:'manual'});
}
const me = async a => (await fetch(a.origin+'/api/auth/me')).json();
test('unconfigured code closes registration, including first administrator; metadata exposes booleans only',async t=>{
  const a=await app(t,{registrationCode:''});
  const m=await me(a);assert.equal(m.registrationRequiresCode,true);assert.equal(m.registrationEnabled,false);assert.equal(m.setupRequired,true);
  const r=await register(a,input());assert.equal(r.status,503);assert.equal(r.headers.has('set-cookie'),false);
  assert.equal((await me(a)).setupRequired,true);
});
for (const [name,value] of [['missing',undefined],['empty',''],['incorrect','invalid-invitation'],['numeric',42],['object',{}],['array',[]],
  ['case changed',REGISTRATION_CODE.toUpperCase()],['extra whitespace',REGISTRATION_CODE+' '],['oversize','a'.repeat(257)]]) {
  test(`registration rejects ${name} code without creating account/cookie`,async t=>{
    const a=await app(t);const body=input('alpha',value);body.registrationCode=value;
    const r=await register(a,body);assert.equal(r.status,403);assert.equal(r.headers.has('set-cookie'),false);
    const error=await r.text();assert.ok(!error.includes(REGISTRATION_CODE));assert.equal((await me(a)).setupRequired,true);
  });
}
test('first and subsequent accounts require code; members cannot request admin; login needs no code',async t=>{
  const a=await app(t);const first=await register(a,input());assert.equal(first.status,201);assert.equal((await first.json()).user.role,'admin');
  const bad=input('beta');delete bad.registrationCode;assert.equal((await register(a,bad)).status,403);
  const member=await register(a,{...input('beta'),role:'admin'});assert.equal(member.status,201);assert.equal((await member.json()).user.role,'member');
  const login=await fetch(a.origin+'/api/auth/login',{method:'POST',headers:{origin:a.origin,'content-type':'application/json'},body:JSON.stringify({username:'beta',password})});
  assert.equal(login.status,200);assert.equal((await login.json()).user.username,'beta');
});
test('wrong code is rejected before password processing, remains rate-limited and respects Origin',async t=>{
  const a=await app(t,{authLimit:2});
  assert.equal((await register(a,{...input('alpha','wrong-code'),password:'x'})).status,403);
  assert.equal((await register(a,input('alpha','wrong-code'))).status,403);
  const limited=await register(a,input());assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
  assert.equal((await register(a,input('beta'),{origin:'https://attacker.test'})).status,403);
  assert.equal((await me(a)).setupRequired,true);
});
test('code rotation blocks old code but does not alter or block existing accounts',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'usos-registration-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'accounts.sqlite');
  let a=await createPilot({port:0,accountsPath:path,registrationCode:REGISTRATION_CODE});
  assert.equal((await register(a,input())).status,201);await a.close();
  const bytes=await readFile(path);assert.ok(!bytes.includes(Buffer.from(REGISTRATION_CODE)));
  a=await createPilot({port:0,accountsPath:path,registrationCode:'different-synthetic-code-2026'});t.after(()=>a.close());
  assert.equal((await register(a,input('beta'))).status,403);
  assert.equal((await register(a,input('beta','different-synthetic-code-2026'))).status,201);
  const login=await fetch(a.origin+'/api/auth/login',{method:'POST',headers:{origin:a.origin,'content-type':'application/json'},body:JSON.stringify({username:'alpha',password})});
  assert.equal(login.status,200);
});
test('invalid configured code fails startup instead of opening registration',async()=>{
  for(const registrationCode of [42,'short','a'.repeat(257),'valid-length-but\ncontrol'])
    await assert.rejects(createPilot({registrationCode}),/registration code configuration/);
  assert.throws(()=>registrationGate('').require(REGISTRATION_CODE),e=>e.status===503);
});
test('browser registration requires code; wrong code clears field; login hides it; desktop/mobile remain usable',async t=>{
  const a=await app(t);const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});t.after(()=>browser.close());
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    await page.setViewportSize(viewport);await page.goto(a.origin+'/account');await page.locator('#registration-code').waitFor({state:'visible'});
    assert.equal(await page.locator('#registration-code').getAttribute('type'),'password');
    assert.equal(await page.locator('#registration-code').evaluate(e=>e.required),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.locator('#username').fill('browser-invite');await page.locator('#name').fill('Browser invitation');await page.locator('#password').fill(password);
  await page.locator('#submit-account').click();assert.equal(await page.locator('#registration-code').evaluate(e=>e.validity.valueMissing),true);
  await page.locator('#registration-code').fill('wrong-invitation');await page.locator('#submit-account').click();
  await page.waitForFunction(()=>document.getElementById('account-notice').textContent.includes('poprawny kod'));
  assert.equal(await page.locator('#registration-code').inputValue(),'');
  await page.locator('#registration-code').fill(REGISTRATION_CODE);await page.locator('#submit-account').click();await page.locator('#profile-name').waitFor({state:'visible'});
  await page.locator('#logout').click();await page.locator('#signed-out').waitFor({state:'visible'});
  assert.equal(await page.locator('#registration-code').isVisible(),false);
  await page.locator('#switch-mode').click();await page.locator('#registration-code').fill('erase-on-hide');
  await page.evaluate(()=>{window.dispatchEvent(new Event('pagehide'));});assert.equal(await page.locator('#registration-code').inputValue(),'');
  assert.deepEqual(errors,[]);
});

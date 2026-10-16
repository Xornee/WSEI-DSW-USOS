import { REGISTRATION_CODE } from './registration-fixture.mjs';
import { test } from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { SocialLogin, socialConfiguration } from '../social-login.mjs';
import { AccountStore } from '../accounts.mjs';
import { createPilot } from '../server.mjs';
import { WorkflowWorker } from './workflows-fixture.mjs';

const password = 'synthetic social login passphrase';
const tenant = '11111111-2222-3333-4444-555555555555';
const { privateKey, publicKey } = await generateKeyPair('RS256');
const { privateKey: otherKey } = await generateKeyPair('RS256');
const jwk = { ...await exportJWK(publicKey), kid: 'fixture-key', alg: 'RS256', use: 'sig' };
const config = { google: { clientId: 'fixture-google', clientSecret: 'synthetic-provider-secret' },
  microsoft: { clientId: 'fixture-microsoft', clientSecret: 'synthetic-provider-secret', tenant } };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
async function token(provider, nonce, overrides = {}, header = {}, key = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: provider.issuer, sub: 'synthetic-subject', aud: provider.clientId,
    iat: now, exp: now + 300, nonce, ...(provider.tenant ? { tid: provider.tenant } : {}), ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture-key', ...header }).sign(key);
}
function fixture(options = {}) {
  let authorize, exchange = 0, keys = 0;
  const reference = new SocialLogin({ config });
  const fetcher = async (url, request = {}) => {
    const p = Object.values(reference.providers).find(p => p.token === url || p.jwks === url);
    assert.ok(p, 'Only fixed allowlisted provider endpoints may be contacted');
    assert.equal(request.redirect, 'error');
    if (url === p.jwks) { keys++; return options.jwks ? options.jwks() : json({ keys: [jwk] }); }
    exchange++;
    assert.equal(request.method, 'POST');
    const body = new URLSearchParams(request.body);
    assert.equal(body.get('client_id'), p.clientId);
    assert.equal(body.get('client_secret'), p.clientSecret);
    assert.ok(body.get('code_verifier'));
    assert.equal(body.get('redirect_uri'), authorize.get('redirect_uri'));
    if (options.response) return options.response();
    return json({ id_token: await token(p, authorize.get('nonce'), options.claims, options.header, options.key) });
  };
  const social = new SocialLogin({ config, fetcher, ...options.social });
  return { social, fetcher, authorize: url => { authorize = new URL(url).searchParams; }, count: () => ({ exchange, keys }) };
}
function begin(f, provider = 'google', action = 'login', owner = null) {
  const start = f.social.begin(provider, 'http://127.0.0.1:8789', action, owner);
  f.authorize(start.url); return { ...start, flow: f.social.consume(provider, start.state, start.browser) };
}
for (const provider of ['google', 'microsoft']) {
  test(`${provider}: valid signed ID token, PKCE and canonical identity; metadata contains no secrets`, async () => {
    const f = fixture(), b = begin(f, provider), url = new URL(b.url);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('response_mode'), 'query');
    assert.ok(url.searchParams.get('nonce')); assert.ok(url.searchParams.get('code_challenge'));
    assert.ok(!url.searchParams.has('client_secret'));
    const identity = await f.social.verify(provider, b.flow, 'synthetic-code');
    assert.deepEqual(identity, { provider, issuer: f.social.providers[provider].issuer, subject: 'synthetic-subject' });
    assert.ok(!JSON.stringify(f.social.publicProviders()).includes(config.google.clientSecret));
    assert.deepEqual(f.count(), { exchange: 1, keys: 1 });
  });
}
test('missing configuration and wildcard tenants disable providers; non-loopback HTTP refused', () => {
  const s = new SocialLogin({ config: socialConfiguration({}) });
  assert.ok(s.publicProviders().every(p => !p.enabled));
  assert.throws(() => s.begin('google', 'http://127.0.0.1'), e => e.status === 503);
  assert.equal(socialConfiguration({ MICROSOFT_TENANT_ID: 'common' }).microsoft.tenant, '');
  assert.throws(() => fixture().social.begin('google', 'http://example.test'), e => e.status === 503);
});
test('state binds provider and browser, expires, and cannot replay', async () => {
  const s = fixture().social, b = s.begin('google', 'https://example.test');
  assert.throws(() => s.consume('google', b.state, '0'.repeat(64)), e => e.status === 403);
  assert.throws(() => s.consume('microsoft', b.state, b.browser), e => e.status === 403);
  assert.throws(() => s.consume('google', b.state, 'invalid'), e => e.status === 403);
  assert.equal(s.consume('google', b.state, b.browser).provider, 'google');
  assert.throws(() => s.consume('google', b.state, b.browser), e => e.status === 410);
  // Use the actual store containing the expiring flow.
  const short = new SocialLogin({ config, ttlMs: 1 }), start = short.begin('google', 'https://example.test');
  await new Promise(r => setTimeout(r, 10));
  assert.throws(() => short.consume('google', start.state, start.browser), e => e.status === 410);
});
test('pending flow count is bounded and cancellation revokes owner-provider flows', () => {
  const s = fixture().social;
  for (let i = 0; i < 256; i++) s.begin('google', 'https://example.test', 'link', { userId: 'owner' });
  assert.throws(() => s.begin('google', 'https://example.test'), e => e.status === 429);
  s.cancelOwner('owner', 'google'); assert.equal(s.flows.size, 0);
});
const invalid = [
  ['signature', { key: otherKey }], ['audience', { claims: { aud: 'attacker-client' } }],
  ['issuer', { claims: { iss: 'https://attacker.test' } }], ['nonce', { claims: { nonce: 'wrong' } }],
  ['unicode nonce', { claims: { nonce: 'ą'.repeat(64) } }], ['authorized party', { claims: { azp: 'attacker' } }],
  ['multiple audiences without azp', { claims: { aud: ['fixture-google', 'attacker'] } }],
  ['expired', { claims: { exp: 1 } }], ['issued in future', { claims: { iat: Math.floor(Date.now()/1000) + 3600 } }],
  ['old token', { claims: { iat: Math.floor(Date.now()/1000) - 3600 } }],
  ['missing subject', { claims: { sub: undefined } }], ['oversize subject', { claims: { sub: 'a'.repeat(257) } }],
  ['control subject', { claims: { sub: 'bad\nsubject' } }], ['untrusted jku', { header: { jku: 'https://attacker.test/keys' } }],
  ['untrusted x5u', { header: { x5u: 'https://attacker.test/cert' } }], ['inline jwk', { header: { jwk } }],
  ['missing kid', { header: { kid: '' } }], ['oversize kid', { header: { kid: 'a'.repeat(257) } }],
  ['unknown kid', { header: { kid: 'unknown-key' } }],
];
for (const [name, options] of invalid) test(`reject ID token: ${name}`, async () => {
  const f = fixture(options), b = begin(f);
  await assert.rejects(f.social.verify('google', b.flow, 'synthetic-code'), e => e.status === 403);
});
test('Microsoft tenant mismatch is rejected even when signature/issuer/audience match', async () => {
  const f = fixture({ claims: { tid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' } }), b = begin(f, 'microsoft');
  await assert.rejects(f.social.verify('microsoft', b.flow, 'synthetic-code'), e => e.status === 403);
});
for (const [name, response] of [
  ['HTML', () => new Response('<html>error</html>')], ['redirect', () => new Response('', { status: 302 })],
  ['huge response', () => json({ pad: 'a'.repeat(200_001) })], ['missing token', () => json({})],
  ['huge token', () => json({ id_token: 'a'.repeat(32_001) })],
  ['unsigned token', () => json({ id_token: Buffer.from(JSON.stringify({alg:'none'})).toString('base64url') + '.e30.' })],
]) test(`provider fail closed: ${name}`, async () => {
  const f = fixture({ response }), b = begin(f);
  await assert.rejects(f.social.verify('google', b.flow, 'synthetic-code'), e => [403,502].includes(e.status));
});
test('code limits reject before exchange; JWKS response is bounded', async () => {
  const f = fixture(), b = begin(f);
  for (const code of ['', 'a'.repeat(4097), 'bad\ncode'])
    await assert.rejects(f.social.verify('google', b.flow, code), e => e.status === 400);
  assert.equal(f.count().exchange, 0);
  const bad = fixture({ jwks: () => json({ keys: Array(51).fill(jwk) }) }), c = begin(bad);
  await assert.rejects(bad.social.verify('google', c.flow, 'synthetic-code'), e => e.status === 502);
});
test('social identities are durable, unique and never email-matched or role-promoted', async () => {
  const store = new AccountStore(':memory:');
  try {
    const admin = await store.register({ username: 'first', name: 'First', password });
    const member = await store.register({ username: 'second', name: 'Second', password });
    const identity = { provider: 'google', issuer: 'https://accounts.google.com', subject: 'synthetic-subject' };
    assert.throws(() => store.loginSocial(identity), e => e.status === 401);
    store.linkSocial(member.id, identity); store.linkSocial(member.id, identity);
    assert.equal(store.loginSocial({ ...identity, email: 'first@example.test', roles: ['admin'] }).role, 'member');
    assert.throws(() => store.linkSocial(admin.id, identity), e => e.status === 409);
    assert.throws(() => store.linkSocial(member.id, { ...identity, subject: 'other' }), e => e.status === 409);
    assert.throws(() => store.loginSocial({ ...identity, subject: 'other', email: 'second@example.test' }), e => e.status === 401);
    assert.equal((await store.login({ username: 'second', password })).id, member.id);
    store.unlinkSocial(member.id, 'google'); assert.throws(() => store.loginSocial(identity), e => e.status === 401);
  } finally { store.close(); }
});
const cookie = response => response.headers.getSetCookie().map(v => v.split(';')[0]);
async function call(app, path, cookies = [], body, method = 'POST', extra = {}) {
  if (path === '/api/auth/register' && body && typeof body === 'object') body = { ...body, registrationCode: REGISTRATION_CODE };
  return fetch(app.origin + path, { method, redirect: 'manual', headers: { origin: app.origin,
    ...(cookies.length ? { cookie: cookies.join('; ') } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function appFixture(t, options = {}) {
  const f = fixture(options), workers = [];
  const app = await createPilot({ registrationCode: REGISTRATION_CODE, port: 0, accountsPath: ':memory:', authLimit: 100,
    socialConfig: config, socialFetch: f.fetcher, loginStartIntervalMs: 0,
    workerFactory: () => { const w = new WorkflowWorker(); workers.push(w); return w; },
    dashboardFactory: () => ({ ical: true, close() {} }), ...options.app });
  t.after(() => app.close());
  return { ...app, ...f, workers };
}
async function register(app, username = 'alpha') {
  const r = await call(app, '/api/auth/register', [], { username, name: username, password });
  assert.equal(r.status, 201); return cookie(r);
}
async function flow(app, owner = [], provider = 'google', action = 'link', input = { currentPassword: password }) {
  const r = await call(app, `/api/auth/oauth/${provider}/${action}`, owner, input);
  assert.equal(r.status, 200, await r.clone().text());
  const url = new URL((await r.json()).url); app.authorize(url);
  const b = cookie(r);
  const callback = `/api/auth/oauth/${provider}/callback?state=${url.searchParams.get('state')}&code=synthetic-code`;
  return { browser: b, callback };
}
async function redeem(app, f, owner = []) {
  const r = await fetch(app.origin + f.callback, { redirect: 'manual', headers: { cookie: f.browser.join('; '), 'sec-fetch-site': 'cross-site' } });
  assert.equal(r.status, 303, await r.clone().text());
  assert.equal(r.headers.get('location'), '/account?oauth=complete');
  return call(app, '/api/auth/oauth/complete', [...owner, ...f.browser]);
}
for (const provider of ['google', 'microsoft']) test(`${provider}: HTTP link with local password, rotate session preserving USOS, logout, SSO, unlink`, async t => {
  const app = await appFixture(t); const owner = await register(app);
  assert.equal((await call(app, '/api/start', owner)).status, 200);
  const w = app.workers[0];
  const proof = await flow(app, owner, provider);
  const link = await redeem(app, proof, owner); assert.equal(link.status, 200, await link.clone().text());
  const rotated = cookie(link).filter(c => c.startsWith('usos_dashboard_owner=') && !c.endsWith('='));
  assert.notEqual(rotated[0], owner[0]); assert.equal(w.state, 'login');
  assert.equal((await call(app, '/api/status', owner, undefined, 'GET')).status, 401);
  const providers = await (await call(app, '/api/auth/providers', rotated, undefined, 'GET')).json();
  assert.deepEqual(providers.linked, [provider]);
  await call(app, '/api/auth/logout', rotated);
  const loginFlow = await flow(app, [], provider, 'start', {}), login = await redeem(app, loginFlow);
  assert.equal(login.status, 200, await login.clone().text());
  const current = cookie(login).filter(c => c.startsWith('usos_dashboard_owner=') && !c.endsWith('='));
  const me = await (await call(app, '/api/auth/me', current, undefined, 'GET')).json();
  assert.equal(me.user.username, 'alpha');
  const status = await (await call(app, '/api/status', current, undefined, 'GET')).json();
  assert.equal(status.state, 'idle', 'Platform OAuth does not connect USOS'); assert.equal(status.maxBrowsers, 5);
  assert.equal((await call(app, `/api/auth/oauth/${provider}/unlink`, current, { currentPassword: password })).status, 200);
  await call(app, '/api/auth/logout', current);
  const after = await redeem(app, await flow(app, [], provider, 'start', {}));
  assert.equal(after.status, 401);
});
test('HTTP rejects passwordless link, origin/CSRF, malformed flow, replay and unknown identity', async t => {
  const app = await appFixture(t), owner = await register(app);
  assert.equal((await call(app, '/api/auth/oauth/google/link', owner, { currentPassword: 'wrong-password' })).status, 401);
  assert.equal((await call(app, '/api/auth/oauth/google/link', owner, {}, 'POST', { origin: 'https://attacker.test' })).status, 403);
  assert.equal((await call(app, '/api/auth/oauth/google/link', [], { currentPassword: password })).status, 401);
  assert.equal((await call(app, '/api/auth/oauth/google/link', owner, { currentPassword: password, redirect: 'https://attacker.test' })).status, 400);
  const f = await flow(app, owner);
  assert.equal((await fetch(app.origin + f.callback, { redirect: 'manual' })).status, 403);
  assert.equal((await fetch(app.origin + f.callback, { redirect: 'manual', headers: { cookie: [...f.browser,...f.browser].join('; ') } })).status, 403);
  const r = await redeem(app, f, owner); assert.equal(r.status, 200);
  assert.equal((await fetch(app.origin + f.callback, { redirect: 'manual', headers: { cookie: f.browser.join('; ') } })).status, 410);
  assert.equal((await call(app, '/api/auth/oauth/complete', f.browser)).status, 410);
  assert.equal((await call(app, '/api/auth/oauth/complete', f.browser, undefined, 'POST', { 'sec-fetch-site': 'cross-site' })).status, 403);
  const rotated = cookie(r).filter(c => c.startsWith('usos_dashboard_owner=') && !c.endsWith('='));
  await call(app, '/api/auth/logout', rotated);
  const another = await appFixture(t, { claims: { sub: 'unknown', email: 'alpha@example.test' } });
  await register(another); // Same display/login does not imply provider identity.
  const userCookie = (await call(another, '/api/auth/me', [], undefined, 'GET')); assert.equal((await userCookie.json()).user, null);
  const unknown = await redeem(another, await flow(another, [], 'google', 'start', {}));
  assert.equal(unknown.status, 401);
});
test('link proof requires the initiating owner at completion; logout revokes pending link', async t => {
  const app = await appFixture(t), owner = await register(app), f = await flow(app, owner);
  await call(app, '/api/auth/logout', owner);
  const r = await redeem(app, f, owner); assert.equal(r.status, 401);
  const providers = await (await call(app, '/api/auth/providers', [], undefined, 'GET')).json(); assert.deepEqual(providers.linked, []);
});
test('cross-site callback never switches an already logged-in platform account', async t => {
  const app = await appFixture(t), a = await register(app), linked = await redeem(app, await flow(app, a), a);
  const rotated = cookie(linked).filter(c => c.startsWith('usos_dashboard_owner=') && !c.endsWith('='));
  await call(app, '/api/auth/logout', rotated);
  const f = await flow(app, [], 'google', 'start', {}), other = await register(app, 'beta');
  const r = await redeem(app, f, other); assert.equal(r.status, 409);
  const me = await (await call(app, '/api/auth/me', other, undefined, 'GET')).json(); assert.equal(me.user.username, 'beta');
});
test('locked account invalidates pending authentication proofs', async t => {
  const app = await appFixture(t), a = await register(app), f = await flow(app, a);
  assert.equal((await call(app, '/api/auth/recovery-code', a, { currentPassword: password })).status, 200);
  assert.equal((await call(app, '/api/auth/lock', a, { currentPassword: password })).status, 200);
  assert.equal((await redeem(app, f, a)).status, 401);
});
test('unlink revokes a verified pending login proof and pending link flow', async t => {
  const app = await appFixture(t), owner = await register(app);
  const link = await redeem(app, await flow(app, owner), owner);
  const a = cookie(link).filter(c => c.startsWith('usos_dashboard_owner=') && !c.endsWith('='));
  const pending = await flow(app, a);
  // A separate signed-out browser may have already verified its provider response.
  const login = await flow(app, [], 'google', 'start', {});
  assert.equal((await fetch(app.origin + login.callback, { redirect: 'manual', headers: { cookie: login.browser.join('; ') } })).status,303);
  assert.equal((await call(app, '/api/auth/oauth/google/unlink', a, { currentPassword:password })).status,200);
  assert.equal((await call(app, '/api/auth/oauth/complete', login.browser)).status,410);
  assert.equal((await fetch(app.origin + pending.callback, { redirect: 'manual', headers:{cookie:pending.browser.join('; ')} })).status,410);
});
test('callback provider mixup, duplicate parameters, attacker redirect and cancellation fail closed', async t => {
  const app=await appFixture(t), owner=await register(app), f=await flow(app,owner);
  for (const [path,status] of [[f.callback.replace('/google/','/microsoft/'),403],
    [f.callback+'&code=second',400], [f.callback+'&redirect_uri=https://attacker.test',400],
    [f.callback+'&iss=https://attacker.test',403]]) {
    const r=await fetch(app.origin+path,{redirect:'manual',headers:{cookie:f.browser.join('; ')}});
    assert.equal(r.status,status); assert.equal(r.headers.get('location'),null);
  }
  const other=await flow(app,owner);
  const canceled=other.callback.replace('code=synthetic-code','error=access_denied&error_description=PRIVATE_PROVIDER_DETAIL');
  const r=await fetch(app.origin+canceled,{redirect:'manual',headers:{cookie:other.browser.join('; ')}});
  assert.equal(r.status,401); assert.ok(!(await r.text()).includes('PRIVATE_PROVIDER_DETAIL'));
});
test('concurrent replay of a callback exchanges its code once only', async t => {
  const app=await appFixture(t), owner=await register(app), f=await flow(app,owner);
  const statuses=await Promise.all([0,1].map(async()=> (await fetch(app.origin+f.callback,{redirect:'manual',headers:{cookie:f.browser.join('; ')}})).status));
  assert.deepEqual(statuses.sort(),[303,410]); assert.equal(app.count().exchange,1);
});
test('HTTPS origin uses host-prefixed Secure cookies and does not trust forwarded origins', async t => {
  const app=await appFixture(t,{app:{publicOrigin:'https://platform.example.test'}});
  const address=app.address, internal='';
  const nativeFetch = (path, options = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname:'127.0.0.1', port:address.port, path, method:options.method || 'GET',
      headers:{ ...options.headers, ...(options.body ? {'content-length':Buffer.byteLength(options.body)} : {}) } }, res => {
      let body=''; res.on('data',chunk=>body+=chunk); res.on('end',()=>{
        const headers=new Headers(); for(let i=0;i<res.rawHeaders.length;i+=2) headers.append(res.rawHeaders[i],res.rawHeaders[i+1]);
        resolve({status:res.statusCode,headers});
      });
    }); req.on('error',reject);req.end(options.body);
  });
  const r=await nativeFetch(internal+'/api/auth/register',{method:'POST',headers:{host:'platform.example.test',origin:app.origin,'content-type':'application/json'},
    body:JSON.stringify({username:'alpha',name:'Alpha',password,registrationCode:REGISTRATION_CODE})});
  assert.equal(r.status,201); const header=r.headers.get('set-cookie');
  assert.ok(header.startsWith('__Host-usos_dashboard_owner=')); assert.ok(header.includes('Secure')); assert.ok(header.includes('SameSite=Strict'));
  assert.equal(r.headers.get('strict-transport-security'),'max-age=31536000');
  const rejected=await nativeFetch(internal+'/api/auth/providers',{headers:{'x-forwarded-host':'platform.example.test','x-forwarded-proto':'https'}});
  assert.equal(rejected.status,403);
  const f=await nativeFetch(internal+'/api/auth/oauth/google/start',{method:'POST',headers:{host:'platform.example.test',origin:app.origin,'content-type':'application/json'},body:'{}'});
  assert.equal(f.status,200); assert.ok(f.headers.get('set-cookie').startsWith('__Host-usos_oidc_flow='));
});
for (const provider of ['google','microsoft']) test(`SEC01 ${provider}: recovery invalidates an already verified cached login proof`, async t=>{
 const app=await appFixture(t),owner=await register(app),link=await redeem(app,await flow(app,owner,provider),owner);
 const current=cookie(link).filter(c=>c.startsWith('usos_dashboard_owner=')&&!c.endsWith('='));
 const recovery=await call(app,'/api/auth/recovery-code',current,{currentPassword:password}),{recoveryCode}=await recovery.json();
 const login=await flow(app,[],provider,'start',{});
 assert.equal((await fetch(app.origin+login.callback,{redirect:'manual',headers:{cookie:login.browser.join('; ')}})).status,303);
 assert.equal((await call(app,'/api/auth/recover',[],{username:'alpha',recoveryCode,newPassword:password+' recovered'})).status,200);
 assert.equal((await call(app,'/api/auth/oauth/complete',login.browser)).status,401);
 assert.equal((await call(app,'/api/status',current,undefined,'GET')).status,401);
});

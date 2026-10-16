import { REGISTRATION_CODE } from './registration-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createPilot } from '../server.mjs';
import { SocialLogin } from '../social-login.mjs';

test('real cross-site browser redirect links Google, preserves Strict cookie ownership, then signs in', async t => {
  const { privateKey,publicKey }=await generateKeyPair('RS256');
  const jwk={...await exportJWK(publicKey),kid:'fixture',alg:'RS256'};
  const config={google:{clientId:'fixture-client',clientSecret:'synthetic-only-secret'},microsoft:{}};
  let authorize;
  const idp=http.createServer((req,res)=>{
    authorize=new URL(req.url,'http://localhost');
    const target=new URL(authorize.searchParams.get('redirect_uri'));
    target.searchParams.set('state',authorize.searchParams.get('state')); target.searchParams.set('code','fixture-code');
    res.writeHead(302,{Location:target.href});res.end();
  });
  idp.listen(0,'127.0.0.1');await once(idp,'listening');t.after(()=>new Promise(resolve=>idp.close(resolve)));
  const providers=new SocialLogin({config}).providers;
  providers.google.authorize=`http://localhost:${idp.address().port}/authorize`;
  const fetcher=async(url,request)=>{
    assert.equal(request.redirect,'error');
    if(url===providers.google.jwks) return Response.json({keys:[jwk]});
    assert.equal(url,providers.google.token);
    const params=new URLSearchParams(request.body);
    assert.equal(params.get('redirect_uri'),authorize.searchParams.get('redirect_uri'));
    const now=Math.floor(Date.now()/1000);
    return Response.json({id_token:await new SignJWT({iss:providers.google.issuer,sub:'fixture-sub',aud:providers.google.clientId,
      iat:now,exp:now+300,nonce:authorize.searchParams.get('nonce')}).setProtectedHeader({alg:'RS256',kid:'fixture'}).sign(privateKey)});
  };
  const app=await createPilot({ registrationCode: REGISTRATION_CODE,port:0,accountsPath:':memory:',socialConfig:config,socialFetch:fetcher,socialProvidersForTests:providers});
  t.after(()=>app.close());
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});t.after(()=>browser.close());
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app.origin+'/account');
  await page.locator('#username').fill('browser-fixture');await page.locator('#name').fill('Browser fixture');
  const password='synthetic browser auth passphrase';await page.locator('#password').fill(password);await page.locator('#registration-code').fill(REGISTRATION_CODE);
  await page.locator('#submit-account').click();await page.locator('#profile-name').waitFor({state:'visible'});
  await page.locator('#provider-password').fill(password);await page.locator('#link-google').click();
  await page.waitForFunction(()=>document.getElementById('google-status')?.textContent.includes('połączone') && document.getElementById('link-google')?.textContent.includes('Odłącz'));
  assert.equal(await page.locator('#profile-name').textContent(),'Browser fixture');
  assert.equal(await page.locator('#provider-password').inputValue(),'');
  assert.equal(new URL(page.url()).search,'');
  await page.locator('#logout').click();await page.locator('#signed-out').waitFor({state:'visible'});
  await page.locator('#login-google').click();await page.locator('#profile-name').waitFor({state:'visible'});
  assert.equal(await page.locator('#profile-name').textContent(),'Browser fixture');
  assert.ok((await page.locator('#connection-status').textContent()).includes('niepołączony'));
  assert.deepEqual(errors,[]);
});

test('unconfigured providers are disabled and explained at desktop/mobile sizes without overflow',async t=>{
  const app=await createPilot({ registrationCode: REGISTRATION_CODE,port:0,accountsPath:':memory:',socialConfig:{google:{},microsoft:{}}});t.after(()=>app.close());
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,chromiumSandbox:true});t.after(()=>browser.close());
  const page=await browser.newPage();
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.goto(app.origin+'/account');
    await page.waitForFunction(()=>document.getElementById('social-help').textContent.includes('wymagają konfiguracji'));
    assert.equal(await page.locator('#login-google').isDisabled(),true);assert.equal(await page.locator('#login-microsoft').isDisabled(),true);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { Duplex } from 'node:stream';
import { once } from 'node:events';
import { AccountStore } from '../accounts.mjs';
import { BrowserWorker } from '../browser.mjs';
import { browserNetwork, publicAddress } from '../browser-network.mjs';
import { createPilot } from '../server.mjs';
import { DashboardConnection, createScheduler } from '../dashboard.mjs';
import { workflowUrl } from '../workflows.mjs';
import { WorkflowWorker, page, validFields } from './workflows-fixture.mjs';
import { REGISTRATION_CODE } from './registration-fixture.mjs';
const password='synthetic audit passphrase 2026';
const identity={provider:'google',issuer:'https://accounts.google.com',subject:'audit-synthetic'};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function pilot(t,options={}) {
 const app=await createPilot({port:0,accountsPath:':memory:',registrationCode:REGISTRATION_CODE,workerFactory:()=>new WorkflowWorker(),dashboardFactory:()=>({ical:true,close(){}}),...options});
 t.after(()=>app.close());return app;
}
function request(app,path,body,{cookie,source}={}) {
 return new Promise((resolve,reject)=>{
  const req=http.request(app.origin+path,{method:'POST',localAddress:source,headers:{origin:app.origin,'content-type':'application/json',...(cookie?{cookie}:{})}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode,cookie:res.headers['set-cookie']?.[0].split(';')[0]}));});
  req.on('error',reject);req.end(JSON.stringify(body));
 });
}
async function register(app,name) {const r=await request(app,'/api/auth/register',{username:name,name,password,registrationCode:REGISTRATION_CODE});assert.equal(r.status,201);return r.cookie;}
const connection=w=>new DashboardConnection(w,{schedule:createScheduler(0)});
const formInput=p=>({formId:p.forms[0].id,fields:validFields,confirmed:true});

test('SEC01 account recovery atomically removes Google and Microsoft identities and consumes code',async()=>{
 const store=new AccountStore(':memory:');try {
  const u=await store.register({username:'recover',password,name:'Fixture'});
  for(const provider of ['google','microsoft'])store.linkSocial(u.id,{...identity,provider});
  const {recoveryCode}=await store.securityAction(u,{currentPassword:password},'recovery-code');
  await store.recover({username:u.username,recoveryCode,newPassword:password+' new'});
  assert.deepEqual(store.socialIdentities(u.id),[]);
  for(const provider of ['google','microsoft'])assert.throws(()=>store.loginSocial({...identity,provider}),e=>e.status===401);
  await assert.rejects(store.recover({username:u.username,recoveryCode,newPassword:password+' replay'}),e=>e.status===401);
  assert.equal((await store.login({username:u.username,password:password+' new'})).id,u.id);
 }finally{store.close();}
});
test('SEC02 one source cannot saturate account budget and deny a different socket source',async t=>{
 const app=await pilot(t);await register(app,'victim');
 for(let i=0;i<4200;i++)await request(app,'/api/auth/login',{username:'flood'+i,password:'x'});
 assert.equal((await request(app,'/api/auth/login',{username:'victim',password},{source:'127.0.0.2'})).status,200);
 assert.equal((await request(app,'/api/auth/login',{username:'victim',password})).status,429);
});
test('SEC03 unauthenticated login does not disclose an active USOS operation',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);const worker=new WorkflowWorker();worker.start=async()=>{await gate;worker.state='login';};
 const app=await pilot(t,{workerFactory:()=>worker});const cookie=await register(app,'busy');
 const starting=request(app,'/api/start',undefined,{cookie});await delay(30);
 try {assert.equal((await request(app,'/api/auth/login',{username:'busy',password:'wrong-password'})).status,401);}finally{release();await starting;}
});
test('SEC04 public platform origin requires TLS except exact local development hosts',async()=>{
 for(const publicOrigin of ['http://app.test','http://10.0.0.1:8789','http://localhost.attacker.test'])await assert.rejects(createPilot({publicOrigin,accountsPath:':memory:'}),/HTTPS|origin/i);
});
for(const suffix of ['&operation=delete','&id=delete','&op=view','&%6fperation=save'])test('SEC05 read GET rejects query '+suffix,()=>{
 assert.throws(()=>workflowUrl('https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/index'+suffix),e=>e.status===409);
});
test('SEC05 mutation label and opaque query become a confirmation capability',async()=>{
 const w=new WorkflowWorker(),c=connection(w),p=c.workflows.render(page('1001','<h1>Test</h1><a href="?_action=dodatki/wnioski/index&amp;operation=delete&amp;id=10">Usuń rekord</a>'),'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/index','Test');
 assert.equal(p.links[0].workflow.kind,'action');const result=await c.workflows.open({target:p.links[0].workflow.target});assert.equal(result.forms[0].changesAccount,true);assert.equal(w.calls.length,0);
});
test('SEC06 key, mixed-case, duplicate and encoded tokens stay out of metadata and stay in server capability',()=>{
 const c=connection(new WorkflowWorker()),p=c.workflows.render(page('1001','<h1>Test</h1><a href="?_action=dodatki/wnioski/pokaz&amp;id=10&amp;%6bey=synthetic-secret&amp;KEY=synthetic-second&amp;key=synthetic-third">Podgląd</a>'),'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/index','Test');
 assert.doesNotMatch(JSON.stringify(p),/synthetic-secret|synthetic-second|synthetic-third/);assert.match(c.workflows.targets.get(p.links[0].workflow.target).url,/synthetic-secret/);
});
for(const [name,type,bytes] of [['payload.html','application/pdf','%PDF-fake'],['report.pdf','application/pdf','<html>'],['report.pdf','text/html','%PDF-fake'],['../report.pdf','application/pdf','%PDF-fake']])test('SEC07 captured upload policy rejects '+name+' '+type,async()=>{
 const w=new WorkflowWorker(),c=connection(w),p=await c.workflows.open({entry:'applications'}),before=w.calls.length;
 await assert.rejects(c.workflows.submit(formInput(p),[{name:'attachment',blob:new File([bytes],name,{type})}]),e=>e.status===400);
 assert.equal(w.calls.length,before);assert.equal(w.writes.length,0);
});
test('SEC08 form expiry is rechecked after identity read',async()=>{
 const w=new WorkflowWorker(),c=connection(w),p=await c.workflows.open({entry:'applications'}),original=c.privatePage.bind(c);
 c.privatePage=async(...args)=>{const result=await original(...args);c.workflows.forms.get(p.forms[0].id).expires=0;return result;};
 await assert.rejects(c.workflows.submit(formInput(p)),e=>e.status===410);assert.equal(w.writes.length,0);
});
test('SEC08 form expiry is rechecked at actual queue dispatch',async()=>{
 const w=new WorkflowWorker(),c=connection(w),p=await c.workflows.open({entry:'applications'}),form=c.workflows.forms.get(p.forms[0].id),original=c.privatePageUrl.bind(c);
 c.privatePageUrl=async(raw,opts)=>{if(opts?.mutation)form.expires=0;return original(raw,opts);};
 await assert.rejects(c.workflows.submit(formInput(p)),e=>e.status===410);assert.equal(w.writes.length,0);
});
test('SEC08 document capability expiry is rechecked inside scheduler',async()=>{
 const w=new WorkflowWorker(),c=connection(w),p=await c.workflows.open({entry:'applications'}),target=p.links.find(l=>l.workflow.kind==='download').workflow.target,original=c.schedule;
 c.schedule=run=>original(()=>{c.workflows.targets.get(target).expires=0;return run();});
 await assert.rejects(c.workflows.download(target),e=>e.status===410);assert.equal(w.calls.filter(call=>call.url.includes('/pobierz')).length,0);
});
test('SEC09 failed Chromium close disposes provisional jar, retains browser and never marks connected',async()=>{
 let closed=0,disposed=0;const w=new BrowserWorker({createRequest:async()=>({get:async()=>({status:()=>200,text:async()=>"user_id: 1001",dispose:async()=>{}}),dispose:async()=>disposed++})});
 w.state='login';w.page={url:()=> 'https://usosweb.ideis.pl/kontroler.php',content:async()=>"user_id: 1001"};w.context={cookies:async()=>[{name:'PHPSESSID',value:'synthetic',domain:'usosweb.ideis.pl'}]};w.browser={close:async()=>{if(++closed===1)throw Error('synthetic close failure');}};
 await assert.rejects(w.verify(),/synthetic close/);assert.equal(w.state,'login');assert.equal(w.api,null);assert.ok(w.browser);assert.equal(disposed,1);
 assert.equal(await w.verify(),true);assert.equal(w.browser,null);assert.equal(w.state,'connected');await w.close();
});
test('SEC09 disconnect retains failed browser close for cleanup retry',async()=>{
 const w=new BrowserWorker();let attempts=0;w.browser={close:async()=>{if(++attempts===1)throw Error('synthetic close');}};
 await assert.rejects(w.close());assert.ok(w.browser);await w.close();assert.equal(attempts,2);assert.equal(w.browser,null);
});
test('SEC10 anonymous imports cannot consume reserved protected timetable capacity',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);let count=0;
 const timetable={defaultTrackId:'958',ttl:60000,cache:new Map(),async get(id){count++;if(id!=='960')await gate;return {data:{entries:[],timetable:{trackId:id}}};}};
 const app=await pilot(t,{timetable});const cookie=await register(app,'plans');
 const pending=['958','959'].map(id=>fetch(app.origin+'/api/plan?scope=public&trackId='+id));
 while(count<2)await delay(5);
 try {assert.equal((await fetch(app.origin+'/api/plan?scope=public&trackId=961')).status,429);assert.equal((await fetch(app.origin+'/api/plan?scope=public&trackId=960',{headers:{cookie}})).status,200);}finally{release();await Promise.all(pending);}
});
for(const address of ['0.0.0.0','10.0.0.1','127.1.2.3','169.254.169.254','168.63.129.16','100.64.0.1','172.16.0.1','192.168.1.1','198.18.0.1','224.0.0.1','255.255.255.255','::','::1','::ffff:127.0.0.1','::ffff:7f00:1','2001::1','2001:0000::1','2001:db8::1','2002:7f00:1::','fc00::1','fe80::1','3fff::1'])test('SEC11 egress rejects '+address,()=>assert.equal(publicAddress(address),false));
for(const address of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111','2a00:1450:4001::1'])test('SEC11 egress permits public '+address,()=>assert.equal(publicAddress(address),true));
async function tunnel(proxy,authority) {
 const u=new URL(proxy.server),socket=net.connect(Number(u.port),u.hostname);await once(socket,'connect');
 socket.write('CONNECT '+authority+' HTTP/1.1\r\nHost: '+authority+'\r\n\r\n');
 let output='';socket.on('data',data=>output+=data);await Promise.race([once(socket,'close'),delay(150)]);socket.destroy();return output;
}
test('SEC11 proxy rejects private IP, mixed DNS, credentials and non-TLS before dialing',async()=>{
 let dials=0;const proxy=await browserNetwork({resolve:async()=>[{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}],connect:()=>{dials++;throw Error('unexpected');}});
 try {for(const authority of ['127.0.0.1:443','2130706433:443','[::1]:443','private.test:443','example.test:80','user:pass@example.test:443'])assert.doesNotMatch(await tunnel(proxy,authority),/200 Connection/);assert.equal(dials,0);
 const r=await fetch(proxy.server+'/internal');assert.equal(r.status,403);
 }finally{await proxy.close();}
});
test('SEC11 proxy resolves once and pins only validated numeric address at dial',async()=>{
 let resolves=0,dial;const proxy=await browserNetwork({resolve:async()=>{resolves++;return [{address:'1.1.1.1',family:4}];},connect:options=>{dial=options;const stream=new Duplex({read(){},write(_c,_e,done){done();}});stream.setTimeout=()=>{};setImmediate(()=>stream.emit('connect'));return stream;}});
 try {assert.match(await tunnel(proxy,'example.test:443'),/200 Connection Established/);assert.equal(resolves,1);assert.deepEqual(dial,{host:'1.1.1.1',port:443,family:4});}finally{await proxy.close();}
});
test('SEC11 actual sandboxed Chromium uses proxy even for implicit loopback destinations',async()=>{
 let hits=0;const canary=http.createServer((_req,res)=>{hits++;res.end('synthetic-private-canary');});canary.listen(0,'127.0.0.1');await once(canary,'listening');
 const w=new BrowserWorker({fixtureHtml:'<h1>Synthetic fixture</h1>'});
 try {await w.start();for(const url of ['http://127.0.0.1:'+canary.address().port+'/internal','http://2130706433:'+canary.address().port+'/internal','https://127.0.0.1:443/internal','http://169.254.169.254/latest/meta-data/']){
  try {const response=await w.page.goto(url,{timeout:5000});assert.notEqual(response?.status(),200);}catch(e){assert.match(e.message,/ERR_|net::|Navigation|timeout/i);}
 }assert.equal(hits,0);}finally{await w.close();await new Promise(resolve=>canary.close(resolve));}
});
test('SEC02 distributed unknown-name churn cannot evict a real account retry counter',async t=>{
 const app=await pilot(t,{authLimit:2});assert.equal((await request(app,'/api/auth/register',{username:'victim',name:'Fixture',password,registrationCode:REGISTRATION_CODE},{source:'127.9.0.1'})).status,201);
 for(let i=0;i<2;i++)assert.equal((await request(app,'/api/auth/login',{username:'victim',password:'wrong-password'})).status,401);
 assert.equal((await request(app,'/api/auth/login',{username:'victim',password:'wrong-password'})).status,429);
 for(let i=0;i<4100;i++)await request(app,'/api/auth/login',{username:'unknown'+i,password:'x'},{source:`127.1.${Math.floor(i/250)}.${i%250+1}`});
 assert.equal((await request(app,'/api/auth/login',{username:'victim',password},{source:'127.2.0.1'})).status,401);
});
test('SEC03 credential changes and recovery verify secret then respect in-flight USOS operation',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve),worker=new WorkflowWorker();worker.start=async()=>{await gate;worker.state='login';};
 const app=await pilot(t,{workerFactory:()=>worker,authLimit:50}),cookie=await register(app,'busy');
 const recovery=await fetch(app.origin+'/api/auth/recovery-code',{method:'POST',headers:{cookie,origin:app.origin,'content-type':'application/json'},body:JSON.stringify({currentPassword:password})});
 const {recoveryCode}=await recovery.json();const starting=request(app,'/api/start',undefined,{cookie});await delay(30);
 try {
  for(const action of ['recovery-code','password','revoke','lock']){
   assert.equal((await request(app,'/api/auth/'+action,{currentPassword:'wrong-password',newPassword:password+' new'},{cookie})).status,401);
   assert.equal((await request(app,'/api/auth/'+action,{currentPassword:password,newPassword:password+' new'},{cookie})).status,409);
  }
  assert.equal((await request(app,'/api/auth/recover',{username:'busy',recoveryCode:'f'.repeat(64),newPassword:password+' new'})).status,401);
  assert.equal((await request(app,'/api/auth/recover',{username:'busy',recoveryCode,newPassword:password+' new'})).status,409);
 }finally{release();await starting;}
 assert.equal((await request(app,'/api/auth/recover',{username:'busy',recoveryCode,newPassword:password+' new'})).status,200);
});
test('SEC05 ambiguous index selectors require confirmation even with unknown mutation verbs',()=>{
 const c=connection(new WorkflowWorker()),p=c.workflows.render(page('1001','<h1>Test</h1><a href="?_action=dodatki/wnioski/index&amp;id=10">Cofnij wniosek</a>'),'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/index','Test');assert.equal(p.links[0].workflow.kind,'action');
});
test('SEC05 trusted static university resources retain exact read URLs; extra parameters do not inherit trust',async()=>{
 const {tsImport}=await import('tsx/esm/api');const {UNIVERSITY_RESOURCES}=await tsImport('../../shared/university.ts',import.meta.url);
 for(const resource of UNIVERSITY_RESOURCES){assert.equal(workflowUrl(resource.url).href,new URL(resource.url).href);if(new URL(resource.url).searchParams.has('file'))assert.throws(()=>workflowUrl(resource.url+'&operation=delete'));}
});
test('SEC07 extension-based upload accept rejects a forged MIME and HTML payload',async()=>{
 const w=new WorkflowWorker(),c=connection(w),p=c.workflows.render(page('1001','<h1>Test</h1><form method="post" action="?_action=dodatki/wnioski/wyslij"><input name="attachment" type="file" accept=".png"><button>Wyślij</button></form>'),'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/index','Test');
 await assert.rejects(c.workflows.submit({formId:p.forms[0].id,fields:{},confirmed:true},[{name:'attachment',blob:new File(['<html>'],'payload.png',{type:'text/html'})}]),e=>e.status===400);assert.equal(w.writes.length,0);
});
test('SEC07 unsupported/unspecified upload controls are explicitly uncalibrated, not fake functional',()=>{
 const c=connection(new WorkflowWorker());for(const accept of ['', '.docx','.zip','application/msword']){const p=c.workflows.render(page('1001',`<h1>Test</h1><form method="post" action="?_action=dodatki/wnioski/wyslij"><input name="attachment" type="file" accept="${accept}"><button>Wyślij</button></form>`),'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/index','Test');assert.equal(p.forms.length,0);assert.equal(p.notices.length,1);}
});
test('SEC09 failed browser close tears down proxy immediately while preserving browser retry',async()=>{
 const w=new BrowserWorker();let closes=0;w.network=await browserNetwork();const address=w.network.server;w.browser={close:async()=>{if(++closes===1)throw Error('synthetic close');}};
 await assert.rejects(w.close());assert.ok(w.browser);assert.equal(w.network,null);await assert.rejects(fetch(address));await w.close();assert.equal(closes,2);
});
test('SEC09 close during delayed launch neither dereferences a cleared proxy nor leaks browser',async()=>{
 let release,entered;const launched=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);let closes=0;
 const w=new BrowserWorker({launch:async()=>{entered();await gate;return {close:async()=>closes++};}});const starting=w.start();await launched;await w.close();release();await starting;assert.equal(closes,1);assert.equal(w.network,null);assert.equal(w.browser,null);
});
test('SEC10 authenticated caller also has a two-import public budget',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);let count=0;const timetable={defaultTrackId:'958',cache:new Map(),ttl:60000,async get(id){count++;await gate;return {data:{entries:[],timetable:{trackId:id}}};}};
 const app=await pilot(t,{timetable}),cookie=await register(app,'public-user'),pending=['958','959'].map(id=>fetch(app.origin+'/api/plan?scope=public&trackId='+id,{headers:{cookie}}));while(count<2)await delay(5);
 try{assert.equal((await fetch(app.origin+'/api/plan?scope=public&trackId=960',{headers:{cookie}})).status,429);}finally{release();await Promise.all(pending);}
});
test('SEC11 oversized DNS answer and unavailable DNS fail before connecting',async()=>{
 let dials=0;for(const resolve of [async()=>Array(33).fill({address:'1.1.1.1',family:4}),async()=>{throw Error('synthetic DNS');}]){const proxy=await browserNetwork({resolve,connect:()=>{dials++;throw Error('unexpected');}});try{assert.doesNotMatch(await tunnel(proxy,'example.test:443'),/200 Connection/);}finally{await proxy.close();}}assert.equal(dials,0);
});
test('SEC06 action-kind callback and key secrets are stripped even when navigationLink rejects mutations',()=>{
 const c=connection(new WorkflowWorker()),p=c.workflows.render(page('1001','<h1>Test</h1><a href="?_action=dodatki/wnioski/usun&amp;callback=synthetic-callback&amp;api_key=synthetic-api-key">Usuń</a>'),'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/index','Test');assert.equal(p.links[0].workflow.kind,'action');assert.doesNotMatch(JSON.stringify(p),/synthetic-callback|synthetic-api-key/);
});
test('SEC06 ordinary external query names containing key as a substring stay intact',async()=>{
 const {tsImport}=await import('tsx/esm/api'),{navigationLink}=await tsImport('../../server/usos/scrape/sections.ts',import.meta.url);
 const url=new URL(navigationLink('https://example.test/?monkey=1&hockey=2&key=synthetic&callback=synthetic'));
 assert.equal(url.searchParams.get('monkey'),'1');assert.equal(url.searchParams.get('hockey'),'2');assert.equal(url.searchParams.has('key'),false);assert.equal(url.searchParams.has('callback'),false);
});
test('SEC05 normalized mutation label blocks read-like target before any fetch',()=>{
 const c=connection(new WorkflowWorker());for(const label of ['Zmień ustawienie','Włącz','Przypisz','Wycofaj','Remove','Edit']){const p=c.workflows.render(page('1001',`<h1>Test</h1><a href="?_action=dodatki/wnioski/pokaz&amp;id=10">${label}</a>`),'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/index','Test');assert.equal(p.links[0].workflow.kind,'action',label);}
});
test('SEC02 cross-source known and unknown usernames have identical failed-login status and body',async t=>{
 const app=await pilot(t,{authLimit:2});await register(app,'victim');
 for(let i=0;i<3;i++){
  const results=[];for(const username of ['victim','missing']){
   const response=await new Promise((resolve,reject)=>{const req=http.request(app.origin+'/api/auth/login',{method:'POST',localAddress:'127.3.0.'+(i+1),headers:{origin:app.origin,'content-type':'application/json'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve([res.statusCode,body]));});req.on('error',reject);req.end(JSON.stringify({username,password:'wrong-password'}));});results.push(response);
  }assert.deepEqual(results[0],results[1]);assert.equal(results[0][0],401);
 }
});
test('SEC06 PHP bracket-shaped keys are scrubbed without dropping ordinary array parameters',async()=>{
 const {tsImport}=await import('tsx/esm/api'),{navigationLink}=await tsImport('../../server/usos/scrape/sections.ts',import.meta.url);
 const url=new URL(navigationLink('https://example.test/?key%5B%5D=synthetic-key&api_key%5Bscope%5D=synthetic-api&monkey%5B%5D=1&hockey%5Bteam%5D=2'));
 assert.doesNotMatch(url.href,/synthetic-key|synthetic-api/);assert.equal(url.searchParams.get('monkey[]'),'1');assert.equal(url.searchParams.get('hockey[team]'),'2');
});
test('SEC06 secret-bearing links retain exact row/capability binding without exposing their keys',()=>{
 for(const labels of [['Pierwszy','Drugi'],['Podgląd','Podgląd']]){
  const c=connection(new WorkflowWorker()),html=page('1001',`<h1>Test</h1><table><tr><th>Wniosek</th></tr><tr><td><a href="?_action=dodatki/wnioski/pokaz&amp;key=synthetic-A">${labels[0]}</a></td></tr><tr><td><a href="?_action=dodatki/wnioski/pokaz&amp;key=synthetic-B">${labels[1]}</a></td></tr></table>`),p=c.workflows.render(html,'https://usosweb.ideis.pl/kontroler.php?_action=dodatki/wnioski/index','Test');
  const links=p.tables[0].rows.map(row=>row[0].links[0]);assert.notEqual(links[0].workflow.target,links[1].workflow.target);
  for(const [i,key] of ['synthetic-A','synthetic-B'].entries())assert.equal(new URL(c.workflows.targets.get(links[i].workflow.target).url).searchParams.get('key'),key);
  assert.doesNotMatch(JSON.stringify(p),/synthetic-A|synthetic-B/);
 }
});

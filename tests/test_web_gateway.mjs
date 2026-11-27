import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../web/gateway.mjs';
import {handleVerifiedGateway,WEB_ORIGIN} from '../worker/src/gateway-policy.mjs';
const team='test-team.cloudflareaccess.com',aud='a'.repeat(64),now=Date.parse('2026-11-26T00:00:00Z'),sec=now/1000;
const pair=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const key={...await crypto.subtle.exportKey('jwk',pair.publicKey),kid:'key1',alg:'RS256',use:'sig'};
const claims={iss:'https://'+team,aud:[aud],sub:'user1',type:'app',iat:sec-10,nbf:sec-10,exp:sec+120};
const encode=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
async function sign(p={},h={}){const data=encode({alg:'RS256',kid:'key1',...h})+'.'+encode({...claims,...p});return data+'.'+Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',pair.privateKey,new TextEncoder().encode(data))).toString('base64url');}
const fetcher=async url=>{assert.equal(url,'https://'+team+'/cdn-cgi/access/certs');return Response.json({keys:[key]});};
const env={BLUE_WEB_ACCESS_TEAM:team,BLUE_WEB_ACCESS_AUD:aud};
const request=(token,path='/api/eod/dates',method='GET',origin=WEB_ORIGIN)=>new Request(WEB_ORIGIN+path,{method,headers:{Origin:origin,...token?{'Cf-Access-Jwt-Assertion':token}:{},Cookie:'private',Authorization:'Bearer untrusted','Cf-Access-Authenticated-User-Email':'spoof@example.invalid',...(method==='POST'?{'Content-Type':'text/plain'}:{})},...(method==='POST'?{body:'{"date":"2026-11-25"}'}:{})});
const handler=(r,e=env,options={now,fetcher},invoke=async req=>Response.json({ok:true}))=>handleVerifiedGateway(r,e,invoke,options);
test('valid token and stripped credentials',async()=>{
 const r=await handler(request(await sign()),env,{now,fetcher},async req=>{for(const name of ['Cookie','Authorization','Cf-Access-Jwt-Assertion','Cf-Access-Authenticated-User-Email','X-Blue-Gateway-Token'])assert.equal(req.headers.get(name),null);return Response.json({ok:true});});assert.equal(r.status,200);
});
test('wrong audience, issuer, expired, future, missing and service token denied',async()=>{
 for(const token of [null,await sign({aud:['b'.repeat(64)]}),await sign({iss:'https://evil.cloudflareaccess.com'}),await sign({exp:sec}),await sign({nbf:sec+1}),await sign({iat:sec+31}),await sign({type:'org'}),await sign({sub:''}),await sign({}, {alg:'none'}),await sign({}, {kid:'unknown'})])assert.equal((await handler(request(token))).status,401);
});
test('forged payload or signature denied',async()=>{const [h,p,s]=(await sign()).split('.');assert.equal((await handler(request(h+'.'+encode({...claims,sub:'attacker'})+'.'+s))).status,401);assert.equal((await handler(request(h+'.'+p+'.'+Buffer.alloc(256).toString('base64url')))).status,401);});
test('unknown routes, cross-site writes and absent configuration fail closed',async()=>{
 const t=await sign();assert.equal((await handler(request(t,'/api/admin'))).status,403);assert.equal((await handler(request(t,'/api/research/request','POST','https://attacker.invalid'))).status,403);assert.equal((await handler(request(t),{})).status,503);assert.equal((await handler(request(t),env,{now,fetcher:async()=>new Response('',{status:503})})).status,503);
});
test('same-origin POST forwards body only after verified token',async()=>{const r=await handler(request(await sign(),'/api/research/request','POST'),env,{now,fetcher},async req=>{assert.equal(await req.text(),'{"date":"2026-11-25"}');assert.equal(req.headers.get('Origin'),WEB_ORIGIN);return Response.json({status:'PENDING'},{status:202});});assert.equal(r.status,202);});
test('frontend assets and API separated; no cookies, redirect or cache',async()=>{
 let calls=0;const e={ASSETS:{fetch:async()=>new Response('asset')},BLUE_API:{fetch:async r=>{calls++;assert.equal(r.headers.get('Cookie'),null);assert.equal(r.headers.get('Authorization'),null);return handler(r);}}};
 assert.equal(await(await gateway.fetch(new Request(WEB_ORIGIN+'/'),e)).text(),'asset');
 assert.equal((await gateway.fetch(request(null),e)).status,401);assert.equal(calls,0);
 const t=await sign(),r=await gateway.fetch(request(t),e);assert.equal(r.status,200);assert.equal(r.headers.get('Cache-Control'),'no-store');assert.equal(calls,1);
 assert.equal((await gateway.fetch(request(t,'/api/research/request','POST','https://evil.invalid'),e)).status,403);
 for(const response of [new Response(null,{status:302,headers:{Location:'https://other.invalid'}}),new Response('<html>login</html>')])assert.equal((await gateway.fetch(request(t),{...e,BLUE_API:{fetch:async()=>response}})).status,502);
});

test('first-party application cookie is verified if Access assertion is absent',async()=>{
 const token=await sign();
 const e={BLUE_API:{fetch:async r=>{assert.equal(r.headers.get('X-Blue-Gateway-Token'),token);assert.equal(r.headers.get('Cookie'),null);return handler(r);}}};
 const r=new Request(WEB_ORIGIN+'/api/eod/dates',{headers:{Cookie:'other=private; CF_Authorization='+token,'X-Blue-Gateway-Token':'forged'}});
 assert.equal((await gateway.fetch(r,e)).status,200);
 const duplicate=new Request(WEB_ORIGIN+'/api/eod/dates',{headers:{Cookie:'CF_Authorization='+token+'; CF_Authorization='+token}});
 assert.equal((await (await gateway.fetch(duplicate,e)).json()).error,'ACCESS_REQUIRED_WEB_TOKEN_MISSING');
 const injected=new Request(WEB_ORIGIN+'/api/eod/dates',{headers:{'X-Blue-Gateway-Token':token}});
 assert.equal((await gateway.fetch(injected,e)).status,401);
});
test('diagnostic codes never include the token or its claims',async()=>{
 const missing=await handler(request(null));assert.equal((await missing.json()).error,'ACCESS_REQUIRED_API_TOKEN_MISSING');
 const wrong=await handler(request(await sign({aud:['b'.repeat(64)]})));assert.equal((await wrong.json()).error,'ACCESS_REQUIRED_API_AUDIENCE_MISMATCH');
 const keys=await handler(request(await sign()),env,{now,fetcher:async()=>new Response('',{status:503})});assert.equal(keys.status,503);assert.equal((await keys.json()).error,'ACCESS_REQUIRED_API_KEYS_HTTP_503');
});

test('transient key service failure retries and succeeds only after signature verification',async()=>{
 let calls=0;
 const fetcher=async()=>++calls===1?new Response('',{status:503}):Response.json({keys:[key]});
 assert.equal((await handler(request(await sign()),env,{now,fetcher})).status,200);
 assert.equal(calls,2);
});
test('public key cache is issuer scoped, expires, and never accepts expired cache on outage',async()=>{
 let calls=0,clockNow=now,available=true;
 const cache=new Map(),clock=()=>clockNow,fetcher=async()=>{calls++;return available?Response.json({keys:[key]}):new Response('',{status:503});};
 const options={now,fetcher,cache,clock};const t=await sign();
 assert.equal((await handler(request(t),env,options)).status,200);
 assert.equal((await handler(request(t),env,options)).status,200);
 assert.equal(calls,1);
 const wrongTeam='other.cloudflareaccess.com',otherEnv={...env,BLUE_WEB_ACCESS_TEAM:wrongTeam};
 assert.equal((await handler(request(await sign({iss:'https://'+wrongTeam})),otherEnv,options)).status,200);
 assert.equal(calls,2);
 clockNow+=120001;available=false;
 const failed=await handler(request(t),env,options);
 assert.equal(failed.status,503);assert.equal((await failed.json()).error,'ACCESS_REQUIRED_API_KEYS_HTTP_503');
 assert.equal(calls,4);
});
test('unknown signing kid refreshes the public key set; no signature bypass',async()=>{
 let calls=0;
 const cache=new Map(),fetcher=async()=>{calls++;return Response.json({keys:[calls===1?key:{...key,kid:'key2'}]});};
 const options={now,fetcher,cache};
 assert.equal((await handler(request(await sign()),env,options)).status,200);
 assert.equal((await handler(request(await sign({}, {kid:'key2'})),env,options)).status,200);
 assert.equal(calls,2);
 const [h,p]= (await sign({}, {kid:'key2'})).split('.');
 assert.equal((await handler(request(h+'.'+p+'.'+Buffer.alloc(256).toString('base64url')),env,options)).status,401);
});
test('permanent key service failures are distinguished and cannot authenticate',async()=>{
 const t=await sign();
 for(const [response,code] of [[()=>new Response('',{status:403}),'KEYS_HTTP_403'],[()=>new Response(null,{status:302,headers:{Location:'https://other.invalid'}}),'KEYS_HTTP_302'],[()=>new Response('not JSON'),'KEYS_INVALID_JSON'],[()=>Response.json({keys:[]}),'KEYS_INVALID_SET']]){
  let calls=0;const r=await handler(request(t),env,{now,fetcher:async()=>{calls++;return response();}});
  assert.equal(r.status,503);assert.equal((await r.json()).error,'ACCESS_REQUIRED_API_'+code);assert.equal(calls,1);
 }
 const r=await handler(request(t),env,{now,fetcher:async()=>{throw Object.assign(new Error('private'),{name:'TimeoutError'});}});
 assert.equal(r.status,503);assert.equal((await r.json()).error,'ACCESS_REQUIRED_API_KEYS_TIMEOUT');
});

test('tracking registry owner derived from authenticated subject, spoofed header stripped',async()=>{const a=await sign(),b=await sign({sub:'user2'});const owners=[];for(const t of [a,b,a]){const r=await handler(request(t,'/api/basket/tracking'),env,{now,fetcher},async(req,owner)=>{assert.match(owner,/^[a-f0-9]{64}$/);assert.equal(req.headers.get('X-Blue-Gateway-Token'),null);owners.push(owner);return Response.json({ok:true})});assert.equal(r.status,200)}assert.notEqual(owners[0],owners[1]);assert.equal(owners[0],owners[2]);assert.equal((await handler(request(a,'/api/basket/tracking','POST','https://evil.invalid'))).status,403)});

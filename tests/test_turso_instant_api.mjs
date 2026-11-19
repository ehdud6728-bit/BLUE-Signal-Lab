import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from '../worker/node_modules/typescript/lib/typescript.js';

// Run the actual API fetch router with the imported services removed. The
// instant route must resolve before any D1-based or provider-based path.
const source=(await readFile(new URL('../worker/src/index.ts',import.meta.url),'utf8'))
  .replace(/^import .*?;\s*$/gm,'');
const script=ts.transpileModule(`const validLiveCode=(x)=>/^[0-9A-Z]{6}$/.test(x);\n${source}`,
  {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {default:api}=await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`);
const ORIGIN='https://blue-signal-lab.ehdud6728.workers.dev';
const PATH='https://api.example/api/eod/quotes/refresh';
const d1Unavailable=new Proxy({},{get(){throw Error('D1_QUOTA_EXCEEDED_UNEXPECTED_READ');}});
const makeRequest=(body={code:'005930'},origin=ORIGIN)=>new Request(PATH,{
  method:'POST',headers:{Origin:origin,'Content-Type':'text/plain;charset=UTF-8'},
  body:JSON.stringify(body)});

test('same origin and Cloudflare Access are both required before service RPC',async()=>{
 let calls=0;
 const env={DB:d1Unavailable,CORS_ORIGIN:ORIGIN,KIS_COLLECTOR:{collectNowTurso:async()=>{
   calls++;return {status:'SAVED'};
 }}};
 assert.equal((await api.fetch(makeRequest({code:'005930'},'https://attacker.invalid'),env,{access:true})).status,403);
 assert.equal((await api.fetch(makeRequest(),env,{})).status,401);
 assert.equal(calls,0);
});

test('one verified KIS quote is returned from a Turso-only RPC, never D1',async()=>{
 const observed=[];
 const env={DB:d1Unavailable,CORS_ORIGIN:ORIGIN,KIS_COLLECTOR:{collectNowTurso:async code=>{
   observed.push(code);
   return {status:'SAVED',code,market:'J',price:66500,trade_date:'2026-11-19',
     received_at_utc:'2026-11-19T00:10:00.000Z'};
 }}};
 const response=await api.fetch(makeRequest({code:'005930'}),env,{access:true});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.deepEqual(observed,['005930']);
 assert.deepEqual({status:body.status,storage:body.storage,price:body.price,market:body.market},
   {status:'SAVED',storage:'TURSO',price:66500,market:'J'});
 assert.equal(body.received_at_utc,'2026-11-19T00:10:00.000Z');
});

test('invalid payload and absent collector fail closed, not into a D1 quote queue',async()=>{
 const env={DB:d1Unavailable,CORS_ORIGIN:ORIGIN};
 for(const value of [null,{}, {code:'NOT-CODE'}]){
   const response=await api.fetch(makeRequest(value),env,{access:true});
   assert.equal(response.status,400);
 }
 const response=await api.fetch(makeRequest(),env,{access:true});
 assert.equal(response.status,503);
 const body=await response.json();
 assert.equal(body.status,'NOT_CONNECTED');
 assert.equal(body.storage,'TURSO');
});

test('expired Turso token and upstream outage show safe status only',async()=>{
 for(const status of ['TURSO_TOKEN_EXPIRED','QUOTE_UNAVAILABLE']){
   const env={DB:d1Unavailable,CORS_ORIGIN:ORIGIN,KIS_COLLECTOR:{collectNowTurso:async()=>{
     if(status==='QUOTE_UNAVAILABLE')throw Error('secret KIS payload must not leak');
     return {status};
   }}};
   const response=await api.fetch(makeRequest(),env,{access:true});
   assert.equal(response.status,503);
   const body=await response.json();
   assert.equal(body.status,status);
   assert.equal(body.price,null);
   assert.equal(JSON.stringify(body).includes('secret'),false);
 }
});

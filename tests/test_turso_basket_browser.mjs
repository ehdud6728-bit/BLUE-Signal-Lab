import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from '../worker/node_modules/typescript/lib/typescript.js';

// Run the actual browser reader without Vite: replace only its build-time
// import.meta.env configuration. No real network and no browser storage.
const source=(await readFile(new URL('../web/src/price-compare.ts',import.meta.url),'utf8'))
 .replace('import.meta.env.VITE_API_BASE','undefined');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,
 target:ts.ScriptTarget.ES2022}}).outputText;
const {fetchComparedTursoFirst,fetchComparedTursoOnly,refreshKisQuoteToTurso,sourceName}=
 await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

function response(body,status=200){return {ok:status>=200&&status<300,status,
 async json(){return body;}};}

const request=[{code:'225190',day:'2026-11-17'}];
const snapshot={code:'225190',day:'2026-11-17',status:'READY',
 latest_price:4500,latest_day:'2026-11-18',latest_source:'KRX_VERIFIED_EOD_CLOSE',
 latest_at:null,latest_market:null,period_high:4700,period_high_day:'2026-11-18',
 period_high_source:'KRX_VERIFIED_EOD_HIGH',high_coverage_to:'2026-11-18',high_complete:false,
 period_low:4350,period_low_day:'2026-11-18',period_low_source:'KRX_VERIFIED_EOD_LOW',
 low_coverage_to:'2026-11-18',low_complete:false};

test('Turso success reads only Turso and preserves later close source',async()=>{
 const prev=globalThis.fetch,paths=[];
 try{
  globalThis.fetch=async url=>{paths.push(new URL(url).pathname);return response({storage:'TURSO',items:[snapshot]});};
  const data=await fetchComparedTursoFirst(request);
  assert.deepEqual(paths,['/api/eod/prices/compare']);
  assert.equal(data['225190:2026-11-17'].latest_price,4500);
  assert.equal(data['225190:2026-11-17'].period_low,4350);
  assert.equal(sourceName(data['225190:2026-11-17'].period_low_source),'Turso KRX 일봉 저가');
 }finally{globalThis.fetch=prev;}
});

test('invalid or discovery-day period low cannot be shown as a verified later low',async()=>{
 const prev=globalThis.fetch,paths=[];
 try{
  globalThis.fetch=async url=>{paths.push(new URL(url).pathname);
   return response({storage:'TURSO',items:[{...snapshot,period_low:999999,
    period_low_day:'2026-11-17'}]});};
  await assert.rejects(()=>fetchComparedTursoOnly(request),/TURSO_EOD_COMPARE_INVALID_RESPONSE/);
  assert.deepEqual(paths,['/api/eod/prices/compare']);
 }finally{globalThis.fetch=prev;}
});

test('valid empty Turso result never burns D1 read quota',async()=>{
 const prev=globalThis.fetch,paths=[];
 try{
  globalThis.fetch=async url=>{paths.push(new URL(url).pathname);return response({storage:'TURSO',
    items:[{...snapshot,status:'NO_LATER_PRICE',latest_price:null,latest_day:null}]});};
  const data=await fetchComparedTursoFirst(request);
  assert.deepEqual(paths,['/api/eod/prices/compare']);
  assert.equal(data['225190:2026-11-17'].latest_price,null);
 }finally{globalThis.fetch=prev;}
});

test('Turso reader supports audited alphanumeric KRX symbols',async()=>{
 const prev=globalThis.fetch,urls=[];
 try{
  globalThis.fetch=async url=>{urls.push(new URL(url));return response({storage:'TURSO',items:[{
    ...snapshot,code:'0000A0',status:'NO_LATER_PRICE',latest_price:null,latest_day:null
  }]});};
  const data=await fetchComparedTursoFirst([{code:'0000A0',day:'2026-11-17'}]);
  assert.equal(urls.length,1);
  assert.equal(urls[0].pathname,'/api/eod/prices/compare');
  assert.equal(urls[0].searchParams.get('items'),'0000A0:2026-11-17');
  assert.equal(data['0000A0:2026-11-17'].status,'NO_LATER_PRICE');
 }finally{globalThis.fetch=prev;}
});

test('pattern search price is Turso-first; manual KIS refresh saves and then reads Turso only',async()=>{
 const main=await readFile(new URL('../web/src/main.tsx',import.meta.url),'utf8');
 assert.match(main,/const readPrices=patternBackend==='turso'\?fetchComparedTursoFirst:fetchCompared/);
 assert.match(main,/if\(patternBackend==='turso'\)\{\s*const result=await refreshKisQuoteToTurso\(r\.code\)/);
 assert.match(main,/const saved=await fetchComparedTursoOnly/);
 assert.match(main,/requestLabel=\{patternBackend==='turso'\?'↻ KIS 최신가 조회':'↻ 시세 갱신'\}/);
});

test('mobile search removes large technical/EOD split and keeps secondary data view',async()=>{
 const main=await readFile(new URL('../web/src/main.tsx',import.meta.url),'utf8');
 assert.doesNotMatch(main,/className="blue-search-source-switch"/);
 assert.doesNotMatch(main,/className="blue-pattern-source-note"/);
 assert.match(main,/className="blue-search-subsource"/);
 assert.match(main,/전체 종목 보기/);
 assert.match(main,/종목 검색으로 돌아가기/);
 assert.match(main,/<details className="blue-source-details">/);
});

test('manual request calls one protected POST, no D1, then reads saved Turso quote',async()=>{
 const prev=globalThis.fetch,calls=[];
 try{
  globalThis.fetch=async (url,options={})=>{
   calls.push({path:new URL(url).pathname,options});
   if(new URL(url).pathname==='/api/eod/quotes/refresh')return response({
    storage:'TURSO',code:'225190',status:'SAVED',message:'조회했습니다.',
    trade_date:'2026-11-19',price:4710,market:'J',received_at_utc:'2026-11-19T00:10:00Z'});
   return response({storage:'TURSO',items:[{...snapshot,latest_day:'2026-11-19',
    latest_price:4710,latest_source:'KIS_TURSO_SNAPSHOT',
    latest_at:'2026-11-19T00:10:00Z',latest_market:'J'}]});
  };
  const result=await refreshKisQuoteToTurso('225190');
  assert.equal(result.status,'SAVED');
  assert.equal(result.price,4710);
  const saved=await fetchComparedTursoOnly(request);
  assert.equal(saved['225190:2026-11-17'].latest_source,'KIS_TURSO_SNAPSHOT');
  assert.deepEqual(calls.map(x=>x.path),['/api/eod/quotes/refresh','/api/eod/prices/compare']);
  assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.credentials,'include');
  assert.deepEqual(JSON.parse(calls[0].options.body),{code:'225190'});
 }finally{globalThis.fetch=prev;}
});

test('manual quote fails closed on Access denial or Turso outage, with zero D1 reads',async()=>{
 const prev=globalThis.fetch,paths=[];
 try{
  globalThis.fetch=async (url)=>{
   const path=new URL(url).pathname;paths.push(path);
   return path==='/api/eod/quotes/refresh'?response({error:'ACCESS_REQUIRED'},401):response({},503);
  };
  await assert.rejects(()=>refreshKisQuoteToTurso('225190'),/CLOUDFLARE_ACCESS_REQUIRED/);
  await assert.rejects(()=>fetchComparedTursoOnly(request),/TURSO_EOD_HTTP_503/);
  assert.deepEqual(paths,['/api/eod/quotes/refresh','/api/eod/prices/compare']);
 }finally{globalThis.fetch=prev;}
});

test('Turso outage falls back exactly once to existing D1 endpoint',async()=>{
 const prev=globalThis.fetch,paths=[];
 try{
  globalThis.fetch=async url=>{
   const path=new URL(url).pathname;paths.push(path);
   return path==='/api/eod/prices/compare'?response({},503):response({items:[{
     ...snapshot,latest_price:4490,latest_source:'KIS_DAILY_CLOSE'}]});
  };
  const data=await fetchComparedTursoFirst(request);
  assert.deepEqual(paths,['/api/eod/prices/compare','/api/prices/compare']);
  assert.equal(data['225190:2026-11-17'].latest_source,'KIS_DAILY_CLOSE');
 }finally{globalThis.fetch=prev;}
});

test('Access denied stops rather than issuing extra D1 reads',async()=>{
 const prev=globalThis.fetch,paths=[];
 try{
  globalThis.fetch=async url=>{paths.push(new URL(url).pathname);return response({},401);};
  await assert.rejects(()=>fetchComparedTursoFirst(request),/TURSO_EOD_HTTP_401/);
  assert.deepEqual(paths,['/api/eod/prices/compare']);
 }finally{globalThis.fetch=prev;}
});

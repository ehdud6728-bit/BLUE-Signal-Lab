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
const {fetchComparedTursoFirst}=await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

function response(body,status=200){return {ok:status>=200&&status<300,status,
 async json(){return body;}};}

const request=[{code:'225190',day:'2026-11-17'}];
const snapshot={code:'225190',day:'2026-11-17',status:'READY',
 latest_price:4500,latest_day:'2026-11-18',latest_source:'KRX_VERIFIED_EOD_CLOSE',
 latest_at:null,latest_market:null,period_high:4700,period_high_day:'2026-11-18',
 period_high_source:'KRX_VERIFIED_EOD_HIGH',high_coverage_to:'2026-11-18',high_complete:false};

test('Turso success reads only Turso and preserves later close source',async()=>{
 const prev=globalThis.fetch,paths=[];
 try{
  globalThis.fetch=async url=>{paths.push(new URL(url).pathname);return response({storage:'TURSO',items:[snapshot]});};
  const data=await fetchComparedTursoFirst(request);
  assert.deepEqual(paths,['/api/eod/prices/compare']);
  assert.equal(data['225190:2026-11-17'].latest_price,4500);
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

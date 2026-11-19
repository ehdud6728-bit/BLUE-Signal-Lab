import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from '../worker/node_modules/typescript/lib/typescript.js';

const source=(await readFile(new URL('../web/src/turso-research-reader.ts',import.meta.url),'utf8'))
 .replace('import.meta.env.VITE_API_BASE','undefined');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,
 target:ts.ScriptTarget.ES2022}}).outputText;
const {fetchResearchChartTursoFirst,fetchResearchEvidenceTursoFirst}=await import(
 `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

const DAY='2026-11-18',CODE='005930';
const chart={status:'READY',chart:{asof:DAY,bars:[{t:'2026-11-17',c:100},
 {t:DAY,c:110}]},stats:{asof:DAY}};
const evidence={code:CODE,day:DAY,extras:{r159_pattern_up_10d:71,r159_pattern_n_10d:8}};
const respond=(body,status=200)=>({ok:status>=200&&status<300,status,
 async json(){return body;}});

async function withMock(resolver,run){
 const prior=globalThis.fetch,paths=[];
 try{
  globalThis.fetch=async url=>{const p=new URL(url);paths.push(p);return resolver(p);};
  await run(paths);
 }finally{globalThis.fetch=prior;}
}

test('verified Turso chart avoids legacy D1 chart reads',async()=>{
 await withMock(()=>respond(chart),async paths=>{
  assert.deepEqual(await fetchResearchChartTursoFirst(CODE,DAY),chart);
  assert.deepEqual(paths.map(p=>p.pathname),['/api/research/chart']);
  assert.equal(paths[0].searchParams.get('date'),DAY);
 });
});

test('an invalid audited chart fails closed without D1 fallback',async()=>{
 await withMock(()=>respond({...chart,chart:{...chart.chart,asof:'2026-11-17'}}),async paths=>{
  assert.equal(await fetchResearchChartTursoFirst(CODE,DAY),null);
  assert.deepEqual(paths.map(p=>p.pathname),['/api/research/chart']);
 });
});

test('older not-imported Turso chart falls back to archived D1 chart',async()=>{
 await withMock(p=>respond(p.pathname==='/api/research/chart'?{
  status:'NOT_AVAILABLE',reason:'DAY_NOT_IMPORTED'}:chart),async paths=>{
  assert.deepEqual(await fetchResearchChartTursoFirst(CODE,DAY),chart);
  assert.deepEqual(paths.map(p=>p.pathname),['/api/research/chart','/api/chart']);
 });
});

test('audited day without stock signal never loads stale D1 chart',async()=>{
 for(const unverified of [{status:'NOT_AVAILABLE',reason:'NO_SIGNAL_FOR_SYMBOL'},
   {status:'NOT_AVAILABLE'}]){
  await withMock(p=>respond(p.pathname==='/api/research/chart'?unverified:chart),async paths=>{
   assert.equal(await fetchResearchChartTursoFirst(CODE,DAY),null);
   assert.deepEqual(paths.map(p=>p.pathname),['/api/research/chart']);
  });
 }
});

test('Turso chart outage falls back; access denial does not burn D1 reads',async()=>{
 await withMock(p=>p.pathname==='/api/research/chart'?respond({},503):respond(chart),async paths=>{
  assert.deepEqual(await fetchResearchChartTursoFirst(CODE,DAY),chart);
  assert.deepEqual(paths.map(p=>p.pathname),['/api/research/chart','/api/chart']);
 });
 await withMock(()=>respond({},401),async paths=>{
  assert.equal(await fetchResearchChartTursoFirst(CODE,DAY),null);
  assert.deepEqual(paths.map(p=>p.pathname),['/api/research/chart']);
 });
});

test('Turso audited pattern evidence avoids D1 and retains exact research stats',async()=>{
 await withMock(()=>respond({storage:'TURSO',data_status:'AVAILABLE',items:[evidence]}),async paths=>{
  const result=await fetchResearchEvidenceTursoFirst(CODE,DAY,8);
  assert.deepEqual(result,evidence);
  assert.deepEqual(paths.map(p=>p.pathname),['/api/research/search']);
  assert.equal(paths[0].searchParams.get('code'),CODE);
  assert.equal(paths[0].searchParams.get('min_pattern_n'),'8');
 });
});

test('valid audited Turso empty signal never falls back to D1',async()=>{
 await withMock(()=>respond({storage:'TURSO',data_status:'AVAILABLE',items:[]}),async paths=>{
  assert.equal(await fetchResearchEvidenceTursoFirst(CODE,DAY,8),null);
  assert.deepEqual(paths.map(p=>p.pathname),['/api/research/search']);
 });
});

test('older research day or temporary Turso outage can read D1 history',async()=>{
 for(const first of [respond({storage:'TURSO',data_status:'NOT_IMPORTED',items:[]}),respond({},503)]){
  await withMock(p=>p.pathname==='/api/research/search'?first:respond({items:[evidence]}),async paths=>{
   assert.deepEqual(await fetchResearchEvidenceTursoFirst(CODE,DAY,8),evidence);
   assert.deepEqual(paths.map(p=>p.pathname),['/api/research/search','/api/search']);
  });
 }
});

test('invalid Turso evidence or missing Access never silently reads D1',async()=>{
 for(const result of [respond({storage:'TURSO',data_status:'AVAILABLE',items:'bad'}),respond({},403)]){
  await withMock(()=>result,async paths=>{
   assert.equal(await fetchResearchEvidenceTursoFirst(CODE,DAY,8),null);
   assert.deepEqual(paths.map(p=>p.pathname),['/api/research/search']);
  });
 }
});

test('basket price, stop loss, supply and pattern evidence now share Turso-first readers',async()=>{
 const root=new URL('../web/src/',import.meta.url);
 const [basket,stop,supply]=await Promise.all(['SmartBasket.tsx','StopLossRow.tsx','basket-supply-record.ts']
  .map(p=>readFile(new URL(p,root),'utf8')));
 assert.match(basket,/fetchComparedTursoFirst\(items/);
 assert.match(basket,/fetchResearchEvidenceTursoFirst\(it\.code,it\.day,patternSampleMin\)/);
 assert.match(stop,/fetchResearchChartTursoFirst\(code,day\)/);
 assert.match(supply,/fetchResearchChartTursoFirst\(code,day\)/);
});

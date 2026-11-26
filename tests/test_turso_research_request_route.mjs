import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from '../worker/node_modules/typescript/lib/typescript.js';

const code=(await readFile(new URL('../worker/src/index.ts',import.meta.url),'utf8'))
  .replace(/^import .*?;\s*$/gm,'');
const script=ts.transpileModule(`
class InvalidTursoResearchRequest extends Error {}
class InvalidPrivateCaseQuery extends Error {}
class PrivateCaseSnapshotChanged extends Error {}
const tursoPrivateCombinedCases=async (_env,params)=>({status:'READY',asof:params.get('asof')});
const requestTursoResearch=async (_env,day)=>({status:'PENDING',day});
const tursoResearchRequestStatus=async (_env,day)=>({status:'READY',day});
const tursoMarketRotation=async()=>({status:'READY',source:'ROTATION'});
const tursoMarketTrends=async()=>({status:'READY',source:'TRENDS'});
const tursoRotationLeaders=async()=>({status:'READY',source:'LEADERS'});
const readMarketEodBreadth=async()=>({status:'COUNT_AUDITED_EOD'});
const handleTursoMarketAi=async (request,env,facts)=>new Response(JSON.stringify({status:'READY',method:request.method,facts}),{status:200});
const tursoResearchCoverage=async ()=>({storage:'TURSO',status:'AUDIT_COUNTS_ONLY'});
const tursoPatternPulse=async ()=>({storage:'TURSO',status:'AUDITED_PATTERN_ACTIVITY'});
const tursoExitStudyReport=async ()=>({storage:'TURSO',status:'NOT_PUBLISHED',report:null});
${code}`,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {default:api}=await import(`data:text/javascript;base64,${Buffer.from(script).toString('base64')}`);
const origin='https://blue-signal-lab.ehdud6728.workers.dev';
const d1Unavailable=new Proxy({},{get(){throw Error('D1_QUOTA_EXCEEDED_READ');}});
const env={DB:d1Unavailable,CORS_ORIGIN:origin};
const request=(path,method='POST',site=origin)=>new Request('https://api.example'+path,{
  method,headers:{Origin:site,'Content-Type':'text/plain;charset=UTF-8'},
  ...(method==='POST'?{body:JSON.stringify({date:'2026-11-19'})}:{})
});

test('only same-origin authenticated users can start a Turso analysis',async()=>{
  assert.equal((await api.fetch(request('/api/research/request','POST','https://attacker.invalid'),
    env,{access:true})).status,403);
  assert.equal((await api.fetch(request('/api/research/request'),env,{})).status,401);
  const response=await api.fetch(request('/api/research/request'),env,{access:true});
  assert.equal(response.status,202);
  assert.deepEqual(await response.json(),{status:'PENDING',day:'2026-11-19'});
});

test('status is Access-gated and never uses the D1 scan table',async()=>{
  const url='/api/research/request/status?date=2026-11-19';
  assert.equal((await api.fetch(request(url,'GET'),env,{})).status,401);
  const response=await api.fetch(request(url,'GET'),env,{access:true});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{status:'READY',day:'2026-11-19'});
});

test('research coverage uses only Turso, never a D1 status or AI cache',async()=>{
  const response=await api.fetch(request('/api/research/coverage','GET'),env,{});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{storage:'TURSO',status:'AUDIT_COUNTS_ONLY'});
});

test('audited pattern pulse remains Turso-only without D1 or AI cache',async()=>{
  const response=await api.fetch(request('/api/research/pulse','GET'),env,{});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{storage:'TURSO',status:'AUDITED_PATTERN_ACTIVITY'});
});

test('exploratory exit study status reads Turso without legacy AI or D1',async()=>{
  const response=await api.fetch(request('/api/research/exit-study','GET'),env,{});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{storage:'TURSO',status:'NOT_PUBLISHED',report:null});
});

test('web date-specific search offers Turso request and persisted status polling',async()=>{
  const web=await readFile(new URL('../web/src/main.tsx',import.meta.url),'utf8');
  const progress=await readFile(new URL('../web/src/TursoResearchProgress.tsx',import.meta.url),'utf8');
  assert.match(web,/if\(source==='turso'\)\{[\s\S]*?setStatus\(''\);[\s\S]*?await requestTursoScan\(queryDate\)/);
  assert.match(web,/API\+'\/api\/research\/request\/status\?date='/);
  assert.match(web,/localStorage\.setItem\(TURSO_WATCH_KEY,tursoWatchDate\)/);
  assert.match(web,/<TursoResearchProgress/);
  assert.match(progress,/패턴 분석 진행 중/);
  assert.match(progress,/formatTursoElapsed/);
});

test('Turso AI tab is pattern readiness only and refreshes its ledger',async()=>{
  const web=await readFile(new URL('../web/src/main.tsx',import.meta.url),'utf8');
  const readiness=await readFile(new URL('../web/src/TursoAiReadiness.tsx',import.meta.url),'utf8');
  assert.match(web,/storageMode==='turso'&&activeView==='ai'&&<section/);
  assert.match(web,/<TursoAiReadiness key=\{r1594AiRefresh\} api=\{API\}/);
  assert.match(web,/storageMode==='d1'&&<section[\s\S]*?<AiWidget/);
  assert.match(readiness,/\/api\/research\/coverage/);
  assert.match(readiness,/추천 점수·예상 수익·AI 시장 전망을 생성하지 않습니다/);
  assert.match(readiness,/<TursoPatternPulse api=\{api\} active=\{active\}/);
  assert.match(readiness,/<TursoExitStudy api=\{api\} active=\{active\}/);
});

test('market AI requires Access and same-origin POST before collecting Turso evidence',async()=>{
 const path='/api/research/market-ai';
 assert.equal((await api.fetch(request(path,'GET'),env,{})).status,401);
 assert.equal((await api.fetch(request(path,'POST','https://attacker.invalid'),env,{access:true})).status,403);
 assert.equal((await api.fetch(request(path,'POST'),env,{})).status,401);
 const response=await api.fetch(request(path,'POST'),env,{access:true});
 assert.equal(response.status,200);
 assert.deepEqual((await response.json()).facts,{rotation:{status:'READY',source:'ROTATION'},trends:{status:'READY',source:'TRENDS'},leaders:{status:'READY',source:'LEADERS'},eodBreadth:{status:'COUNT_AUDITED_EOD'}});
});

test('private research cases require Access and forbid caching',async()=>{
 const path='/api/research/private-combined-cases?asof=2026-11-24';
 assert.equal((await api.fetch(request(path,'GET'),env,{})).status,401);
 const r=await api.fetch(request(path,'GET'),env,{access:true});
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 assert.deepEqual(await r.json(),{status:'READY',asof:'2026-11-24'});
});

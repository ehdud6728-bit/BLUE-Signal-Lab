import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from '../worker/node_modules/typescript/lib/typescript.js';

const code=(await readFile(new URL('../worker/src/index.ts',import.meta.url),'utf8'))
  .replace(/^import .*?;\s*$/gm,'');
const script=ts.transpileModule(`
class InvalidTursoResearchRequest extends Error {}
const requestTursoResearch=async (_env,day)=>({status:'PENDING',day});
const tursoResearchRequestStatus=async (_env,day)=>({status:'READY',day});
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

test('web date-specific search offers Turso request and persisted status polling',async()=>{
  const web=await readFile(new URL('../web/src/main.tsx',import.meta.url),'utf8');
  const progress=await readFile(new URL('../web/src/TursoResearchProgress.tsx',import.meta.url),'utf8');
  assert.match(web,/if\(patternBackend==='turso'\)\{[\s\S]*?setStatus\(''\);[\s\S]*?await requestTursoScan\(queryDate\)/);
  assert.match(web,/API\+'\/api\/research\/request\/status\?date='/);
  assert.match(web,/localStorage\.setItem\(TURSO_WATCH_KEY,tursoWatchDate\)/);
  assert.match(web,/<TursoResearchProgress/);
  assert.match(progress,/패턴 분석 진행 중/);
  assert.match(progress,/formatTursoElapsed/);
});

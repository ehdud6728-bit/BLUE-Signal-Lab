import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {officialMacroCalendar} from '../worker/src/official-macro-calendar.ts';
import {buildMarketEvidence,marketPrompt,validateMarketReport,handleTursoMarketAi,readMarketEodBreadth} from '../worker/src/turso-market-ai.ts';
const now=new Date('2026-11-25T00:30:00Z'),day='2026-11-24',at='2026-11-24T16:09:00Z',proof='a'.repeat(64);
const flow=[{day,foreign:'BUY',institution:'SELL'},{day:'2026-11-23',foreign:'BUY',institution:null}];
function fixture(){
 const rotation={status:'READY',receipt_day:day,observed_at_utc:'2026-11-24T14:00:00Z',state:'STALE_RECEIPT',markets:['KOSPI','KOSDAQ'].map(market=>({market,change_pct:1,breadth_pct:60,flows:flow}))};
 const trend={day,rs5:1,rs10:-1,rs20:-3,momentum:2,quadrant:'IMPROVING',previous_day:'2026-11-23',previous_quadrant:'LAGGING'};
 const trends={status:'READY',receipt_day:'2026-11-25',observed_at_utc:at,trend_sha256:proof,global:[{name:'VIX',symbol:'.VIX',summary:{day,close:31,change_pct:5,change5_pct:2}},{name:'다우',symbol:'.DJI',summary:null}],markets:['KOSPI','KOSDAQ'].map(market=>({market,benchmark:{day,change_pct:1,change5_pct:2},universe:1,rows:[{code:'1234',name:'비공개업종명',trend}]}))};
 const stock={code:'005930',name:'비공개종목명',r5:2,r10:1,amount_ratio:1.5,signals:['BB20']};
 const group={name:'비공개업종명',code:'1234',entry:'NEW_ENTRY',members:2,matched:2,membership_source:'KIS_MASTER_FLAG',leaders:[{...stock,code:'000660',r10:8}],followers:[stock]};
 const leaders={status:'READY',trend_receipt_day:'2026-11-25',trend_sha256:proof,receipt_day:'2026-11-25',master_receipt_day:'2026-11-25',day,trend_superseded:false,mapping_status:'PARTIAL',signal_status:'AUDITED',markets:['KOSPI','KOSDAQ'].map(market=>({market,improving:1,analyzed:1,groups:[group]}))};
 return {rotation,trends,leaders};
}
const output=(ref='M_KOSPI')=>{
 const p={text:'관측 자료를 근거로 추가 확인이 필요합니다.',refs:[ref]};
 const s={condition:'시장 폭과 수급의 방향을 확인합니다.',response:'확인 전에는 위험 관찰을 우선합니다.',invalidation:'반대 방향 자료가 나타나면 다시 평가합니다.',refs:[ref]};
 return {summary:p,risks:p,rotation:p,watch:p,scenarios:{rise:s,range:s,fall:s}};
};
test('derive dated observations, anonymize prompt, exclude superseded or mismatching stock evidence',()=>{
 const input=fixture(),e=buildMarketEvidence(input,now),prompt=marketPrompt(e.facts);
 assert.equal(e.facts.candidate_status,'ALIGNED');
 assert.equal(e.facts.domestic[0].foreign[0].known,2);
 assert.equal(e.facts.global[0].vix_band,'30_TO_40');
 assert.equal(e.facts.global[1].status,'MISSING');
 assert.ok(e.refs.some(x=>x.label.includes('005930')));
 for(const forbidden of ['005930','000660','비공개종목명','비공개업종명'])assert.ok(!prompt.includes(forbidden));
 input.leaders.trend_sha256='b'.repeat(64);
 assert.equal(buildMarketEvidence(input,now).facts.candidate_status,'UNAVAILABLE_OR_SUPERSEDED');
 assert.equal(buildMarketEvidence({rotation:null,trends:null,leaders:null},now).available,false);
 assert.throws(()=>validateMarketReport(output('MADE_UP'),new Set(['M_KOSPI'])),/AI_REPORT_INVALID/);
});
test('GET never writes or calls Gemini, same evidence reuses cache, changed evidence capped at five attempts',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0,writes=0;
 const factory=()=>({async execute(q){
  const stmt=db.prepare(q.sql);
  if(/^\s*SELECT\b/i.test(q.sql))return {rows:stmt.all(...q.args)};
  writes++;const r=stmt.run(...q.args);return {rowsAffected:Number(r.changes),rows:[]};
 },close(){}});
 const env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'secret',GEMINI_API_KEY:'dummy'};
 const fetchFn=async(_url,options)=>{calls++;const prompt=JSON.parse(options.body).contents[0].parts[0].text;assert.ok(!prompt.includes('005930'));return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(output())}]}}]}));};
 const input=fixture();
 const request=method=>new Request('https://example.test/api/research/market-ai',{method});
 const run=(method)=>handleTursoMarketAi(request(method),env,input,{factory,now,fetchFn});
 try{
  assert.equal((await (await run('GET')).json()).status,'NOT_GENERATED');
  assert.equal(writes,0);assert.equal(calls,0);
  let body=await (await run('POST')).json();assert.equal(body.status,'READY');assert.equal(body.cached,false);
  const before=writes;
  body=await (await run('GET')).json();assert.equal(body.cached,true);assert.equal(writes,before);
  body=await (await run('POST')).json();assert.equal(body.cached,true);assert.equal(calls,1);
  for(let i=2;i<=5;i++){input.rotation.markets[0].change_pct=i;assert.equal((await (await run('POST')).json()).status,'READY');}
  input.rotation.markets[0].change_pct=6;const capped=await run('POST');assert.equal(capped.status,429);assert.equal((await capped.json()).error,'DAILY_LIMIT');assert.equal(calls,5);
 }finally{db.close();}
});
test('invalid generated evidence ID is rejected and never cached as READY',async()=>{
 const db=new DatabaseSync(':memory:');let calls=0;
 const factory=()=>({async execute(q){const s=db.prepare(q.sql);if(/^SELECT\b/.test(q.sql))return {rows:s.all(...q.args)};return {rowsAffected:Number(s.run(...q.args).changes),rows:[]};},close(){}});
 const env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'secret',GEMINI_API_KEY:'dummy'};
 const fetchFn=async()=>{calls++;return new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify(output('INVALID_REF'))}]}}]}));};
 const run=method=>handleTursoMarketAi(new Request('https://example.test',{method}),env,fixture(),{factory,now,fetchFn});
 try{const r=await run('POST');assert.equal(r.status,502);assert.equal((await r.json()).error,'AI_REPORT_INVALID');const again=await run('POST');assert.equal(again.status,503);assert.equal(calls,1);assert.equal(db.prepare("SELECT COUNT(*) n FROM blue_ai_market_calls_v1 WHERE status='READY'").get().n,0);}finally{db.close();}
});

test('official calendar preserves ET/UTC dates, filters passed events and expires AI evidence',()=>{
 const cal=officialMacroCalendar(now);
 assert.equal(cal.status,'REVIEWED_SCHEDULE');
 assert.equal(cal.events.find(e=>e.id==='E_FOMC_DEC').scheduled_utc,'2026-12-09T19:00:00.000Z');
 assert.equal(cal.events.find(e=>e.id==='E_JOBS_NOV').scheduled_utc,'2026-12-04T13:30:00.000Z');
 assert.equal(cal.events.find(e=>e.id==='E_PCE_OCT').scheduled_utc,'2026-11-25T13:30:00.000Z');
 assert.ok(cal.events.every(e=>e.status==='SCHEDULED_NOT_RESULT'&&e.source_url.startsWith('https://')));
 assert.equal(cal.vix_futures.f1,null);assert.equal(cal.vix_futures.structure,null);
 assert.equal(officialMacroCalendar(new Date('2026-11-24T10:00:00Z')).events.length,0);
 assert.equal(officialMacroCalendar(new Date('2026-11-25T14:00:00Z')).events.some(e=>e.id==='E_PCE_OCT'),false);
 const e=buildMarketEvidence(fixture(),now);
 assert.ok(e.facts.macro_calendar.events.some(x=>x.id==='E_FOMC_DEC'));
 assert.ok(e.refs.some(x=>x.id==='E_FOMC_DEC'));
 assert.ok(!('f1' in e.facts.vix_futures));
 const stale=buildMarketEvidence(fixture(),new Date('2026-12-10T00:00:00Z'));
 assert.equal(stale.macro.status,'REVIEW_REQUIRED');
 assert.equal(stale.facts.macro_calendar.events.length,0);
 assert.ok(!stale.refs.some(x=>x.id.startsWith('E_')));
});

test('market evidence quality distinguishes receipt from trade day, partial flows and mixed global dates',()=>{
 const input=fixture();
 let q=buildMarketEvidence(input,now).facts.quality;
 assert.equal(q.domestic_quote_day,'UNVERIFIED');
 assert.equal(q.domestic_receipt,'OLD_OR_UNKNOWN_RECEIPT');
 assert.equal(q.breadth,'BOTH_MARKETS');
 assert.equal(q.flow_3_observations,'PARTIAL_OR_MISSING');
 assert.equal(q.us_core,'MIXED_OR_MISSING');
 assert.equal(q.domestic_trends,'SAME_DATED_OBSERVATIONS');
 assert.equal(q.candidates,'ALIGNED');
 assert.equal(q.decision_basis,'CONDITIONAL_ONLY');
 input.trends.global.push(...['.SPX','.NDX'].map(symbol=>({name:symbol,symbol,summary:{day,close:100,change_pct:1}})));
 q=buildMarketEvidence(input,now).facts.quality;
 assert.equal(q.us_core,'SAME_DATED_OBSERVATIONS');
 assert.equal(q.us_core_day,day);
 input.trends.global.at(-1).summary.day='2026-11-23';
 assert.equal(buildMarketEvidence(input,now).facts.quality.us_core,'MIXED_OR_MISSING');
 input.trends.global.at(-1).summary.day='2026-11-26';
 assert.equal(buildMarketEvidence(input,now).facts.quality.us_core,'MIXED_OR_MISSING');
 input.rotation.receipt_day='2026-11-25';
 assert.equal(buildMarketEvidence(input,now).facts.quality.domestic_receipt,'TODAY_RECEIPT_ONLY');
 assert.equal(buildMarketEvidence(input,now).facts.quality.domestic_quote_day,'UNVERIFIED');
});

test('duplicate flow dates do not satisfy three-observation evidence quality',()=>{
 const input=fixture();
 for(const m of input.rotation.markets)m.flows=[{day,foreign:'BUY',institution:'BUY'},{day,foreign:'BUY',institution:'BUY'},{day:'2026-11-23',foreign:'BUY',institution:'BUY'}];
 assert.equal(buildMarketEvidence(input,now).facts.quality.flow_3_observations,'PARTIAL_OR_MISSING');
 for(const m of input.rotation.markets)m.flows[1]={day:'2026-11-20',foreign:'BUY',institution:'BUY'};
 assert.equal(buildMarketEvidence(input,now).facts.quality.flow_3_observations,'BOTH_MARKETS');
});

test('count-audited KRX breadth uses matched positive closes, rejects mismatched audit and reads only',async()=>{
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE blue_eod_ingest_audit_v1(trade_day TEXT PRIMARY KEY,row_count INTEGER,source TEXT,day_sha256 TEXT); CREATE TABLE blue_eod_daily_v1(trade_day TEXT,code TEXT,market TEXT,close INTEGER,PRIMARY KEY(trade_day,code));');
 const prior='2026-11-23';
 for(const d of [prior,day])db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES(?,?,?,?)').run(d,1700,'KRX_TEST',proof);
 const insert=db.prepare('INSERT INTO blue_eod_daily_v1 VALUES(?,?,?,?)');
 db.exec('BEGIN');
 for(let i=0;i<1700;i++){
  const code=String(i).padStart(6,'0'),market=i<850?'KOSPI':'KOSDAQ';
  insert.run(prior,code,market,100);
  insert.run(day,code,market,i%2===0?110:90);
 }
 db.exec('COMMIT');
 // Replace one prior symbol: current still has 1700 rows, but one is unmatched.
 db.prepare('UPDATE blue_eod_daily_v1 SET code=? WHERE trade_day=? AND code=?').run('999999',prior,'000000');
 const factory=()=>({async execute(q){assert.match(q.sql,/^WITH recent AS/);return {rows:db.prepare(q.sql).all(...q.args)};},close(){}});
 const env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'dummy'};
 try{
  const result=await readMarketEodBreadth(env,{factory,now});
  assert.equal(result.status,'COUNT_AUDITED_EOD');
  assert.equal(result.day,day);assert.equal(result.prior_day,prior);
  const kospi=result.markets.find(m=>m.market==='KOSPI');
  assert.deepEqual(kospi,{market:'KOSPI',universe:850,matched:849,up:424,down:425,flat:0,unmatched:1});
  const e=buildMarketEvidence({...fixture(),eodBreadth:result},now);
  assert.equal(e.facts.quality.eod_breadth,'COUNT_AUDITED_EOD');
  assert.equal(e.facts.quality.domestic_quote_day,'UNVERIFIED');
  assert.ok(e.refs.some(r=>r.id==='B_KOSPI'));
  assert.equal(e.facts.eod_breadth.find(m=>m.market==='KOSPI').up_pct,49.94);
  assert.ok(!marketPrompt(e.facts).includes('999999'));
  db.prepare('UPDATE blue_eod_ingest_audit_v1 SET row_count=1701 WHERE trade_day=?').run(day);
  assert.equal((await readMarketEodBreadth(env,{factory,now})).status,'UNAVAILABLE');
  db.prepare('UPDATE blue_eod_ingest_audit_v1 SET row_count=1700 WHERE trade_day=?').run(day);
  db.prepare('UPDATE blue_eod_daily_v1 SET close=0 WHERE trade_day=? AND code=?').run(prior,'000001');
  assert.equal((await readMarketEodBreadth(env,{factory,now})).status,'UNAVAILABLE');
 }finally{db.close();}
});

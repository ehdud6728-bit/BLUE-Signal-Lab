import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditAiPatternHorizons,SHORT_HORIZONS,LONG_HORIZONS} from './ai-pattern-horizons-audit.mjs';

const NOW=new Date('2026-11-20T01:00:00Z');
const dayFrom=i=>new Date(Date.parse('2026-11-19T00:00:00Z')-i*86400000)
  .toISOString().slice(0,10);
function marketDays(n){const days=[];for(let i=0;days.length<n;i++){
  const d=dayFrom(i),weekday=new Date(d+'T00:00:00Z').getUTCDay();
  if(weekday!==0&&weekday!==6)days.push(d);
}return days;}
function mock({days=marketDays(22),researchDays=days,indicatorDays=[],
  eodActual=1700,researchActual=2,indicatorActual=1700,
  available=['eod','research'],eodExpected=1700}={}){
  const lookup={eod:['blue_eod_ingest_audit_v1','blue_eod_daily_v1'],
    research:['blue_research_signal_audit_v1','blue_research_signals_v1'],
    indicators:['blue_indicators_audit_v1','blue_indicators_daily_v1']};
  const calls=[];
  const client={async execute(query){
    const sql=typeof query==='string'?query:query.sql,args=typeof query==='string'?[]:query.args;
    calls.push({sql,args});assert.match(sql,/^SELECT\b/);
    assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|REPLACE|ALTER)\b/i);
    if(sql.includes('FROM sqlite_master'))return {rows:available.flatMap(k=>lookup[k].map(name=>({name})))};
    if(sql.includes('FROM blue_eod_ingest_audit_v1'))return {rows:days.map(trade_day=>
      ({trade_day,row_count:String(eodExpected)}))};
    if(sql.includes('FROM blue_research_signal_audit_v1'))return {rows:researchDays.map(trade_day=>
      ({trade_day,row_count:'2',observed_stocks:'1700'}))};
    if(sql.includes('FROM blue_indicators_audit_v1'))return {rows:indicatorDays.map(trade_day=>
      ({trade_day,row_count:'1700'}))};
    if(sql.includes('FROM blue_eod_daily_v1'))return {rows:args.map(trade_day=>
      ({trade_day,actual:String(eodActual)}))};
    if(sql.includes('FROM blue_research_signals_v1'))return {rows:args.map(trade_day=>
      ({trade_day,actual:String(researchActual)}))};
    if(sql.includes('FROM blue_indicators_daily_v1'))return {rows:args.map(trade_day=>
      ({trade_day,actual:String(indicatorActual)}))};
    throw Error('UNEXPECTED_SQL');
  }};
  return {client,calls};
}

test('plan does no SQL and names independent short and long horizons',async()=>{
  const report=await auditAiPatternHorizons(null,{mode:'plan',now:NOW});
  assert.equal(report.turso_sql_queries,0);
  assert.deepEqual(report.short_horizons,[5,10,20,60]);
  assert.deepEqual(report.long_horizons,[120,250,500]);
  assert.deepEqual([...SHORT_HORIZONS,...LONG_HORIZONS],[5,10,20,60,120,250,500]);
  assert.equal(report.d1_sql_queries,0);
});

test('short window works as a data count while long remains incomplete and no recommendation is made',async()=>{
  const {client,calls}=mock(),r=await auditAiPatternHorizons(client,{mode:'audit',now:NOW});
  assert.equal(r.status,'FURTHER_OUTCOME_VALIDATION_REQUIRED');
  assert.deepEqual(r.short_term.map(x=>x.ledger_count_filled),[true,true,true,false]);
  assert.deepEqual(r.long_term.map(x=>x.ledger_count_filled),[false,false,false]);
  assert.equal(r.short_term[0].research_dates_on_eod,5);
  assert.equal(r.short_term[2].research_dates_on_eod,20);
  assert.equal(r.eod.audited_days,22);
  assert.equal(r.research.audited_days,22);
  assert.equal(r.indicators.audited_days,0);
  assert.equal(r.sampled_last_eight.eod.length,8);
  assert.ok(r.sampled_last_eight.eod.every(x=>x.matched));
  assert.equal(r.research_without_eod,0);
  assert.equal(r.short_term[0].outcome_maturity_verified,false);
  assert.equal(r.d1_sql_queries,0);
  assert.equal(calls.length,5);
  assert.equal(r.turso_sql_queries,calls.length);
  assert.ok(calls.every(q=>!q.sql.includes('blue_kis_token')&&!q.sql.includes('FROM runs')));
  assert.ok(calls.some(q=>q.sql.includes('a.source_payload_sha256=s.source_payload_sha256')));
});

test('long 120-day horizon is counted independently of the short 20/60-day windows',async()=>{
  const days=marketDays(125),{client}=mock({days});
  const r=await auditAiPatternHorizons(client,{mode:'audit',now:NOW});
  assert.deepEqual(r.short_term.map(x=>x.ledger_count_filled),[true,true,true,true]);
  assert.deepEqual(r.long_term.map(x=>x.ledger_count_filled),[true,false,false]);
  assert.equal(r.long_term[0].research_dates_on_eod,120);
  assert.equal(r.long_term[0].session_continuity_verified,false);
});

test('missing weekday is only a candidate until exchange holidays are checked',async()=>{
  const days=['2026-11-19','2026-11-17','2026-11-16'];
  const {client}=mock({days});
  const r=await auditAiPatternHorizons(client,{mode:'audit',now:NOW});
  assert.equal(r.status,'SHORT_WINDOW_AUDIT_INSUFFICIENT');
  assert.deepEqual(r.possible_missing_weekdays.first_20,['2026-11-18']);
  assert.match(r.possible_missing_weekdays.note,/휴장일/);
});

test('mismatched actual rows or a missing data table never counts as verified history',async()=>{
  const mismatch=mock({eodActual:1699});
  assert.equal((await auditAiPatternHorizons(mismatch.client,{mode:'audit',now:NOW})).status,
    'SAMPLED_READBACK_MISMATCH');
  const absent=mock({available:['research']});
  assert.equal((await auditAiPatternHorizons(absent.client,{mode:'audit',now:NOW})).status,
    'NO_EOD_AUDIT');
});

test('indicators are optional but checked by immutable full-market counts when present',async()=>{
  const days=marketDays(22),{client,calls}=mock({days,indicatorDays:days,
    available:['eod','research','indicators']});
  const r=await auditAiPatternHorizons(client,{mode:'audit',now:NOW});
  assert.equal(r.indicators.audited_days,22);
  assert.ok(r.sampled_last_eight.indicators.every(x=>x.actual===1700&&x.matched));
  assert.equal(calls.length,7);
  assert.equal(calls.filter(x=>x.sql.includes('a.source_payload_sha256=s.source_payload_sha256')).length,2);
});

test('invalid, out-of-order, future or oversized audited ranges fail closed',async()=>{
  for(const days of [['2026-11-19','2026-11-19'],['2026-11-23'],
    ['2026-11-19','2026-11-20'],['2026-13-01']]){
    const {client}=mock({days});
    await assert.rejects(()=>auditAiPatternHorizons(client,{mode:'audit',now:NOW}),
      /AI_HORIZON_AUDIT_/);
  }
  await assert.rejects(()=>auditAiPatternHorizons(null,{mode:'apply',now:NOW}),
    /AI_HORIZON_AUDIT_INVALID_MODE/);
});

test('manual workflow has no DB write, deployment, D1, or KIS token path',()=>{
  const path=new URL('../../.github/workflows/blue_turso_ai_pattern_horizons_audit.yml',import.meta.url);
  const yaml=readFileSync(path,'utf8');
  assert.match(yaml,/workflow_dispatch:/);
  assert.match(yaml,/default: plan/);
  assert.match(yaml,/options: \[plan, audit\]/);
  assert.match(yaml,/github\.event_name == 'pull_request' \|\| github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(yaml,/CLOUDFLARE_API_TOKEN|wrangler deploy|wrangler d1|tokenP|mode=apply/i);
});

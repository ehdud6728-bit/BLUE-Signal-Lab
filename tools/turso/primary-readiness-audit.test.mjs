import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditTursoPrimary,D1_ONLY_DOMAINS} from './primary-readiness-audit.mjs';

const NOW=new Date('2026-11-19T05:00:00Z');
function mock({eod=[{trade_day:'2026-11-18',expected:'2500',actual:'2500'}],
  research=[{trade_day:'2026-11-18',expected:'189',actual:'189'}],
  quotes=[{trade_day:'2026-11-19',n:'4'}]}={}){
  const queries=[];
  const client={async execute(q){
    queries.push(q);
    if(q.sql.includes('FROM blue_eod_ingest_audit_v1 a WHERE'))return {rows:eod};
    if(q.sql.includes('FROM blue_research_signal_audit_v1 a'))return {rows:research};
    if(q.sql.includes('FROM blue_kis_live_quotes_r141 WHERE'))return {rows:quotes};
    throw Error('UNEXPECTED_QUERY');
  }};
  return {client,queries};
}

test('plan mode proves no Turso or D1 SQL is needed for dependency inventory',async()=>{
  const report=await auditTursoPrimary(null,{mode:'plan',now:NOW});
  assert.equal(report.status,'PLAN_ONLY');
  assert.equal(report.turso_sql_queries,0);assert.equal(report.d1_sql_queries,0);
  assert.equal(report.d1_history_verified,false);
  assert.ok(D1_ONLY_DOMAINS.some(d=>d.tables.includes('chart_snapshots')));
  assert.ok(D1_ONLY_DOMAINS.some(d=>d.tables.includes('blue_basket_watch_r153')));
});

test('recent Turso counts compare audited EOD and research without reading D1',async()=>{
  const {client,queries}=mock();
  const report=await auditTursoPrimary(client,{mode:'turso_recent',now:NOW});
  assert.equal(report.status,'RECENT_TURSO_COUNTS_MATCH');
  assert.deepEqual(report.eod_days,[{day:'2026-11-18',expected:2500,actual:2500,matched:true}]);
  assert.deepEqual(report.research_days,[{day:'2026-11-18',expected:189,actual:189,matched:true}]);
  assert.deepEqual(report.quote_days,[{day:'2026-11-19',symbols:4}]);
  assert.equal(queries.length,3);assert.equal(report.d1_sql_queries,0);
  assert.equal(report.full_history_migrated,false);
  assert.equal(report.all_app_features_turso_independent,false);
  assert.equal(report.latest_eod_age_days,1);
  for(const q of queries){
    assert.match(q.sql,/^SELECT /);
    assert.doesNotMatch(q.sql,/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE)\b/i);
    assert.ok(q.args.length<=3);
    assert.ok(q.args.at(-1)<=8);
  }
});

test('incomplete audited research and EOD are explicitly not migration-ready',async()=>{
  const variants=[
    {eod:[{trade_day:'2026-11-18',expected:2500,actual:2499}]},
    {research:[{trade_day:'2026-11-18',expected:189,actual:188}]}
  ];
  for(const variant of variants){
    const {client}=mock(variant);
    const report=await auditTursoPrimary(client,{mode:'turso_recent',now:NOW});
    assert.equal(report.status,'AUDIT_COUNT_MISMATCH');
  }
  const {client}=mock({eod:[]});
  assert.equal((await auditTursoPrimary(client,{mode:'turso_recent',now:NOW})).status,'NO_VERIFIED_EOD');
  const noResearch=mock({research:[]});
  assert.equal((await auditTursoPrimary(noResearch.client,{mode:'turso_recent',now:NOW})).status,'NO_VERIFIED_RESEARCH');
  const stale=mock({eod:[{trade_day:'2026-11-01',expected:2500,actual:2500}],
    research:[{trade_day:'2026-11-01',expected:189,actual:189}]});
  assert.equal((await auditTursoPrimary(stale.client,{mode:'turso_recent',now:NOW})).status,'STALE_VERIFIED_DAYS');
});

test('malformed and excessive rows fail closed; never infer D1 parity',async()=>{
  for(const variant of [
    {eod:[{trade_day:'2026-11-20',expected:2500,actual:2500}]},
    {eod:[{trade_day:'2026-11-18',expected:-1,actual:2500}]},
    {quotes:[{trade_day:'2026-11-19',n:'not-a-count'}]},
    {research:Array.from({length:9},()=>({trade_day:'2026-11-18',expected:189,actual:189}))}
  ]){
    const {client}=mock(variant);
    await assert.rejects(()=>auditTursoPrimary(client,{mode:'turso_recent',now:NOW}),/TURSO_AUDIT_/);
  }
  await assert.rejects(()=>auditTursoPrimary(null,{mode:'d1_full_scan',now:NOW}),/TURSO_AUDIT_BAD_MODE/);
});

test('manual audit workflow cannot query D1, issue tokenP, or deploy Workers',()=>{
  const path=new URL('../../.github/workflows/blue_turso_primary_readiness.yml',import.meta.url);
  const source=readFileSync(path,'utf8');
  assert.match(source,/workflow_dispatch:/);
  assert.match(source,/default: plan/);
  assert.match(source,/options: \[plan, turso_recent\]/);
  assert.doesNotMatch(source,/CLOUDFLARE_API_TOKEN|wrangler d1|tokenP|wrangler deploy/);
});

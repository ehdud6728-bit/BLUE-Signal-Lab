import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createClient} from '@libsql/client';
import {importV2Replay} from './research-v2-signal-import.mjs';

const DAY='2026-11-10';
const HASH='e'.repeat(64);
const sha=x=>createHash('sha256').update(x).digest('hex');
const SOURCE='KRX_PYKRX_EXACT_DAY_VERIFIED';
const CONFIRM='blue-research-v2-four-day-replay';
function example(){
  const row={trade_day:DAY,code:'086520',run_id:'blue_market_20261110',
    signal_names:'RSI_GC',close_price:123,supply_distance_pct:null,
    extras:{},stats:{},chart:{version:'R10_CHART_V1',asof:DAY,
      bars:[{t:DAY,c:123}]}};
  const payload=Buffer.from(JSON.stringify(row)+'\n');
  const manifest={format:'BLUE_TURSO_SIGNAL_SNAPSHOT_V1',day:DAY,run_id:row.run_id,
    observed_stocks:2662,matched_stocks:1,signal_events:1,source:SOURCE,
    payload_sha256:sha(payload),source_audit_sha256:HASH,
    signals_csv_sha256:HASH,chart_snapshots_sha256:HASH};
  const proof={format:'BLUE_RESEARCH_REPLAY_V2_PROOF_V1',day:DAY,
    verified_eod_source:SOURCE,eod_day_sha256:HASH,eod_row_count:2662,
    research_payload_sha256:sha(payload),research_source_audit_sha256:HASH,
    source_marcap_sha256_2025:HASH,source_marcap_sha256_2026:HASH,
    history_50_coverage_sha256:HASH,all_50_histories_ready:true,
    v1_original_unchanged:true,source:'IMMUTABLE_KRX_EOD_HASH_MATCH_RESCAN'};
  return {manifest,payload,proof};
}
async function seeded(){
  const db=createClient({url:'file::memory:'});
  await db.execute(`CREATE TABLE blue_eod_ingest_audit_v1
    (trade_day TEXT,row_count INTEGER,source TEXT,day_sha256 TEXT)`);
  await db.execute(`CREATE TABLE blue_research_signal_audit_v1
    (trade_day TEXT,observed_stocks INTEGER)`);
  await db.execute(`CREATE TABLE blue_eod_daily_v1
    (trade_day TEXT,code TEXT,close INTEGER)`);
  await db.execute(`CREATE TABLE blue_research_signals_v1 (trade_day TEXT,code TEXT)`);
  await db.execute({sql:'INSERT INTO blue_eod_ingest_audit_v1 VALUES(?,?,?,?)',
    args:[DAY,2662,SOURCE,HASH]});
  await db.execute({sql:'INSERT INTO blue_research_signal_audit_v1 VALUES(?,?)',
    args:[DAY,2612]});
  await db.execute({sql:'INSERT INTO blue_eod_daily_v1 VALUES(?,?,?)',args:[DAY,'086520',123]});
  await db.execute({sql:'INSERT INTO blue_research_signals_v1 VALUES(?,?)',args:[DAY,'OLD001']});
  return {db,clientFactory:()=>({execute:q=>db.execute(q),close(){}})};
}

test('dry_run makes zero DB queries and requires genuine v2 proof',async()=>{
  const data=example();
  const r=await importV2Replay(data);
  assert.equal(r.status,'DRY_RUN');
  assert.equal(r.queries,0);
  assert.equal(r.written,0);
  await assert.rejects(importV2Replay({...data,proof:{...data.proof,eod_row_count:2612}}),
    /BAD_RESEARCH_PROOF/);
});
test('check selects audited EOD without any writer table creation',async()=>{
  const {db,clientFactory}=await seeded();
  try{
    const r=await importV2Replay({...example(),mode:'check',env:{
      TURSO_DATABASE_URL:'libsql://example',TURSO_AUTH_TOKEN:'unused'},clientFactory});
    assert.equal(r.status,'CHECKED_READ_ONLY');
    const tables=await db.execute(`SELECT name FROM sqlite_master WHERE name LIKE '%_v2'`);
    assert.equal(tables.rows.length,0);
  }finally{db.close();}
});
test('explicit guarded apply writes only versioned tables, repeat is idempotent',async()=>{
  const {db,clientFactory}=await seeded();
  const opts={...example(),mode:'apply',clientFactory,env:{
    TURSO_DATABASE_URL:'libsql://example',TURSO_AUTH_TOKEN:'unused',V2_REPLAY_APPLY_CONFIRM:CONFIRM}};
  try{
    await assert.rejects(importV2Replay({...opts,env:{...opts.env,V2_REPLAY_APPLY_CONFIRM:''}}),
      /APPLY_NOT_AUTHORIZED/);
    assert.equal((await importV2Replay(opts)).written,1);
    assert.equal((await importV2Replay(opts)).written,0);
    const v2=await db.execute('SELECT * FROM blue_research_signal_audit_v2');
    assert.equal(v2.rows.length,1);
    assert.equal(Number(v2.rows[0].observed_stocks),2662);
    const old=await db.execute('SELECT code FROM blue_research_signals_v1');
    assert.deepEqual(old.rows.map(r=>r.code),['OLD001']);
    await assert.rejects(importV2Replay({...opts,proof:{...opts.proof,
      source_marcap_sha256_2026:'f'.repeat(64)}}),/EXISTING_AUDIT_CONFLICT/);
  }finally{db.close();}
});
test('source EOD drift fails before creating v2 tables',async()=>{
  const {db,clientFactory}=await seeded();
  try{
    await db.execute({sql:'UPDATE blue_eod_daily_v1 SET close=?',args:[999]});
    await assert.rejects(importV2Replay({...example(),mode:'check',
      env:{TURSO_DATABASE_URL:'libsql://example',TURSO_AUTH_TOKEN:'unused'},clientFactory}),
      /SIGNAL_KRX_PRICE_MISMATCH/);
  }finally{db.close();}
});

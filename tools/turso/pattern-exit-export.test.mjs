import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {exportPatternExitSource} from './pattern-exit-export.mjs';

function fixture({missing=false,badHash=false}={}){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE blue_eod_ingest_audit_v1 (
    trade_day TEXT,row_count INTEGER,source TEXT,day_sha256 TEXT);
    CREATE TABLE blue_eod_daily_v1 (
    trade_day TEXT,code TEXT,open INTEGER,high INTEGER,low INTEGER,close INTEGER);
    CREATE TABLE blue_research_signal_audit_v1 (
    trade_day TEXT,row_count INTEGER,observed_stocks INTEGER,
    signal_events INTEGER,source_payload_sha256 TEXT);
    CREATE TABLE blue_research_signals_v1 (
    trade_day TEXT,code TEXT,signal_names TEXT,source_payload_sha256 TEXT);`);
  const rows=db.prepare('INSERT INTO blue_eod_daily_v1 VALUES (?,?,?,?,?,?)');
  const audit=db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES (?,?,?,?)');
  const researchAudit=db.prepare('INSERT INTO blue_research_signal_audit_v1 VALUES (?,?,?,?,?)');
  const signal=db.prepare('INSERT INTO blue_research_signals_v1 VALUES (?,?,?,?)');
  for(const [idx,day] of ['2026-11-18','2026-11-19'].entries()){
    audit.run(day,1700,'KRX_PYKRX_EXACT_DAY_VERIFIED','a'.repeat(64));
    researchAudit.run(day,1,1700,1,'b'.repeat(64));
    signal.run(day,idx?'000002':'000001','BB20',badHash?'c'.repeat(64):'b'.repeat(64));
    for(let i=1;i<=1700-(missing&&idx?1:0);i++){
      rows.run(day,String(i).padStart(6,'0'),100,104,98,101);
    }
  }
  const calls=[];
  return {client:{async execute(cmd){const sql=typeof cmd==='string'?cmd:cmd.sql;
    const args=typeof cmd==='string'?[]:cmd.args;
    calls.push(sql);
    assert.match(sql.trim(),/^SELECT\b/i);
    return {rows:db.prepare(sql).all(...args)};
  }},calls,close(){db.close();}};
}

test('plan makes no SQL calls or external writes',async()=>{
  assert.deepEqual(await exportPatternExitSource(null,{mode:'plan',sessions:500}),{
    status:'PLAN_ONLY',storage:'TURSO',turso_sql_queries:0,d1_sql_queries:0,
    requested_sessions:500});
});

test('audited EOD, hashes and matched signal rows make a bounded read-only study source',async()=>{
  const db=fixture();
  const x=await exportPatternExitSource(db.client,{mode:'study',sessions:5});
  assert.equal(x.format,'BLUE_TURSO_EXIT_SOURCE_V1');
  assert.equal(x.eod_days.length,2);
  assert.equal(x.signals.length,2);
  assert.equal(x.bars.length,4);
  assert.equal(x.audits_readback_verified,true);
  assert.equal(x.trading_calendar_verified,false);
  assert.equal(x.corporate_actions_verified,false);
  assert.ok(db.calls.length>=4);
  assert.ok(db.calls.every(sql=>!sql.includes('UPDATE ')&&!sql.includes('DELETE ')));
  db.close();
});

test('row count mismatches and mismatching research source hash refuse to export',async()=>{
  for(const options of [{missing:true},{badHash:true}]){
    const db=fixture(options);
    await assert.rejects(()=>exportPatternExitSource(db.client,{mode:'study',sessions:5}),
      /EXIT_EXPORT_(?:INCOMPLETE_EOD|UNVERIFIED_SIGNAL)/);
    db.close();
  }
});

test('rejects unsupported windows without opening a database',async()=>{
  await assert.rejects(()=>exportPatternExitSource(null,{sessions:100,mode:'study'}),
    /INVALID_EXIT_EXPORT_MODE/);
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {exportPatternExitSource} from './pattern-exit-export.mjs';

function fixture({missing=false,badHash=false,researchMismatch=false,marketJump=false}={}){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE blue_eod_ingest_audit_v1 (
    trade_day TEXT,row_count INTEGER,source TEXT,day_sha256 TEXT);
    CREATE TABLE blue_eod_daily_v1 (
    trade_day TEXT,code TEXT,market TEXT,name TEXT,open INTEGER,high INTEGER,low INTEGER,close INTEGER,amount INTEGER);
    CREATE TABLE blue_research_signal_audit_v1 (
    trade_day TEXT,row_count INTEGER,observed_stocks INTEGER,
    signal_events INTEGER,source_payload_sha256 TEXT);
    CREATE TABLE blue_research_signals_v1 (
    trade_day TEXT,code TEXT,signal_names TEXT,source_payload_sha256 TEXT);`);
  const rows=db.prepare('INSERT INTO blue_eod_daily_v1 VALUES (?,?,?,?,?,?,?,?,?)');
  const audit=db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES (?,?,?,?)');
  const researchAudit=db.prepare('INSERT INTO blue_research_signal_audit_v1 VALUES (?,?,?,?,?)');
  const signal=db.prepare('INSERT INTO blue_research_signals_v1 VALUES (?,?,?,?)');
  for(const [idx,day] of ['2026-11-18','2026-11-19'].entries()){
    audit.run(day,1700,'KRX_PYKRX_EXACT_DAY_VERIFIED','a'.repeat(64));
    researchAudit.run(day,1,researchMismatch&&idx?1800:1700,1,'b'.repeat(64));
    signal.run(day,idx?'000002':'000001','BB20',badHash?'c'.repeat(64):'b'.repeat(64));
    for(let i=1;i<=1700-(missing&&idx?1:0);i++){
      rows.run(day,String(i).padStart(6,'0'),i%2?'KOSPI':'KOSDAQ',`테스트종목${i}`,
        100,104,98,marketJump&&idx?102:101,1000000);
    }
  }
  const calls=[];
  return {client:{async execute(cmd){const sql=typeof cmd==='string'?cmd:cmd.sql;
    const args=typeof cmd==='string'?[]:cmd.args;
    calls.push(sql);
    assert.match(sql.trim(),/^(?:SELECT|WITH)\b/i);
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
  assert.equal(x.bars[0].market,'KOSPI');
  assert.equal(x.bars[0].amount,1000000);
  assert.deepEqual(x.signals.map(s=>s.stock_name_at_signal),['테스트종목1','테스트종목2']);
  assert.equal(x.market_breadth_by_day.length,6);
  const second=x.market_breadth_by_day.find(x=>x.day==='2026-11-19'&&x.scope==='ALL');
  assert.deepEqual({universe:second.universe,matched1:second.matched1,
    up1:second.up1,down1:second.down1,matched5:second.matched5},
    {universe:1700,matched1:1700,up1:0,down1:0,matched5:0});
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

test('whole-market and exchange breadth distinguish rising from flat audited closes',async()=>{
  const db=fixture({marketJump:true});
  const x=await exportPatternExitSource(db.client,{mode:'study',sessions:5});
  const get=scope=>x.market_breadth_by_day.find(r=>
    r.day==='2026-11-19'&&r.scope===scope);
  assert.deepEqual([get('ALL').up1,get('ALL').down1,get('ALL').matched1],
    [1700,0,1700]);
  assert.equal(get('KOSPI').up1,850);
  assert.equal(get('KOSDAQ').up1,850);
  assert.equal(get('ALL').matched5,0); // no fabricated five-day history
  assert.ok(db.calls.every(sql=>sql.trim().startsWith('SELECT')||
    sql.trim().startsWith('WITH')));
  db.close();
});

test('excludes historical partial-universe signal days, while retaining their verified future KRX bars',async()=>{
  const db=fixture({researchMismatch:true});
  const x=await exportPatternExitSource(db.client,{mode:'study',sessions:5});
  assert.deepEqual(x.research_excluded_days,[{
    day:'2026-11-19',reason:'RESEARCH_UNIVERSE_EOD_COUNT_MISMATCH',
    observed_stocks:1800,eod_stocks:1700,
  }]);
  assert.equal(x.research_audited_days,1);
  assert.deepEqual(x.signals.map(s=>s.day),['2026-11-18']);
  assert.equal(x.eod_days.length,2);
  assert.equal(x.bars.length,2); // November 19 remains an EOD observation for November 18 signals.
  assert.ok(db.calls.every(sql=>sql.trim().startsWith('SELECT')||
    sql.trim().startsWith('WITH')));
  db.close();
});

test('rejects unsupported windows without opening a database',async()=>{
  await assert.rejects(()=>exportPatternExitSource(null,{sessions:100,mode:'study'}),
    /INVALID_EXIT_EXPORT_MODE/);
});

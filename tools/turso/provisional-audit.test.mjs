import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@libsql/client';
import {auditDay,auditProvisional,auditLine} from './provisional-audit.mjs';

const DAY='2026-11-19';
const NOW=new Date('2026-11-20T01:00:00.000Z');
const KIS_DAILY='KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL';

async function fixture(){
  const db=createClient({url:'file::memory:'});
  await db.execute(`CREATE TABLE blue_kis_provisional_daily_v1 (
    trade_day TEXT NOT NULL,code TEXT NOT NULL,market TEXT NOT NULL,name TEXT,
    open INTEGER,high INTEGER,low INTEGER,close INTEGER,volume INTEGER,
    reference_day TEXT,observed_at_utc TEXT,date_basis TEXT,source TEXT,
    PRIMARY KEY(trade_day,code))`);
  await db.execute(`CREATE TABLE blue_kis_live_quotes_r141 (
    trade_date TEXT,market TEXT,code TEXT,received_at_utc TEXT,payload_json TEXT,
    PRIMARY KEY(trade_date,market,code))`);
  await db.execute('CREATE TABLE blue_eod_ingest_audit_v1 (trade_day TEXT, row_count INTEGER)');
  await db.execute('CREATE TABLE blue_eod_daily_v1 (trade_day TEXT, code TEXT)');
  return db;
}

async function insertDaily(db,{code='005930',open=100,high=110,low=90,close=105,
  volume=1000,reference='2026-11-18',observed='2026-11-19T11:44:12.000Z',
  source=KIS_DAILY,dateBasis='KIS_REPORTED_TRADE_DATE',reported='20261119',
  payload=true}={}){
  await db.execute({sql:`INSERT INTO blue_kis_provisional_daily_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args:[DAY,code,'J','PRIVATE_NAME',open,high,low,close,volume,reference,observed,dateBasis,source]});
  if(payload){
    await db.execute({sql:'INSERT INTO blue_kis_live_quotes_r141 VALUES(?,?,?,?,?)',
      args:[DAY,'J',code,observed,JSON.stringify({source:'KIS_REST_INQUIRE_DAILY_PRICE',
        reported_trade_date:reported,trade_date_kst:DAY,received_at_utc:observed,
        phase:'KRX_POST_CLOSE',provisional_status:'IN_PROGRESS',
        provisional_date_basis:dateBasis,is_confirmed_daily:false})]});
  }
}

test('validates the day and rejects unbounded historical or future scans',()=>{
  assert.equal(auditDay('2026-11-19',NOW),DAY);
  assert.equal(auditDay('',NOW),'2026-11-20');
  for(const value of ['2026-11-31','2026-11-21','2026-11-10','2026-11-19 OR 1=1'])
    assert.throws(()=>auditDay(value,NOW));
});

test('audits an exact KIS post-close day using SELECT queries only',async()=>{
  const db=await fixture();const queries=[];
  try{
    await insertDaily(db);
    const readonly={execute:async query=>{
      const sql=typeof query==='string'?query:query.sql;
      queries.push(sql);
      assert.match(sql,/^SELECT\b/);
      const args=typeof query==='string'?[]:query.args;
      if(args?.length&&sql.includes('trade_day=?'))assert.ok(args.includes(DAY));
      return db.execute(query);
    }};
    const report=await auditProvisional(readonly,DAY);
    assert.equal(report.status,'OBSERVED_KIS_DATE_EVIDENCE');
    assert.equal(report.rows,1);
    assert.equal(report.daily_rows,1);
    assert.equal(report.latest_evidence_checked,1);
    assert.equal(report.latest_evidence_valid,1);
    assert.equal(report.newest_observation_utc,'2026-11-19T11:44:12.000Z');
    assert.equal(report.eod_state,'NO_AUDIT');
    assert.equal(report.bad_ohlc,0);
    assert.ok(queries.length>=5);
    const line=auditLine(report);
    assert.ok(!line.includes('005930'));
    assert.ok(!line.includes('PRIVATE_NAME'));
    assert.ok(!line.includes('1000'));
  }finally{db.close();}
});

test('missing newer latest quote evidence is an explicit limitation, not a failed KIS date',async()=>{
  const db=await fixture();
  try{
    await insertDaily(db,{payload:false});
    const report=await auditProvisional(db,DAY);
    assert.equal(report.status,'PARTIAL_KIS_DATE_EVIDENCE');
    assert.equal(report.latest_evidence_unavailable,1);
    assert.equal(report.latest_evidence_invalid,0);
  }finally{db.close();}
});

test('flags original KIS date mismatch, impossible OHLC and negative volume',async()=>{
  const db=await fixture();
  try{
    await insertDaily(db,{reported:'20261118',open:120,high:110,volume:-1,
      observed:'2026-11-19T14:30:00.000Z'});
    const report=await auditProvisional(db,DAY);
    assert.equal(report.status,'INVALID_PROVISIONAL_ROWS');
    assert.equal(report.latest_evidence_invalid,1);
    assert.equal(report.bad_ohlc,1);
    assert.equal(report.bad_volume,1);
    assert.equal(report.outside_session,1);
  }finally{db.close();}
});

test('does not mistake an incomplete or unaudited KRX day for complete EOD',async()=>{
  const db=await fixture();
  try{
    await db.execute({sql:'INSERT INTO blue_eod_ingest_audit_v1 VALUES(?,?)',args:[DAY,1700]});
    let report=await auditProvisional(db,DAY);
    assert.equal(report.status,'NO_PROVISIONAL_ROWS');
    assert.equal(report.eod_state,'INCOMPLETE_EOD');
    assert.equal(report.eod_audit_expected,1700);
    assert.equal(report.eod_actual,0);
    await db.execute({sql:'UPDATE blue_eod_ingest_audit_v1 SET row_count=1'});
    report=await auditProvisional(db,DAY);
    assert.equal(report.eod_state,'UNVERIFIED_EOD_AUDIT');
  }finally{db.close();}
});

test('missing provisional table is reported and never created by the audit',async()=>{
  const db=createClient({url:'file::memory:'});
  try{
    const report=await auditProvisional(db,DAY);
    assert.equal(report.status,'PROVISIONAL_TABLE_MISSING');
    assert.equal(report.missing_tables,4);
    const tables=await db.execute("SELECT name FROM sqlite_master WHERE name LIKE 'blue_%'");
    assert.equal(tables.rows.length,0);
  }finally{db.close();}
});

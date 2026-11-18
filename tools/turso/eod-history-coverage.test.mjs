import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeEodHistory,inspectEodHistory} from './eod-history-coverage.mjs';

const HASH='a'.repeat(64);
const row=(day,n=2660)=>({trade_day:day,row_count:n,
  source:'KRX_PYKRX_EXACT_DAY_VERIFIED',day_sha256:HASH});

test('eight verified days have 217 sessions to go and a bounded previous window',()=>{
  const rows=['2026-11-18','2026-11-17','2026-11-16','2026-11-13',
    '2026-11-12','2026-11-11','2026-11-10','2026-11-09'].map(d=>row(d));
  const report=summarizeEodHistory(rows,2660,{asofKst:'2026-11-19'});
  assert.equal(report.additional_sessions_needed,217);
  assert.equal(report.history_count_sufficient,false);
  assert.equal(report.indicator_ready,false);
  assert.equal(report.unverified_weekday_candidate_count,0);
  assert.deepEqual(report.next_backfill_window_candidate,
    {start_day:'2026-10-28',end_day:'2026-11-06'});
});

test('an absent weekday is only an unverified candidate, not a proven market day',()=>{
  const report=summarizeEodHistory([row('2026-11-11'),row('2026-11-09')],2660);
  assert.deepEqual(report.unverified_weekday_candidates,['2026-11-10']);
  assert.match(report.notes[0],/holidays/);
});

test('225 audited sessions do not automatically enable unverified indicators',()=>{
  const rows=[];
  const cursor=new Date('2026-11-18T00:00:00Z');
  while(rows.length<225){
    if(cursor.getUTCDay()>0&&cursor.getUTCDay()<6)rows.push(row(cursor.toISOString().slice(0,10)));
    cursor.setUTCDate(cursor.getUTCDate()-1);
  }
  const report=summarizeEodHistory(rows,2660);
  assert.equal(report.history_count_sufficient,true);
  assert.equal(report.additional_sessions_needed,0);
  assert.equal(report.next_backfill_window_candidate,null);
  assert.equal(report.indicator_ready,false);
});

test('rejects duplicate, unsorted, invalid and incomplete audit records',()=>{
  assert.throws(()=>summarizeEodHistory([row('2026-11-09'),row('2026-11-09')],2660),/INVALID_EOD_AUDIT/);
  assert.throws(()=>summarizeEodHistory([row('2026-11-09'),row('2026-11-10')],2660),/INVALID_EOD_AUDIT/);
  assert.throws(()=>summarizeEodHistory([row('2026-11-32')],2660),/INVALID_AUDIT_DAY/);
  assert.throws(()=>summarizeEodHistory([row('2026-11-14')],2660),/INVALID_EOD_AUDIT/);
  assert.throws(()=>summarizeEodHistory([row('2026-11-09',100)],100),/INVALID_EOD_AUDIT/);
  assert.throws(()=>summarizeEodHistory([row('2026-11-09')],1234),/LATEST_EOD_ROW_COUNT_MISMATCH/);
});

test('read-only query checks latest actual candle count but never accesses D1',async()=>{
  const queries=[];
  const client={async execute(statement){
    queries.push(statement);
    if(typeof statement==='string')return {rows:[row('2026-11-18')]};
    return {rows:[{n:2660}]};
  }};
  const report=await inspectEodHistory(client,'2026-11-19');
  assert.equal(report.latest_day,'2026-11-18');
  assert.equal(queries.length,2);
  assert.ok(queries.every(q=>/SELECT/.test(typeof q==='string'?q:q.sql)));
  assert.deepEqual(queries[1].args,['2026-11-18']);
  const badClient={...client,async execute(q){
    return typeof q==='string'?{rows:[row('2026-11-18')]}:{rows:[{n:2600}]};
  }};
  await assert.rejects(inspectEodHistory(badClient,'2026-11-19'),/LATEST_EOD_ROW_COUNT_MISMATCH/);
});

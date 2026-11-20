import test from 'node:test';
import assert from 'node:assert/strict';
import {planMissingHistory,validateHistorySessions} from './missing-history-plan.mjs';

const A='a'.repeat(64),B='b'.repeat(64);
const calendar={format:'BLUE_KRX_DAY_PROOF_CANDIDATES_V1',source_proof:'PENDING_KRX_EXACT_DAY',
  start:'2026-11-09',end:'2026-11-13',
  sessions:['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13']};
function fixture({eod={},signals={},eodRows={},signalRows={},tables=true}={}){
  const statements=[];
  const names=tables?['blue_eod_ingest_audit_v1','blue_research_signal_audit_v1',
    'blue_eod_daily_v1','blue_research_signals_v1']:[];
  return {statements,client:{async execute(input){
    const sql=typeof input==='string'?input:input.sql;
    const args=typeof input==='string'?[]:input.args;
    statements.push({sql,args});
    if(sql.includes('sqlite_master'))return {rows:names.map(name=>({name}))};
    if(sql.includes('SELECT * FROM blue_eod_ingest_audit_v1'))return {rows:Object.entries(eod).map(
      ([trade_day,row])=>({trade_day,...row}))};
    if(sql.includes('SELECT * FROM blue_research_signal_audit_v1'))return {rows:Object.entries(signals).map(
      ([trade_day,row])=>({trade_day,...row}))};
    if(sql.includes('COUNT(*) AS count FROM blue_eod_daily_v1'))return {rows:[{count:eodRows[args[0]]||0}]};
    if(sql.includes('COUNT(*) AS count FROM blue_research_signals_v1'))return {rows:[{count:signalRows[args[0]]||0}]};
    throw Error('UNEXPECTED_SQL');
  }}};
}
const eodRow=n=>({row_count:n,day_sha256:A});
const signalRow=(n,observed)=>({row_count:n,observed_stocks:observed,
  source_payload_sha256:A,source_audit_sha256:B});

test('select oldest genuinely missing days; leave existing audits and conflicts untouched',async()=>{
  const mock=fixture({eod:{'2026-11-09':eodRow(2660),'2026-11-10':eodRow(2662),
    '2026-11-11':eodRow(2665)},signals:{'2026-11-09':signalRow(155,2660),
    '2026-11-10':signalRow(239,2600)},
    eodRows:{'2026-11-11':2665,'2026-11-13':2}});
  const plan=await planMissingHistory(mock.client,{calendar,batchSize:3});
  assert.deepEqual(plan.selected,[
    {day:'2026-11-11',eod:'already_audited',signals:'missing'},
    {day:'2026-11-12',eod:'missing',signals:'missing'},
  ]);
  assert.deepEqual(plan.blocked,[
    {day:'2026-11-10',reason:'EXISTING_AUDIT_INCONSISTENT'},
    {day:'2026-11-13',reason:'PARTIAL_OR_MISMATCHED_UNAUDITED_ROWS'},
  ]);
  assert.equal(plan.already_audited,1);
  assert.equal(plan.d1_sql_queries,0);
  assert.ok(mock.statements.every(s=>s.sql.startsWith('SELECT')));
});

test('batch limit avoids extra day reads; all audited days produce no selected writes',async()=>{
  const mock=fixture({eod:{'2026-11-09':eodRow(2660)},
    signals:{'2026-11-09':signalRow(155,2660)}});
  const plan=await planMissingHistory(mock.client,{calendar,batchSize:1});
  assert.deepEqual(plan.selected,[{day:'2026-11-10',eod:'missing',signals:'missing'}]);
  assert.equal(plan.remaining_possible,3);
  const counts=mock.statements.filter(s=>s.sql.includes('COUNT(*)'));
  assert.equal(counts.length,2);
});

test('lookahead lets later KRX-confirmed weekdays progress despite earlier unverified dates',async()=>{
  const mock=fixture();
  const plan=await planMissingHistory(mock.client,{calendar,batchSize:1,candidateLimit:5});
  assert.equal(plan.selected.length,5);
  assert.equal(plan.max_verified_days,1);
  assert.equal(plan.source_proof,'PENDING_KRX_EXACT_DAY');
  assert.ok(plan.selected.every(x=>x.eod==='missing'&&x.signals==='missing'));
});

test('days with existing un-audited signals are quarantined while the next date progresses',async()=>{
  const mock=fixture({signalRows:{'2026-11-09':1}});
  const plan=await planMissingHistory(mock.client,{calendar,batchSize:2});
  assert.deepEqual(plan.blocked,[{day:'2026-11-09',reason:'PARTIAL_OR_MISMATCHED_UNAUDITED_ROWS'}]);
  assert.deepEqual(plan.selected.map(x=>x.day),['2026-11-10','2026-11-11']);
});

test('missing underlying data table, invalid source sessions and unsafe batch fail closed',async()=>{
  assert.throws(()=>validateHistorySessions({...calendar,sessions:['2026-11-14']}),
    /MISSING_HISTORY_CALENDAR_INVALID/);
  assert.throws(()=>validateHistorySessions({...calendar,sessions:['2026-11-09','2026-11-09']}),
    /MISSING_HISTORY_CALENDAR_INVALID/);
  await assert.rejects(planMissingHistory(fixture().client,{calendar,batchSize:6}),
    /MISSING_HISTORY_ARGS_INVALID/);
  const mock=fixture();
  mock.client.execute=async()=>({rows:[{name:'blue_eod_ingest_audit_v1'}]});
  await assert.rejects(planMissingHistory(mock.client,{calendar}),
    /MISSING_HISTORY_AUDIT_DATA_TABLE_MISSING/);
});

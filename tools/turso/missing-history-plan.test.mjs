import test from 'node:test';
import assert from 'node:assert/strict';
import {planMissingHistory,validateHistorySessions} from './missing-history-plan.mjs';

const A='a'.repeat(64),B='b'.repeat(64);
const calendar={format:'BLUE_KRX_DAY_PROOF_CANDIDATES_V1',source_proof:'PENDING_KRX_EXACT_DAY',
  start:'2026-11-09',end:'2026-11-13',
  sessions:['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13']};
function fixture({eod={},signals={},eodRows={},signalRows={},kisRows={},
  tables=true,kisTable=false}={}){
  const statements=[];
  const names=tables?['blue_eod_ingest_audit_v1','blue_research_signal_audit_v1',
    'blue_eod_daily_v1','blue_research_signals_v1',
    ...(kisTable?['blue_kis_provisional_daily_v1']:[])]:[];
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
    if(sql.includes('FROM blue_kis_provisional_daily_v1'))return {rows:args
      .filter(day=>kisRows[day]).map(trade_day=>({trade_day,rows:kisRows[trade_day].rows,
        postclose_daily_rows:kisRows[trade_day].daily}))};
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
    {day:'2026-11-10',reason:'EXISTING_AUDIT_INCONSISTENT',
      details:['SIGNAL_OBSERVED_VS_EOD_COUNT_MISMATCH']},
    {day:'2026-11-13',reason:'PARTIAL_OR_MISMATCHED_UNAUDITED_ROWS',
      details:['EOD_ROWS_WITHOUT_AUDIT']},
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

test('explicit November priority range selects missing Nov 2-6 ahead of existing Nov 9-20',async()=>{
  const sessions=['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06',
    '2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13',
    '2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20'];
  const prior=sessions.slice(5);
  const mock=fixture({eod:Object.fromEntries(prior.map(d=>[d,eodRow(2662)])),
    signals:Object.fromEntries(prior.map(d=>[d,signalRow(100,2662)]))});
  const plan=await planMissingHistory(mock.client,{calendar:{...calendar,
    start:'2026-11-02',end:'2026-11-20',sessions},batchSize:5});
  assert.deepEqual(plan.selected.map(item=>item.day),sessions.slice(0,5));
  assert.ok(plan.selected.every(item=>item.eod==='missing'&&item.signals==='missing'));
  assert.equal(plan.already_audited,10);
  assert.ok(mock.statements.every(item=>item.sql.startsWith('SELECT')));
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
  assert.deepEqual(plan.blocked,[{day:'2026-11-09',reason:'PARTIAL_OR_MISMATCHED_UNAUDITED_ROWS',
    details:['SIGNAL_ROWS_WITHOUT_AUDIT']}]);
  assert.deepEqual(plan.selected.map(x=>x.day),['2026-11-10','2026-11-11']);
});

test('KIS-only historical date stays unconfirmed, even when KIS has postclose prices',async()=>{
  const mock=fixture({kisTable:true,kisRows:{'2026-11-09':{rows:10,daily:8}}});
  const plan=await planMissingHistory(mock.client,{calendar,batchSize:1});
  assert.deepEqual(plan.selected,[{day:'2026-11-09',eod:'missing',signals:'missing'}]);
  assert.deepEqual(plan.source_evidence,[{
    day:'2026-11-09',eod_audit:'MISSING',signal_audit:'MISSING',
    kis_provisional:'RECORDED_UNCONFIRMED',kis_rows:10,
    kis_postclose_daily_rows:8,price_state:'KIS_ONLY_NO_KRX_CONFIRMED_EOD',
  }]);
  assert.equal(plan.db_writes,0);
  assert.ok(mock.statements.every(s=>s.sql.startsWith('SELECT')));
});

test('invalid research audit reports exact mismatch and KIS evidence independently',async()=>{
  const mock=fixture({kisTable:true,
    eod:{'2026-11-10':eodRow(2662)},
    signals:{'2026-11-10':signalRow(239,2600)},
    kisRows:{'2026-11-10':{rows:15,daily:0}},
  });
  const plan=await planMissingHistory(mock.client,{calendar,batchSize:1});
  assert.deepEqual(plan.blocked,[{day:'2026-11-10',
    reason:'EXISTING_AUDIT_INCONSISTENT',
    details:['SIGNAL_OBSERVED_VS_EOD_COUNT_MISMATCH']}]);
  assert.deepEqual(plan.source_evidence.find(x=>x.day==='2026-11-10'),{
    day:'2026-11-10',eod_audit:'PRESENT',signal_audit:'PRESENT',
    kis_provisional:'RECORDED_UNCONFIRMED',kis_rows:15,
    kis_postclose_daily_rows:0,price_state:'KRX_EOD_AUDIT_PRESENT',
  });
  assert.equal(plan.selected.length,1);
});

test('missing KIS table means unknown historical KIS evidence, not a zero-collection claim',async()=>{
  const plan=await planMissingHistory(fixture().client,{calendar,batchSize:1});
  assert.equal(plan.source_evidence[0].kis_provisional,'TABLE_MISSING');
  assert.equal(plan.source_evidence[0].price_state,'NO_KRX_CONFIRMED_EOD');
});

test('invalid EOD audit does not become confirmed EOD when KIS exists',async()=>{
  const mock=fixture({kisTable:true,eod:{'2026-11-09':{row_count:100,day_sha256:'invalid'}},
    kisRows:{'2026-11-09':{rows:9,daily:9}}});
  const plan=await planMissingHistory(mock.client,{calendar,batchSize:1});
  assert.deepEqual(plan.blocked[0].details,['EOD_AUDIT_ROW_COUNT_INVALID','EOD_AUDIT_HASH_INVALID']);
  const evidence=plan.source_evidence.find(x=>x.day==='2026-11-09');
  assert.equal(evidence.price_state,'KRX_EOD_AUDIT_INVALID');
  assert.equal(evidence.kis_provisional,'RECORDED_UNCONFIRMED');
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

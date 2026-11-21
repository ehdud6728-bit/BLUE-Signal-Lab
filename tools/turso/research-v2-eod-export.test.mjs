import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {REPLAY_DAYS,reconstructAuditedDay,exportV2ReplaySource}
  from './research-v2-eod-export.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const source='KRX_PYKRX_EXACT_DAY_VERIFIED';
function rows(day){return Array.from({length:2662},(_,i)=>({
  trade_day:day,code:String(i+1).padStart(6,'0'),market:i<1000?'KOSPI':'KOSDAQ',
  name:'',open:'100',high:'110',low:'90',close:'101',volume:'500',amount:'50500',source,
}));}
function fixture(day){
  const values=rows(day),payload=Buffer.from(values.map(r=>JSON.stringify(r)+'\n').join(''));
  const audit={trade_day:day,row_count:'2662',source,day_sha256:sha(payload)};
  return {values,payload,audit};
}
test('plan accesses no DB and rejects unsupported modes',async()=>{
  assert.equal((await exportV2ReplaySource(null)).turso_queries,0);
  await assert.rejects(exportV2ReplaySource(null,{mode:'apply'}),/V2_REPLAY_BAD_MODE/);
});
test('rebuilds exact original day bytes and enforces original stored SHA',()=>{
  const {values,payload,audit}=fixture(REPLAY_DAYS[0]);
  const exported=reconstructAuditedDay(REPLAY_DAYS[0],audit,values);
  assert.equal(exported.payload.compare(payload),0);
  assert.equal(exported.manifest.data_sha256,audit.day_sha256);
  assert.equal(exported.manifest.total_rows,2662);
  assert.throws(()=>reconstructAuditedDay(REPLAY_DAYS[0],
    {...audit,day_sha256:'a'.repeat(64)},values),/ORIGINAL_KRX_HASH_MISMATCH/);
});
test('rejects altered prices, missing codes and wrong market provenance',()=>{
  const {values,audit}=fixture(REPLAY_DAYS[1]);
  assert.throws(()=>reconstructAuditedDay(REPLAY_DAYS[1],audit,values.slice(1)),/COUNT_MISMATCH/);
  const broken=values.map(r=>({...r}));broken[200].close='102';
  assert.throws(()=>reconstructAuditedDay(REPLAY_DAYS[1],audit,broken),/ORIGINAL_KRX_HASH_MISMATCH/);
  broken[200].source='KIS_PROVISIONAL';
  assert.throws(()=>reconstructAuditedDay(REPLAY_DAYS[1],audit,broken),/BAD_ROW/);
});
test('four days SELECT only, 50-gap proof and byte hash preserved',async()=>{
  const proofs=REPLAY_DAYS.map(day=>fixture(day));
  const queries=[];
  const client={async execute({sql,args}){
    queries.push(sql);assert.match(sql,/^SELECT/);
    assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|CREATE)\b/);
    if(sql.includes('FROM blue_eod_ingest_audit_v1')){
      assert.deepEqual(args,REPLAY_DAYS);return {rows:proofs.map(x=>x.audit)};
    }
    if(sql.includes('FROM blue_research_signal_audit_v1')){
      assert.deepEqual(args,REPLAY_DAYS);return {rows:REPLAY_DAYS.map(day=>({
        trade_day:day,observed_stocks:'2612'}))};
    }
    if(sql.includes('FROM blue_eod_daily_v1'))return {rows:proofs[REPLAY_DAYS.indexOf(args[0])].values};
    throw Error('UNEXPECTED_QUERY');
  }};
  const result=await exportV2ReplaySource(client,{mode:'inspect'});
  assert.equal(result.status,'VERIFIED_READ_ONLY');
  assert.equal(result.days.length,4);
  assert.equal(result.total_rows,10648);
  assert.equal(queries.length,6);
});

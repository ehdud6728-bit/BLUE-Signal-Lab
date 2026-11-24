import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {classifyStocks,captureLeaders,selectAlignedTrend} from './rotation-leaders.mjs';
const row=(code,r5,r10,ratio,signals=[],amount=600000000,sectors=['0002'])=>({code,name:code,close:1000,r5,r10,amount_ratio:ratio,signals,amount,sectors});
test('leaders and recovering followers require liquidity, true group and price recovery',()=>{
 const r=classifyStocks([row('000001',4,15,2),row('000002',2,0,2,['ENV20_LOWER_TOUCH']),row('000003',1,1,3),row('000004',-1,-10,4),row('000005',1,0,null),row('000006',1,0,3,[],100),row('000007',1,0,3,[],600000000,['0003'])],{code:'0002'});
 assert.deepEqual(r.leaders.map(x=>x.code),['000001']);
 assert.deepEqual(r.followers.map(x=>x.code),['000002','000003']);
 assert.equal(classifyStocks([row('000002',1,0,3)],{code:'0002'}).followers.length,0);
});
test('plan never opens DB',async()=>{
 assert.equal((await captureLeaders({}, {mode:'plan',factory:()=>{throw Error('forbidden')}})).status,'PLAN_ONLY');
});

test('missing newest EOD can use older aligned trend but never mix dates',async()=>{
 const days=Array.from({length:11},(_,i)=>new Date(Date.UTC(2026,10,13+i)).toISOString().slice(0,10)).reverse();
 const proof='a'.repeat(64),audits=days.map(trade_day=>({trade_day,row_count:2000,source:'KRX_PYKRX_EXACT_DAY_VERIFIED',day_sha256:proof}));
 const trend=(receipt,day,prev,benchmark_days)=>{const at=receipt+'T00:00:00Z',s={schema:'BLUE_ROTATION_TRENDS_V1',receipt_day:receipt,observed_at_utc:at,markets:['KOSPI','KOSDAQ'].map(market=>({market,benchmark:{day,previous_day:prev},...(benchmark_days?{benchmark_days}:{})}))};const payload_json=JSON.stringify(s);return {receipt_day:receipt,observed_at_utc:at,payload_json,payload_sha256:createHash('sha256').update(payload_json).digest('hex')};};
 const newer=trend('2026-11-25','2026-11-24',days[0]),older=trend('2026-11-24',days[0],days[1],days.slice().reverse());
 const read=async(sql,args)=>{
  if(sql.startsWith('SELECT receipt_day FROM'))return [newer,older];
  if(sql.startsWith('SELECT receipt_day,observed'))return [args[0]===newer.receipt_day?newer:older];
  if(sql.includes('blue_eod_ingest_audit_v1'))return audits;
  if(sql.includes('COUNT(*)'))return audits.map(a=>({trade_day:a.trade_day,n:a.row_count}));
  throw Error('unexpected query');
 };
 const result=await selectAlignedTrend(read,'2026-11-25');
 assert.equal(result.day,'2026-11-23');assert.equal(result.latest_trend_day,'2026-11-24');assert.equal(result.reference_basis,'EXACT_BENCHMARK_DATES');
 audits.splice(4,1);
 await assert.rejects(()=>selectAlignedTrend(read,'2026-11-25'),/LEADERS_EOD_HISTORY_REQUIRED/);
});

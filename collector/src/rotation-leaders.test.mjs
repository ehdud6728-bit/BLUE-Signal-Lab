import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {classifyStocks,captureLeaders,selectAlignedTrend,masterMembership,resolveMembership,publishLeaders,leaderStorageFailure} from './rotation-leaders.mjs';
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

test('direct industry codes and documented index flags are separate exact membership paths',()=>{
 const members=[{market:'KOSPI',code:'000001',sectors:['0010'],index_tags:['KOSPI200_건설']},{market:'KOSPI',code:'000002',sectors:['0010'],index_tags:['KOSPI200_금융']},{market:'KOSDAQ',code:'000003',sectors:['0010'],index_tags:['KOSDAQ150']}];
 const a=masterMembership(members,'KOSPI',{code:'2010',name:'코스피 200 건설'});
 assert.equal(a.source,'KIS_MASTER_FLAG');assert.deepEqual([...a.codes],['000001']);
 const b=masterMembership(members,'KOSPI',{code:'0010',name:'건설'});
 assert.equal(b.source,'KIS_MASTER_CODE');assert.equal(b.codes.size,2);
 const c=masterMembership(members,'KOSPI',{code:'2010',name:'코스피200 건설 관련'});
 assert.equal(c.source,'UNMAPPED');
});
test('KRX fallback requires exact requested day and group identities and intersects eligible market membership',async()=>{
 const members=[{market:'KOSPI',code:'000001',sectors:['0010']},{market:'KOSPI',code:'000002',sectors:['0010']},{market:'KOSDAQ',code:'000003',sectors:['0010']}];
 const targets=[{market:'KOSPI',code:'2010',name:'복합지수'}];
 const res=await resolveMembership(members,targets,'2026-11-23',async req=>({day:req.day,groups:[{...targets[0],status:'AVAILABLE',reason:null,krx_code:'1234',krx_scope:'KOSPI',identity_basis:'LOCAL_EXACT_NAME',members:['000001','000003','999999']}]}));
 const r=res.get('KOSPI/2010');assert.equal(r.source,'KRX_INDEX_CONSTITUENTS');assert.deepEqual([...r.codes],['000001']);
 const bad=await resolveMembership(members,targets,'2026-11-23',async req=>({day:'2026-11-22',groups:[]}));
 assert.equal(bad.get('KOSPI/2010').source,'UNMAPPED');
 const rows=[row('000001',4,15,2,[],600000000,['0010']),row('000002',5,20,2,[],600000000,['0010'])];
 assert.deepEqual(classifyStocks(rows,targets[0],x=>r.codes.has(x.code)).leaders.map(x=>x.code),['000001']);
});

test('publication opens its own client and verifies partial snapshot before success',async()=>{
 const snapshot={receipt_day:'2026-11-25',observed_at_utc:'2026-11-24T15:49:24Z',mapping_status:'PARTIAL',markets:[]};
 let saved,closed=false,opened=0;
 const factory=()=>{opened++;return {async execute(q){
   if(typeof q==='string'){assert.match(q,/CREATE TABLE IF NOT EXISTS blue_rotation_leaders_v1/);return {rows:[]};}
   if(q.sql.startsWith('INSERT')){saved=q.args;return {rows:[]};}
   assert.equal(q.args[0],snapshot.receipt_day);
   return {rows:[{payload_json:saved[2],payload_sha256:saved[3]}]};
 },close(){closed=true;}};};
 await publishLeaders(snapshot,factory,{url:'libsql://test.invalid',authToken:'fake'});
 assert.equal(opened,1);assert.equal(closed,true);
 assert.deepEqual(JSON.parse(saved[2]),snapshot);
 assert.equal(saved[3],createHash('sha256').update(saved[2]).digest('hex'));
});
test('publication reports safe stage and provider code, never leaks provider message',async()=>{
 const snapshot={receipt_day:'2026-11-25',observed_at_utc:'2026-11-24T15:49:24Z'};
 let closed=false;
 await assert.rejects(()=>publishLeaders(snapshot,()=>({async execute(q){
   if(typeof q==='string')return {rows:[]};
   throw Object.assign(Error('SECRET URL token'),{code:'HRANA_WEBSOCKET_ERROR'});
 },close(){closed=true;}}),{},{wait:async()=>{},attempts:1}),{message:'LEADERS_STORAGE_WRITE_HRANA_WEBSOCKET_ERROR'});
 assert.equal(closed,true);
 assert.equal(leaderStorageFailure('RUNTIME',new ReferenceError('secret')),'LEADERS_STORAGE_RUNTIME_UNKNOWN_REFERENCEERROR');
});

test('transient socket errors reopen connection and replay identical snapshot, including lost write acknowledgement',async()=>{
 const snapshot={receipt_day:'2026-11-25',observed_at_utc:'2026-11-24T16:03:11Z',mapping_status:'PARTIAL',markets:[]};
 let opened=0,closed=0,saved=null,writes=0;const waits=[];
 const socket=()=>Object.assign(new TypeError('private provider message'),{cause:{code:'UND_ERR_SOCKET'}});
 const factory=()=>{const attempt=++opened;return {async execute(q){
   if(typeof q==='string'){if(attempt===1)throw socket();return {rows:[]};}
   if(q.sql.startsWith('INSERT')){
     writes++;if(saved)assert.deepEqual(q.args,saved);else saved=q.args;
     if(attempt===2)throw socket();
     return {rows:[]};
   }
   return {rows:[{payload_json:saved[2],payload_sha256:saved[3]}]};
 },close(){closed++;}};};
 await publishLeaders(snapshot,factory,{}, {wait:async ms=>{waits.push(ms);}});
 assert.equal(opened,3);assert.equal(closed,3);assert.equal(writes,2);assert.deepEqual(waits,[750,1500]);
});
test('auth and proof errors do not retry',async()=>{
 const snapshot={receipt_day:'2026-11-25',observed_at_utc:'2026-11-24T16:03:11Z'};let opened=0;
 await assert.rejects(()=>publishLeaders(snapshot,()=>{opened++;return {async execute(){throw Object.assign(Error('secret'),{code:'AUTH_TOKEN_INVALID'});},close(){}};},{},{wait:async()=>{throw Error('unexpected retry');}}),/LEADERS_STORAGE_CREATE_AUTH_TOKEN_INVALID/);
 assert.equal(opened,1);
 await assert.rejects(()=>publishLeaders(snapshot,()=>({async execute(){return {rows:[]};},close(){}}),{},{wait:async()=>{throw Error('unexpected retry');}}),/LEADERS_READBACK_MISMATCH/);
});

test('cross-family membership requires relative-history identity metadata and keeps market scope',async()=>{
 const members=[{market:'KOSDAQ',code:'000001',sectors:[]},{market:'KOSPI',code:'000002',sectors:[]}];
 const g={market:'KOSDAQ',code:'6296',name:'통합지수'};
 const response={...g,status:'AVAILABLE',reason:null,krx_code:'1234',krx_scope:'KRX',identity_basis:'CROSS_EXACT_NAME_AND_RELATIVE_HISTORY',members:['000001','000002']};
 const run=async result=>(await resolveMembership(members,[g],'2026-11-24',async()=>({day:'2026-11-24',groups:[result]}))).get('KOSDAQ/6296');
 const ok=await run(response);assert.equal(ok.source,'KRX_INDEX_CONSTITUENTS');assert.deepEqual([...ok.codes],['000001']);assert.equal(ok.krx_scope,'KRX');
 const bad=await run({...response,identity_basis:'LOCAL_EXACT_NAME'});assert.equal(bad.source,'UNMAPPED');
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectKisAfterKrxFailure} from './krx-kis-fallback-collect.mjs';

const NOW=new Date('2026-11-20T13:21:00.000Z'); // 22:21 KST
const ENV={KIS_APP_KEY:'fake-key',KIS_APP_SECRET:'fake-secret',
  DB:new Proxy({},{get(){throw Error('NO_D1_ACCESS');}})};
const daily=(day='20261120')=>({rt_cd:'0',output:{
  stck_bsop_date:day,stck_prpr:'12300',stck_oprc:'12100',stck_hgpr:'12500',
  stck_lwpr:'12000',acml_vol:'123456'}});
function mock({current=false,existing=[],referenceCount=1700}={}){
  const calls=[],batches=[];
  const rows=Array.from({length:1700},(_,i)=>({
    code:String(i).padStart(6,'0'),name:'test',close:'12000'}));
  return {calls,batches,client:{
    async execute(query){
      const sql=typeof query==='string'?query:query.sql;
      calls.push(sql);
      if(sql.includes('WHERE trade_day=? AND row_count>=1700'))
        return {rows:current?[{row_count:1700}]:[]};
      if(sql.includes('SELECT COUNT(*) AS n'))return {rows:[{n:1700}]};
      if(sql.includes('SELECT trade_day,row_count'))
        return {rows:[{trade_day:'2026-11-19',row_count:referenceCount}]};
      if(sql.includes('SELECT code,name,close'))return {rows};
      if(sql.includes('CREATE TABLE IF NOT EXISTS'))return {rows:[]};
      if(sql.includes('SELECT code FROM blue_kis_provisional_daily_v1'))
        return {rows:existing.map(code=>({code}))};
      throw Error('UNEXPECTED_SQL');
    },async batch(statements,mode){assert.equal(mode,'write');batches.push(statements);}
  }};
}
const deps=(extra={})=>({token:async()=> 'fake-cached-token',noPacing:true,
  receivedAt:NOW,quoteDaily:async()=>daily(),maxSymbols:2,...extra});

test('KRX failed apply fetches KIS exact-day quotes after 22:00, provisional only',async()=>{
 const db=mock();const calls=[];
 const result=await collectKisAfterKrxFailure(db.client,ENV,'2026-11-20',NOW,
   deps({quoteDaily:async(_env,_token,market,code,day)=>{
     calls.push([market,code,day]);return daily();}}));
 assert.equal(result.status,'KIS_PROVISIONAL_ATTEMPTED');
 assert.equal(result.attempted,2);assert.equal(result.saved,2);assert.equal(result.complete,false);
 assert.deepEqual(calls,[['J','000000','2026-11-20'],['J','000001','2026-11-20']]);
 const writes=db.batches.flat();
 assert.equal(writes.length,6);
 assert.equal(writes.filter(x=>x.sql.includes('INSERT INTO blue_kis_provisional_daily_v1')).length,2);
 assert.ok(writes.every(x=>!/(INSERT|UPDATE|DELETE)\s+(?:INTO\s+)?(?:blue_eod_daily_v1|blue_research_signals_v1|blue_eod_ingest_audit_v1)/.test(x.sql)));
 assert.equal(JSON.stringify(db.calls).includes('fake-cached-token'),false);
});

test('KIS retry skips previously verified provisional rows and does not overwrite them',async()=>{
 const db=mock({existing:['000000']});const codes=[];
 const result=await collectKisAfterKrxFailure(db.client,ENV,'2026-11-20',NOW,
   deps({maxSymbols:1,quoteDaily:async(_env,_token,_market,code)=>{
     codes.push(code);return daily();}}));
 assert.deepEqual(codes,['000001']);
 assert.equal(result.already_saved,1);assert.equal(result.saved,1);
});

test('complete audited KRX EOD prevents any KIS token lookup or write',async()=>{
 const db=mock({current:true});
 const result=await collectKisAfterKrxFailure(db.client,ENV,'2026-11-20',NOW,
  deps({token:async()=>{throw Error('TOKEN_MUST_NOT_BE_READ');}}));
 assert.equal(result.status,'KRX_EOD_ALREADY_AVAILABLE');
 assert.equal(db.batches.length,0);
});

test('stale/future dates and incomplete reference fail before provider calls',async()=>{
 for(const [day,db] of [['2026-11-21',mock()],['2026-11-01',mock()],
   ['2026-11-20',mock({referenceCount:1699})]]){
  await assert.rejects(()=>collectKisAfterKrxFailure(db.client,ENV,day,NOW,
    deps({quoteDaily:async()=>{throw Error('KIS_MUST_NOT_BE_CALLED');}})),
    /INVALID_KIS_FALLBACK_DAY|INVALID_KIS_REFERENCE_AUDIT/);
  assert.equal(db.batches.length,0);
 }
});

test('missing exact date or provider throttle never creates a false success',async()=>{
 const missing=mock();
 const a=await collectKisAfterKrxFailure(missing.client,ENV,'2026-11-20',NOW,
  deps({maxSymbols:2,quoteDaily:async()=>daily('20261119')}));
 assert.equal(a.saved,0);assert.equal(a.rejected,2);
 assert.equal(missing.batches.length,0);
 const throttled=mock();
 const b=await collectKisAfterKrxFailure(throttled.client,ENV,'2026-11-20',NOW,
  deps({quoteDaily:async()=>{throw Error('KIS_RATE_LIMIT');}}));
 assert.equal(b.status,'KIS_RATE_LIMIT_BACKOFF');
 assert.equal(b.attempted,1);assert.equal(b.saved,0);
});

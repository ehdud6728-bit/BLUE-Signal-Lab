import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBasket} from '../collector/src/basket.mjs';

const now=new Date('2026-11-17T01:00:00.000Z'); // Tuesday 10:00 KST
const quote={rt_cd:'0',output:{stck_prpr:'10300',stck_oprc:'10200',stck_hgpr:'10400',
 stck_lwpr:'10100',acml_vol:'1234',stck_bsop_date:'20261117'}};
function makeDb(codes=['005930','000660']){
 const writes=[];let selectedLimit=0;
 const due=codes.map((code,i)=>({code,base_day:i===1?'2026-11-11':'2026-11-12',
   baseline_close:10000,progress_to_day:'2026-11-16',recent_day:'2026-11-16',
   recent_close:10000,quote_day:null,created_at_utc:now.toISOString()}));
 const db={prepare(sql){let args=[];const stmt={bind(...v){args=v;return stmt;},
  async all(){if(sql.includes('FROM blue_basket_watch_r153')){
    selectedLimit=args[2];return {results:due.slice(0,args[2])};
   }throw Error('unexpected SELECT '+sql);},
  async run(){if(sql.startsWith('UPDATE blue_basket_watch_r153'))writes.push({sql,args});
   return {meta:{changes:1}};}};return stmt;}};
 return {db,due,writes,get limit(){return selectedLimit;}};
}
test('fast basket cron processes more than 3 due rows and shares duplicate-ticker quotes',async()=>{
 const mock=makeDb(['005930','000660','005930','035420','051910']);let quoteCalls=0;
 const res=await collectBasket({DB:mock.db,COLLECTOR_ENABLED:'true'},now,{
   token:async()=> 'test-token',quote:async()=>{quoteCalls++;return quote;}});
 assert.equal(mock.limit,18);
 assert.equal(res.processed,5);
 assert.equal(quoteCalls,4); // duplicate discovery date shares one intraday REST call
 assert.ok(mock.writes.filter(w=>w.sql.includes('next_due_utc')).every(w=>
  w.args.some(v=>v==='2026-11-17T01:02:00.000Z')));
});
test('without a current quote the next basket attempt is the following minute',async()=>{
 const mock=makeDb(['005930']);
 const res=await collectBasket({DB:mock.db,COLLECTOR_ENABLED:'true'},now,{
   token:async()=> 'test-token',quote:async()=>{throw Error('provider unavailable');}});
 assert.equal(res.success,1); // historical high is retained; live quote remains unavailable
 assert.ok(mock.writes[0].args.includes('2026-11-17T01:01:00.000Z'));
 assert.ok(mock.writes[0].args.includes('QUOTE_UNAVAILABLE'));
});
test('basket batch size is bounded even when configured too high',async()=>{
 const mock=makeDb(['005930']);
 await collectBasket({DB:mock.db,COLLECTOR_ENABLED:'true',BASKET_BATCH_LIMIT:'999'},now,{
   token:async()=> 'test-token',quote:async()=>quote});
 assert.equal(mock.limit,24);
});
test('current quote is saved even if historical high backfill later fails',async()=>{
 const mock=makeDb(['005930']);let quoteCalls=0;
 mock.due[0].progress_to_day='2026-11-15';
 const res=await collectBasket({DB:mock.db,COLLECTOR_ENABLED:'true'},now,{
  token:async()=> 'test-token',
  quote:async()=>{quoteCalls++;return quote;},
  daily:async()=>{throw Error('historical source temporarily offline');}});
 assert.equal(res.success,0);
 assert.equal(quoteCalls,1);
 assert.ok(mock.writes.some(w=>w.args.includes('2026-11-17')&&w.args.includes(10300)));
 assert.ok(mock.writes.some(w=>w.args.includes('PROVIDER_RETRY')));
});

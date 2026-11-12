import test from 'node:test';
import assert from 'node:assert/strict';
import {decodePairs,chartAfterSearch,bestObservation,highSummary,comparePrices} from '../worker/src/price-compare.ts';

test('date validation and request cap reject arbitrary tickers, duplicates and future dates',()=>{
 assert.equal(decodePairs('005930:2026-11-02','2026-11-12')?.length,1);
 assert.equal(decodePairs('005930:2026-11-02,005930:2026-11-02','2026-11-12')?.length,1);
 assert.equal(decodePairs('BAD:2026-11-02','2026-11-12'),null);
 assert.equal(decodePairs('005930:2026-12-02','2026-11-12'),null);
 assert.equal(decodePairs(Array.from({length:25},(_,i)=>`0000${String(i).padStart(2,'0')}:2026-11-02`).join(','),'2026-11-12'),null);
});
test('chart high cannot use bars before search day or after chart asof',()=>{
 const bars=[
  {t:'2026-11-01',h:999,c:98},
  {t:'2026-11-02',h:110,c:105},
  {t:'2026-11-03',h:127,c:120},
  {t:'2026-11-04',h:119,c:118},
  {t:'2026-11-15',h:777,c:715}];
 const r=chartAfterSearch(JSON.stringify({bars}),'2026-11-02','2026-11-04');
 assert.equal(r.latest.price,118);assert.equal(r.latest.day,'2026-11-04');
 assert.equal(r.high.price,127);assert.equal(r.high.day,'2026-11-03');assert.equal(r.high.full,true);
});
test('partial chart history has a partial coverage label, not proven complete',()=>{
 const r=chartAfterSearch(JSON.stringify({bars:[{t:'2026-11-04',h:125,c:120}]}),'2026-11-02','2026-11-04');
 assert.equal(r.high.full,false);
 assert.equal(highSummary([r.high],'2026-11-04').complete,false);
});
test('recent price is selected by trading date before source priority',()=>{
 const all=[{price:100,day:'2026-11-10',source:'EOD',at:null,market:null,priority:99},
  {price:110,day:'2026-11-11',source:'KIS',at:null,market:'J',priority:10}];
 assert.equal(bestObservation(all)?.price,110);
});
test('high observed later cannot silently turn a partial period into complete history',()=>{
 const h=highSummary([{price:160,day:'2026-11-07',source:'DAILY',coverageTo:'2026-11-10',full:true},
  {price:165,day:'2026-11-11',source:'SNAP',coverageTo:'2026-11-11',full:false}], '2026-11-11');
 assert.equal(h.price,165);assert.equal(h.complete,false);
});
function mockDb(){
 const calls=[];
 const rows=[
   {base_day:'2026-11-02',status:'READY',progress_to_day:'2026-11-08',
    highest_price:143,highest_day:'2026-11-06',recent_close:124,recent_day:'2026-11-08',
    quote_price:128,quote_day:'2026-11-09',quote_market:'J',quote_at_utc:'2026-11-09T03:00:00Z'},
   {base_day:'2026-11-04',status:'READY',progress_to_day:'2026-11-08',highest_price:190,highest_day:'2026-11-06'}
 ];
 return {calls,prepare(sql){
  const query=(args)=>({
   async first(){calls.push({sql,args});
    if(sql.includes('SELECT s.close_price FROM signals s'))return {close_price:100};
    if(sql.includes('SELECT c.chart_json,c.day FROM chart_snapshots'))return {day:'2026-11-08',chart_json:JSON.stringify({bars:[
      {t:'2026-11-02',h:108,c:100},
      {t:'2026-11-05',h:115,c:110},
      {t:'2026-11-08',h:132,c:122}]})};
    if(sql.includes('SELECT s.day,s.close_price FROM signals s'))return {day:'2026-11-08',close_price:122};
    return null;
   },async all(){calls.push({sql,args});
    if(sql.includes('FROM blue_basket_watch_r153'))return {results:rows};
    return {results:[]};
   }
  });
  return {bind(...args){return query(args)},async all(){
   if(sql.includes('FROM sqlite_master'))return {results:[{name:'blue_basket_watch_r153'},{name:'chart_snapshots'}]};
   return {results:[]};
  }};
 }};
}
test('same ticker and multiple discovered dates do not share an earlier-date high',async()=>{
 const db=mockDb();const url=new URL('https://app.test/api/prices/compare?items=005930:2026-11-02,005930:2026-11-04');
 const response=await comparePrices(db,url),body=await response.json();
 assert.equal(response.status,200);assert.equal(body.items.length,2);
 assert.equal(body.items[0].period_high,143);
 assert.equal(body.items[1].period_high,190);
 assert.equal(body.items[0].latest_price,128);
 assert.equal(body.items[1].latest_price,128);
 assert.ok(db.calls.every(x=>!/(INSERT|UPDATE|DELETE|KIS_APP_SECRET)/i.test(x.sql)));
});

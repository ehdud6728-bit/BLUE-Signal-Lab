import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedDailyRows,mergeDaily} from '../collector/src/basket.mjs';
import {decodeItems} from '../worker/src/performance.ts';

const candle=(d,h,c,l=90)=>({stck_bsop_date:d,stck_hgpr:String(h),stck_clpr:String(c),stck_lwpr:String(l)});
test('reject provider failure instead of inventing bars',()=>{
 assert.throws(()=>verifiedDailyRows({rt_cd:'1',output2:[]},'2026-11-01','2026-11-10','2026-10-31'));
 assert.throws(()=>verifiedDailyRows({rt_cd:'0',output2:{}},'2026-11-01','2026-11-10','2026-10-31'));
});
test('exclude search day and outside range',()=>{
 const rows=verifiedDailyRows({rt_cd:'0',output2:[
  candle('20261031',200,140),candle('20261103',170,130),candle('20261111',500,400)]},
 '2026-11-01','2026-11-10','2026-10-31');
 assert.equal(rows.length,1);assert.equal(rows[0].day,'2026-11-03');
});
test('highest intraday and most recent closing are distinct facts',()=>{
 const out=mergeDaily({highest_price:null,highest_day:null,recent_close:null,recent_day:null},[
  {day:'2026-11-02',high:160,close:101},{day:'2026-11-04',high:150,close:140}]);
 assert.deepEqual(out,{highest_price:160,highest_day:'2026-11-02',recent_close:140,recent_day:'2026-11-04'});
});
test('daily invalid data does not change stored maximum',()=>{
 const bars=verifiedDailyRows({rt_cd:'0',output2:[
  candle('20261104',90,100,80),candle('20261105',170,140,120)]},
 '2026-11-04','2026-11-06','2026-11-01');
 assert.equal(bars.length,1);const out=mergeDaily({highest_price:200,highest_day:'2026-11-03',recent_close:100,recent_day:'2026-11-02'},bars);
 assert.equal(out.highest_price,200);assert.equal(out.recent_close,140);
});
test('identical day highest uses earliest recorded date',()=>{
 const out=mergeDaily({highest_price:150,highest_day:'2026-11-04',recent_close:140,recent_day:'2026-11-04'},[
  {day:'2026-11-03',high:150,close:130}]);
 assert.equal(out.highest_day,'2026-11-03');assert.equal(out.recent_day,'2026-11-04');
});

test('watch enrollment rejects symbols, malformed days, and future dates',()=>{
 assert.equal(decodeItems([{code:'005930',day:'2026-11-02'}],20)?.length,1);
 assert.equal(decodeItems([{code:'12345',day:'2026-11-02'}],20),null);
 assert.equal(decodeItems([{code:'005930',day:'2026-02-30'}],20),null);
 assert.equal(decodeItems([{code:'005930',day:'2028-01-01'}],20),null);
});
test('duplicate watch entries are de-duplicated and the 20-item cap is enforced',()=>{
 assert.equal(decodeItems([{code:'005930',day:'2026-11-02'},{code:'005930',day:'2026-11-02'}],20)?.length,1);
 assert.equal(decodeItems(Array.from({length:21},()=>({code:'005930',day:'2026-11-02'})),20),null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {evidence} from './combined-pattern-factors.mjs';
test('row hash, known false and malformed missing factors',()=>{
 const day='2026-11-24',code='024720',signal={day,code,names:['ENV20']},bar={close:109};
 const record={trade_day:day,code,signal_names:'ENV20',close_price:109,chart:{asof:day,bars:[{t:day,c:109}]},extras:{rsi_gc:'False',ma20:'10',ma40:'20',ma60:'30'}};
 const make=r=>{const raw=JSON.stringify(r);return {trade_day:day,code,close_price:109,record_json:raw,row_sha256:createHash('sha256').update(raw).digest('hex')}};
 assert.equal(evidence(make(record),signal,bar).rsi_gc,false);
 assert.equal(evidence(make(record),signal,bar).ma_down,true);
 assert.equal(evidence(make({...record,extras:{}}),signal,bar).ma_down,null);
 assert.throws(()=>evidence({...make(record),row_sha256:'bad'},signal,bar),/HASH_MISMATCH/);
});

test('detailed values do not alter the legacy cohort; discrepancies exclude numeric evidence',()=>{
 const day='2026-11-24',code='024720',signal={day,code,names:['ENV20']},bar={close:109};
 const record={trade_day:day,code,signal_names:'ENV20',close_price:109,chart:{asof:day,bars:[
  {t:'2026-11-23',c:100,r:29,rs:30},{t:day,c:109,r:34.12,rs:31.23}]},extras:{rsi_gc:'True',rsi:34.12345,rsi_signal:31.23456,ma20:10,ma40:20,ma60:30}};
 const make=r=>{const raw=JSON.stringify(r);return {trade_day:day,code,close_price:109,record_json:raw,row_sha256:createHash('sha256').update(raw).digest('hex')}};
 const a=evidence(make(record),signal,bar),b=evidence(make(record),signal,bar,{details:true});
 assert.equal(a.rsi_value,undefined);assert.equal(a.rsi_gc,b.rsi_gc);
 assert.equal(b.rsi_value,34.12345);assert.equal(b.prior_rsi,29);assert.equal(b.rsi_value_chart_consistent,true);assert.equal(b.rsi_cross_value_consistent,true);
 const bad=evidence(make({...record,extras:{...record.extras,rsi:40}}),signal,bar,{details:true});
 assert.equal(bad.rsi_gc,true);assert.equal(bad.rsi_value,null);assert.equal(bad.rsi_value_chart_consistent,false);
});

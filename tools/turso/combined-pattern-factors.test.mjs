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

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHistory,rotation,globalSummary,captureTrends} from './market-trends.mjs';
const day=i=>new Date(Date.UTC(2026,9,1+i)).toISOString().slice(0,10);
const base=Array.from({length:26},(_,i)=>({day:day(i),close:100+i}));
test('same-date relative performance and momentum, no missing-session substitution',()=>{
 const series=base.map((b,i)=>({...b,close:b.close*(1+i*i/10000)}));
 const t=rotation(series,base);
 assert.equal(t.matched_sessions,26);assert.equal(t.day,day(25));
 assert.ok(t.rs10>0&&t.momentum>0);assert.equal(t.quadrant,'LEADING');
 assert.equal(rotation(series.slice(1),base),null);
 assert.equal(rotation(base,base).quadrant,'NEUTRAL');
 assert.equal(globalSummary(base).previous_day,day(24));
});
test('strict identity and dates; blank price is not zero',()=>{
 const raw={rt_cd:'0',output1:{bstp_cls_code:'1'},output2:[{stck_bsop_date:'20261002',bstp_nmix_prpr:'100.2'},{stck_bsop_date:'20261001',bstp_nmix_prpr:''}]};
 assert.deepEqual(parseHistory(raw,'0001',day(0),day(2)),[{day:day(1),close:100.2}]);
 assert.throws(()=>parseHistory(raw,'1001',day(0),day(2)),/HISTORY_IDENTITY_UNVERIFIED/);
 assert.throws(()=>parseHistory(raw,'0001',day(0),day(0)),/HISTORY_DATE_INVALID/);
});
test('plan is entirely offline',async()=>{
 const forbidden=()=>{throw Error('forbidden');};
 assert.deepEqual(await captureTrends({}, {mode:'plan',factory:forbidden,fetchFn:forbidden}),{status:'PLAN_ONLY',kis_calls:0,turso_writes:0});
});

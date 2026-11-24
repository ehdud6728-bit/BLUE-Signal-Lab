import test from 'node:test';
import assert from 'node:assert/strict';
import {parseHistory,rotation,globalSummary,captureTrends,globalIdentity} from './market-trends.mjs';
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

test('overseas code and exact name identity: no wrong-symbol fallback',()=>{
 assert.equal(globalIdentity({stck_shrn_iscd:' NDX '},'.NDX'),'EXACT_CODE');
 assert.equal(globalIdentity({stck_shrn_iscd:'',hts_kor_isnm:'나스닥 100'},'.NDX'),'EXACT_NAME_NO_CODE');
 assert.equal(globalIdentity({stck_shrn_iscd:'SPX',hts_kor_isnm:'나스닥 100'},'.NDX'),'CODE_MISMATCH');
 assert.equal(globalIdentity({stck_shrn_iscd:'NDX',hts_kor_isnm:'S&P500'},'.NDX'),'NAME_MISMATCH');
 assert.equal(globalIdentity({hts_kor_isnm:'나스닥'},'.NDX'),'CODE_MISSING');
});
test('global-only inspect retries at most ten overseas calls without domestic reads or writes',async()=>{
 const requests=[];
 const r=await captureTrends({TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'fake'},{mode:'global_inspect',now:new Date('2026-11-24T14:30:00Z'),
 factory:()=>({execute(){throw Error('unexpected DB query');},close(){}}),token:async()=>({token:'fake'}),wait:async()=>{},
 fetchFn:async u=>{assert.match(u.pathname,/overseas-price/);const s=u.searchParams.get('FID_INPUT_ISCD');requests.push(s);
 return new Response(JSON.stringify({rt_cd:'0',output1:s.startsWith('.')?{}:{stck_shrn_iscd:s},output2:[{stck_bsop_date:'20261120',ovrs_nmix_prpr:'100'},{stck_bsop_date:'20261123',ovrs_nmix_prpr:'102'}]}));}});
 assert.equal(r.scope,'GLOBAL_ONLY');assert.equal(r.kis_calls,10);assert.equal(requests.length,10);assert.ok(r.global.every(x=>x.status==='AVAILABLE'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {capture,parseCategory,parseFlows} from './market-rotation.mjs';
const now=new Date('2026-11-24T06:00:00Z');
const category={rt_cd:'0',output1:{bstp_nmix_prpr:'2500.00',bstp_nmix_prdy_ctrt:'1.00',ascn_issu_cnt:'60',down_issu_cnt:'30',stnr_issu_cnt:'10'},output2:[{bstp_cls_code:'0002',hts_kor_isnm:'테스트 분류',bstp_nmix_prpr:'100',bstp_nmix_prdy_ctrt:'2.50',acml_tr_pbmn_rlim:'12.5'}]};
const flows={rt_cd:'0',output:[{stck_bsop_date:'20261124',frgn_ntby_tr_pbmn:'-123',orgn_ntby_tr_pbmn:'100',prsn_ntby_tr_pbmn:''},{stck_bsop_date:'20261125',frgn_ntby_tr_pbmn:'123'}]};
test('actual relative strength, provider share, and missing flows are distinct',()=>{
 const m=parseCategory(category,'KOSPI','0001');
 assert.equal(m.sectors[0].relative_pct,1.5);
 assert.equal(m.sectors[0].turnover_share_pct,12.5);
 assert.deepEqual(parseFlows(flows,'2026-11-24'),[{day:'2026-11-24',foreign:'SELL',institution:'BUY',individual:null}]);
 const bad=structuredClone(category);bad.output2[0].bstp_nmix_prdy_ctrt='';
 assert.throws(()=>parseCategory(bad,'KOSPI','0001'),/CATEGORY_SECTOR_INVALID/);
});
test('plan makes no calls; inspect does not write and apply verifies private snapshot',async()=>{
 const never=()=>{throw Error('forbidden');};
 assert.equal((await capture({}, {mode:'plan',factory:never,fetchFn:never})).kis_calls,0);
 const env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'test',KIS_APP_KEY:'test',KIS_APP_SECRET:'test'};
 let saved='',writes=0,calls=0;
 const factory=()=>({close(){},async execute(cmd){
  if(typeof cmd==='string'){assert.match(cmd,/^CREATE TABLE IF NOT EXISTS/);writes++;return {rows:[]};}
  if(cmd.sql.startsWith('INSERT')){writes++;saved=cmd.args[2];return {rows:[]};}
  if(cmd.sql.startsWith('SELECT payload_json'))return {rows:[{payload_json:saved}]};
  throw Error('unexpected');
 }});
 const deps={now,factory,token:async()=>({status:'READY',token:'fake'}),wait:async()=>{},fetchFn:async u=>{
  calls++;return new Response(JSON.stringify(u.pathname.endsWith('category-price')?category:flows),{status:200});
 }};
 const inspected=await capture(env,{...deps,mode:'inspect'});
 assert.equal(inspected.status,'INSPECT_ONLY');assert.equal(writes,0);assert.equal(calls,4);
 const result=await capture(env,{...deps,mode:'apply'});
 assert.equal(result.status,'OK');assert.equal(writes,2);assert.equal(result.snapshot.quote_trade_day,null);
 assert.equal(result.snapshot.markets.length,2);assert.equal(calls,8);
 assert.equal(JSON.parse(saved).markets[0].flows[0].foreign,'SELL');
});

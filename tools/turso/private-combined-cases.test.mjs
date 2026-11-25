import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {persist,validate} from './private-combined-cases.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const day='2026-11-24';
function fixture(){
 const payload=JSON.stringify([{day,code:'000001',indicators:{record_sha256:'a'.repeat(64)}}]),sha256=hash(payload);
 const groups=['ENV20','ENV20_LOWER_TOUCH'].flatMap(base=>['JOINT','LONG_BULL_NOT_JOINT','LONG_BULL_RSI_GC'].map(group=>{
  const total=base==='ENV20'&&group==='JOINT'?1:0;
  return {base,group,total,page_hashes:total?[sha256]:[],horizons:Object.fromEntries([1,3,5,10,20].map(h=>[h,{complete:0,pending:total,missing:0}]))};
 }));
 const manifest=JSON.stringify({schema:'BLUE_PRIVATE_COMBINED_CASES_V1',asof:day,source_sha256:'b'.repeat(64),factors_sha256:'c'.repeat(64),page_size:20,groups});
 return {manifest,pages:[{base:'ENV20',group:'JOINT',page:0,payload,sha256}]};
}
test('inspect never writes; apply publishes only verified pages',async()=>{
 const db=new DatabaseSync(':memory:');
 let writes=0;
 const client={execute:async({sql,args})=>{const st=db.prepare(sql);if(/^\s*SELECT/i.test(sql))return {rows:st.all(...args)};writes++;return {rows:[],rowsAffected:st.run(...args).changes};}};
 const b=fixture();
 assert.equal((await persist(client,b)).writes,0);assert.equal(writes,0);
 const ok=await persist(client,b,{mode:'apply'});assert.equal(ok.status,'READY');
 assert.equal(db.prepare('SELECT manifest_sha256 FROM blue_private_case_heads_v1').get().manifest_sha256,hash(b.manifest));
 const bad=fixture();bad.pages[0].payload='[]';
 assert.throws(()=>validate(bad),/CASE_PAGE_INVALID/);
 await assert.rejects(persist(client,bad,{mode:'apply'}),/CASE_PAGE_INVALID/);
 assert.equal(db.prepare('SELECT manifest_sha256 FROM blue_private_case_heads_v1').get().manifest_sha256,hash(b.manifest));
 db.close();
});

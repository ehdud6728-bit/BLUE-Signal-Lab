import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {publish,compact} from './forward-ui-publish.mjs';
test('explicit publication, same day readback and no writes in inspect',async()=>{
 const db=new DatabaseSync(':memory:'),sqls=[];const client={async execute(q){const sql=typeof q==='string'?q:q.sql,args=q.args||[];sqls.push(sql);const p=db.prepare(sql);return {rows:sql.startsWith('SELECT')?p.all(...args):(p.run(...args),[])}}};
 const data={schema:'BLUE_FORWARD_UI_V1',asof:'2026-11-25'},now=new Date('2026-11-26T12:00:00Z');
 assert.equal((await publish(client,data,{now})).writes,0);assert.equal(sqls.length,0);
 assert.equal((await publish(client,data,{now,apply:true})).status,'PUBLISHED_READBACK_MATCH');db.close();
});
test('compact rejects mismatched dates and strips symbol rows',()=>{
 const asof='2026-11-25',a={schema:'BLUE_ADAPTIVE_MARKET_BUNDLE_V1',asof,market:['KOSPI','KOSDAQ'].map(market=>({market,frequency:{rows:[]}})),rotation:{receipts:[],rows:[]},forward_performance:{sealed_changes:[]}};
 const s={schema:'BLUE_FORWARD_REPORT_V2',asof,pooled_opportunity_rows:[]},b={schema:'BLUE_FORWARD_SYMBOL_SETTLEMENT_REPORT_V1',asof,recent_rows:[{symbol_rows:[{code:'000001'}]}],conflicts:[]};
 assert.ok(!JSON.stringify(compact(a,s,b)).includes('000001'));assert.throws(()=>compact(a,{...s,asof:'2026-11-24'},b),/BASIS/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSearchPriority} from '../collector/src/search-quote-priority.mjs';
const now=new Date('2026-11-12T07:00:00Z');
function dbMock(){const writes=[];const db={prepare(sql){const st={sql,args:[],bind(...args){this.args=args;return this;},async first(){if(sql.includes('FROM sqlite_master'))return {name:'blue_search_quote_priority_r1594'};throw Error('unexpected first '+sql);},async all(){return {results:[{code:'000400',base_day:'2026-11-06',baseline_close:2500}]};},async run(){writes.push([sql,this.args]);return {meta:{changes:1}}}};return st;}};return {db,writes};}
test('missing encrypted KIS token is visible without removing last saved prices',async()=>{
 const {db,writes}=dbMock();let quotes=0;
 const r=await collectSearchPriority({DB:db,COLLECTOR_ENABLED:'true',KIS_APP_KEY:'test',KIS_APP_SECRET:'test'},now,{phases:()=>[['J','KRX_AFTER']],token:async()=>null,quote:async()=>{quotes++;}});
 assert.equal(r.status,'WAITING_TOKEN');assert.equal(quotes,0);
 const updates=writes.filter(([sql])=>sql.includes("status='WAITING_TOKEN'"));assert.equal(updates.length,1);
 assert.ok(updates[0][1].includes('000400'));assert.equal(updates[0][0].includes('price='),false);
});

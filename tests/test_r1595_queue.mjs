import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSearchPriority} from '../collector/src/search-quote-priority.mjs';
const now=new Date('2026-11-16T01:00:00Z'); // Monday 10am KST
function mock(){let query;const db={prepare(sql){const stmt={bind(...vals){this.vals=vals;return this;},async first(){if(sql.includes('sqlite_master'))return {name:'blue_search_quote_priority_r1594'};throw Error(sql)},async run(){return {meta:{changes:1}}},async all(){query={sql,values:this.vals};return {results:[]}}};return stmt;}};return {db,getQuery:()=>query};}
test('closed market never calls KIS',async()=>{
 const {db}=mock();let quoteCalls=0;
 const result=await collectSearchPriority({DB:db,COLLECTOR_ENABLED:'true'},now,{phases:()=>[],quote:async()=>{quoteCalls++;}});
 assert.equal(result.status,'MARKET_CLOSED');assert.equal(quoteCalls,0);
});
test('overnight/weekend queued work survives 2 hour expiry but is bounded',async()=>{
 const {db,getQuery}=mock();const result=await collectSearchPriority({DB:db,COLLECTOR_ENABLED:'true',KIS_APP_KEY:'x',KIS_APP_SECRET:'y'},now,{phases:()=>[['J','KRX_REGULAR']],token:async()=> 'token'});
 assert.equal(result.status,'IDLE');const q=getQuery();
 assert.match(q.sql,/LIMIT 4/);
 assert.match(q.sql,/ORDER BY CASE status WHEN 'QUEUED' THEN 0 WHEN 'RETRY' THEN 1 ELSE 2 END,requested_at_utc DESC/);
 const age=now.getTime()-Date.parse(q.values[1]);
 assert.ok(age>=6*86400000 && age<=8*86400000);
});

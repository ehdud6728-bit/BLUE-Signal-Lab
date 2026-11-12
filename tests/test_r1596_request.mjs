import test from 'node:test';
import assert from 'node:assert/strict';
import {requestSearchQuotes} from '../worker/src/search-quote-priority.ts';
function mock(verified=true){const statements=[];const db={prepare(sql){const st={sql,args:[],bind(...args){this.args=args;return this;},async first(){if(sql.includes('FROM signals s JOIN runs r'))return verified?{close_price:2500}:null;if(sql.includes('SELECT requested_at_utc'))return null;throw Error('unexpected first '+sql);},async run(){statements.push([sql,this.args]);return {meta:{changes:1}}}};return st;}};return {db,statements};}
test('empty-body POST query enqueues authenticated verified symbol',async()=>{
 const {db,statements}=mock();const r=await requestSearchQuotes(new Request('https://test.invalid/api/prices/request?items=000400:2026-11-06',{method:'POST'}),db);
 assert.equal(r.status,200);assert.equal((await r.json()).queued,1);assert.ok(statements.some(([sql])=>sql.includes('INSERT INTO blue_search_quote_priority_r1594')));
});
test('query must be valid and bounded',async()=>{
 const {db,statements}=mock();const r=await requestSearchQuotes(new Request('https://test.invalid/api/prices/request?items=000400:wrong',{method:'POST'}),db);
 assert.equal(r.status,400);assert.equal(statements.length,0);
});
test('arbitrary unverified ticker cannot enter queue',async()=>{
 const {db,statements}=mock(false);const r=await requestSearchQuotes(new Request('https://test.invalid/api/prices/request?items=000400:2026-11-06',{method:'POST'}),db);
 assert.equal(r.status,200);assert.equal((await r.json()).not_verified,1);
 assert.equal(statements.filter(([sql])=>sql.includes('INSERT INTO blue_search_quote_priority_r1594')).length,0);
});
test('old small JSON client remains supported',async()=>{
 const {db}=mock();const r=await requestSearchQuotes(new Request('https://test.invalid/api/prices/request',{method:'POST',body:JSON.stringify({items:[{code:'000400',day:'2026-11-06'}]})}),db);
 assert.equal(r.status,200);assert.equal((await r.json()).queued,1);
});
test('GET never queues',async()=>{
 const {db,statements}=mock();const r=await requestSearchQuotes(new Request('https://test.invalid/api/prices/request?items=000400:2026-11-06'),db);
 assert.equal(r.status,405);assert.equal(statements.length,0);
});

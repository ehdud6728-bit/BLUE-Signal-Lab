import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeRequested,requestSearchQuotes} from '../worker/src/search-quote-priority.ts';

const today='2026-11-12';
test('valid verified-looking pair and duplicate code collapsed',()=>{
 const x=decodeRequested([{code:'005930',day:'2026-11-10'},{code:'005930',day:'2026-11-02'}],today);
 assert.equal(x.length,1);assert.equal(x[0].day,'2026-11-10');
});
test('blocks arbitrary codes, invalid dates and requests of more than eight',()=>{
 assert.equal(decodeRequested([{code:'abcdef',day:'2026-11-10'}],today),null);
 assert.equal(decodeRequested([{code:'005930',day:'2026-11-31'}],today),null);
 assert.equal(decodeRequested([{code:'005930',day:'2026-11-13'}],today),null);
 assert.equal(decodeRequested(Array.from({length:9},(_,i)=>({code:String(i).padStart(6,'0'),day:'2026-11-10'})),today),null);
});
function dbMock({verified=true,existing=null}={}){
 const state={queries:[],writes:[]};
 const db={prepare(sql){
  const q={sql,args:[],bind(...args){this.args=args;return this;},
  async first(){state.queries.push([sql,this.args]);
   if(sql.includes('FROM signals s JOIN runs r'))return verified?{close_price:123}:null;
   if(sql.includes('SELECT requested_at_utc'))return existing?{requested_at_utc:existing}:null;
   throw Error('unexpected first query '+sql);
  },async run(){state.writes.push([sql,this.args]);return {meta:{changes:1}};}};
  return q;
 }};return {db,state};
}
test('POST stores validated discovery without touching external quote API',async()=>{
 const {db,state}=dbMock();
 const req=new Request('https://example.invalid/api/prices/request',{method:'POST',body:JSON.stringify({items:[{code:'005930',day:'2026-11-10'}]})});
 const resp=await requestSearchQuotes(req,db);const body=await resp.json();
 assert.equal(resp.status,200);assert.equal(body.queued,1);assert.equal(state.writes.length,2);
 assert.ok(state.writes.some(([q])=>q.includes('INSERT INTO blue_search_quote_priority_r1594')));
 assert.equal(JSON.stringify(state.queries).includes('https://'),false);
});
test('unverified symbols cannot enter the request queue',async()=>{
 const {db,state}=dbMock({verified:false});
 const req=new Request('https://example.invalid/api/prices/request',{method:'POST',body:JSON.stringify({items:[{code:'005930',day:'2026-11-10'}]})});
 const resp=await requestSearchQuotes(req,db);const data=await resp.json();
 assert.equal(data.not_verified,1);assert.equal(data.queued,0);
 assert.equal(state.writes.filter(([q])=>q.includes('INSERT INTO blue_search_quote_priority_r1594')).length,0);
});
test('invalid payload refuses writes',async()=>{
 const {db,state}=dbMock();
 const req=new Request('https://example.invalid/api/prices/request',{method:'POST',body:JSON.stringify({items:[{code:'foo',day:'2026-11-10'}]})});
 const resp=await requestSearchQuotes(req,db);
 assert.equal(resp.status,400);assert.equal(state.writes.length,0);
});

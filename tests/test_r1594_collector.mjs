import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSearchPriority} from '../collector/src/search-quote-priority.mjs';
const now=new Date('2026-11-12T03:00:00Z'); // 12:00 KST
function dbMock(available=true){
 const writes=[];const queries=[];
 const db={prepare(sql){const query={sql,values:[],bind(...args){this.values=args;return this;},
 async first(){queries.push([sql,this.values]);
  if(sql.includes('FROM sqlite_master'))return available?{name:'blue_search_quote_priority_r1594'}:null;
  throw Error('unexpected SELECT first '+sql);},
 async all(){queries.push([sql,this.values]);if(sql.includes('FROM blue_search_quote_priority_r1594'))return {results:[{code:'005930',base_day:'2026-11-10',baseline_close:10000}]};
  throw Error('unexpected SELECT all '+sql);},
 async run(){writes.push([sql,this.values]);return {meta:{changes:1}};}};
 return query;}};
 return {db,writes,queries};
}
test('collector does not call KIS without a verified queue',async()=>{
 const {db,writes}=dbMock(false);let called=0;
 const res=await collectSearchPriority({DB:db,COLLECTOR_ENABLED:'true'},now,{quote:async()=>{called++;}});
 assert.equal(res.status,'NOT_CONFIGURED');assert.equal(called,0);assert.equal(writes.length,0);
});
test('collector skips closed market, does not claim nonexistent live tick',async()=>{
 const {db}=dbMock(true);let called=0;
 const res=await collectSearchPriority({DB:db,COLLECTOR_ENABLED:'true'},now,{phases:()=>[],quote:async()=>{called++;}});
 assert.equal(res.status,'MARKET_CLOSED');assert.equal(called,0);
});
test('collector reuses vault token, writes validated REST price, never logs or stores token',async()=>{
 const {db,writes}=dbMock();const secret='DUMMY_SECRET_TOKEN';let calls=0;
 const env={DB:db,COLLECTOR_ENABLED:'true',KIS_APP_KEY:'app',KIS_APP_SECRET:'secret'};
 const res=await collectSearchPriority(env,now,{
  phases:()=>[['J','KRX_REGULAR']],token:async()=>secret,
  quote:async()=>{calls++;return {rt_cd:'0',output:{stck_prpr:'10300',stck_oprc:'10200',stck_hgpr:'10400',stck_lwpr:'10100',acml_vol:'1234',stck_bsop_date:'20261112'}};}
 });
 assert.equal(res.status,'PROCESSED');assert.equal(res.saved,1);assert.equal(calls,1);
 assert.ok(writes.some(([sql,vals])=>sql.includes("status='READY'")&&vals.includes(10300)&&vals.includes(10400)));
 assert.equal(JSON.stringify(writes).includes(secret),false);
});

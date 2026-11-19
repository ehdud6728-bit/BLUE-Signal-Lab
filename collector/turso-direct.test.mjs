import test from 'node:test';
import assert from 'node:assert/strict';
import {collectTursoDirect,tursoDirectMode} from './src/turso-direct.mjs';

const NOW=new Date('2026-11-19T00:05:15.000Z'); // 09:05 KST
const env=(extra={})=>({
  COLLECTOR_ENABLED:'true',
  TURSO_DATABASE_URL:'libsql://mock.example',
  TURSO_AUTH_TOKEN:'stub',
  TURSO_DIRECT_PILOT_UNTIL_UTC:'2026-11-19T00:20:15.000Z',
  KIS_APP_KEY:'key',KIS_APP_SECRET:'secret',
  // Reading legacy D1 must break this test (direct collector should never do so).
  DB:new Proxy({},{get(){throw Error('LEGACY_D1_USED');}}),
  ...extra
});
function mockDb({day='2026-11-18',expected=2,count=2,rows=null}={}){
  const state={closed:false,queries:[],batches:[]};
  const db={
    async execute(q){
      const sql=typeof q==='string'?q:q.sql;
      state.queries.push(sql);
      if(sql.includes('SELECT a.trade_day,a.row_count'))return {rows:[{trade_day:day,row_count:expected}]};
      if(sql.includes('SELECT COUNT(*) AS n'))return {rows:[{n:count}]};
      if(sql.includes('SELECT s.code,s.close_price'))return {rows:rows??[
        {code:'005930',close_price:'66000',signal_names:'BB20'},
        {code:'000660',close_price:'160000',signal_names:'ENV20'}]};
      if(sql.includes('SELECT ciphertext,expires_at_utc'))return {rows:[]};
      throw Error('UNEXPECTED_QUERY');
    },
    async batch(statements,mode){state.batches.push({statements,mode});},
    close(){state.closed=true;}
  };
  return {db,state};
}
function response(){return {rt_cd:'0',output:{
  stck_prpr:'66500',stck_oprc:'66300',stck_hgpr:'67200',
  stck_lwpr:'65400',acml_vol:'700000',stck_bsop_date:'20261119',
  stck_cntg_hour:'090510',prdy_ctrt:'1.25'
}};}

test('pilot expiry is timeboxed, never turns on by default',()=>{
  assert.equal(tursoDirectMode({},NOW),'OFF');
  assert.equal(tursoDirectMode(env(),NOW),'PILOT');
  assert.equal(tursoDirectMode(env({TURSO_DIRECT_PILOT_UNTIL_UTC:'2026-11-19T01:20:15.000Z'}),NOW),'OFF');
  assert.equal(tursoDirectMode(env({TURSO_DIRECT_PILOT_UNTIL_UTC:'2026-11-19T00:01:00.000Z'}),NOW),'OFF');
});
test('Turso collector uses independent audited selection and writes verified KIS latest plus history',async()=>{
  const {db,state}=mockDb();let calls=0;
  const result=await collectTursoDirect(env(),NOW,{
    clientFactory:()=>db,marketsFor:()=>[['J','KRX_REGULAR']],
    token:async()=> 'fake-validated-token',quote:async()=>{calls++;return response();},
    receivedAt:NOW,noPacing:true
  });
  assert.equal(result.status,'SAVED');assert.equal(result.saved,2);
  assert.equal(calls,2);assert.equal(state.batches.length,1);
  assert.equal(state.batches[0].mode,'write');
  assert.equal(state.batches[0].statements.length,4);
  assert.ok(state.queries.every(sql=>!sql.includes('D1')&&!sql.includes('sqlite_master')));
  assert.equal(state.closed,true);
});
test('no Turso token means no KIS provider request and no new token issuance',async()=>{
  const {db,state}=mockDb();
  const result=await collectTursoDirect(env(),NOW,{
    clientFactory:()=>db,marketsFor:()=>[['J','KRX_REGULAR']],
    quote:async()=>{throw Error('SHOULD_NOT_CALL_PROVIDER');}
  });
  assert.equal(result.status,'TURSO_TOKEN_MISSING');
  assert.equal(state.batches.length,0);
  assert.equal(state.closed,true);
});
test('incomplete independently audited research day blocks collection',async()=>{
  const {db,state}=mockDb({count:1});
  await assert.rejects(()=>collectTursoDirect(env(),NOW,{
    clientFactory:()=>db,marketsFor:()=>[['J','KRX_REGULAR']]
  }),/TURSO_DIRECT_INCOMPLETE_AUDIT/);
  assert.equal(state.batches.length,0);
  assert.equal(state.closed,true);
});
test('stale research signals never masquerade as current candidates',async()=>{
  const {db,state}=mockDb({day:'2026-11-01'});
  const result=await collectTursoDirect(env(),NOW,{
    clientFactory:()=>db,marketsFor:()=>[['J','KRX_REGULAR']]
  });
  assert.equal(result.status,'STALE_RESEARCH_DAY');
  assert.equal(state.batches.length,0);
});

test('verified KRX alphanumeric stocks can be collected; invalid codes never reach KIS',async()=>{
  const {db,state}=mockDb({expected:2,count:2,rows:[
    {code:'00088K',close_price:'15000',signal_names:'ENV20'},
    {code:'00-88K',close_price:'15000',signal_names:'ENV20'}
  ]});
  const queried=[]; const result=await collectTursoDirect(env(),NOW,{
    clientFactory:()=>db,marketsFor:()=>[['J','KRX_REGULAR']],
    token:async()=> 'fake-validated-token',
    quote:async(_env,_token,_market,code)=>{queried.push(code);return response();},
    receivedAt:NOW,noPacing:true
  });
  assert.equal(result.status,'SAVED');
  assert.equal(result.saved,1);
  assert.equal(result.rejected,1);
  assert.deepEqual(queried,['00088K']);
  assert.equal(state.batches[0].statements[0].args[2],'00088K');
});

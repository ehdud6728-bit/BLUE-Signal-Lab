import test from 'node:test';
import assert from 'node:assert/strict';
import {collectTursoInstant,tursoInstantEnabled} from '../src/turso-direct.mjs';

const NOW=new Date('2026-11-19T00:10:00.000Z');
const env=(extra={})=>({
  COLLECTOR_ENABLED:'true',TURSO_INSTANT_QUOTES_ENABLED:'true',
  TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'fake',
  KIS_APP_KEY:'fake-key',KIS_APP_SECRET:'fake-secret',
  DB:new Proxy({},{get(){throw Error('D1_QUOTA_EXCEEDED_UNEXPECTED_ACCESS');}}),...extra
});
const quote={rt_cd:'0',output:{stck_prpr:'66500',stck_oprc:'66300',stck_hgpr:'67200',
  stck_lwpr:'65400',acml_vol:'700000',stck_bsop_date:'20261119',prdy_ctrt:'1.25'}};
function mockClient({missing=false,stale=false,claim=1,budget=1,failWrite=false}={}){
  const state={calls:[],batches:[],closed:false};
  const client={
    async execute(q){
      const sql=typeof q==='string'?q:q.sql;
      const args=typeof q==='string'?[]:q.args;
      state.calls.push({sql,args});
      if(sql.includes('SELECT e.trade_day,e.close'))return {rows:missing?[]:[{
        trade_day:stale?'2026-11-01':'2026-11-18',close:'66000',name:'삼성전자'}]};
      if(sql.includes('blue_turso_instant_code_limit_v1')&&sql.includes('INSERT'))return {rowsAffected:claim};
      if(sql.includes('blue_turso_instant_minute_budget_v1')&&sql.includes('INSERT'))return {rowsAffected:budget};
      if(sql.includes('CREATE TABLE IF NOT EXISTS'))return {rowsAffected:0};
      throw Error('UNEXPECTED_TURSO_QUERY');
    },
    async batch(statements,mode){if(failWrite)throw Error('FAKE_DB_WRITE_FAILURE');
      state.batches.push({statements,mode});},
    close(){state.closed=true;}
  };
  return {client,state};
}
const deps=(client,extra={})=>({clientFactory:()=>client,marketsFor:()=>[['J','KRX_REGULAR']],
  token:async()=> 'FAKE_TOKEN_NOT_SECRET',quote:async()=>quote,receivedAt:NOW,...extra});

test('disabled, invalid symbol and market closed make no Turso or D1 connection',async()=>{
  assert.equal(tursoInstantEnabled(env()),true);
  assert.equal(tursoInstantEnabled(env({TURSO_INSTANT_QUOTES_ENABLED:'false'})),false);
  assert.equal((await collectTursoInstant(env(),'ABC/00',NOW)).status,'INVALID_CODE');
  assert.equal((await collectTursoInstant(env({TURSO_INSTANT_QUOTES_ENABLED:'false'}),'005930',NOW)).status,'DISABLED');
  assert.equal((await collectTursoInstant(env(),'005930',new Date('2026-11-19T13:10:00Z'))).status,'MARKET_CLOSED');
});
test('after close an instant lookup uses exact-date KIS daily quote and provisional-only storage',async()=>{
  const {client,state}=mockClient();
  const closing=new Date('2026-11-19T12:00:00Z'); // 21:00 KST
  let priceCalls=0,dailyCalls=0;
  const result=await collectTursoInstant(env(),'005930',closing,deps(client,{
    receivedAt:closing,
    quote:async()=>{priceCalls++;throw Error('CURRENT_PRICE_NOT_ALLOWED');},
    quoteDaily:async()=>{dailyCalls++;return quote;}
  }));
  assert.equal(result.status,'SAVED');
  assert.equal(priceCalls,0);assert.equal(dailyCalls,1);
  assert.equal(state.batches[0].statements.length,3);
  const provisional=state.batches[0].statements.find(s=>s.sql.includes('INSERT INTO blue_kis_provisional_daily_v1'));
  assert.ok(provisional);
  assert.equal(provisional.args[11],'KIS_REPORTED_TRADE_DATE');
  assert.equal(provisional.args[12],'KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL');
  assert.equal(state.batches[0].statements.some(s=>/blue_eod_ingest_audit|blue_research_signals/.test(s.sql)),false);
});
test('instant KIS quote saves latest and history in Turso without reading D1',async()=>{
  const {client,state}=mockClient();let calls=0;
  const result=await collectTursoInstant(env(),'005930',NOW,
    deps(client,{quote:async()=>{calls++;return quote;}}));
  assert.equal(result.status,'SAVED');assert.equal(result.market,'J');assert.equal(calls,1);
  assert.equal(result.price,66500);
  assert.equal(state.batches.length,1);assert.equal(state.batches[0].mode,'write');
  assert.equal(state.batches[0].statements.length,2);
  assert.ok(state.batches[0].statements.every(s=>/blue_kis_live_(quotes|history)_r141/.test(s.sql)));
  assert.equal(state.calls[0].args[0],'005930');assert.equal(state.closed,true);
  assert.equal(JSON.stringify(state).includes('FAKE_TOKEN_NOT_SECRET'),false);
});
test('unverified or stale Turso EOD prevents KIS and writes',async()=>{
  for(const variant of [{missing:true},{stale:true}]){
    const {client,state}=mockClient(variant);
    const result=await collectTursoInstant(env(),'005930',NOW,
      deps(client,{quote:async()=>{throw Error('KIS_MUST_NOT_BE_CALLED');}}));
    assert.equal(result.status,variant.missing?'NO_VERIFIED_EOD_REFERENCE':'STALE_OR_INVALID_EOD_REFERENCE');
    assert.equal(state.batches.length,0);assert.equal(state.calls.length,1);
  }
});
test('Turso token missing prevents all writes and KIS requests',async()=>{
  const {client,state}=mockClient();
  const result=await collectTursoInstant(env(),'005930',NOW,
    deps(client,{token:async()=>null,quote:async()=>{throw Error('KIS_CALLED');}}));
  assert.equal(result.status,'TURSO_TOKEN_MISSING');
  assert.equal(state.calls.length,1);assert.equal(state.batches.length,0);
});
test('atomic per-symbol and global limits fail closed before KIS',async()=>{
  for(const variant of [{claim:0,expected:'COOLDOWN'},{budget:0,expected:'RATE_LIMITED'}]){
    const {client,state}=mockClient(variant);let calls=0;
    const result=await collectTursoInstant(env(),'005930',NOW,
      deps(client,{quote:async()=>{calls++;return quote;}}));
    assert.equal(result.status,variant.expected);
    assert.equal(calls,0);assert.equal(state.batches.length,0);
  }
});
test('provider or Turso write failure does not call D1 or expose provider details',async()=>{
  for(const failWrite of [false,true]){
    const {client,state}=mockClient({failWrite});
    const result=await collectTursoInstant(env(),'005930',NOW,
      deps(client,failWrite?{}:{quote:async()=>{throw Error('secret-provider-body');}}));
    assert.deepEqual(result,{status:'QUOTE_UNAVAILABLE'});
    assert.equal(state.closed,true);
  }
});

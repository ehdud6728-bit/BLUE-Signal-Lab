import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupSymbolLive,requestSymbolLive,validLiveCode} from '../worker/src/symbol-live.ts';

const now=new Date('2026-11-17T05:50:00Z');
const data={code:'225190',market:'J',market_label:'KRX',phase:'KRX_REGULAR',
 trade_date_kst:'2026-11-17',received_at_utc:now.toISOString(),price:3320,
 open:3205,high:3360,low:3125,accumulated_volume:10000,official_eod:false,
 provider_trade_day_verified:true};
function db({known=true,snapshot=true}={}){
 const writes=[];
 return {writes,prepare(sql){return {bind(...args){this.args=args;return this;},
  async all(){return {results:['blue_symbol_directory_v1','blue_symbol_live_quotes_v1',
   'blue_symbol_live_requests_v1','blue_symbol_analysis_v1'].map(name=>({name}))};},
  async first(){
   if(sql.includes('SELECT name FROM blue_symbol_directory_v1'))return known?{name:'LK삼양'}:null;
   if(sql.includes('SELECT diagnosis_json FROM blue_symbol_analysis_v1'))return null;
   if(sql.includes('SELECT COUNT(*)'))return {n:0};
   if(sql.includes('FROM blue_symbol_live_quotes_v1'))return snapshot?
    {trade_date:data.trade_date_kst,market:'J',received_at_utc:now.toISOString(),payload_json:JSON.stringify(data)}:null;
   if(sql.includes('FROM blue_symbol_analysis_v1'))return null;
   return null;
  },async run(){writes.push({sql,args:this.args||[]});return {meta:{changes:1}};}};}};
}
test('quote request requires a real catalog / proven historical code',async()=>{
 assert.equal(validLiveCode('225190'),true);
 assert.equal(validLiveCode('22519/'),false);
 const mock=db({known:false});
 assert.equal((await requestSymbolLive(mock,'225190',now)).status,'UNKNOWN_SYMBOL');
 assert.equal(mock.writes.length,0);
});
test('a code may queue without any confirmed EOD for today',async()=>{
 const mock=db({snapshot:false});
 const out=await requestSymbolLive(mock,'225190',now);
 assert.equal(out.status,'QUEUED');
 assert.ok(mock.writes.some(x=>x.sql.includes('INSERT INTO blue_symbol_live_requests_v1')));
 assert.equal((await lookupSymbolLive(mock,'225190',now)).status,'NOT_COLLECTED');
});
test('stored quote explicitly labels source and historical status',async()=>{
 const mock=db();const out=await lookupSymbolLive(mock,'225190',now);
 assert.equal(out.status,'READY');
 assert.equal(out.name,'LK삼양');
 assert.equal(out.snapshot.official_eod,false);
 const stale=await lookupSymbolLive(mock,'225190',new Date('2026-11-18T05:50:00Z'));
 assert.equal(stale.status,'STALE_SNAPSHOT');
});
test('existing R1.4.1 KIS research snapshot is usable even before new collection',async()=>{
 const mock={prepare(sql){return {bind(){return this;},
  async all(){return {results:['blue_symbol_directory_v1','blue_kis_live_quotes_r141'].map(name=>({name}))};},
  async first(){
   if(sql.includes('SELECT name FROM blue_symbol_directory_v1'))return {name:'LK삼양'};
   if(sql.includes('FROM blue_kis_live_quotes_r141'))return {
    trade_date:data.trade_date_kst,market:'J',received_at_utc:now.toISOString(),
    payload_json:JSON.stringify({...data,source:'KIS_REST_INQUIRE_PRICE'})};
   return null;
  }};}};
 const result=await lookupSymbolLive(mock,'225190',now);
 assert.equal(result.status,'READY');
 assert.equal(result.snapshot.source,'KIS_REST_INQUIRE_PRICE');
 assert.equal(result.snapshot.official_eod,false);
});
test('missing provider trade-day proof remains explicitly unverified',async()=>{
 const mock=db();
 const originalPrepare=mock.prepare.bind(mock);
 mock.prepare=sql=>{
  const stmt=originalPrepare(sql);
  if(sql.includes('FROM blue_symbol_live_quotes_v1')){
   stmt.first=async()=>({trade_date:data.trade_date_kst,market:'J',
    received_at_utc:now.toISOString(),payload_json:JSON.stringify({...data,
     provider_trade_day_verified:false})});
  }
  return stmt;
 };
 const result=await lookupSymbolLive(mock,'225190',now);
 assert.equal(result.status,'DAY_UNVERIFIED');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSymbolLiveQuote,collectSymbolLivePriority} from '../src/symbol-live.mjs';

const now=new Date('2026-11-17T05:50:00Z'); // KST 14:50
const quote=(extra={})=>({rt_cd:'0',output:{stck_prpr:'3320',stck_oprc:'3205',
 stck_hgpr:'3360',stck_lwpr:'3125',acml_vol:'1055000',acml_tr_pbmn:'3400000000',
 stck_bsop_date:'20261117',prdy_ctrt:'3.5',...extra}});

test('standalone KIS quote does not need same-day EOD or invent turnover units',()=>{
 const q=parseSymbolLiveQuote('225190','J','KRX_REGULAR',quote(),now);
 assert.equal(q.trade_date_kst,'2026-11-17');
 assert.equal(q.price,3320);
 assert.equal(q.accumulated_turnover_raw,'3400000000');
 assert.equal(q.turnover_unit_verified,false);
 assert.equal(q.official_eod,false);
 assert.equal(q.market_label,'KRX');
 assert.equal(q.phase,'KRX_REGULAR');
 assert.equal(q.provider_trade_day_verified,true);
});
test('provider-date mismatch and impossible quote are rejected',()=>{
 assert.throws(()=>parseSymbolLiveQuote('225190','J','KRX_REGULAR',quote({stck_bsop_date:'20261116'}),now),/TRADE_DATE_MISMATCH/);
 assert.throws(()=>parseSymbolLiveQuote('225190','J','KRX_REGULAR',quote({stck_prpr:'5000'}),now),/QUOTE_INCONSISTENT/);
 assert.throws(()=>parseSymbolLiveQuote('225190','J','KRX_REGULAR',quote({acml_vol:'-1'}),now),/QUOTE_INCONSISTENT/);
});
test('NXT is explicitly separate from KRX official EOD',()=>{
 const q=parseSymbolLiveQuote('225190','NX','NXT_AFTER',quote(),now);
 assert.equal(q.market_label,'NXT');assert.equal(q.phase,'NXT_AFTER');
 assert.equal(q.official_eod,false);
});
test('outside the market window never accesses DB or KIS',async()=>{
 const env={COLLECTOR_ENABLED:'true',DB:{prepare(){throw Error('DB_CONTACTED');}}};
 const out=await collectSymbolLivePriority(env,new Date('2026-11-17T12:00:00Z'));
 assert.equal(out.status,'MARKET_CLOSED');
});
test('collector queues one verified-receipt snapshot without touching EOD tables',async()=>{
 const writes=[];
 const db={prepare(sql){return {bind(...args){this.args=args;return this;},
  async first(){if(sql.includes('sqlite_master'))return {name:'blue_symbol_live_requests_v1'};return null;},
  async all(){return {results:[{code:'225190'}]};},
  async run(){writes.push({sql,args:this.args||[]});return {meta:{changes:1}};}};}};
 const result=await collectSymbolLivePriority({COLLECTOR_ENABLED:'true',DB:db},now,{
  phases:()=>[['J','KRX_REGULAR']],token:async()=> 'TEST_TOKEN',quote:async()=>quote()});
 assert.equal(result.saved,1);
 assert.ok(writes.some(x=>x.sql.includes('INSERT INTO blue_symbol_live_quotes_v1')));
 assert.ok(writes.every(x=>!/(INSERT|UPDATE|DELETE)\s+(INTO\s+)?(signals|runs|daily_counts)\b/i.test(x.sql)));
});

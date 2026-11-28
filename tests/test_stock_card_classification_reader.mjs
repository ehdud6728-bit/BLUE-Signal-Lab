import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {attachStockCardClassification} from '../worker/src/stock-card-classification.ts';
import {stockCardClassification} from '../web/src/stock-card-classification.ts';
const day='2026-11-26',hash='a'.repeat(64),code='100790';
const row={market:'KOSDAQ',name:'미래에셋벤처투자',industry:'금융',close:100,themes:[{label:'2차전지',index:'KRX 2차전지 TOP 10 지수'}]};
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE blue_eod_ingest_audit_v1 (trade_day TEXT PRIMARY KEY,day_sha256 TEXT); CREATE TABLE blue_stock_card_classification_v1 (trade_day TEXT PRIMARY KEY,payload_json TEXT,payload_sha256 TEXT)');
 for(const d of [day,'2026-11-30']){
  db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES (?,?)').run(d,hash);
  db.prepare('INSERT INTO blue_stock_card_classification_v1 VALUES (?,?,?)').run(d,JSON.stringify({schema:'BLUE_STOCK_CARD_CLASSIFICATION_V1',day:d,eod_sha256:hash,industry_source:'KRX_VIA_PYKRX_1_2_9',theme_status:'REQUESTED_DATE_MEMBERS_UNVERIFIED',theme_coverage:{available:38,total:39},rows:{[code]:row}}),hash);
 }
 return {db,client:{execute:async({sql,args})=>({rows:db.prepare(sql).all(...args)})}};
}
test('exact-day and prior reference classification does not look into future or affect ordering',async()=>{
 const {db,client}=fixture();
 try{
  const items=[{code,day:'2026-11-27',name:row.name,close_price:101,extras:{}},{code,day,name:row.name,close_price:100,extras:{}},{code,day:'2026-11-25',extras:{stock_card_classification:'forged'}},{code,day,name:row.name,close_price:999,extras:{}},{code,day,name:'다른 회사',close_price:100,extras:{}},{code:'000000',day,extras:{}}];
  const keys=items.map(x=>x.code+':'+x.day);await attachStockCardClassification(client,items);
  assert.deepEqual(items.map(x=>x.code+':'+x.day),keys);
  assert.equal(items[0].extras.stock_card_classification.asof,day);
  assert.equal(items[1].extras.stock_card_classification.industry,'금융');
  for(const item of items.slice(2))assert.equal(item.extras.stock_card_classification,undefined);
  const live=[{code,name:row.name,extras:{}}];await attachStockCardClassification(client,live,day);
  assert.equal(live[0].extras.stock_card_classification.asof,day);
 }finally{db.close()}
});
test('metadata absence and mismatched audit are nonfatal',async()=>{
 const {db,client}=fixture();try{
  const x={code,day,extras:{stock_card_classification:'forged'}};
  db.prepare('UPDATE blue_eod_ingest_audit_v1 SET day_sha256=? WHERE trade_day=?').run('bad',day);
  await attachStockCardClassification(client,[x]);assert.equal(x.extras.stock_card_classification,undefined);
  db.exec('DROP TABLE blue_stock_card_classification_v1');await attachStockCardClassification(client,[x]);assert.equal(x.extras.stock_card_classification,undefined);
 }finally{db.close()}
});
test('reported theme is separate from KRX, identity-checked and not backdated',()=>{
 const x=stockCardClassification(code,row.name,day,{});assert.equal(x.event.label,'SpaceX');assert.equal(x.industry,null);
 assert.equal(stockCardClassification(code,row.name,'2026-04-13',{}).event,null);
 assert.equal(stockCardClassification(code,'다른 회사',day,{}).event,null);
 const e={stock_card_classification:{asof:day,source:'KRX_DATED_REFERENCE',market:'KOSDAQ',industry:'금융',themes:[...row.themes,...row.themes]}};
 assert.deepEqual(stockCardClassification(code,row.name,day,e).labels,['2차전지']);
 assert.equal(stockCardClassification(code,row.name,'2026-11-25',e).industry,null);
 assert.equal(stockCardClassification(code,row.name,'2026-12-05',e).industry,null);
});

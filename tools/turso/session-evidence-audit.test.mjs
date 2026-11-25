import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {auditSessions} from './session-evidence-audit.mjs';
const day='2026-11-25',now=new Date('2026-11-26T00:00:00Z');
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE blue_kis_provisional_daily_v1(trade_day TEXT,code TEXT,market TEXT,open INT,high INT,low INT,close INT,volume INT,observed_at_utc TEXT,source TEXT,date_basis TEXT);
 CREATE TABLE blue_kis_live_quotes_r141(trade_date TEXT,market TEXT,code TEXT,received_at_utc TEXT,payload_json TEXT);
 CREATE TABLE blue_kis_live_history_r141(trade_date TEXT,market TEXT,code TEXT,received_at_utc TEXT,price INT,volume INT,phase TEXT);
 CREATE TABLE blue_eod_daily_v1(trade_day TEXT,code TEXT,open INT,high INT,low INT,close INT,volume INT);
 CREATE TABLE blue_eod_ingest_audit_v1(trade_day TEXT,row_count INT);`);
 const insert=(code,at,close=105,payload=true)=>{
  db.prepare('INSERT INTO blue_kis_provisional_daily_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(day,code,'J',100,110,90,close,1000,at,'KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL','KIS_REPORTED_TRADE_DATE');
  if(payload)db.prepare('INSERT INTO blue_kis_live_quotes_r141 VALUES(?,?,?,?,?)').run(day,'J',code,at,JSON.stringify({source:'KIS_REST_INQUIRE_DAILY_PRICE',provider_endpoint:'inquire-daily-itemchartprice',reported_trade_date:'20261125',trade_date_kst:day,received_at_utc:at,open:100,high:110,low:90,price:close,accumulated_volume:1000,is_confirmed_daily:false}));
 };
 insert('000001','2026-11-25T07:00:00Z');
 insert('000002','2026-11-25T11:05:00Z',106);
 insert('000003','2026-11-25T06:25:00Z');
 insert('000004','2026-11-25T10:00:00Z',105,false);
 const history=db.prepare('INSERT INTO blue_kis_live_history_r141 VALUES(?,?,?,?,?,?,?)');
 history.run(day,'J','000001','2026-11-25T07:00:00Z',101,100,'KRX_AFTER');
 history.run(day,'NX','000001','2026-11-25T10:50:00Z',101,100,'NXT_AFTER');
 history.run(day,'J','000001','2026-11-25T10:59:00Z',105,1000,'KRX_POST_CLOSE');
 history.run(day,'J','000001','2026-11-25T11:00:00Z',101,100,'KRX_AFTER');
 return {db,client:{execute:async({sql,args})=>{assert.match(sql,/^SELECT\b/);return {rows:db.prepare(sql).all(...args)};}}};
}
test('session receipt counts do not treat daily close responses as aftermarket trades',async()=>{
 const {db,client}=fixture();
 try{
  const r=await auditSessions(client,day,now);
  assert.equal(r.comparison,null);
  assert.equal(r.daily_evidence.reduce((n,x)=>n+x.n,0),4);
  assert.equal(r.daily_evidence.reduce((n,x)=>n+x.evidence_match,0),3);
  assert.deepEqual(r.aftermarket_receipts,[{market:'J',phase:'KRX_AFTER',receipts:1,symbols:1},{market:'NX',phase:'NXT_AFTER',receipts:1,symbols:1}]);
 }finally{db.close();}
});
test('compares only post-close exact matching payloads and complete audited EOD',async()=>{
 const {db,client}=fixture();
 try{
  db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES(?,1700)').run(day);
  assert.equal((await auditSessions(client,day,now)).comparison,null);
  db.prepare("WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i<1700) INSERT INTO blue_eod_daily_v1 SELECT ?,printf('%06d',i),100,110,90,105,1000 FROM seq").run(day);
  const r=await auditSessions(client,day,now);
  assert.equal(r.eod.state,'AUDITED_ROW_COUNT_MATCH');
  assert.equal(r.comparison.reduce((n,x)=>n+x.paired,0),2);
  assert.equal(r.comparison.reduce((n,x)=>n+x.close_match,0),1);
  assert.equal(r.comparison.reduce((n,x)=>n+x.all_ohlcv_match,0),1);
  assert.equal(r.comparison.reduce((n,x)=>n+x.volume_match,0),2);
 }finally{db.close();}
});

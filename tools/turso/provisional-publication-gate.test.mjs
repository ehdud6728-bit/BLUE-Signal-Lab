import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {publicationGate} from './provisional-publication-gate.mjs';

function fixture({quotes=true,head=null,eod=false,incomplete=false,latest='2026-11-25T05:15:00Z'}={}){
 const db=new DatabaseSync(':memory:');
 db.exec("CREATE TABLE blue_eod_ingest_audit_v1(trade_day TEXT,row_count INT); INSERT INTO blue_eod_ingest_audit_v1 VALUES('2026-11-24',2660); CREATE TABLE blue_kis_provisional_daily_v1(trade_day TEXT,reference_day TEXT,market TEXT,date_basis TEXT,source TEXT,observed_at_utc TEXT);");
 db.exec("CREATE TABLE blue_eod_daily_v1(trade_day TEXT,code TEXT)");
 const insertDay=(day,n)=>db.prepare("WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i<?) INSERT INTO blue_eod_daily_v1 SELECT ?,printf('%06d',i) FROM seq").run(n,day);
 insertDay('2026-11-24',incomplete&&!eod?2659:2660);
 if(eod){db.exec("INSERT INTO blue_eod_ingest_audit_v1 VALUES('2026-11-25',2660)");insertDay('2026-11-25',incomplete?2659:2660);}
 if(quotes)db.prepare('INSERT INTO blue_kis_provisional_daily_v1 VALUES(?,?,?,?,?,?)').run('2026-11-25','2026-11-24','J','KIS_REPORTED_TRADE_DATE','KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL',latest);
 if(head){db.exec('CREATE TABLE blue_provisional_pattern_head_v1(trade_day TEXT,reference_day TEXT,latest_observed_utc TEXT)');db.prepare('INSERT INTO blue_provisional_pattern_head_v1 VALUES(?,?,?)').run('2026-11-25','2026-11-24',head);}
 return {db,client:{execute:async({sql,args})=>{assert.match(sql,/^SELECT/);return {rows:db.prepare(sql).all(...args)};}}};
}
test('current fresh quotes are eligible, identical snapshot and stale quotes skipped only on schedule',async()=>{
 const now=new Date('2026-11-25T05:20:00Z');
 for(const [opts,reason] of [[{},'CURRENT_QUOTES_AVAILABLE'],[{head:'2026-11-25T05:15:00Z'},'NO_NEW_QUOTES'],[{latest:'2026-11-25T03:00:00Z'},'STALE_QUOTES'],[{quotes:false},'NO_CURRENT_QUOTES'],[{eod:true},'EOD_ALREADY_AVAILABLE']]){
  const f=fixture(opts);
  try{const result=await publicationGate(f.client,now,{scheduled:true});assert.equal(result.reason,reason);assert.equal(result.ready,reason==='CURRENT_QUOTES_AVAILABLE');}finally{f.db.close();}
 }
 const f=fixture({head:'2026-11-25T05:15:00Z'});
 try{assert.equal((await publicationGate(f.client,now)).ready,true);assert.equal((await publicationGate(f.client,new Date('2026-11-25T13:30:00Z'))).ready,false);assert.equal((await publicationGate(f.client,new Date('2026-11-28T05:20:00Z'))).ready,false);}finally{f.db.close();}
});

test('incomplete EOD audit is an explicit error, not a successful skip or valid baseline',async()=>{
 const now=new Date('2026-11-25T05:20:00Z');
 for(const eod of [true,false]){
  const f=fixture({eod,incomplete:true});
  try{await assert.rejects(publicationGate(f.client,now,{scheduled:true}),/EOD_AUDIT_COUNT_MISMATCH/);}
  finally{f.db.close();}
 }
});

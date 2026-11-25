import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {auditPublication} from './provisional-publication-audit.mjs';
const day='2026-11-25',ref='2026-11-24',now=new Date('2026-11-25T13:40:00Z');
const sha=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE blue_provisional_pattern_head_v1(trade_day,reference_day,snapshot_id,latest_observed_utc,scan_asof_utc,row_count,metadata_json);
 CREATE TABLE blue_provisional_pattern_rows_v1(snapshot_id,code,record_json,row_sha256);
 CREATE TABLE blue_eod_ingest_audit_v1(trade_day,row_count);
 CREATE TABLE blue_eod_daily_v1(trade_day,code);
 CREATE TABLE blue_research_signal_audit_v1(trade_day,row_count,observed_stocks,signal_events,source_payload_sha256);
 CREATE TABLE blue_research_signals_v1(trade_day,code,signal_names,source_payload_sha256);`);
 const at='2026-11-25T10:00:00.000Z',scan='2026-11-25T10:05:00.000Z';
 const meta=JSON.stringify({day,pattern_confirmed:false,scan_asof_utc:scan,quote_coverage:{reference:ref},history_metadata:{reference:ref},observed:5,eligible:4,audit:{asof:day,matched_stocks:2,signal_events:3}});
 const rows=[['000660','ENV20,BB20'],['005930','ENV20']].map(([code,signals])=>{const raw=JSON.stringify({code,date:day,signals,provisional:true,pattern_confirmed:false});return [code,raw,sha(raw)];});
 const id=sha(JSON.stringify([meta,...rows.map(r=>r[2])]));
 db.prepare('INSERT INTO blue_provisional_pattern_head_v1 VALUES (?,?,?,?,?,?,?)').run(day,ref,id,at,scan,2,meta);
 for(const row of rows)db.prepare('INSERT INTO blue_provisional_pattern_rows_v1 VALUES (?,?,?,?)').run(id,...row);
 const confirmed=()=>{
  db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES (?,1700)').run(day);
  db.prepare("WITH RECURSIVE seq(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM seq WHERE i<1700) INSERT INTO blue_eod_daily_v1 SELECT ?,printf('%06d',i) FROM seq").run(day);
  db.prepare('INSERT INTO blue_research_signal_audit_v1 VALUES (?,2,1700,3,?)').run(day,'a'.repeat(64));
  for(const [code,s] of [['000660','ENV20,MACD_GC'],['035720','ENV20']])db.prepare('INSERT INTO blue_research_signals_v1 VALUES (?,?,?,?)').run(day,code,s,'a'.repeat(64));
 };
 const client={execute:async({sql,args})=>{assert.match(sql,/^SELECT/);return {rows:db.prepare(sql).all(...args)};}};
 return {db,client,confirmed};
}
test('pending confirmed data preserves publication coverage without claiming parity',async()=>{
 const f=fixture();try{
 const r=await auditPublication(f.client,day,now);
 assert.equal(r.status,'PUBLISHED_CONFIRMED_COMPARISON_PENDING');assert.equal(r.publication.matched,2);assert.equal(r.publication.eligible,4);assert.equal(r.comparison,null);
 }finally{f.db.close();}
});
test('positive-set overlap counts are distinct from stock coverage and missing signal eligibility',async()=>{
 const f=fixture();try{f.confirmed();const r=await auditPublication(f.client,day,now);
 assert.equal(r.status,'POSITIVE_SET_COMPARISON_AVAILABLE');
 assert.equal(r.comparison.common_matched_symbols,1);assert.equal(r.comparison.common_symbol_signal_events,1);
 assert.equal(r.comparison.provisional_only_events,2);assert.equal(r.comparison.confirmed_only_events,2);
 }finally{f.db.close();}
});
test('bad manifest and incomplete confirmed day fail closed',async()=>{
 for(const corrupt of [f=>f.db.exec("UPDATE blue_provisional_pattern_rows_v1 SET row_sha256='"+'b'.repeat(64)+"'"),f=>{f.confirmed();f.db.exec("DELETE FROM blue_eod_daily_v1 WHERE code='000001'");},f=>{f.confirmed();f.db.exec("UPDATE blue_research_signals_v1 SET source_payload_sha256='invalid'");}]){
  const f=fixture();try{corrupt(f);await assert.rejects(auditPublication(f.client,day,now),/MISMATCH|INCOMPLETE_CONFIRMED_AUDIT/);}finally{f.db.close();}
 }
});
test('absent publication is not fabricated',async()=>{
 const f=fixture();try{f.db.exec('DELETE FROM blue_provisional_pattern_head_v1');const r=await auditPublication(f.client,day,now);assert.equal(r.status,'NO_PUBLISHED_SNAPSHOT');assert.equal(r.comparison,null);}finally{f.db.close();}
});

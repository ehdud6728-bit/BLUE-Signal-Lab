/** Bounded SELECT-only comparison of the last published positive set with the
 * audited confirmed positive set. Does not reconstruct missing denominators.
 */
import {createHash} from 'node:crypto';
import {createClient} from '@libsql/client/web';
import {pathToFileURL} from 'node:url';
import {auditDay} from './provisional-audit.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const require=(ok,reason)=>{if(!ok)throw Error(reason);};
const n=v=>{const x=Number(v);require(v!=null&&Number.isSafeInteger(x)&&x>=0&&x<=1000000,'INVALID_COUNT');return x;};
const code=/^[0-9A-Z]{6}$/;
const hash=/^[a-f0-9]{64}$/;
const flags=s=>{const a=String(s??'').split(',');require(a.every(x=>/^[A-Z0-9_]{2,60}$/.test(x))&&new Set(a).size===a.length,'INVALID_SIGNAL_NAMES');return a;};
function positiveSet(rows){
 const out=new Map();
 for(const row of rows){const c=String(row.code);require(code.test(c)&&!out.has(c),'INVALID_SYMBOL_SET');out.set(c,flags(row.signals));}
 return out;
}
export async function auditPublication(db,day,now=new Date()){
 day=auditDay(day,now);
 const q=async(sql,args=[])=>(await db.execute({sql,args})).rows;
 const tables=['blue_provisional_pattern_head_v1','blue_provisional_pattern_rows_v1','blue_eod_ingest_audit_v1','blue_eod_daily_v1','blue_research_signal_audit_v1','blue_research_signals_v1'];
 const found=new Set((await q('SELECT name FROM sqlite_master WHERE type=\'table\' AND name IN (?,?,?,?,?,?)',tables)).map(r=>String(r.name)));
 const out={day,status:'NO_PUBLISHED_SNAPSHOT',publication:null,comparison:null,
  missing_tables:tables.filter(x=>!found.has(x)),
  limits:['LATEST_PUBLISHED_GENERATION_ONLY','POSITIVE_SET_OVERLAP_NOT_PATTERN_RETENTION','COMMON_ELIGIBLE_UNIVERSE_NOT_SAVED','NO_FULL_PAYLOAD_REHASH','NO_INDEPENDENT_HISTORY_OR_CALENDAR_PARITY']};
 if(!tables.slice(0,2).every(t=>found.has(t)))return out;
 const heads=await q('SELECT * FROM blue_provisional_pattern_head_v1 WHERE trade_day=?',[day]);
 require(heads.length<=1,'DUPLICATE_PUBLICATION_HEAD');
 if(!heads.length)return out;
 const h=heads[0],m=JSON.parse(String(h.metadata_json)),id=String(h.snapshot_id),expected=n(h.row_count);
 require(hash.test(id)&&m.day===day&&m.pattern_confirmed===false&&m.quote_coverage?.reference===h.reference_day&&
  m.history_metadata?.reference===h.reference_day&&h.reference_day<day&&m.audit?.asof===day&&
  n(m.audit.matched_stocks)===expected&&n(m.eligible)>=expected&&n(m.observed)>=n(m.eligible)&&
  Date.parse(m.scan_asof_utc)===Date.parse(h.scan_asof_utc)&&Number.isFinite(Date.parse(h.latest_observed_utc))&&Date.parse(h.latest_observed_utc)<=Date.parse(h.scan_asof_utc),'INVALID_HEAD_METADATA');
 const rows=await q(`SELECT code,row_sha256,json_extract(record_json,'$.signals') AS signals,
  json_extract(record_json,'$.code') AS record_code,json_extract(record_json,'$.date') AS record_day,
  json_extract(record_json,'$.provisional') AS provisional,json_extract(record_json,'$.pattern_confirmed') AS confirmed
  FROM blue_provisional_pattern_rows_v1 WHERE snapshot_id=? ORDER BY code LIMIT 10001`,[id]);
 require(expected<=10000&&rows.length===expected&&rows.every(r=>hash.test(String(r.row_sha256))&&r.code===r.record_code&&r.record_day===day&&Number(r.provisional)===1&&r.confirmed!=null&&Number(r.confirmed)===0),'PUBLICATION_ROW_MISMATCH');
 require(sha(JSON.stringify([String(h.metadata_json),...rows.map(r=>String(r.row_sha256))]))===id,'PUBLICATION_MANIFEST_MISMATCH');
 const p=positiveSet(rows);
 const events=[...p.values()].reduce((s,a)=>s+a.length,0);
 require(events===n(m.audit.signal_events),'PUBLICATION_EVENT_MISMATCH');
 out.publication={snapshot_id:id,reference_day:h.reference_day,scan_asof_utc:h.scan_asof_utc,latest_observed_utc:h.latest_observed_utc,
  observed:n(m.observed),eligible:n(m.eligible),matched:expected,events,
  rejected:m.quote_coverage.rejectedCount==null?null:n(m.quote_coverage.rejectedCount),
  manifest_matches:true,baseline_revision:m.history_metadata.baseline_revision??null,baseline_cache:m.history_metadata.baseline_cache??null};
 out.status='PUBLISHED_CONFIRMED_COMPARISON_PENDING';
 if(tables.slice(2).every(t=>found.has(t))){
  const e=await q('SELECT row_count FROM blue_eod_ingest_audit_v1 WHERE trade_day=?',[day]);
  const a=await q('SELECT row_count,observed_stocks,signal_events,source_payload_sha256 FROM blue_research_signal_audit_v1 WHERE trade_day=?',[day]);
  require(e.length<=1&&a.length<=1,'DUPLICATE_CONFIRMED_AUDIT');
  if(e.length&&a.length){
   const ec=n(e[0].row_count),ac=n(a[0].row_count),observed=n(a[0].observed_stocks);
   const actual=n((await q('SELECT COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day=?',[day]))[0]?.n);
   require(ec>=1700&&ec<=10000&&actual===ec&&observed>=1700&&observed<=10000&&ac<=observed&&hash.test(String(a[0].source_payload_sha256)),'INCOMPLETE_CONFIRMED_AUDIT');
   const crows=await q('SELECT code,signal_names AS signals,source_payload_sha256 FROM blue_research_signals_v1 WHERE trade_day=? ORDER BY code LIMIT 10001',[day]);
   require(crows.length===ac&&crows.every(r=>r.source_payload_sha256===a[0].source_payload_sha256),'CONFIRMED_ROW_MISMATCH');
   const c=positiveSet(crows),ce=[...c.values()].reduce((s,v)=>s+v.length,0);
   require(ce===n(a[0].signal_events),'CONFIRMED_EVENT_MISMATCH');
   let commonSymbols=0,commonEvents=0;
   for(const [symbol,ps] of p){const cs=c.get(symbol);if(cs){commonSymbols++;commonEvents+=ps.filter(x=>cs.includes(x)).length;}}
   out.comparison={confirmed_eod_rows:ec,confirmed_observed:observed,confirmed_matched:ac,confirmed_events:ce,
    common_matched_symbols:commonSymbols,provisional_only_matched_symbols:p.size-commonSymbols,confirmed_only_matched_symbols:c.size-commonSymbols,
    common_symbol_signal_events:commonEvents,provisional_only_events:events-commonEvents,confirmed_only_events:ce-commonEvents};
   out.status='POSITIVE_SET_COMPARISON_AVAILABLE';
  }
 }
 const end=await q('SELECT snapshot_id FROM blue_provisional_pattern_head_v1 WHERE trade_day=?',[day]);
 require(end.length===1&&String(end[0].snapshot_id)===id,'PUBLICATION_CHANGED_DURING_AUDIT');
 return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let db;
 try{db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
  console.log('BLUE_PUBLICATION_COMPARISON_AUDIT',JSON.stringify(await auditPublication(db,process.argv[2])));
 }catch(e){console.error('BLUE_PUBLICATION_COMPARISON_AUDIT_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'UNAVAILABLE');process.exitCode=1;}finally{db?.close();}
}

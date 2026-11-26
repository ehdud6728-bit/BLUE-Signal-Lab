/** Full universe, immutable KRX original-byte hash verification, bounded SELECT only. */
import {createClient} from '@libsql/client';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {reconstructVerifiedDay} from './research-v2-eod-export.mjs';
const fail=(ok,code)=>{if(!ok)throw Error(code);};
const int=x=>{const n=Number(x);fail(x!==null&&x!==undefined&&Number.isSafeInteger(n)&&n>=0,'FULL_BAD_COUNT');return n;};
export async function exportUniverse(db,{sessions=60,cutoff}){
 fail([30,60].includes(sessions)&&/^20\d{2}-\d{2}-\d{2}$/.test(cutoff)&&Number.isFinite(Date.parse(cutoff))&&new Date(cutoff+'T00:00:00Z').toISOString().slice(0,10)===cutoff,'FULL_BAD_REQUEST');
 const audit=(await db.execute({sql:'SELECT trade_day,row_count,source,day_sha256 FROM blue_eod_ingest_audit_v1 WHERE trade_day<=? ORDER BY trade_day DESC LIMIT ?',args:[cutoff,sessions]})).rows.reverse();
 fail(audit.length>0&&audit.length<=sessions,'FULL_NO_AUDIT');
 const days=[],bars=[],signals=[];let prev='';
 for(const a of audit){
  const day=a.trade_day;fail(day>prev&&day<=cutoff,'FULL_BAD_DATE_ORDER');prev=day;
  const rows=(await db.execute({sql:'SELECT trade_day,code,market,name,open,high,low,close,volume,amount,source FROM blue_eod_daily_v1 WHERE trade_day=? ORDER BY code',args:[day]})).rows;
  const proof=reconstructVerifiedDay(day,a,rows);
  fail(proof.manifest.total_rows===rows.length,'FULL_PROOF_MISMATCH');
  const codes=new Set(rows.map(x=>x.code));
  for(const r of rows){
   const values={};for(const k of ['open','high','low','close','amount']){values[k]=int(r[k]);fail(values[k]>0,'FULL_BAD_VALUE');}
   bars.push({day,code:r.code,market:r.market,...values});
  }
  const sa=(await db.execute({sql:'SELECT trade_day,row_count,observed_stocks,signal_events,source_payload_sha256 FROM blue_research_signal_audit_v1 WHERE trade_day=?',args:[day]})).rows;
  fail(sa.length<=1,'FULL_DUP_SIGNAL_AUDIT');
  let signal_status='MISSING_AUDIT';
  if(sa.length){
   const s=sa[0];fail(s.trade_day===day,'FULL_BAD_SIGNAL_AUDIT');
   if(int(s.observed_stocks)!==rows.length)signal_status='UNIVERSE_COUNT_MISMATCH';
   else{
    const sr=(await db.execute({sql:'SELECT code,signal_names,source_payload_sha256 FROM blue_research_signals_v1 WHERE trade_day=? ORDER BY code',args:[day]})).rows;
    fail(/^[a-f0-9]{64}$/.test(s.source_payload_sha256)&&sr.length===int(s.row_count)&&sr.length<=rows.length,'FULL_BAD_SIGNAL_AUDIT');
    let prior='',events=0;
    for(const x of sr){
     const names=String(x.signal_names).split(',');
     fail(codes.has(x.code)&&x.code>prior&&x.source_payload_sha256===s.source_payload_sha256&&names.length<=30&&names.every(n=>/^[A-Z0-9_]{2,60}$/.test(n))&&names.join(',')===[...new Set(names)].sort().join(','),'FULL_BAD_SIGNAL_ROW');
     prior=x.code;events+=names.length;signals.push({day,code:x.code,names});
    }
    fail(events===int(s.signal_events),'FULL_SIGNAL_EVENTS_MISMATCH');
    signal_status='COUNT_AND_PAYLOAD_HASH_METADATA_MATCH';
   }
  }
  days.push({day,rows:rows.length,sha256:a.day_sha256,source:a.source,signal_status});
 }
 return {schema:'BLUE_FULL_UNIVERSE_SOURCE_V1',cutoff,days,bars,signals,original_eod_hashes_recomputed:true};
}
async function main(){
 const cutoff=new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10);
 const url=process.env.TURSO_DATABASE_URL||'',authToken=process.env.TURSO_AUTH_TOKEN||'';
 fail(/^(libsql|https):\/\//.test(url)&&authToken,'FULL_CONFIG_MISSING');
 const db=createClient({url,authToken,intMode:'string'});
 try{
  const data=await exportUniverse(db,{sessions:60,cutoff});
  const out='output/full-universe/source.json';await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(data)+'\n');
  console.log('BLUE_FULL_UNIVERSE_SOURCE',JSON.stringify({days:data.days.length,first:data.days[0].day,last:data.days.at(-1).day,bars:data.bars.length,signal_rows:data.signals.length,hash_recomputed:true,writes:0}));
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)main().catch(e=>{console.error('BLUE_FULL_UNIVERSE_FAILED',/^(FULL_|V2_REPLAY_)[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1;});

/** Separate corrected historical replay; no database writes or original-record substitution. */
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {verifySignalSnapshot} from './signal-snapshot-import.mjs';
import {readReport,buildReport} from './discovery-high15.mjs';
import {seal} from './discovery-high15-case-seal.mjs';
const DAYS=['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-23','2026-11-24','2026-11-25','2026-11-26'];
const SCOPE='DAILY_KRX_TARGET_KOSDAQ_GLOBAL_COPY_V1';
const need=(ok,code)=>{if(!ok)throw Error(code)};
const sha=x=>createHash('sha256').update(x).digest('hex');
const readJSON=async p=>JSON.parse(await readFile(p,'utf8'));
function replayAdapter(db,snapshots){
 return {async execute(q){
  need(q&&typeof q.sql==='string'&&/^SELECT\b/i.test(q.sql),'REPLAY_SELECT_ONLY');
  if(q.sql.includes('FROM blue_research_signal_audit_v1')||q.sql.includes('FROM blue_research_signals_v1')){
   const [day,limit,offset]=q.args;
   const s=snapshots.get(day);need(s,'REPLAY_UNEXPECTED_DAY');
   if(q.sql.includes('FROM blue_research_signal_audit_v1'))return {rows:[{
    row_count:s.rows.length,observed_stocks:s.manifest.observed_stocks,signal_events:s.manifest.signal_events,source_payload_sha256:s.manifest.payload_sha256}]};
   need(limit===5&&Number.isInteger(offset)&&offset>=0,'REPLAY_BAD_PAGE');
   return {rows:s.rows.slice(offset,offset+limit).map(r=>({trade_day:r.trade_day,code:r.code,close_price:r.close_price,signal_names:r.signal_names,record_json:r.raw,row_sha256:r.row_sha256,source_payload_sha256:s.manifest.payload_sha256}))};
  }
  need(q.sql.includes('FROM blue_eod_ingest_audit_v1')||q.sql.includes('FROM blue_eod_daily_v1'),'REPLAY_UNEXPECTED_QUERY');
  return db.execute(q);
 }};
}
function membership(oldCases,newCases){
 const key=x=>x.day+'/'+x.code;
 const old=new Map(oldCases.map(x=>[key(x),x])),next=new Map(newCases.map(x=>[key(x),x]));
 need(old.size===oldCases.length&&next.size===newCases.length,'REPLAY_DUP_CASE');
 const days=[...new Set([...oldCases,...newCases].map(x=>x.day))].sort();
 return days.map(day=>{
  const a=oldCases.filter(x=>x.day===day),b=newCases.filter(x=>x.day===day);
  const retained=b.filter(x=>old.has(key(x))),added=b.filter(x=>!old.has(key(x))),removed=a.filter(x=>!next.has(key(x)));
  const stat=rows=>Object.fromEntries(['1','3','5','ASOF'].map(h=>{
   const known=rows.filter(x=>x.windows[h].complete);
   return [h,{n:rows.length,complete:known.length,hits:known.filter(x=>x.windows[h].status==='HIT').length,partial_hits:rows.filter(x=>x.windows[h].status==='PARTIAL_HIT').length}];
  }));
  return {day,old:a.length,replay:b.length,retained:retained.length,added:added.length,removed:removed.length,
    changed_signal_names:retained.filter(x=>x.signal_names.join(',')!==old.get(key(x)).signal_names.join(',')).length,
    added_outcomes:stat(added),removed_outcomes:stat(removed),retained_outcomes:stat(retained)};
 });
}
async function loadSnapshots(root){
 const snapshots=new Map();let yearHashes;
 for(const day of DAYS){
  const dir=join(root,day),audit=await readJSON(join(dir,'source','AUDIT.json'));
  const manifest=await readJSON(join(dir,'snapshot','manifest.json'));
  const payload=await readFile(join(dir,'snapshot','records.jsonl'));
  const rows=verifySignalSnapshot(manifest,payload);
  need(manifest.day===day&&audit.asof===day&&audit.scope===SCOPE&&manifest.history_scope===SCOPE&&audit.target_ohlcva_exact===true&&audit.unaffected_history_exact===true&&audit.target_rows===manifest.observed_stocks&&audit.observed_stocks===manifest.observed_stocks&&audit.matched_stocks===rows.length&&rows.every(r=>r.extras.history_scope===SCOPE),'REPLAY_PROVENANCE_MISMATCH');
  need(sha(await readFile(join(dir,'source','signals.csv')))===manifest.signals_csv_sha256&&sha(await readFile(join(dir,'source','chart_snapshots.jsonl')))===manifest.chart_snapshots_sha256,'REPLAY_SOURCE_HASH_MISMATCH');
  const hashes=JSON.stringify(audit.source_sha256_by_year);
  need(audit.source_sha256_by_year&&Object.values(audit.source_sha256_by_year).every(x=>/^[a-f0-9]{64}$/.test(x))&&(!yearHashes||yearHashes===hashes),'REPLAY_YEAR_SOURCE_CHANGED');
  yearHashes=hashes;snapshots.set(day,{manifest,rows,audit});
 }
 return snapshots;
}
async function run(){
 const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
 const root='output/global-replay';
 try{
  const snapshots=await loadSnapshots(root);
  const orig=await readReport(db),replay=await readReport(replayAdapter(db,snapshots));
  need(orig.report.coverage.every(c=>c.eod==='HASH_MATCH')&&DAYS.every(d=>orig.report.coverage.find(c=>c.day===d)?.payload_hash_recomputed),'REPLAY_ORIGINAL_INCOMPLETE');
  need(replay.report.coverage.every(c=>c.eod==='HASH_MATCH')&&DAYS.every(d=>replay.report.coverage.find(c=>c.day===d)?.signals==='FULL_RECORDED_UNIVERSE'),'REPLAY_UNIVERSE_INCOMPLETE');
  need(orig.report.coverage.every((c,i)=>c.eod_sha256===replay.report.coverage[i].eod_sha256),'REPLAY_EOD_CHANGED');
  const common=DAYS.filter(d=>orig.report.coverage.find(c=>c.day===d)?.signals==='FULL_RECORDED_UNIVERSE');
  need(common.length>0,'REPLAY_NO_COMMON_DAYS');
  const subset=x=>buildReport({...x.data,events:x.data.events.filter(e=>common.includes(e.day))});
  const markReplay=r=>({...r,schema:'BLUE_DISCOVERY_HIGH15_CORRECTED_REPLAY_V1',
    reference:'REPLAY_DISCOVERY_CLOSE_MATCHED_TO_KRX_EOD',
    limitations:['Corrected reconstructed historical records; NOT original actual discoveries.',...r.limitations.filter(x=>!x.startsWith('Recorded V1 discovery rows only'))]});
  const before=subset(orig),after=markReplay(subset(replay));
  const report={schema:'BLUE_GLOBAL_CORRECTED_HIGH15_REPLAY_V1',writes:0,source_scope:SCOPE,
    day_sources:[...snapshots].map(([day,s])=>({day,source_sha256_by_year:s.audit.source_sha256_by_year,source_audit_sha256:s.manifest.source_audit_sha256,payload_sha256:s.manifest.payload_sha256,restored_rows:s.audit.valid_prior_rows_restored,affected_codes:s.audit.changed_codes})),
    membership:membership(orig.cases.cases,replay.cases.cases),common_full_universe_days:common,
    original_recorded:orig.report,corrected_replay:markReplay(replay.report),
    same_full_dates:{original:before,corrected:after},
    limitations:['Reconstructed historical signals, NOT original discoveries; current immutable-in-run MARCAP bytes can differ from historical source.','Original 11/16 and 11/17 partial scanner universe handled separately; compare same full dates.','No new conditions selected. Fixed outcomes and original frozen hypotheses; not independent holdout.','Corporate actions, long historical prices and actual execution not independently certified.','No writes to Turso or D1.']};
  await mkdir(join(root,'public'),{recursive:true});
  await writeFile(join(root,'public','report.json'),JSON.stringify(report,null,2)+'\n');
  const cases={schema:'BLUE_GLOBAL_CORRECTED_REPLAY_PRIVATE_V1',original:orig.cases,corrected:replay.cases};
  const sealed=seal(JSON.stringify(cases));
  await writeFile(join(root,'public','cases.sealed.json'),JSON.stringify(sealed)+'\n');
  console.log('BLUE_GLOBAL_REPLAY_RESULT',JSON.stringify({original:orig.cases.cases.length,replay:replay.cases.cases.length,common_days:common.length,private_sha256:sealed.payload_sha256,writes:0}));
 }finally{db.close()}
}
async function selfTest(){
 let n=0;const t=x=>{need(x,'REPLAY_TEST_FAILED');n++};
 const w={complete:true,status:'HIT'},a=(code,signals)=>({day:DAYS[0],code,signal_names:signals,windows:{1:w,3:w,5:w,ASOF:w}});
 const m=membership([a('A',['ENV20']),a('B',['BB40'])],[a('A',['ENV40']),a('C',['BB40'])])[0];
 t(m.retained===1&&m.added===1&&m.removed===1&&m.changed_signal_names===1);
 t(m.added_outcomes['3'].hits===1&&m.removed_outcomes['3'].complete===1);
 t(!JSON.stringify(m).includes('"code"'));
 let forwarded=0;
 const adapter=replayAdapter({execute:async()=>{forwarded++;return {rows:[]}}},new Map([[DAYS[0],{rows:[{trade_day:DAYS[0],code:'000001',raw:'fixture',row_sha256:'a'}],manifest:{observed_stocks:1700,signal_events:1,payload_sha256:'hash'}}]]));
 t((await adapter.execute({sql:'SELECT row_count FROM blue_research_signal_audit_v1',args:[DAYS[0]]})).rows[0].row_count===1);
 t((await adapter.execute({sql:'SELECT code FROM blue_research_signals_v1',args:[DAYS[0],5,0]})).rows[0].record_json==='fixture');
 t((await adapter.execute({sql:'SELECT code FROM blue_research_signals_v1',args:[DAYS[0],5,5]})).rows.length===0);
 await adapter.execute({sql:'SELECT code FROM blue_eod_daily_v1',args:[DAYS[0]]});t(forwarded===1);
 let blocked=false;try{await adapter.execute({sql:'DELETE FROM blue_research_signals_v1',args:[]})}catch(e){blocked=e.message==='REPLAY_SELECT_ONLY'}t(blocked&&forwarded===1);
 return n;
}
export {loadSnapshots,replayAdapter};
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
if(process.argv.includes('--test'))console.log('BLUE_GLOBAL_REPLAY_TESTS',await selfTest());
else run().catch(e=>{console.error('BLUE_GLOBAL_REPLAY_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1});

}

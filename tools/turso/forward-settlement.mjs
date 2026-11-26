/** Bounded append-only aggregate settlement archive. Inspect is SELECT-only. */
import {createClient} from '@libsql/client';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readFile,writeFile} from 'node:fs/promises';
const TABLE='blue_forward_settlement_v1',SCHEMA='BLUE_FORWARD_SETTLEMENT_V1',RULE='FORWARD_V1',OUTCOME='FORWARD_HIGH_V2';
const SYMBOL_TABLE='blue_forward_symbol_settlement_v1',SYMBOL_SCHEMA='BLUE_FORWARD_SYMBOL_SETTLEMENT_V1',SYMBOL_OUTCOME='FORWARD_SYMBOL_EXIT_V1';
const sha=x=>createHash('sha256').update(x).digest('hex');
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
const isDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const key=r=>[r.source_day,r.rule_version,r.outcome_version,r.horizon];
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x}
function validate(r){
 const p=r.pooled;
 check(((r.schema===SCHEMA&&r.outcome_version===OUTCOME)||(r.schema===SYMBOL_SCHEMA&&r.outcome_version===SYMBOL_OUTCOME))&&r.rule_version===RULE&&[1,3,5,10,20].includes(r.horizon)&&[r.source_day,r.entry_day,r.maturity_day].every(isDay)&&r.source_day<r.entry_day&&r.entry_day<=r.maturity_day&&typeof r.captured_at==='string'&&Number.isFinite(Date.parse(r.captured_at))&&/^[a-f0-9]{40}$/.test(r.rule_commit)&&digest(r.benchmark_state_sha256),'SETTLEMENT_BAD_META');
 const captureDay=new Date(Date.parse(r.captured_at)+9*3600000).toISOString().slice(0,10);
 check(r.source_day<captureDay&&captureDay<r.entry_day,'SETTLEMENT_BAD_CAPTURE');
 check(Array.isArray(r.observation_days)&&r.observation_days.length===r.horizon&&r.observation_days.every(isDay)&&r.observation_days.every((d,i)=>!i||d>r.observation_days[i-1])&&r.observation_days[0]===r.entry_day&&r.observation_days.at(-1)===r.maturity_day,'SETTLEMENT_BAD_WINDOW');
 check(r.source_hashes&&digest(r.source_hashes[r.source_day])&&Object.entries(r.source_hashes).every(([d,h])=>isDay(d)&&d<=r.source_day&&digest(h))&&r.outcome_hashes&&Object.entries(r.outcome_hashes).every(([d,h])=>isDay(d)&&d>r.source_day&&d<=r.maturity_day&&digest(h))&&r.observation_days.every(d=>digest(r.outcome_hashes[d])),'SETTLEMENT_BAD_PROOF');
 check(Number.isInteger(r.snapshot_rows)&&r.snapshot_rows>0&&r.snapshot_rows<=10000&&p&&Number.isInteger(p.sample_count)&&p.sample_count>0&&Number.isInteger(p.missing_path)&&p.missing_path>=0&&p.pending===0&&p.events===r.snapshot_rows&&p.sample_count+p.missing_path===r.snapshot_rows&&r.coverage===(p.missing_path?'PARTIAL_SYMBOL_PATHS':'COMPLETE_SYMBOL_PATHS')&&Array.isArray(r.groups)&&r.groups.length<=10000,'SETTLEMENT_BAD_COUNTS');
 if(r.schema===SYMBOL_SCHEMA){
  const a=r.symbol_rows,e=r.exit_summary;check(Array.isArray(a)&&a.length===r.snapshot_rows&&new Set(a.map(x=>x.code)).size===a.length&&a.filter(x=>x.status==='OBSERVED').length===p.sample_count&&e?.events===a.length&&e.observed===p.sample_count&&e.missing_path===p.missing_path&&Array.isArray(r.exit_groups)&&r.exit_groups.length<=10000,'SETTLEMENT_SYMBOL_COUNTS');
  for(const x of a){
   check(/^[0-9A-Z]{6}$/.test(x.code)&&['KOSPI','KOSDAQ'].includes(x.market)&&['OBSERVED','MISSING_PATH'].includes(x.status),'SETTLEMENT_SYMBOL_META');
   if(x.status==='MISSING_PATH'){check(x.opportunity===null&&Object.keys(x.exits).length===0,'SETTLEMENT_SYMBOL_MISSING');continue;}
   check(x.opportunity&&['high','low','close','giveback'].every(k=>Number.isFinite(x.opportunity[k]))&&x.opportunity.peak_day>=1&&x.opportunity.peak_day<=r.horizon,'SETTLEMENT_SYMBOL_OPPORTUNITY');
   for(const m of ['SIGNAL_LOW','ATR14_SMA_1_5']){
    const z=x.exits[m];check(z&&typeof z.status==='string'&&z.targets,'SETTLEMENT_EXIT_META');
    if(z.status==='READY'){check(Number.isFinite(z.risk_pct)&&z.risk_pct>=0&&z.risk_pct<100&&Object.keys(z.targets).length===2,'SETTLEMENT_EXIT_RISK');
     for(const t of ['3','5']){const q=z.targets[t];check(q&&Number.isFinite(q.return_pct)&&q.return_pct>=-100&&q.return_pct<=Number(t)&&Number.isInteger(q.exit_day)&&q.exit_day>=1&&q.exit_day<=r.horizon&&['TARGET','STOP_GAP','STOP_TOUCH','TIME_CLOSE'].includes(q.reason)&&typeof q.ambiguous==='boolean','SETTLEMENT_EXIT_RESULT');}
    }else check(z.risk_pct===null&&Object.keys(z.targets).length===0,'SETTLEMENT_EXIT_UNAVAILABLE');
   }
  }
 }
}
export function pack(r){
 validate(r);const raw=JSON.stringify(canonical(r)),payload=gzipSync(raw).toString('base64');
 check(Buffer.byteLength(raw)<=4000000&&payload.length<=400000,'SETTLEMENT_PAYLOAD_CAP');
 return {payload,hash:sha(raw)};
}
export function unpack(row){
 check(typeof row.payload==='string'&&row.payload.length<=400000,'SETTLEMENT_PAYLOAD_CAP');
 const raw=gunzipSync(Buffer.from(row.payload,'base64'),{maxOutputLength:4000000}).toString('utf8');
 check(sha(raw)===row.payload_sha256,'SETTLEMENT_HASH_MISMATCH');
 const r=JSON.parse(raw);validate(r);
 check(r.source_day===row.source_day&&r.rule_version===row.rule_version&&r.outcome_version===row.outcome_version&&r.horizon===Number(row.horizon)&&r.maturity_day===row.maturity_day,'SETTLEMENT_METADATA_MISMATCH');
 return r;
}
export async function runSettlement(db,batch,ledger,{mode='inspect',confirm='',symbols=false}={}){
 check(['inspect','apply'].includes(mode),'SETTLEMENT_BAD_MODE');
 check(mode!=='apply'||confirm==='blue-forward-settlement-v1','SETTLEMENT_CONFIRM_REQUIRED');
 const table=symbols?SYMBOL_TABLE:TABLE,outcome=symbols?SYMBOL_OUTCOME:OUTCOME;
 check(batch.schema===(symbols?'BLUE_FORWARD_SYMBOL_SETTLEMENT_BATCH_V1':'BLUE_FORWARD_SETTLEMENT_BATCH_V1')&&isDay(batch.asof)&&Array.isArray(batch.records)&&batch.records.length<=150&&Array.isArray(ledger),'SETTLEMENT_BAD_BATCH');
 const sources=new Map(ledger.map(s=>[s.source_day,s])),seen=new Set(),planned=[];
 for(const r of batch.records){
  const s=sources.get(r.source_day);const k=JSON.stringify(key(r));
  check(r.outcome_version===outcome&&!seen.has(k)&&s&&r.maturity_day<=batch.asof&&s.rule_version===r.rule_version&&s.captured_at===r.captured_at&&s.rule_commit===r.rule_commit&&s.rows.length===r.snapshot_rows&&s.benchmark_state_sha256===r.benchmark_state_sha256&&JSON.stringify(canonical(s.source_hashes))===JSON.stringify(canonical(r.source_hashes)),'SETTLEMENT_SOURCE_MISMATCH');
  if(symbols){const expected=new Map(s.rows.map(x=>[x.code,x.market]));check(r.symbol_rows.every(x=>expected.get(x.code)===x.market)&&expected.size===r.symbol_rows.length,"SETTLEMENT_SYMBOL_CAPTURE_MISMATCH");}
  seen.add(k);planned.push({r,...pack(r)});
 }
 let exists=(await db.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name=?",args:[table]})).rows.length>0;
 const lookup=r=>db.execute({sql:"SELECT * FROM "+table+" WHERE source_day=? AND rule_version=? AND outcome_version=? AND horizon=?",args:key(r)});
 const missing=[];let unchanged=0;const conflicts=[];
 for(const x of planned){
  const row=exists?(await lookup(x.r)).rows[0]:null;
  if(row){unpack(row);if(row.payload_sha256!==x.hash)conflicts.push({source_day:x.r.source_day,horizon:x.r.horizon});else unchanged++;}
  else missing.push(x);
 }
 // Never rewrite a sealed cohort, including when later missing symbol paths recover.
 // Conflict blocks this whole write batch, but inspect can report it.
 check(mode!=='apply'||!conflicts.length,'SETTLEMENT_EXISTING_CONFLICT');
 let written=0;
 if(mode==='apply'&&missing.length){
  if(!exists){await db.execute("CREATE TABLE IF NOT EXISTS "+table+" (source_day TEXT NOT NULL, rule_version TEXT NOT NULL, outcome_version TEXT NOT NULL, horizon INTEGER NOT NULL, maturity_day TEXT NOT NULL, payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL, PRIMARY KEY(source_day,rule_version,outcome_version,horizon))");exists=true;}
  for(const x of missing){
   const r=x.r;
   await db.execute({sql:"INSERT INTO "+table+" (source_day,rule_version,outcome_version,horizon,maturity_day,payload,payload_sha256) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_day,rule_version,outcome_version,horizon) DO NOTHING",args:[...key(r),r.maturity_day,x.payload,x.hash]});
   const row=(await lookup(r)).rows[0];check(row,'SETTLEMENT_READBACK_MISSING');unpack(row);check(row.payload_sha256===x.hash,'SETTLEMENT_READBACK_CONFLICT');written++;
  }
 }
 const counts=exists?(await db.execute({sql:"SELECT COUNT(*) AS total, MIN(source_day) AS first_day, MAX(source_day) AS last_day FROM "+table+" WHERE rule_version=? AND outcome_version=?",args:[RULE,outcome]})).rows[0]:{total:0,first_day:null,last_day:null};
 const archive=exists?(await db.execute({sql:"SELECT * FROM "+table+" WHERE rule_version=? AND outcome_version=? ORDER BY source_day DESC,horizon ASC LIMIT 60",args:[RULE,outcome]})).rows.map(unpack):[];
 return {schema:symbols?'BLUE_FORWARD_SYMBOL_SETTLEMENT_REPORT_V1':'BLUE_FORWARD_SETTLEMENT_REPORT_V1',asof:batch.asof,mode,eligible:planned.length,missing:missing.length,unchanged,conflicts,written,diagnostics:batch.diagnostics,total:Number(counts.total),first_day:counts.first_day,last_day:counts.last_day,recent_rows:symbols?archive.map(({symbol_rows,...rest})=>rest):archive};
}
async function main(){
 const url=process.env.TURSO_DATABASE_URL||'',authToken=process.env.TURSO_AUTH_TOKEN||'';
 check(/^(libsql|https):\/\//.test(url)&&authToken,'SETTLEMENT_DB_CONFIG');
 const db=createClient({url,authToken,intMode:'string'});
 try{
  const symbols=process.argv.includes('--symbols');
  const batch=JSON.parse(await readFile(symbols?'output/forward/symbol-candidates.json':'output/forward/settlement-candidates.json','utf8'));
  const ledger=JSON.parse(await readFile('output/forward/ledger.json','utf8'));
  const r=await runSettlement(db,batch,ledger,{mode:process.env.SETTLEMENT_MODE||'inspect',confirm:process.env.SETTLEMENT_CONFIRM||'',symbols});
  await writeFile(symbols?'output/forward/symbol-report.json':'output/forward/settlement-report.json',JSON.stringify(r)+'\n');
  const {recent_rows,...log}=r;console.log(symbols?'BLUE_FORWARD_SYMBOL_SETTLEMENT':'BLUE_FORWARD_SETTLEMENT',JSON.stringify({...log,returned_rows:recent_rows.length}));
 }finally{db.close()}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)main().catch(e=>{console.error('BLUE_FORWARD_SETTLEMENT_FAILED',/^SETTLEMENT_[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1});

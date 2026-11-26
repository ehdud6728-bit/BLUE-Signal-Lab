/** Bounded append-only aggregate settlement archive. Inspect is SELECT-only. */
import {createClient} from '@libsql/client';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readFile,writeFile} from 'node:fs/promises';
const TABLE='blue_forward_settlement_v1',SCHEMA='BLUE_FORWARD_SETTLEMENT_V1',RULE='FORWARD_V1',OUTCOME='FORWARD_HIGH_V2';
const sha=x=>createHash('sha256').update(x).digest('hex');
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
const isDay=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const digest=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const key=r=>[r.source_day,r.rule_version,r.outcome_version,r.horizon];
function canonical(x){if(Array.isArray(x))return x.map(canonical);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])]));return x}
function validate(r){
 const p=r.pooled;
 check(r.schema===SCHEMA&&r.rule_version===RULE&&r.outcome_version===OUTCOME&&[1,3,5,10,20].includes(r.horizon)&&[r.source_day,r.entry_day,r.maturity_day].every(isDay)&&r.source_day<r.entry_day&&r.entry_day<=r.maturity_day&&typeof r.captured_at==='string'&&Number.isFinite(Date.parse(r.captured_at))&&/^[a-f0-9]{40}$/.test(r.rule_commit)&&digest(r.benchmark_state_sha256),'SETTLEMENT_BAD_META');
 const captureDay=new Date(Date.parse(r.captured_at)+9*3600000).toISOString().slice(0,10);
 check(r.source_day<captureDay&&captureDay<r.entry_day,'SETTLEMENT_BAD_CAPTURE');
 check(Array.isArray(r.observation_days)&&r.observation_days.length===r.horizon&&r.observation_days.every(isDay)&&r.observation_days.every((d,i)=>!i||d>r.observation_days[i-1])&&r.observation_days[0]===r.entry_day&&r.observation_days.at(-1)===r.maturity_day,'SETTLEMENT_BAD_WINDOW');
 check(r.source_hashes&&digest(r.source_hashes[r.source_day])&&Object.entries(r.source_hashes).every(([d,h])=>isDay(d)&&d<=r.source_day&&digest(h))&&r.outcome_hashes&&Object.entries(r.outcome_hashes).every(([d,h])=>isDay(d)&&d>r.source_day&&d<=r.maturity_day&&digest(h))&&r.observation_days.every(d=>digest(r.outcome_hashes[d])),'SETTLEMENT_BAD_PROOF');
 check(Number.isInteger(r.snapshot_rows)&&r.snapshot_rows>0&&r.snapshot_rows<=10000&&p&&Number.isInteger(p.sample_count)&&p.sample_count>0&&Number.isInteger(p.missing_path)&&p.missing_path>=0&&p.pending===0&&p.events===r.snapshot_rows&&p.sample_count+p.missing_path===r.snapshot_rows&&r.coverage===(p.missing_path?'PARTIAL_SYMBOL_PATHS':'COMPLETE_SYMBOL_PATHS')&&Array.isArray(r.groups)&&r.groups.length<=10000,'SETTLEMENT_BAD_COUNTS');
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
export async function runSettlement(db,batch,ledger,{mode='inspect',confirm=''}={}){
 check(['inspect','apply'].includes(mode),'SETTLEMENT_BAD_MODE');
 check(mode!=='apply'||confirm==='blue-forward-settlement-v1','SETTLEMENT_CONFIRM_REQUIRED');
 check(batch.schema==='BLUE_FORWARD_SETTLEMENT_BATCH_V1'&&isDay(batch.asof)&&Array.isArray(batch.records)&&batch.records.length<=150&&Array.isArray(ledger),'SETTLEMENT_BAD_BATCH');
 const sources=new Map(ledger.map(s=>[s.source_day,s])),seen=new Set(),planned=[];
 for(const r of batch.records){
  const s=sources.get(r.source_day);const k=JSON.stringify(key(r));
  check(!seen.has(k)&&s&&r.maturity_day<=batch.asof&&s.rule_version===r.rule_version&&s.captured_at===r.captured_at&&s.rule_commit===r.rule_commit&&s.rows.length===r.snapshot_rows&&s.benchmark_state_sha256===r.benchmark_state_sha256&&JSON.stringify(canonical(s.source_hashes))===JSON.stringify(canonical(r.source_hashes)),'SETTLEMENT_SOURCE_MISMATCH');
  seen.add(k);planned.push({r,...pack(r)});
 }
 let exists=(await db.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name=?",args:[TABLE]})).rows.length>0;
 const lookup=r=>db.execute({sql:"SELECT * FROM "+TABLE+" WHERE source_day=? AND rule_version=? AND outcome_version=? AND horizon=?",args:key(r)});
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
  if(!exists){await db.execute("CREATE TABLE IF NOT EXISTS "+TABLE+" (source_day TEXT NOT NULL, rule_version TEXT NOT NULL, outcome_version TEXT NOT NULL, horizon INTEGER NOT NULL, maturity_day TEXT NOT NULL, payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL, PRIMARY KEY(source_day,rule_version,outcome_version,horizon))");exists=true;}
  for(const x of missing){
   const r=x.r;
   await db.execute({sql:"INSERT INTO "+TABLE+" (source_day,rule_version,outcome_version,horizon,maturity_day,payload,payload_sha256) VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_day,rule_version,outcome_version,horizon) DO NOTHING",args:[...key(r),r.maturity_day,x.payload,x.hash]});
   const row=(await lookup(r)).rows[0];check(row,'SETTLEMENT_READBACK_MISSING');unpack(row);check(row.payload_sha256===x.hash,'SETTLEMENT_READBACK_CONFLICT');written++;
  }
 }
 const counts=exists?(await db.execute({sql:"SELECT COUNT(*) AS total, MIN(source_day) AS first_day, MAX(source_day) AS last_day FROM "+TABLE+" WHERE rule_version=? AND outcome_version=?",args:[RULE,OUTCOME]})).rows[0]:{total:0,first_day:null,last_day:null};
 const archive=exists?(await db.execute({sql:"SELECT * FROM "+TABLE+" WHERE rule_version=? AND outcome_version=? ORDER BY source_day DESC,horizon ASC LIMIT 60",args:[RULE,OUTCOME]})).rows.map(unpack):[];
 return {schema:'BLUE_FORWARD_SETTLEMENT_REPORT_V1',asof:batch.asof,mode,eligible:planned.length,missing:missing.length,unchanged,conflicts,written,diagnostics:batch.diagnostics,total:Number(counts.total),first_day:counts.first_day,last_day:counts.last_day,recent_rows:archive};
}
async function main(){
 const url=process.env.TURSO_DATABASE_URL||'',authToken=process.env.TURSO_AUTH_TOKEN||'';
 check(/^(libsql|https):\/\//.test(url)&&authToken,'SETTLEMENT_DB_CONFIG');
 const db=createClient({url,authToken,intMode:'string'});
 try{
  const batch=JSON.parse(await readFile('output/forward/settlement-candidates.json','utf8'));
  const ledger=JSON.parse(await readFile('output/forward/ledger.json','utf8'));
  const r=await runSettlement(db,batch,ledger,{mode:process.env.SETTLEMENT_MODE||'inspect',confirm:process.env.SETTLEMENT_CONFIRM||''});
  await writeFile('output/forward/settlement-report.json',JSON.stringify(r)+'\n');
  const {recent_rows,...log}=r;console.log('BLUE_FORWARD_SETTLEMENT',JSON.stringify({...log,returned_rows:recent_rows.length}));
 }finally{db.close()}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)main().catch(e=>{console.error('BLUE_FORWARD_SETTLEMENT_FAILED',/^SETTLEMENT_[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1});

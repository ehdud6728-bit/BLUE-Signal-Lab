/** Explicit manual append-only research ledger. Never update an existing observation. */
import {createClient} from '@libsql/client';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readFile,writeFile} from 'node:fs/promises';
const VERSION='FORWARD_V1',TABLE='blue_forward_observation_v1';
const sha=x=>createHash('sha256').update(x).digest('hex');
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const day=now=>new Date(now.getTime()+9*3600000).toISOString().slice(0,10);
const previous=now=>day(new Date(now.getTime()-86400000));
export function pack(s){
 const raw=JSON.stringify(s),payload=gzipSync(raw).toString('base64');
 check(Buffer.byteLength(raw)<=3000000&&payload.length<=200000,'FORWARD_PAYLOAD_CAP');
 return {payload,digest:sha(raw)};
}
export function unpack(r){
 check(typeof r.payload==='string'&&r.payload.length<=200000,'FORWARD_PAYLOAD_CAP');
 const raw=gunzipSync(Buffer.from(r.payload,'base64'),{maxOutputLength:3000000}).toString('utf8');
 check(sha(raw)===r.payload_sha256,'FORWARD_HASH_MISMATCH');
 const s=JSON.parse(raw);
 check(s.source_day===r.source_day&&s.rule_version===r.rule_version&&s.captured_at===r.captured_at&&s.schema==='BLUE_FORWARD_CANDIDATE_V1'&&Array.isArray(s.rows),'FORWARD_METADATA_MISMATCH');
 return s;
}
export async function runLedger(db,candidate,{mode='inspect',confirm='',now=new Date()}={}){
 check(['inspect','apply'].includes(mode),'FORWARD_BAD_MODE');
 check(mode!=='apply'||confirm==='blue-forward-capture-v1','FORWARD_CONFIRM_REQUIRED');
 check(candidate.schema==='BLUE_FORWARD_CANDIDATE_V1'&&candidate.rule_version===VERSION&&candidate.cutoff===previous(now)&&candidate.source_day<day(now)&&/^[a-f0-9]{40}$/.test(candidate.rule_commit)&&Array.isArray(candidate.rows)&&candidate.rows.length>=1700&&candidate.rows.length<=10000&&new Set(candidate.rows.map(r=>r.code)).size===candidate.rows.length,'FORWARD_BAD_CANDIDATE');
 let exists=(await db.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name=?",args:[TABLE]})).rows.length>0;
 let status='INSPECT_ONLY';
 if(mode==='apply'){
  if(!exists){await db.execute("CREATE TABLE IF NOT EXISTS "+TABLE+" (source_day TEXT NOT NULL, rule_version TEXT NOT NULL, captured_at TEXT NOT NULL, payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL, PRIMARY KEY(source_day,rule_version))");exists=true;}
  const existing=(await db.execute({sql:"SELECT * FROM "+TABLE+" WHERE source_day=? AND rule_version=?",args:[candidate.source_day,VERSION]})).rows[0];
  if(existing){unpack(existing);status='ALREADY_CAPTURED';}
  else{
   const captured={...candidate,captured_at:now.toISOString(),capture_day:day(now)};
   const {payload,digest}=pack(captured);
   await db.execute({sql:"INSERT INTO "+TABLE+" (source_day,rule_version,captured_at,payload,payload_sha256) VALUES(?,?,?,?,?) ON CONFLICT(source_day,rule_version) DO NOTHING",args:[candidate.source_day,VERSION,captured.captured_at,payload,digest]});
   const stored=(await db.execute({sql:"SELECT * FROM "+TABLE+" WHERE source_day=? AND rule_version=?",args:[candidate.source_day,VERSION]})).rows[0];
   check(stored,'FORWARD_READBACK_MISSING');unpack(stored);
   check(stored.payload_sha256===digest,'FORWARD_CONCURRENT_CAPTURE_DIFFERENT');
   status='CAPTURED_READBACK_MATCH';
  }
 }
 const rows=exists?(await db.execute({sql:"SELECT * FROM "+TABLE+" WHERE rule_version=? ORDER BY source_day DESC LIMIT 30",args:[VERSION]})).rows:[];
 return {status,ledger:rows.map(unpack)};
}
async function main(){
 const mode=process.env.MODE||'inspect',confirm=process.env.CONFIRM||'';
 const url=process.env.TURSO_DATABASE_URL||'',authToken=process.env.TURSO_AUTH_TOKEN||'';
 check(/^(libsql|https):\/\//.test(url)&&authToken,'FORWARD_DB_CONFIG');
 const db=createClient({url,authToken,intMode:'string'});
 try{
  const candidate=JSON.parse(await readFile('output/forward/candidate.json','utf8'));
  const r=await runLedger(db,candidate,{mode,confirm});
  await writeFile('output/forward/ledger.json',JSON.stringify(r.ledger)+'\n');
  console.log('BLUE_FORWARD_LEDGER',JSON.stringify({status:r.status,snapshots:r.ledger.length,source_day:candidate.source_day,rule_version:VERSION}));
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)main().catch(e=>{console.error('BLUE_FORWARD_LEDGER_FAILED',/^FORWARD_[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1;});

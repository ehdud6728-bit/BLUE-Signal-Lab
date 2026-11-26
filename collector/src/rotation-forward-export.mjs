/** Read only original prospective rotation receipts; never manufacture capture. */
import {createClient} from '@libsql/client';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {decodeSnapshot} from './rotation-outcomes.mjs';
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
const kst=d=>new Date(d.getTime()+32400000).toISOString().slice(0,10);
export async function exportFrozenRotation(db,now=new Date()){
 const table=(await db.execute({sql:"SELECT name FROM sqlite_master WHERE type='table' AND name=?",args:['blue_rotation_observations_v1']})).rows.length>0;
 const rows=table?(await db.execute({sql:"SELECT receipt_day,source_observed_at,payload_json,payload_sha256,recorded_at FROM blue_rotation_observations_v1 ORDER BY receipt_day DESC LIMIT 60",args:[]})).rows:[];
 check(rows.length<=60,'ROTATION_FORWARD_CAP');
 const seen=new Set();
 const archives=rows.map(r=>{
  const a=decodeSnapshot({...r,observed_at_utc:r.source_observed_at}),at=new Date(r.recorded_at);
  check(Number.isFinite(at.getTime())&&kst(at)===a.receipt_day&&at.getTime()>=Date.parse(a.source_observed_at)&&at<=now&&!seen.has(a.receipt_day),'ROTATION_FORWARD_TIMESTAMP');
  seen.add(a.receipt_day);
  return {recorded_day:a.receipt_day,recorded_at:r.recorded_at,source_day:a.source_day,source_sha256:a.source_sha256,mapping_status:a.mapping_status,candidates:a.candidates.map(({market,code,role})=>({market,code,role}))};
 });
 return {schema:'BLUE_ROTATION_FROZEN_SOURCE_V1',status:archives.length?'OBSERVED_ARCHIVES':'NO_PROSPECTIVE_ARCHIVES',archives};
}
async function main(){
 const url=process.env.TURSO_DATABASE_URL||'',authToken=process.env.TURSO_AUTH_TOKEN||'';
 check(/^(libsql|https):\/\//.test(url)&&authToken,'ROTATION_FORWARD_DB_CONFIG');
 const db=createClient({url,authToken,intMode:'string'});
 try{const r=await exportFrozenRotation(db);await writeFile('output/forward/rotation-source.json',JSON.stringify(r)+'\n');console.log('BLUE_ROTATION_FORWARD_SOURCE',JSON.stringify({status:r.status,receipts:r.archives.length,writes:0}));}finally{db.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('BLUE_ROTATION_FORWARD_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1});

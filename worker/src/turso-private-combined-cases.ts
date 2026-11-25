import {createClient} from '@libsql/client/web';
type Env={TURSO_DATABASE_URL?:string;TURSO_AUTH_TOKEN?:string};
type DB=Pick<ReturnType<typeof createClient>,'execute'|'close'>;
type Factory=(opts:{url:string;authToken:string;intMode:'string'})=>DB;
const bases=['ENV20','ENV20_LOWER_TOUCH'],groups=['JOINT','LONG_BULL_NOT_JOINT','LONG_BULL_RSI_GC'];
const hash=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const day=(x:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const digest=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
export class InvalidPrivateCaseQuery extends Error{constructor(){super('INVALID_PRIVATE_CASE_QUERY');}}
export class PrivateCaseSnapshotChanged extends Error{constructor(){super('PRIVATE_CASE_SNAPSHOT_CHANGED');}}
export async function tursoPrivateCombinedCases(env:Env,params:URLSearchParams,factory:Factory=createClient){
 const asof=params.get('asof')||'',base=params.get('base')||'',group=params.get('group')||'',pageText=params.get('page')??'0',snapshot=params.get('snapshot');
 if(!day(asof)||!bases.includes(base)||!groups.includes(group)||!/^\d{1,3}$/.test(pageText)||Number(pageText)>399||snapshot!==null&&!hash(snapshot)||Number(pageText)>0&&!snapshot)throw new InvalidPrivateCaseQuery();
 const page=Number(pageText),url=env.TURSO_DATABASE_URL?.trim()||'',authToken=env.TURSO_AUTH_TOKEN?.trim()||'';
 if(!/^(https|libsql):\/\//.test(url)||!authToken)throw Error('CASE_DB_NOT_CONFIGURED');
 const db=factory({url,authToken,intMode:'string'});
 try{
  const q=(sql:string,args:(string|number)[]=[])=>db.execute({sql,args});
  if(!(await q("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_private_case_heads_v1'")).rows.length)return {status:'NOT_CAPTURED',asof};
  const r=(await q('SELECT snapshot_id,manifest_json,manifest_sha256 FROM blue_private_case_heads_v1 WHERE asof=?',[asof])).rows[0];
  if(!r)return {status:'NOT_CAPTURED',asof};
  const raw=String(r.manifest_json),id=String(r.snapshot_id);
  if(!hash(id)||id!==r.manifest_sha256||raw.length>512*1024||await digest(raw)!==id)throw Error('CASE_HEAD_HASH_MISMATCH');
  if(snapshot&&snapshot!==id)throw new PrivateCaseSnapshotChanged();
  const m=JSON.parse(raw);
  if(m.schema!=='BLUE_PRIVATE_COMBINED_CASES_V1'||m.asof!==asof||m.page_size!==20||!hash(m.source_sha256)||!hash(m.factors_sha256)||!Array.isArray(m.groups)||m.groups.length!==6)throw Error('CASE_HEAD_INVALID');
  const matches=m.groups.filter((x:any)=>x.base===base&&x.group===group);
  const g=matches[0];
  if(matches.length!==1||!Number.isSafeInteger(g.total)||g.total<0||g.total>8000||!Array.isArray(g.page_hashes)||g.page_hashes.length!==Math.ceil(g.total/20)||!g.page_hashes.every(hash))throw Error('CASE_GROUP_INVALID');
  if(page>=Math.max(1,g.page_hashes.length))throw new InvalidPrivateCaseQuery();
  let rows:unknown[]=[];
  if(g.total){
   const p=(await q('SELECT payload_json,payload_sha256 FROM blue_private_case_pages_v1 WHERE snapshot_id=? AND base=? AND cohort=? AND page=?',[id,base,group,page])).rows[0];
   if(!p)throw Error('CASE_PAGE_MISSING');
   const payload=String(p.payload_json);
   if(payload.length>128*1024||p.payload_sha256!==g.page_hashes[page]||await digest(payload)!==p.payload_sha256)throw Error('CASE_PAGE_HASH_MISMATCH');
   const items=JSON.parse(payload);
   if(!Array.isArray(items)||items.length!==Math.min(20,g.total-page*20)||items.some(x=>!day(x.day)||x.day>asof||!/^[0-9A-Z]{6}$/.test(x.code)||!hash(x.indicators?.record_sha256)))throw Error('CASE_PAGE_INVALID');
   rows=items;
  }
  return {status:'READY',asof,snapshot:id,source_sha256:m.source_sha256,factors_sha256:m.factors_sha256,published_comparison:m.published_comparison,legacy_factors_sha256:m.legacy_factors_sha256,audit_sessions:m.audit_sessions,signal_audit_sessions:m.signal_audit_sessions,quality:m.quality,base,group,total:g.total,page,page_count:g.page_hashes.length,horizons:g.horizons,rows};
 }finally{db.close();}
}

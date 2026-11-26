/** Access-protected by caller. SELECT only, bounded exact-date cohort lookup. */
import {createClient} from '@libsql/client/web';
type Env={TURSO_DATABASE_URL?:string;TURSO_AUTH_TOKEN?:string};
type DB=Pick<ReturnType<typeof createClient>,'execute'|'close'>;
type Factory=(x:{url:string;authToken:string;intMode:'string'})=>DB;
const day=(d:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
const check=(ok:unknown,msg:string)=>{if(!ok)throw Error(msg)};
export class InvalidForwardView extends Error{constructor(){super('INVALID_FORWARD_VIEW')}}
async function inflate(p:string){
 check(p.length<=400000,'FORWARD_VIEW_CAP');
 const bytes=Uint8Array.from(atob(p),c=>c.charCodeAt(0));
 const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
 const chunks:Uint8Array[]=[];let n=0;
 try{while(true){const r=await reader.read();if(r.done)break;n+=r.value.byteLength;check(n<=4000000,'FORWARD_VIEW_CAP');chunks.push(r.value)}}finally{await reader.cancel();reader.releaseLock()}
 const out=new Uint8Array(n);let i=0;for(const c of chunks){out.set(c,i);i+=c.length}return new TextDecoder('utf-8',{fatal:true}).decode(out);
}
export async function tursoForwardView(env:Env,params:URLSearchParams,factory:Factory=createClient){
 const code=params.get('code'),date=params.get('day');
 if((code===null)!==(date===null)||code!==null&&(!/^[0-9A-Z]{6}$/.test(code)||!day(date!))||[...params.keys()].some(k=>!['code','day'].includes(k))||params.getAll('code').length>1||params.getAll('day').length>1)throw new InvalidForwardView();
 const url=env.TURSO_DATABASE_URL?.trim()||'',authToken=env.TURSO_AUTH_TOKEN?.trim()||'';
 check(/^(https|libsql):\/\//.test(url)&&authToken,'FORWARD_VIEW_DB_CONFIG');
 const db=factory({url,authToken,intMode:'string'});
 try{
  const q=(sql:string,args:(string|number)[]=[])=>db.execute({sql,args});
  const table=code===null?'blue_forward_ui_report_v1':'blue_forward_symbol_settlement_v1';
  if(!(await q("SELECT name FROM sqlite_master WHERE type='table' AND name=?",[table])).rows.length)return {status:'NOT_AVAILABLE',code,day:date};
  if(code===null){
   const r=(await q('SELECT asof,generated_at,payload_json,payload_sha256 FROM blue_forward_ui_report_v1 ORDER BY asof DESC LIMIT 1')).rows[0];
   if(!r)return {status:'NOT_AVAILABLE'};
   const raw=String(r.payload_json);check(raw.length<=250000&&await hash(raw)===r.payload_sha256,'FORWARD_VIEW_HASH');
   const data=JSON.parse(raw);check(data.schema==='BLUE_FORWARD_UI_V1'&&data.asof===r.asof&&day(data.asof)&&Array.isArray(data.market)&&Array.isArray(data.opportunity),'FORWARD_VIEW_META');
   return {status:'OK',generated_at:r.generated_at,report:data};
  }
  const rows=(await q("SELECT source_day,horizon,maturity_day,payload,payload_sha256 FROM blue_forward_symbol_settlement_v1 WHERE source_day=? AND rule_version='FORWARD_V1' AND outcome_version='FORWARD_SYMBOL_EXIT_V1' ORDER BY horizon LIMIT 6",[date!])).rows;
  check(rows.length<=5,'FORWARD_VIEW_DUPLICATE');const out=[];
  for(const r of rows){
   const raw=await inflate(String(r.payload));check(await hash(raw)===r.payload_sha256,'FORWARD_VIEW_HASH');
   const x=JSON.parse(raw),h=Number(r.horizon);check(x.schema==='BLUE_FORWARD_SYMBOL_SETTLEMENT_V1'&&x.rule_version==='FORWARD_V1'&&x.outcome_version==='FORWARD_SYMBOL_EXIT_V1'&&x.source_day===date&&x.source_day===r.source_day&&x.horizon===h&&[1,3,5,10,20].includes(h)&&x.maturity_day===r.maturity_day&&day(x.entry_day)&&day(x.maturity_day)&&Array.isArray(x.symbol_rows)&&x.symbol_rows.length===x.snapshot_rows&&x.symbol_rows.length<=10000,'FORWARD_VIEW_META');
   const hits=x.symbol_rows.filter((z:any)=>z.code===code);check(hits.length<=1,'FORWARD_VIEW_DUPLICATE');
   if(hits.length){const z=hits[0];check(['OBSERVED','MISSING_PATH'].includes(z.status)&&['KOSPI','KOSDAQ'].includes(z.market),'FORWARD_VIEW_SYMBOL');
    out.push({horizon:h,entry_day:x.entry_day,maturity_day:x.maturity_day,captured_at:x.captured_at,coverage:x.coverage,market:z.market,status:z.status,opportunity:z.opportunity,exits:z.exits});}
  }
  return {status:out.length?'OK':'NO_SEALED_MATCH',code,day:date,rows:out,basis:'FIRST_OPEN_AFTER_CAPTURE_DAY'};
 }finally{db.close()}
}

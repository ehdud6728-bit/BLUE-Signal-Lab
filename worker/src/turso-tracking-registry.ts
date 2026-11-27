import {createClient} from '@libsql/client/web';
type Env={TURSO_DATABASE_URL?:string;TURSO_AUTH_TOKEN?:string};
type Row={code:string;precise:boolean};
type Config={revision:number;items:Row[];updated_at:string|null};
const TABLE='blue_tracking_roster_v1';
const MAX_CODES=50,MAX_PRECISE=10;
export function validateRoster(x:unknown):Row[]{
 if(!Array.isArray(x)||x.length>MAX_CODES)throw Error('ROSTER_CAPACITY');
 const seen=new Set<string>(),out:Row[]=[];
 for(const r of x){
  if(!r||typeof r.code!=='string'||!/^\d{6}$/.test(r.code)||typeof r.precise!=='boolean'||seen.has(r.code))throw Error('INVALID_ROSTER');
  seen.add(r.code);out.push({code:r.code,precise:r.precise});
 }
 if(out.filter(r=>r.precise).length>MAX_PRECISE)throw Error('PRECISE_CAPACITY');
 return out.sort((a,b)=>a.code.localeCompare(b.code));
}
const blank=():Config=>({revision:0,items:[],updated_at:null});
const response=(status:number,body:unknown)=>({status,body});
async function boundedBody(req:Request){
 const reader=req.body?.getReader();if(!reader)throw Error('INVALID_BODY');
 const parts:Uint8Array[]=[];let n=0;
 try{for(;;){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>8192){await reader.cancel();throw Error('BODY_TOO_LARGE')}parts.push(r.value);}}
 finally{reader.releaseLock()}
 const data=new Uint8Array(n);let offset=0;for(const p of parts){data.set(p,offset);offset+=p.length;}
 return JSON.parse(new TextDecoder().decode(data));
}
export async function trackingRegistry(req:Request,env:Env,owner:string,{factory=createClient,now=new Date()}={}){
 if(!/^[a-f0-9]{64}$/.test(owner))return response(401,{error:'ACCESS_REQUIRED'});
 let expected=0,items:Row[]=[];
 if(req.method==='POST'){
  try{const input=await boundedBody(req);
   if(!Number.isSafeInteger(input?.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER)throw Error('INVALID_REVISION');
   expected=input.revision;items=validateRoster(input.items);
  }catch(e){return response(400,{error:e instanceof Error&&['ROSTER_CAPACITY','INVALID_ROSTER','PRECISE_CAPACITY','INVALID_REVISION','BODY_TOO_LARGE'].includes(e.message)?e.message:'INVALID_BODY'});}
 }else if(req.method!=='GET')return response(405,{error:'METHOD_NOT_ALLOWED'});
 const url=env.TURSO_DATABASE_URL?.trim()||'',authToken=env.TURSO_AUTH_TOKEN?.trim()||'';
 if(!/^(https|libsql):\/\//.test(url)||!authToken)return response(503,{error:'TRACKING_STORAGE_UNAVAILABLE'});
 const db=factory({url,authToken,intMode:'string'});
 try{
  const exists=(await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='"+TABLE+"'")).rows.length>0;
  if(!exists&&req.method==='GET')return response(200,{status:'NOT_REGISTERED',...blank(),auto_tracking:false});
  if(!exists)await db.execute("CREATE TABLE IF NOT EXISTS "+TABLE+" (owner TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),roster_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(owner,revision))");
  const read=async():Promise<Config>=>{
   const q=await db.execute({sql:"SELECT revision,roster_json,updated_at FROM "+TABLE+" WHERE owner=? ORDER BY revision DESC LIMIT 1",args:[owner]});
   if(!q.rows.length)return blank();const row=q.rows[0],revision=Number(row.revision),updated_at=String(row.updated_at);
   if(!Number.isSafeInteger(revision)||revision<1||!Number.isFinite(Date.parse(updated_at)))throw Error('TRACKING_CORRUPT');
   return {revision,items:validateRoster(JSON.parse(String(row.roster_json))),updated_at};
  };
  const current=await read();
  if(req.method==='GET'){
    const quotes = [];
    let quotes_available = true;
    if(current.items.length){
      try {
        const codes = current.items.map(item=>item.code);
        const result = await db.execute({sql:`SELECT code,close,trade_day,observed_at_utc
          FROM blue_kis_provisional_daily_v1
          WHERE trade_day=(SELECT MAX(trade_day) FROM blue_kis_provisional_daily_v1 WHERE trade_day<=?)
          AND code IN (${codes.map(()=>'?').join(',')}) AND market='J' ORDER BY code`,
          args:[new Date(now.getTime()+9*3600000).toISOString().slice(0,10),...codes]});
        for(const row of result.rows){
          const price = Number(row.close), observed = Date.parse(String(row.observed_at_utc));
          if(!Number.isSafeInteger(price)||price<=0||!Number.isFinite(observed)||observed>now.getTime())continue;
          quotes.push({code:String(row.code),price,day:String(row.trade_day),observed_at:String(row.observed_at_utc)});
        }
      } catch { quotes_available=false; }
    }
    return response(200,{status:current.revision?'REGISTERED':'NOT_REGISTERED',...current,
      quotes,quotes_available,auto_tracking:false});
  }
  if(current.revision!==expected)return response(409,{error:'REVISION_CONFLICT'});
  const payload=JSON.stringify(items);
  if(current.revision&&payload===JSON.stringify(current.items))return response(200,{status:'UNCHANGED',...current,auto_tracking:false});
  // Single atomic INSERT guarded by previous max revision. No destructive
  // replacement, no cross-account read, no schedule or KIS call.
  const q=await db.execute({sql:"INSERT INTO "+TABLE+" (owner,revision,roster_json,updated_at) SELECT ?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM "+TABLE+" WHERE owner=?),0)=?",args:[owner,expected+1,payload,now.toISOString(),owner,expected]});
  if(q.rowsAffected!==1)return response(409,{error:'REVISION_CONFLICT'});
  const saved=await read();
  if(saved.revision!==expected+1||JSON.stringify(saved.items)!==payload)return response(409,{error:'READBACK_CHANGED'});
  return response(200,{status:'REGISTERED',...saved,auto_tracking:false});
 }finally{db.close();}
}

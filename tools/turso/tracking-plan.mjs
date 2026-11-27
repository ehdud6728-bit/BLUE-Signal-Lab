/** Read-only shared roster planning. No KIS calls, writes or schedule changes.
 * Global union cap prevents account-specific caps from silently multiplying load. */
import {pathToFileURL} from 'node:url';
import {task} from '../../collector/src/tracking-checkpoint.mjs';
const TABLE='blue_tracking_roster_v1';
// Re-offer the latest due work until its durable task id has been completed.
// This tolerates late invocations; it does not fabricate missed price history.
export function checkpointTasks(basic,precise,now){
 const kst=new Date(now.getTime()+9*3600000),minute=kst.getUTCHours()*60+kst.getUTCMinutes()-540;
 if(kst.getUTCDay()<1||kst.getUTCDay()>5||minute<0||minute>=390)return [];
 const day=kst.toISOString().slice(0,10),end=m=>new Date(Date.parse(day+'T00:00:00Z')+m*60000).toISOString();
 // Midnight UTC is 09:00 KST, so m is elapsed regular-session minutes.
 const out=[];const all=[...basic,...precise].sort();
 for(const code of all)out.push(task(code,'QUOTE',end(Math.floor(minute/5)*5)));
 for(let i=0;i<basic.length;i++){
  const offset=Number(basic[i])%24*5;let due=Math.floor(minute/120)*120+offset;
  if(due>minute)due-=120;
  if(due>=0)out.push(task(basic[i],'BASIC',end(due)));
 }
 const closed=Math.floor((minute-2)/30)*30;
 if(closed>=30)for(const code of precise)out.push(task(code,'PRECISE',end(closed)));
 return out;
}
export function plan(rows,now=new Date()){
 const codes=new Map(),owners=new Set();
 for(const r of rows){
  if(!/^[a-f0-9]{64}$/.test(String(r.owner))||owners.has(r.owner)||!Number.isSafeInteger(Number(r.revision))||Number(r.revision)<1)throw Error('INVALID_ROSTER_HEADER');
  owners.add(r.owner);const items=JSON.parse(r.roster_json);
  if(!Array.isArray(items)||items.length>50||items.filter(x=>x?.precise===true).length>10)throw Error('INVALID_ROSTER_LIMIT');
  const seen=new Set();
  for(const x of items){
   if(!x||!/^\d{6}$/.test(x.code)||typeof x.precise!=='boolean'||seen.has(x.code))throw Error('INVALID_ROSTER_ITEM');
   seen.add(x.code);codes.set(x.code,Boolean(codes.get(x.code)||x.precise));
  }
 }
 const precise=[...codes].filter(([,v])=>v).map(([k])=>k).sort(),basic=[...codes].filter(([,v])=>!v).map(([k])=>k).sort();
 const meta={owners:owners.size,unique_symbols:codes.size,precise_symbols:precise.length,basic_symbols:basic.length,writes:0,kis_requests:0};
 // Do not select a subset or discard another owner's preferences without approval.
 if(codes.size>50||precise.length>10)return {...meta,status:'GLOBAL_CAPACITY_BLOCKED',quote_batches:[],basic_due:[],precise_due:[],checkpoint_tasks:[]};
 const kst=new Date(now.getTime()+9*3600000),minutes=kst.getUTCHours()*60+kst.getUTCMinutes()-540;
 if(kst.getUTCDay()<1||kst.getUTCDay()>5||minutes<0||minutes>=390)return {...meta,status:'OUTSIDE_REGULAR_WINDOW',quote_batches:[],basic_due:[],precise_due:[],checkpoint_tasks:[]};
 // Candidate slots only; no exchange calendar, checkpoint, lease or provider call.
 const all=[...codes.keys()].sort(),slot=Math.floor(minutes/5);
 const batches=minutes%5===0?[all.slice(0,30),all.slice(30)].filter(a=>a.length):[];
 // spread basic over 24 five-minute slots in each 120-minute block.
 const basic_due=minutes%5===0?basic.filter((_,i)=>i%24===slot%24):[];
 // All precise candidates after a 30-minute window, not at opening.
 const precise_due=minutes>=32&&minutes%30===2?precise:[];
 return {...meta,status:codes.size?'PLAN_ONLY':'NO_REGISTERED_SYMBOLS',quote_batches:batches,basic_due,precise_due,checkpoint_tasks:checkpointTasks(basic,precise,now)};
}
export async function inspect(client,now){
 const exists=(await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='"+TABLE+"'")).rows.length;
 if(!exists)return {...plan([],now),status:'REGISTRY_NOT_CREATED'};
 const r=await client.execute("SELECT t.owner,t.revision,t.roster_json FROM "+TABLE+" t JOIN (SELECT owner,MAX(revision) revision FROM "+TABLE+" GROUP BY owner ORDER BY owner LIMIT 101) latest ON t.owner=latest.owner AND t.revision=latest.revision");
 if(r.rows.length>100)return {status:'ACCOUNT_SCAN_CAPACITY_BLOCKED',writes:0,kis_requests:0};
 const p=plan(r.rows,now);
 // Avoid publishing user selections or account identifiers in Actions logs.
 const {quote_batches,basic_due,precise_due,checkpoint_tasks,...meta}=p;
 return {...meta,quote_batches:quote_batches.length,quote_due_symbols:quote_batches.flat().length,basic_due_symbols:basic_due.length,precise_due_symbols:precise_due.length,checkpoint_candidates:checkpoint_tasks.length};
}
async function main(){
 const env=process.env;if(!env.TURSO_DATABASE_URL||!env.TURSO_AUTH_TOKEN)throw Error('CONFIG_MISSING');
 const {createClient}=await import('@libsql/client');
 const c=createClient({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN,intMode:'string'});
 try{console.log('BLUE_TRACKING_PLAN',JSON.stringify(await inspect(c,new Date())))}finally{c.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('BLUE_TRACKING_PLAN_FAILED');process.exitCode=1});

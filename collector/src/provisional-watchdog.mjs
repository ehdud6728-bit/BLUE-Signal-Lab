/** Independent, opt-in recovery trigger. Never collect quotes or alter pattern data.
 * Cloudflare cron is independent of GitHub's schedule; actual analysis remains in
 * the existing serialized publisher. All failures fail closed, no secret logging.
 */
import {createClient} from '@libsql/client/web';
import {publicationGate} from './provisional-publication-gate.mjs';
const API='https://api.github.com/repos/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_provisional_pattern_publish.yml';
const ACTIVE=['queued','in_progress','waiting','requested','pending'];
const MINUTE=60000, COOLDOWN=30*MINUTE, STALE=40*MINUTE;
export async function runProvisionalWatchdog(env,now=new Date(),deps={}){
 const tick=deps.tick||now;
 if(env.BLUE_PROVISIONAL_WATCHDOG_ENABLED!=='true')return {status:'DISABLED'};
 if(env.COLLECTOR_ENABLED!=='true')return {status:'COLLECTOR_DISABLED'};
 if(tick.getUTCMinutes()%10!==0)return {status:'NOT_TICK'};
 const kst=new Date(now.getTime()+9*3600000),clock=kst.toISOString().slice(11,16);
 if(kst.getUTCDay()===0||kst.getUTCDay()===6||clock<'09:30'||clock>='21:30')return {status:'OUTSIDE_WINDOW'};
 const token=env.BLUE_PROVISIONAL_WATCHDOG_GITHUB_TOKEN;
 if(!token||!env.TURSO_DATABASE_URL||!env.TURSO_AUTH_TOKEN)return {status:'CONFIG_MISSING'};
 const db=(deps.clientFactory||createClient)({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN,intMode:'string'});
 const query=async(sql,args=[])=>(await db.execute({sql,args})).rows;
 try{
  const g=await (deps.gate||publicationGate)(db,now,{scheduled:true});
  if(!g.ready)return {status:g.reason};
  const tables=await query("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_provisional_pattern_head_v1'");
  const head=tables.length?(await query('SELECT scan_asof_utc,latest_observed_utc FROM blue_provisional_pattern_head_v1 WHERE trade_day=? AND reference_day=?',[g.day,g.reference]))[0]:null;
  if(head){
   const scan=Date.parse(String(head.scan_asof_utc)),latest=Date.parse(String(head.latest_observed_utc)),newest=Date.parse(g.latest_observed_utc);
   if(!Number.isFinite(scan)||!Number.isFinite(latest)||!Number.isFinite(newest)||scan>now.getTime()||latest>scan)return {status:'INVALID_HEAD_TIME'};
   if(latest>=newest)return {status:'NO_NEW_QUOTES'};
   const postClose=clock>='15:40'&&new Date(latest+9*3600000).toISOString().slice(11,16)<'15:30';
   if(!postClose&&now.getTime()-scan<STALE)return {status:'RECENT_PUBLICATION'};
  }
  // Atomic cooldown claim: prevents concurrent invocations and excessive retries,
  // including ambiguous network failures. Only this small watchdog table is written.
  await db.execute('CREATE TABLE IF NOT EXISTS blue_provisional_watchdog_v1 (trade_day TEXT PRIMARY KEY, next_attempt_utc TEXT NOT NULL, attempts INTEGER NOT NULL)');
  const stamp=now.toISOString(),next=new Date(now.getTime()+COOLDOWN).toISOString();
  const claim=await db.execute({sql:'INSERT INTO blue_provisional_watchdog_v1 (trade_day,next_attempt_utc,attempts) VALUES (?,?,1) ON CONFLICT(trade_day) DO UPDATE SET next_attempt_utc=excluded.next_attempt_utc,attempts=blue_provisional_watchdog_v1.attempts+1 WHERE blue_provisional_watchdog_v1.next_attempt_utc<=? AND blue_provisional_watchdog_v1.attempts<24',args:[g.day,next,stamp]});
  if(claim.rowsAffected!==1)return {status:'COOLDOWN_OR_DAILY_CAP'};
  const request=deps.fetchFn||fetch;
  const headers={authorization:'Bearer '+token,accept:'application/vnd.github+json','content-type':'application/json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'blue-provisional-watchdog'};
  for(const status of ACTIVE){
   const r=await request(API+'/runs?status='+status+'&per_page=1',{method:'GET',headers,signal:AbortSignal.timeout(10000)});
   if(!r.ok)return {status:'GITHUB_LIST_FAILED',http:r.status};
   const payload=await r.json();
   if(!Number.isSafeInteger(payload.total_count)||payload.total_count<0||!Array.isArray(payload.workflow_runs)||((payload.total_count>0)!==(payload.workflow_runs.length>0)))return {status:'GITHUB_LIST_INVALID'};
   if(payload.total_count>0)return {status:'PUBLISH_ALREADY_ACTIVE'};
  }
  // Recheck after network round trips; the publisher itself rechecks everything.
  const second=await (deps.gate||publicationGate)(db,deps.nowFn?deps.nowFn():new Date(),{scheduled:true});
  if(!second.ready||second.day!==g.day||second.reference!==g.reference)return {status:'NO_LONGER_ELIGIBLE'};
  const r=await request(API+'/dispatches',{method:'POST',headers,body:JSON.stringify({ref:'main',inputs:{mode:'recovery'}}),signal:AbortSignal.timeout(10000)});
  // GitHub can accept a request while the response is lost. Do not retry here.
  return r.status===204||r.status===200?{status:'DISPATCH_ACCEPTED',day:g.day}:{status:'DISPATCH_REJECTED',http:r.status};
 }catch{return {status:'WATCHDOG_UNAVAILABLE'};}
 finally{db.close();}
}

/** BLUE R1.5.10.9: Cloudflare-side EOD and NXT-after checkpoints.
 * This is a scheduler, NOT a stock exchange price source.
 * Never put GitHub token in a browser response or use unverified NXT quotes as KRX EOD.
 */
interface CronEnv {
  DB: D1Database;
  GITHUB_TOKEN?: string;
}

const GITHUB_DISPATCH='https://api.github.com/repos/ehdud6728-bit/BLUE-Signal-Lab/actions/workflows/blue_market_scan_research_only.yml/dispatches';
const SCHEMA=`CREATE TABLE IF NOT EXISTS blue_eod_schedule_r15109 (
  day TEXT NOT NULL, phase TEXT NOT NULL, status TEXT NOT NULL,
  updated_at TEXT NOT NULL, dispatch_http INTEGER,
  nxt_sampled_codes INTEGER, nxt_latest_utc TEXT,
  message TEXT, PRIMARY KEY(day,phase)
)`;
function kstDay(when:Date):string {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(when);
}
function kstClock(when:Date):string {
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(when);
}
async function note(env:CronEnv,day:string,phase:string,status:string,message:string,http:number|null=null,quotes:number|null=null,latest:string|null=null):Promise<void>{
  await env.DB.prepare(`INSERT INTO blue_eod_schedule_r15109
    (day,phase,status,updated_at,dispatch_http,nxt_sampled_codes,nxt_latest_utc,message)
    VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(day,phase) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,
      dispatch_http=excluded.dispatch_http,nxt_sampled_codes=excluded.nxt_sampled_codes,
      nxt_latest_utc=excluded.nxt_latest_utc,message=excluded.message`)
    .bind(day,phase,status,new Date().toISOString(),http,quotes,latest,message).run();
}
async function requestVerifiedEod(env:CronEnv,day:string,phase:'KRX_EOD'|'KRX_RETRY'):Promise<void>{
  // An already imported source date never needs a new KRX run just to refresh a UI.
  const ready=await env.DB.prepare(`SELECT 1 AS ok FROM daily_counts d JOIN runs r ON r.run_id=d.run_id
     WHERE d.day=? AND r.latest_price_date=d.day AND r.is_demo=0 LIMIT 1`).bind(day).first();
  if(ready){await note(env,day,phase,'READY','Verified KRX EOD already stored');return;}
  const earlier=await env.DB.prepare('SELECT status,updated_at FROM blue_eod_schedule_r15109 WHERE day=? AND phase=?').bind(day,phase).first<{status:string;updated_at:string}>();
  // Avoid duplicate dispatches while the GitHub runner may still be queued.
  if(earlier&&['DISPATCHED','CLAIMED'].includes(earlier.status))return;
  if(!env.GITHUB_TOKEN){await note(env,day,phase,'BLOCKED','GITHUB_TOKEN not configured on API Worker');return;}
  // Claim the date+phase before making the GitHub request. A failed dispatch can retry.
  const timestamp=new Date().toISOString();
  const claim=await env.DB.prepare(`INSERT INTO blue_eod_schedule_r15109(day,phase,status,updated_at,message)
      VALUES(?,?,'CLAIMED',?,'GitHub dispatch in progress')
      ON CONFLICT(day,phase) DO UPDATE SET status='CLAIMED',updated_at=excluded.updated_at,
       message=excluded.message WHERE status IN ('ERROR','BLOCKED')`)
     .bind(day,phase,timestamp).run();
  if(!claim.meta.changes)return;
  try{
    const result=await fetch(GITHUB_DISPATCH,{method:'POST',headers:{
      'Accept':'application/vnd.github+json','Authorization':`Bearer ${env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version':'2022-11-28','User-Agent':'BLUE-EOD-Cloudflare-Cron',
      'Content-Type':'application/json'
    },body:JSON.stringify({ref:'main',inputs:{asof_date:day,publish_to_d1:'true'}})});
    const ok=result.status===204||result.status===200;
    await note(env,day,phase,ok?'DISPATCHED':'ERROR',ok?'GitHub verified-EOD job requested':`GitHub dispatch HTTP ${result.status}`,result.status);
    if(!ok)console.warn('BLUE_EOD_DISPATCH_FAILED',day,phase,result.status);
  }catch{
    await note(env,day,phase,'ERROR','GitHub dispatch network error');
    console.warn('BLUE_EOD_DISPATCH_NETWORK_ERROR',day,phase);
  }
}
async function afterMarketAudit(env:CronEnv,day:string):Promise<void>{
  let count=0,latest:string|null=null,status='NO_VERIFIED_NXT_SNAPSHOT';
  try{
    const table=await env.DB.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='blue_kis_live_quotes_r141'").first();
    if(table){
      const row=await env.DB.prepare(`SELECT COUNT(DISTINCT code) AS n,MAX(received_at_utc) AS latest
        FROM blue_kis_live_quotes_r141 WHERE trade_date=? AND market='NX'
        AND json_valid(payload_json) AND json_extract(payload_json,'$.phase')='NXT_AFTER'`)
        .bind(day).first<{n:number;latest:string|null}>();
      count=Number(row?.n||0);latest=row?.latest||null;
      if(count>0)status='PARTIAL_NXT_SNAPSHOTS';
    }
  }catch{status='NXT_AUDIT_UNAVAILABLE';}
  await note(env,day,'NXT_AFTER',status,
    count>0?'Saved NXT after-market snapshots only; NOT official 20:00 last trade for full market':'No provider-verified NXT after-market snapshot available',
    null,count,latest);
}

export async function runEodCloudflareCron(event:ScheduledController,env:CronEnv):Promise<void>{
  const scheduled=new Date(event.scheduledTime);
  const day=kstDay(scheduled),clock=kstClock(scheduled);
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(day)||scheduled.getUTCDay()===0||scheduled.getUTCDay()===6)return;
  // Do not dispatch a previous-day scan if a Cron fires many hours late.
  if(day!==kstDay(new Date()))return;
  if(day>'2026-12-31'){
    console.warn('BLUE_EOD_YEAR_CONFIG_UPDATE_REQUIRED',day);return;
  }
  await env.DB.prepare(SCHEMA).run();
  if(clock==='16:40'||clock==='16:55'){
    await requestVerifiedEod(env,day,'KRX_EOD');
  } else if(clock==='20:20'||clock==='20:35'){
    await afterMarketAudit(env,day);
    // If regular EOD is still missing, the 20:20 checkpoint also retries it.
    await requestVerifiedEod(env,day,'KRX_RETRY');
  }
}

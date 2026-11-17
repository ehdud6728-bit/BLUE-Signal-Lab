/** Private, rate-limited KIS quote lookup for an authenticated API request.
 * Called only through Cloudflare's named service-binding RPC entrypoint.
 * KIS credentials never leave this collector Worker and no official EOD,
 * trading signal, or order record is generated.
 */
import {inspectCachedToken,kstParts,marketsFor,getKisQuote} from './core.mjs';
import {parseSymbolLiveQuote} from './symbol-live.mjs';

const PER_CODE_SECONDS=20;
const REQUESTS_PER_MINUTE=12;
const validCode=value=>typeof value==='string'&&/^[0-9A-Z]{6}$/.test(value);

export async function collectSymbolLiveInstant(env,code,now=new Date(),deps={}){
  if(!validCode(code))return {status:'INVALID_CODE'};
  if(String(env.COLLECTOR_ENABLED).toLowerCase()!=='true')return {status:'DISABLED'};
  const phases=(deps.phases||marketsFor)(now,env.CLOSED_DATES||'');
  if(!phases.length)return {status:'MARKET_CLOSED'};
  const db=env.DB;
  const [market,phase]=phases.find(p=>p[0]==='J')||phases[0];
  let token;
  try{
    const found=deps.token?
      {token:await deps.token(db,env.KIS_APP_KEY,env.KIS_APP_SECRET,now)}:
      await inspectCachedToken(db,env.KIS_APP_KEY,env.KIS_APP_SECRET,now);
    token=found.token;
  }catch{/* Token detail and secrets are never returned. */}
  if(!token)return {status:'WAITING_TOKEN'};
  try{
    await db.prepare(`CREATE TABLE IF NOT EXISTS blue_symbol_live_direct_limit_v1 (
      code TEXT PRIMARY KEY,next_allowed_utc TEXT NOT NULL)`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS blue_symbol_live_direct_budget_v1 (
      minute_utc TEXT PRIMARY KEY,used INTEGER NOT NULL)`).run();
    const stamp=now.toISOString();
    const retryAt=new Date(now.getTime()+PER_CODE_SECONDS*1000).toISOString();
    // Atomic, per-code cooldown; concurrent tab requests cannot all reach KIS.
    const claimed=await db.prepare(`INSERT INTO blue_symbol_live_direct_limit_v1
      (code,next_allowed_utc) VALUES(?,?)
      ON CONFLICT(code) DO UPDATE SET next_allowed_utc=excluded.next_allowed_utc
      WHERE blue_symbol_live_direct_limit_v1.next_allowed_utc<=?`)
      .bind(code,retryAt,stamp).run();
    if(claimed.meta?.changes!==1)return {status:'COOLDOWN'};
    // Additional global cap, independent of the original Cron collector.
    const minute=stamp.slice(0,16);
    const used=await db.prepare(`INSERT INTO blue_symbol_live_direct_budget_v1
      (minute_utc,used) VALUES(?,1)
      ON CONFLICT(minute_utc) DO UPDATE SET used=used+1
      WHERE blue_symbol_live_direct_budget_v1.used<?`)
      .bind(minute,REQUESTS_PER_MINUTE).run();
    if(used.meta?.changes!==1)return {status:'RATE_LIMITED'};
    const raw=await (deps.quote||getKisQuote)(env,token,market,code);
    const q=parseSymbolLiveQuote(code,market,phase,raw,deps.receivedAt||new Date());
    await db.prepare(`CREATE TABLE IF NOT EXISTS blue_symbol_live_quotes_v1 (
      trade_date TEXT NOT NULL,market TEXT NOT NULL,code TEXT NOT NULL,
      received_at_utc TEXT NOT NULL,payload_json TEXT NOT NULL,
      PRIMARY KEY(trade_date,market,code))`).run();
    await db.prepare(`INSERT INTO blue_symbol_live_quotes_v1
      (trade_date,market,code,received_at_utc,payload_json) VALUES(?,?,?,?,?)
      ON CONFLICT(trade_date,market,code) DO UPDATE SET
      received_at_utc=excluded.received_at_utc,payload_json=excluded.payload_json
      WHERE excluded.received_at_utc>blue_symbol_live_quotes_v1.received_at_utc`)
      .bind(q.trade_date_kst,q.market,q.code,q.received_at_utc,JSON.stringify(q)).run();
    // If a background queue entry exists, make the result visible there too.
    try{
      await db.prepare(`UPDATE blue_symbol_live_requests_v1
        SET status='READY',checked_at_utc=?,next_due_utc=?,message=NULL
        WHERE code=?`).bind(q.received_at_utc,retryAt,code).run();
    }catch{/* An absent queue cannot invalidate the safely stored quote. */}
    return {status:'SAVED',code,trade_date:q.trade_date_kst,market:q.market};
  }catch{
    // Never leak KIS credentials, raw vendor responses, or D1 internals.
    return {status:'QUOTE_UNAVAILABLE'};
  }
}

/**
 * Turso-only KIS quote collector. No D1 queries, queue, tokenP, or orders.
 * Time-boxed opt-in only. The legacy D1 Cron collector remains unchanged.
 */
import {createClient} from '@libsql/client/web';
import {marketsFor,kstParts,getKisQuote,getKisDailyQuote,parseQuote,vaultScope,decryptVault,ageDays,inspectCachedToken} from './core.mjs';
import {buildTursoMirrorStatements} from './turso-mirror.mjs';
import {provisionalStatements} from './turso-provisional.mjs';

const MAX_PER_TICK=12;
const MAX_PILOT_MS=30*60*1000;
const MAX_SOURCE_AGE_DAYS=7;
const INSTANT_PER_CODE_SECONDS=20;
// Conservative first throughput step; shared KIS account must be monitored.
const INSTANT_PER_MINUTE=20;
// KRX stock codes include six-character uppercase alphanumerics (e.g. 00088K).
// Match the validated EOD candidate and Turso price-comparison contracts.
const CODE=/^[0-9A-Z]{6}$/;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

export function tursoDirectMode(env,now=new Date()){
  if(String(env?.TURSO_DIRECT_QUOTES_ENABLED||'false').toLowerCase()==='true')return 'FULL';
  const expiry=String(env?.TURSO_DIRECT_PILOT_UNTIL_UTC||'');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(expiry))return 'OFF';
  const delta=Date.parse(expiry)-now.getTime();
  return delta>0&&delta<=MAX_PILOT_MS?'PILOT':'OFF';
}

export function tursoInstantEnabled(env){
  return String(env?.TURSO_INSTANT_QUOTES_ENABLED||'false').toLowerCase()==='true' &&
    String(env?.COLLECTOR_ENABLED||'false').toLowerCase()==='true';
}

export async function tursoDirectCachedToken(client,env,now){
  if(!env.KIS_APP_KEY||!env.KIS_APP_SECRET)return {status:'KIS_CONFIG_MISSING',token:null};
  const scope=await vaultScope(env.KIS_APP_KEY);
  let found;
  try{
    found=await client.execute({sql:'SELECT ciphertext,expires_at_utc FROM blue_turso_kis_vault_v1 WHERE scope=? LIMIT 1',args:[scope]});
  }catch{return {status:'TURSO_TOKEN_VAULT_UNAVAILABLE',token:null};}
  const row=found.rows?.[0];
  if(!row)return {status:'TURSO_TOKEN_MISSING',token:null};
  if(typeof row.ciphertext!=='string'||!Number.isFinite(Date.parse(String(row.expires_at_utc))))
    return {status:'TURSO_TOKEN_METADATA_INVALID',token:null};
  if(Date.parse(String(row.expires_at_utc))<=now.getTime()+5*60_000)
    return {status:'TURSO_TOKEN_EXPIRED',token:null};
  try{return {status:'READY',token:await decryptVault(row.ciphertext,env.KIS_APP_KEY,env.KIS_APP_SECRET)};}
  catch{return {status:'TURSO_TOKEN_DECRYPT_FAILED',token:null};}
}
/** The exact same issued token can be read from the existing encrypted D1
 * standby vault. D1 is only queried when the primary token is unavailable;
 * neither Worker is authorized to call tokenP.
 */
export async function sharedKisToken(client,env,now){
  const primary=await tursoDirectCachedToken(client,env,now);
  if(primary.token||String(env.BLUE_KIS_DUAL_VAULT_ENABLED)!=='true'||
    !['TURSO_TOKEN_VAULT_UNAVAILABLE','TURSO_TOKEN_MISSING','TURSO_TOKEN_EXPIRED'].includes(primary.status))
    return primary;
  if(!env.DB?.prepare)return {status:'D1_TOKEN_BACKUP_NOT_CONFIGURED',token:null};
  const standby=await inspectCachedToken(env.DB,env.KIS_APP_KEY,env.KIS_APP_SECRET,now);
  return standby.token?{status:'D1_BACKUP_READY',token:standby.token}:
    {status:`D1_BACKUP_${standby.status}`,token:null};
}

/** Collects a deterministic rotating page of verified, independently stored
 * research signal stocks. Each tick processes at most 12 symbols, avoiding a
 * 189-symbol provider burst while cycling through every saved signal.
 */
export async function collectTursoDirect(env,now=new Date(),deps={}){
  const mode=tursoDirectMode(env,now);
  if(mode==='OFF')return {status:'DISABLED'};
  if(String(env.COLLECTOR_ENABLED||'false').toLowerCase()!=='true')return {status:'DISABLED'};
  const kst=kstParts(now);
  if(Math.floor(kst.seconds/60)%5!==0)return {status:'NOT_FIVE_MINUTE_TICK'};
  const phases=(deps.marketsFor||marketsFor)(now,env.CLOSED_DATES||'');
  if(!phases.length)return {status:'MARKET_CLOSED'};
  const url=String(env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(libsql|https):\/\//.test(url)||!authToken)return {status:'TURSO_NOT_CONFIGURED'};
  const client=(deps.clientFactory||createClient)({url,authToken,intMode:'string'});
  try{
    const recent=await client.execute({sql:'SELECT a.trade_day,a.row_count FROM blue_research_signal_audit_v1 a JOIN blue_eod_ingest_audit_v1 e ON e.trade_day=a.trade_day AND e.row_count>=1700 WHERE a.trade_day<? AND a.row_count>0 ORDER BY a.trade_day DESC LIMIT 1',args:[kst.date]});
    if(!recent.rows.length)return {status:'NO_VERIFIED_RESEARCH_DAY'};
    const day=String(recent.rows[0].trade_day),expected=Number(recent.rows[0].row_count);
    if(!DATE.test(day)||!Number.isSafeInteger(expected)||expected<1||expected>10000)
      throw Error('TURSO_DIRECT_BAD_AUDIT');
    const daysOld=ageDays(kst.date,day);
    if(daysOld<1||daysOld>MAX_SOURCE_AGE_DAYS)
      return {status:'STALE_RESEARCH_DAY',asof:day};
    const completeness=await client.execute({sql:'SELECT COUNT(*) AS n FROM blue_research_signals_v1 s JOIN blue_research_signal_audit_v1 a ON a.trade_day=s.trade_day AND a.source_payload_sha256=s.source_payload_sha256 WHERE s.trade_day=?',args:[day]});
    if(Number(completeness.rows[0]?.n)!==expected)throw Error('TURSO_DIRECT_INCOMPLETE_AUDIT');
    const pages=Math.ceil(expected/MAX_PER_TICK);
    const page=Math.floor(kst.seconds/300)%pages;
    const rows=await client.execute({sql:'SELECT s.code,s.close_price,s.signal_names FROM blue_research_signals_v1 s JOIN blue_research_signal_audit_v1 a ON a.trade_day=s.trade_day AND a.source_payload_sha256=s.source_payload_sha256 WHERE s.trade_day=? ORDER BY s.code LIMIT ? OFFSET ?',args:[day,MAX_PER_TICK,page*MAX_PER_TICK]});
    if(!rows.rows.length)return {status:'EMPTY_PAGE',asof:day,page};
    const found=deps.token?{status:'READY',token:await deps.token(client,env,now)}:
      await sharedKisToken(client,env,now);
    if(!found.token)return {status:found.status==='READY'?'TURSO_TOKEN_MISSING':found.status,asof:day};
    const [market,phase]=phases.find(v=>v[0]==='J')||phases[0];
    const accepted=[];let rejected=0,previous=0;
    for(const r of rows.rows){
      const code=String(r.code),close=Number(r.close_price);
      if(!CODE.test(code)||!Number.isSafeInteger(close)||close<=0){rejected++;continue;}
      if(previous&&!deps.noPacing)await (deps.sleep||sleep)(450);
      previous++;
      try{
        const json=await (deps.quote||getKisQuote)(env,found.token,market,code);
        const received=deps.receivedAt||new Date();
        const q=parseQuote({code,name:'',eod_close:close,eod_asof:day,
          eod_signals:String(r.signal_names||''),origin:'TURSO_AUDITED_SIGNAL'},
          market,phase,json,received,kst.date);
        if(q.trade_date_kst!==kst.date||q.source!=='KIS_REST_INQUIRE_PRICE')
          throw Error('TURSO_DIRECT_QUOTE_DAY_MISMATCH');
        accepted.push(q);
      }catch{rejected++;}
    }
    if(!accepted.length)return {status:'NO_VALID_QUOTES',asof:day,attempted:rows.rows.length,rejected};
    // Existing latest/history tables and quote validation reused; this batch
    // has no D1 dependency, even if its daily quota is exhausted.
    await client.batch(buildTursoMirrorStatements(accepted),'write');
    return {status:'SAVED',mode,asof:day,page,pages,
      attempted:rows.rows.length,saved:accepted.length,rejected};
  }finally{client.close();}
}

/** Access-protected service-binding RPC only. Independently selects a verified
 * EOD reference and cached KIS token from Turso, then saves the observed quote
 * to Turso latest/history. D1 is NEVER consulted, including on failure.
 * The API Worker authenticates the caller; the flag and atomic Turso limits
 * prevent a public or unattended KIS polling loop.
 */
export async function collectTursoInstant(env,code,now=new Date(),deps={}){
  if(typeof code!=='string'||!CODE.test(code))return {status:'INVALID_CODE'};
  if(!tursoInstantEnabled(env))return {status:'DISABLED'};
  const phases=(deps.marketsFor||marketsFor)(now,env.CLOSED_DATES||'');
  const kst=kstParts(now);
  const afterClose=!['Sat','Sun'].includes(kst.weekday)&&
    !String(env.CLOSED_DATES||'').split(',').map(x=>x.trim()).includes(kst.date)&&
    kst.seconds>=15*3600+20*60&&kst.seconds<22*3600;
  if(!phases.length&&!afterClose)return {status:'MARKET_CLOSED'};
  const url=String(env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(libsql|https):\/\//.test(url)||!authToken)return {status:'TURSO_NOT_CONFIGURED'};
  const client=(deps.clientFactory||createClient)({url,authToken,intMode:'string'});
  try{
    const day=kst.date;
    const reference=await client.execute({sql:`SELECT e.trade_day,e.close,e.name
      FROM blue_eod_daily_v1 e JOIN blue_eod_ingest_audit_v1 a
        ON a.trade_day=e.trade_day AND a.row_count>=1700
      WHERE e.code=? AND e.trade_day<? ORDER BY e.trade_day DESC LIMIT 1`,args:[code,day]});
    const row=reference.rows?.[0];
    if(!row)return {status:'NO_VERIFIED_EOD_REFERENCE'};
    const sourceDay=String(row.trade_day),close=Number(row.close);
    if(!DATE.test(sourceDay)||!Number.isSafeInteger(close)||close<=0||
      ageDays(day,sourceDay)<1||ageDays(day,sourceDay)>MAX_SOURCE_AGE_DAYS)
      return {status:'STALE_OR_INVALID_EOD_REFERENCE'};
    // No D1 token fallback for an explicitly Turso-only immediate quote.
    const found=deps.token?{token:await deps.token(client,env,now)}:
      await tursoDirectCachedToken(client,env,now);
    if(!found.token)return {status:found.status||'TURSO_TOKEN_MISSING'};
    // Atomic limits are stored in Turso, so a D1 quota failure cannot bypass
    // them or allow extra provider traffic. A DB failure fails closed.
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_turso_instant_code_limit_v1
      (code TEXT PRIMARY KEY,next_allowed_utc TEXT NOT NULL)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_turso_instant_minute_budget_v1
      (minute_utc TEXT PRIMARY KEY,used INTEGER NOT NULL)`);
    const stamp=now.toISOString(),next=new Date(now.getTime()+INSTANT_PER_CODE_SECONDS*1000).toISOString();
    const claimed=await client.execute({sql:`INSERT INTO blue_turso_instant_code_limit_v1
      (code,next_allowed_utc) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET
      next_allowed_utc=excluded.next_allowed_utc
      WHERE blue_turso_instant_code_limit_v1.next_allowed_utc<=?`,args:[code,next,stamp]});
    if(claimed.rowsAffected!==1)return {status:'COOLDOWN'};
    const minute=stamp.slice(0,16);
    const budget=await client.execute({sql:`INSERT INTO blue_turso_instant_minute_budget_v1
      (minute_utc,used) VALUES(?,1) ON CONFLICT(minute_utc) DO UPDATE SET
      used=used+1 WHERE blue_turso_instant_minute_budget_v1.used<?`,args:[minute,INSTANT_PER_MINUTE]});
    if(budget.rowsAffected!==1)return {status:'RATE_LIMITED'};
    const [market,phase]=afterClose?['J','KRX_POST_CLOSE']:
      (phases.find(p=>p[0]==='J')||phases[0]);
    const raw=afterClose?
      await (deps.quoteDaily||getKisDailyQuote)(env,found.token,'J',code,day):
      await (deps.quote||getKisQuote)(env,found.token,market,code);
    const received=deps.receivedAt||new Date();
    const quote=parseQuote({code,name:String(row.name||'').slice(0,70),
      eod_close:close,eod_asof:sourceDay,eod_signals:'',
      origin:'TURSO_VERIFIED_EOD_INSTANT'},market,phase,raw,received,day);
    if(afterClose){
      if(!quote.reported_trade_date||quote.open<quote.low||quote.open>quote.high)
        throw Error('INVALID_KIS_DAILY_QUOTE');
      quote.source='KIS_REST_INQUIRE_DAILY_PRICE';
      quote.provisional_status='IN_PROGRESS';
      quote.provisional_date_basis='KIS_REPORTED_TRADE_DATE';
      quote.is_confirmed_daily=false;
      await client.execute(`CREATE TABLE IF NOT EXISTS blue_kis_provisional_daily_v1 (
        trade_day TEXT NOT NULL,code TEXT NOT NULL,market TEXT NOT NULL,
        name TEXT NOT NULL,open INTEGER NOT NULL,high INTEGER NOT NULL,
        low INTEGER NOT NULL,close INTEGER NOT NULL,volume INTEGER NOT NULL,
        reference_day TEXT NOT NULL,observed_at_utc TEXT NOT NULL,
        date_basis TEXT NOT NULL,source TEXT NOT NULL,
        PRIMARY KEY(trade_day,code))`);
    }
    await client.batch(afterClose?provisionalStatements([quote]):
      buildTursoMirrorStatements([quote]),'write');
    return {status:'SAVED',code,market,price:quote.price,
      trade_date:day,received_at_utc:quote.received_at_utc};
  }catch{
    // No credentials, raw provider payload, SQL or token ever reaches the API.
    return {status:'QUOTE_UNAVAILABLE'};
  }finally{client.close();}
}

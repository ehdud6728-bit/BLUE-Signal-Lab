/**
 * Opt-in, Turso-only, KIS provisional DAILY observations during KRX trading.
 * This deliberately does not create audited KRX EOD or research signal rows.
 * No token issuance, D1 reads/writes, orders, or minute bars.
 */
import {createClient} from '@libsql/client/web';
import {ageDays,getKisQuote,kstParts,marketsFor,parseQuote} from './core.mjs';
import {tursoDirectCachedToken} from './turso-direct.mjs';
import {buildTursoMirrorStatements} from './turso-mirror.mjs';

const PAGE_SIZE=10;
const MAX_PILOT_MS=30*60_000;
const MAX_REFERENCE_AGE_DAYS=7;
const CODE=/^[0-9A-Z]{6}$/;
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function tursoProvisionalMode(env,now=new Date()){
  if(String(env?.TURSO_PROVISIONAL_PAUSED||'false').toLowerCase()==='true')return 'OFF';
  if(String(env?.TURSO_PROVISIONAL_QUOTES_ENABLED||'false').toLowerCase()==='true')return 'FULL';
  const until=String(env?.TURSO_PROVISIONAL_PILOT_UNTIL_UTC||'');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(until))return 'OFF';
  const remaining=Date.parse(until)-now.getTime();
  return remaining>0&&remaining<=MAX_PILOT_MS?'PILOT':'OFF';
}

export function provisionalStatements(quotes){
  const mirror=buildTursoMirrorStatements(quotes);
  for(const q of quotes){
    if(q.market!=='J'||q.phase!=='KRX_REGULAR'||q.provisional_status!=='IN_PROGRESS'||
      q.trade_date_kst===q.eod_asof||q.source!=='KIS_REST_INQUIRE_PRICE'||
      !['KIS_REPORTED_TRADE_DATE','COLLECTOR_KST_REGULAR_SESSION'].includes(q.provisional_date_basis))
      throw Error('INVALID_PROVISIONAL_QUOTE');
    mirror.push({sql:`INSERT INTO blue_kis_provisional_daily_v1
      (trade_day,code,market,name,open,high,low,close,volume,
       reference_day,observed_at_utc,date_basis,source)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(trade_day,code) DO UPDATE SET
        market=excluded.market,name=excluded.name,open=excluded.open,
        high=excluded.high,low=excluded.low,close=excluded.close,
        volume=excluded.volume,reference_day=excluded.reference_day,
        observed_at_utc=excluded.observed_at_utc,date_basis=excluded.date_basis,
        source=excluded.source
      WHERE excluded.observed_at_utc>blue_kis_provisional_daily_v1.observed_at_utc`,
      args:[q.trade_date_kst,q.code,'J',q.name,q.open,q.high,q.low,q.price,
        q.accumulated_volume,q.eod_asof,q.received_at_utc,q.provisional_date_basis,
        'KIS_REST_INQUIRE_PRICE_PROVISIONAL']});
  }
  return mirror;
}

/** Ten symbols/minute, paging audited previous-day KRX symbols in code order.
 * A typical ~2,700-symbol directory completes its first pass in ~4.5 hours.
 * Missing/suspended/provider-rejected symbols remain missing, never fabricated.
 */
export async function collectTursoProvisional(env,now=new Date(),deps={}){
  const mode=tursoProvisionalMode(env,now);
  if(mode==='OFF'||String(env?.COLLECTOR_ENABLED||'false').toLowerCase()!=='true')
    return {status:'DISABLED'};
  const kst=kstParts(now);
  // The KIS regular-session quote is not an independently verified final EOD.
  if(kst.seconds<9*3600||kst.seconds>=15*3600+20*60||
    !(deps.marketsFor||marketsFor)(now,env.CLOSED_DATES||'')
      .some(([market,phase])=>market==='J'&&phase==='KRX_REGULAR'))
    return {status:'OUTSIDE_KRX_REGULAR_SESSION'};
  const url=String(env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(libsql|https):\/\//.test(url)||!authToken)return {status:'TURSO_NOT_CONFIGURED'};
  const client=(deps.clientFactory||createClient)({url,authToken,intMode:'string'});
  try{
    const latest=await client.execute({sql:`SELECT trade_day,row_count
      FROM blue_eod_ingest_audit_v1
      WHERE trade_day<? AND row_count>=1700
      ORDER BY trade_day DESC LIMIT 1`,args:[kst.date]});
    const audit=latest.rows?.[0];
    if(!audit)return {status:'NO_VERIFIED_EOD_REFERENCE'};
    const day=String(audit.trade_day),expected=Number(audit.row_count);
    if(!DAY.test(day)||!Number.isSafeInteger(expected)||expected<1700||expected>10000)
      return {status:'INVALID_EOD_AUDIT'};
    const age=ageDays(kst.date,day);
    if(age<1||age>MAX_REFERENCE_AGE_DAYS)return {status:'STALE_EOD_REFERENCE',asof:day};
    const count=await client.execute({sql:'SELECT COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day=?',args:[day]});
    if(Number(count.rows?.[0]?.n)!==expected)return {status:'INCOMPLETE_EOD_REFERENCE',asof:day};
    const pages=Math.ceil(expected/PAGE_SIZE);
    const minute=Math.floor((kst.seconds-9*3600)/60);
    const page=minute%pages;
    const selected=await client.execute({sql:`SELECT code,name,close FROM blue_eod_daily_v1
      WHERE trade_day=? ORDER BY code LIMIT ? OFFSET ?`,args:[day,PAGE_SIZE,page*PAGE_SIZE]});
    if(!selected.rows?.length)return {status:'EMPTY_PAGE',asof:day,page};
    // Unlike the shared research collector, this path never reads D1 backup.
    const found=deps.token?{status:'READY',token:await deps.token(client,env,now)}:
      await tursoDirectCachedToken(client,env,now);
    if(!found.token)return {status:found.status==='READY'?'TURSO_TOKEN_MISSING':found.status,asof:day};
    const quotes=[];let rejected=0,previous=0;
    for(const r of selected.rows){
      const code=String(r.code||''),close=Number(r.close);
      if(!CODE.test(code)||!Number.isSafeInteger(close)||close<=0){rejected++;continue;}
      if(previous&&!deps.noPacing)await (deps.sleep||sleep)(450);
      previous++;
      try{
        const json=await (deps.quote||getKisQuote)(env,found.token,'J',code);
        const received=deps.receivedAt||new Date();
        const q=parseQuote({code,name:String(r.name||'').slice(0,70),
          eod_close:close,eod_asof:day,eod_signals:'',
          origin:'TURSO_VERIFIED_EOD_PROVISIONAL'},
        'J','KRX_REGULAR',json,received,kst.date);
        if(q.open<q.low||q.open>q.high)throw Error('INVALID_PROVISIONAL_OPEN');
        // KIS's inquire-price response may omit a trading-day field. In this
        // case the date is inferred from the KRX session, never 'verified'.
        q.provisional_status='IN_PROGRESS';
        q.provisional_date_basis=q.reported_trade_date?
          'KIS_REPORTED_TRADE_DATE':'COLLECTOR_KST_REGULAR_SESSION';
        q.is_confirmed_daily=false;
        quotes.push(q);
      }catch{rejected++;}
    }
    if(!quotes.length)return {status:'NO_VALID_QUOTES',asof:day,page,
      attempted:selected.rows.length,rejected};
    // No confirmed EOD/research/audit table is modified by these statements.
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_kis_provisional_daily_v1 (
      trade_day TEXT NOT NULL,code TEXT NOT NULL,market TEXT NOT NULL,
      name TEXT NOT NULL,open INTEGER NOT NULL,high INTEGER NOT NULL,
      low INTEGER NOT NULL,close INTEGER NOT NULL,volume INTEGER NOT NULL,
      reference_day TEXT NOT NULL,observed_at_utc TEXT NOT NULL,
      date_basis TEXT NOT NULL,source TEXT NOT NULL,
      PRIMARY KEY(trade_day,code))`);
    await client.batch(provisionalStatements(quotes),'write');
    return {status:'SAVED',mode,asof:day,trade_day:kst.date,
      page,pages,attempted:selected.rows.length,saved:quotes.length,rejected};
  }finally{client.close();}
}

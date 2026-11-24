/**
 * Opt-in, Turso-only, KIS provisional DAILY observations through 22:00 KST.
 * After the regular session, fill only when independently audited KRX EOD is
 * not available; require an exact KIS-reported trade date.
 * This deliberately does not create audited KRX EOD or research signal rows.
 * No token issuance, D1 reads/writes, orders, or minute bars.
 */
import {createClient} from '@libsql/client/web';
import {ageDays,getKisQuote,getKisDailyQuote,kstParts,marketsFor,parseQuote} from './core.mjs';
import {tursoDirectCachedToken} from './turso-direct.mjs';
import {buildTursoMirrorStatements} from './turso-mirror.mjs';

const PILOT_PAGE=10;
const FULL_PAGE=40;
const FULL_START=20;
const FULL_MIN=10;
const COOLDOWN_MS=3*60_000;
const MAX_PILOT_MS=30*60_000;
const MAX_REFERENCE_AGE_DAYS=7;
const REGULAR_END=15*3600+20*60;
const POST_CLOSE_END=22*3600;
const CODE=/^[0-9A-Z]{6}$/;
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// Only bounded, code-only diagnostics. Never log provider bodies, URLs or tokens.
const QUOTE_ERRORS=new Set(['KIS_RATE_LIMIT','KIS_DAILY_EXACT_DATE_MISSING',
  'KIS_DAILY_RESPONSE_INVALID','KIS_DAILY_HTTP_UNAVAILABLE',
  'KIS_RESPONSE_INVALID','QUOTE_MISSING_FIELD','QUOTE_INCONSISTENT',
  'PROVIDER_TRADE_DAY_MISMATCH','KIS_DAILY_DATE_MISSING',
  'INVALID_PROVISIONAL_OPEN']);
const quoteReason=e=>QUOTE_ERRORS.has(e?.message)?e.message:'OTHER_QUOTE_REJECTED';

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
    const regular=q.phase==='KRX_REGULAR'&&q.source==='KIS_REST_INQUIRE_PRICE'&&
      ['KIS_REPORTED_TRADE_DATE','COLLECTOR_KST_REGULAR_SESSION'].includes(q.provisional_date_basis);
    const afterClose=['KRX_POST_CLOSE','KRX_FAILED_KIS_SECONDARY'].includes(q.phase)&&
      q.source==='KIS_REST_INQUIRE_DAILY_PRICE'&&
      q.provisional_date_basis==='KIS_REPORTED_TRADE_DATE'&&q.is_confirmed_daily===false&&
      q.reported_trade_date===q.trade_date_kst.replaceAll('-','');
    if(q.market!=='J'||q.provisional_status!=='IN_PROGRESS'||
      q.trade_date_kst===q.eod_asof||(!regular&&!afterClose))
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
        afterClose?'KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL':'KIS_REST_INQUIRE_PRICE_PROVISIONAL']});
  }
  return mirror;
}

/** Full mode cautiously ramps 20 -> 40 symbols/minute; pilot stays 10.
 * EGW00201/HTTP 429 halves the next batch and pauses three minutes. Unlike
 * a process-local timer, the bounded throttle state survives cron restarts.
 * These are app budgets, NOT a claim of a guaranteed KIS provider quota.
 */
export async function collectTursoProvisional(env,now=new Date(),deps={}){
  const mode=tursoProvisionalMode(env,now);
  if(mode==='OFF'||String(env?.COLLECTOR_ENABLED||'false').toLowerCase()!=='true')
    return {status:'DISABLED'};
  const kst=kstParts(now);
  const closed=String(env.CLOSED_DATES||'').split(',').map(x=>x.trim()).includes(kst.date);
  const weekday=!['Sat','Sun'].includes(kst.weekday)&&!closed;
  const regular=kst.seconds>=9*3600&&kst.seconds<REGULAR_END&&
    (deps.marketsFor||marketsFor)(now,env.CLOSED_DATES||'')
      .some(([market,phase])=>market==='J'&&phase==='KRX_REGULAR');
  const afterClose=weekday&&kst.seconds>=REGULAR_END&&kst.seconds<POST_CLOSE_END;
  if(!regular&&!afterClose)return {status:'OUTSIDE_COLLECTION_WINDOW'};
  const url=String(env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(libsql|https):\/\//.test(url)||!authToken)return {status:'TURSO_NOT_CONFIGURED'};
  const client=(deps.clientFactory||createClient)({url,authToken,intMode:'string'});
  try{
    // An independently audited same-day KRX EOD wins after the market closes.
    // If absent or incomplete, KIS observations remain provisional through 22:00.
    if(afterClose){
      const current=await client.execute({sql:`SELECT row_count FROM blue_eod_ingest_audit_v1
        WHERE trade_day=? AND row_count>=1700 LIMIT 1`,args:[kst.date]});
      const audited=current.rows?.[0];
      if(audited){
        const expected=Number(audited.row_count);
        if(!Number.isSafeInteger(expected)||expected>10000)
          return {status:'INVALID_CURRENT_EOD_AUDIT',trade_day:kst.date};
        const actual=await client.execute({sql:'SELECT COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day=?',args:[kst.date]});
        if(Number(actual.rows?.[0]?.n)===expected)
          return {status:'VERIFIED_EOD_ALREADY_AVAILABLE',trade_day:kst.date};
      }
    }
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
    let batchCap=PILOT_PAGE;
    if(mode==='FULL'){
      await client.execute(`CREATE TABLE IF NOT EXISTS blue_kis_provisional_pacing_v1 (
        trade_day TEXT PRIMARY KEY,batch_cap INTEGER NOT NULL,
        cooldown_until_utc TEXT NOT NULL)`);
      const saved=await client.execute({sql:`SELECT batch_cap,cooldown_until_utc
        FROM blue_kis_provisional_pacing_v1 WHERE trade_day=? LIMIT 1`,args:[kst.date]});
      const state=saved.rows?.[0];
      if(state){
        batchCap=Number(state.batch_cap);
        if(!Number.isInteger(batchCap)||batchCap<FULL_MIN||batchCap>FULL_PAGE)
          return {status:'INVALID_PROVISIONAL_PACING',asof:day};
        const next=Date.parse(String(state.cooldown_until_utc));
        if(!Number.isFinite(next))return {status:'INVALID_PROVISIONAL_PACING',asof:day};
        if(next>now.getTime())return {status:'KIS_RATE_LIMIT_COOLDOWN',asof:day,
          retry_after_utc:String(state.cooldown_until_utc)};
      }else batchCap=FULL_START;
    }
    const pageWidth=mode==='FULL'?FULL_PAGE:PILOT_PAGE;
    const pages=Math.ceil(expected/pageWidth);
    const minute=Math.floor((kst.seconds-9*3600)/60);
    const page=minute%pages;
    const base=await client.execute({sql:`SELECT code,name,close FROM blue_eod_daily_v1
      WHERE trade_day=? ORDER BY code LIMIT ? OFFSET ?`,args:[day,batchCap,page*pageWidth]});
    // Every fifth minute, refresh a few recently audited pattern candidates
    // before the rotating market sweep. Never use unaudited/D1 candidates.
    let priority=[];
    if(mode==='FULL'&&minute%5===0){
      try{
        const latestResearch=await client.execute({sql:`SELECT trade_day,row_count
          FROM blue_research_signal_audit_v1 WHERE trade_day<=? AND row_count>0
          ORDER BY trade_day DESC LIMIT 1`,args:[day]});
        const research=latestResearch.rows?.[0];
        const n=Number(research?.row_count||0),take=Math.min(8,Math.floor(batchCap/4));
        if(n>0&&n<=10000&&take>0){
          const offset=(Math.floor(minute/5)*take)%n;
          const rows=await client.execute({sql:`SELECT e.code,e.name,e.close
            FROM blue_research_signals_v1 s JOIN blue_research_signal_audit_v1 a
              ON a.trade_day=s.trade_day AND a.source_payload_sha256=s.source_payload_sha256
            JOIN blue_eod_daily_v1 e ON e.trade_day=? AND e.code=s.code
            WHERE s.trade_day=? ORDER BY s.code LIMIT ? OFFSET ?`,
            args:[day,String(research.trade_day),take,offset]});
          priority=rows.rows||[];
        }
      }catch{ /* An optional priority cannot block the full-market sweep. */ }
    }
    const seen=new Set();
    const selected={rows:[...priority,...(base.rows||[])].filter(row=>{
      const code=String(row.code||'');
      if(seen.has(code))return false;seen.add(code);return true;
    }).slice(0,batchCap)};
    if(!selected.rows?.length)return {status:'EMPTY_PAGE',asof:day,page};
    // Unlike the shared research collector, this path never reads D1 backup.
    const found=deps.token?{status:'READY',token:await deps.token(client,env,now)}:
      await tursoDirectCachedToken(client,env,now);
    if(!found.token)return {status:found.status==='READY'?'TURSO_TOKEN_MISSING':found.status,asof:day};
    const quotes=[];let rejected=0,previous=0,rateLimited=false;let turnoverValid=0,turnoverMissing=0;
    const reasons={};
    for(const r of selected.rows){
      const code=String(r.code||''),close=Number(r.close);
      if(!CODE.test(code)||!Number.isSafeInteger(close)||close<=0){
        rejected++;reasons.INVALID_REFERENCE_SYMBOL=(reasons.INVALID_REFERENCE_SYMBOL||0)+1;continue;
      }
      if(previous&&!deps.noPacing)await (deps.sleep||sleep)(450);
      previous++;
      try{
        const json=afterClose
          ?await (deps.quoteDaily||getKisDailyQuote)(env,found.token,'J',code,kst.date)
          :await (deps.quote||getKisQuote)(env,found.token,'J',code);
        const received=deps.receivedAt||new Date();
        const q=parseQuote({code,name:String(r.name||'').slice(0,70),
          eod_close:close,eod_asof:day,eod_signals:'',
          origin:'TURSO_VERIFIED_EOD_PROVISIONAL'},
        'J',afterClose?'KRX_POST_CLOSE':'KRX_REGULAR',json,received,kst.date);
        if(q.open<q.low||q.open>q.high)throw Error('INVALID_PROVISIONAL_OPEN');
        // Regular inquire-price may omit a day, but post-close daily-price must
        // provide an exact matching KIS business date (never an inference).
        if(afterClose&&!q.reported_trade_date)throw Error('KIS_DAILY_DATE_MISSING');
        if(afterClose)q.source='KIS_REST_INQUIRE_DAILY_PRICE';
        q.provisional_status='IN_PROGRESS';
        q.provisional_date_basis=q.reported_trade_date?
          'KIS_REPORTED_TRADE_DATE':'COLLECTOR_KST_REGULAR_SESSION';
        q.is_confirmed_daily=false;
        if(Number.isSafeInteger(q.accumulated_amount_krw)&&q.accumulated_amount_krw>0)turnoverValid++;else turnoverMissing++;
        quotes.push(q);
      }catch(e){
        rejected++;
        const reason=quoteReason(e);reasons[reason]=(reasons[reason]||0)+1;
        if(reason==='KIS_RATE_LIMIT'){
          rateLimited=true;break; // do NOT retry a throttled provider immediately.
        }
      }
    }
    if(mode==='FULL'){
      const nextCap=rateLimited?Math.max(FULL_MIN,Math.floor(batchCap/2)):
        rejected>selected.rows.length/2?batchCap:Math.min(FULL_PAGE,batchCap+5);
      const cooldown=new Date(now.getTime()+(rateLimited?COOLDOWN_MS:0)).toISOString();
      await client.execute({sql:`INSERT INTO blue_kis_provisional_pacing_v1
        (trade_day,batch_cap,cooldown_until_utc) VALUES(?,?,?)
        ON CONFLICT(trade_day) DO UPDATE SET batch_cap=excluded.batch_cap,
        cooldown_until_utc=excluded.cooldown_until_utc`,
        args:[kst.date,nextCap,cooldown]});
    }
    if(!quotes.length)return {status:rateLimited?'KIS_RATE_LIMIT_BACKOFF':'NO_VALID_QUOTES',asof:day,page,
      attempted:previous,rejected,rate_limited:rateLimited,reasons};
    // No confirmed EOD/research/audit table is modified by these statements.
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_kis_provisional_daily_v1 (
      trade_day TEXT NOT NULL,code TEXT NOT NULL,market TEXT NOT NULL,
      name TEXT NOT NULL,open INTEGER NOT NULL,high INTEGER NOT NULL,
      low INTEGER NOT NULL,close INTEGER NOT NULL,volume INTEGER NOT NULL,
      reference_day TEXT NOT NULL,observed_at_utc TEXT NOT NULL,
      date_basis TEXT NOT NULL,source TEXT NOT NULL,
      PRIMARY KEY(trade_day,code))`);
    await client.batch(provisionalStatements(quotes),'write');
    return {status:rateLimited?'SAVED_WITH_KIS_COOLDOWN':'SAVED',mode,asof:day,trade_day:kst.date,
      phase:afterClose?'KRX_POST_CLOSE':'KRX_REGULAR',
      page,pages,attempted:previous,saved:quotes.length,rejected,
      rate_limited:rateLimited,batch_cap:batchCap,turnover_valid:turnoverValid,turnover_missing:turnoverMissing,reasons};
  }finally{client.close();}
}

/** KRX exact-day failure -> bounded KIS daily-price collection into Turso.
 * Only the scheduled/manual APPLY pipeline calls this. KIS observations stay
 * provisional and NEVER enter audited KRX EOD, indicators, or research tables.
 * Existing encrypted Turso token only; no tokenP, D1, orders, or FULL flags.
 */
import {createClient} from '@libsql/client/web';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {ageDays,getKisDailyQuote,kstParts,parseQuote} from '../../collector/src/core.mjs';
import {tursoDirectCachedToken} from '../../collector/src/turso-direct.mjs';
import {provisionalStatements} from '../../collector/src/turso-provisional.mjs';

const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const CODE=/^[0-9A-Z]{6}$/;
const PACE_MS=1750; // <=35 requests/minute, independent of other KIS queues
const WRITE_BATCH=20;
const MAX_EMPTY_DATE_STREAK=25;
const sleep=ms=>new Promise(done=>setTimeout(done,ms));

function validDay(day){
  if(!DAY.test(day))return false;
  const d=new Date(day+'T00:00:00Z');
  return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===day;
}

export async function collectKisAfterKrxFailure(client,env,day,now=new Date(),deps={}){
  const today=kstParts(now).date;
  if(!validDay(day)||ageDays(today,day)<0||ageDays(today,day)>7)
    throw Error('INVALID_KIS_FALLBACK_DAY');
  // A complete KRX audited day always wins, even if one upstream fetch failed.
  const current=await client.execute({sql:`SELECT row_count FROM blue_eod_ingest_audit_v1
    WHERE trade_day=? AND row_count>=1700 LIMIT 1`,args:[day]});
  if(current.rows?.length){
    const count=Number(current.rows[0].row_count);
    const actual=await client.execute({sql:'SELECT COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day=?',args:[day]});
    if(count>=1700&&count<=10000&&Number(actual.rows?.[0]?.n)===count)
      return {status:'KRX_EOD_ALREADY_AVAILABLE',day,attempted:0,saved:0};
  }
  const previous=await client.execute({sql:`SELECT trade_day,row_count FROM blue_eod_ingest_audit_v1
    WHERE trade_day<? AND row_count>=1700 ORDER BY trade_day DESC LIMIT 1`,args:[day]});
  const audit=previous.rows?.[0];
  if(!audit||!validDay(String(audit.trade_day)))throw Error('NO_VERIFIED_KIS_REFERENCE');
  const reference=String(audit.trade_day),expected=Number(audit.row_count);
  if(!Number.isSafeInteger(expected)||expected<1700||expected>10000||
    ageDays(day,reference)<1||ageDays(day,reference)>7)
    throw Error('INVALID_KIS_REFERENCE_AUDIT');
  const symbols=await client.execute({sql:`SELECT code,name,close FROM blue_eod_daily_v1
    WHERE trade_day=? ORDER BY code LIMIT 10001`,args:[reference]});
  if(symbols.rows.length!==expected)throw Error('INCOMPLETE_KIS_REFERENCE');
  const found=deps.token?{token:await deps.token(client,env,now)}:
    await tursoDirectCachedToken(client,env,now);
  if(!found.token)throw Error(found.status||'TURSO_TOKEN_MISSING');

  await client.execute(`CREATE TABLE IF NOT EXISTS blue_kis_live_quotes_r141 (
    trade_date TEXT NOT NULL,market TEXT NOT NULL,code TEXT NOT NULL,
    received_at_utc TEXT NOT NULL,payload_json TEXT NOT NULL,
    PRIMARY KEY(trade_date,market,code))`);
  await client.execute(`CREATE TABLE IF NOT EXISTS blue_kis_live_history_r141 (
    trade_date TEXT NOT NULL,market TEXT NOT NULL,code TEXT NOT NULL,
    received_at_utc TEXT NOT NULL,price INTEGER NOT NULL,volume INTEGER NOT NULL,
    phase TEXT NOT NULL,PRIMARY KEY(trade_date,market,code,received_at_utc))`);
  await client.execute(`CREATE TABLE IF NOT EXISTS blue_kis_provisional_daily_v1 (
    trade_day TEXT NOT NULL,code TEXT NOT NULL,market TEXT NOT NULL,
    name TEXT NOT NULL,open INTEGER NOT NULL,high INTEGER NOT NULL,
    low INTEGER NOT NULL,close INTEGER NOT NULL,volume INTEGER NOT NULL,
    reference_day TEXT NOT NULL,observed_at_utc TEXT NOT NULL,
    date_basis TEXT NOT NULL,source TEXT NOT NULL,
    PRIMARY KEY(trade_day,code))`);
  const existing=await client.execute({sql:`SELECT code FROM blue_kis_provisional_daily_v1
    WHERE trade_day=? AND reference_day=? AND market='J'
      AND source='KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL'
      AND date_basis='KIS_REPORTED_TRADE_DATE'
      AND open>0 AND low>0 AND high>=open AND open>=low
      AND close BETWEEN low AND high AND volume>=0`,args:[day,reference]});
  const savedCodes=new Set(existing.rows.map(r=>String(r.code)));
  let attempted=0,saved=0,rejected=0,emptyStreak=0,stopReason='';
  const quotes=[];
  const flush=async()=>{
    if(!quotes.length)return;
    await client.batch(provisionalStatements(quotes),'write');
    saved+=quotes.length;
    quotes.length=0;
  };
  let lastCall=0;
  for(const item of symbols.rows){
    const code=String(item.code),close=Number(item.close);
    if(savedCodes.has(code))continue; // A retry resumes missing symbols only.
    if(!CODE.test(code)||!Number.isSafeInteger(close)||close<=0){rejected++;continue;}
    if(lastCall&&!deps.noPacing){
      const remaining=PACE_MS-(Date.now()-lastCall);
      if(remaining>0)await (deps.sleep||sleep)(remaining);
    }
    lastCall=Date.now();attempted++;
    try{
      const raw=await (deps.quoteDaily||getKisDailyQuote)(env,found.token,'J',code,day);
      const received=deps.receivedAt||new Date();
      const quote=parseQuote({code,name:String(item.name||'').slice(0,70),
        eod_close:close,eod_asof:reference,eod_signals:'',
        origin:'KRX_FAILED_KIS_SECONDARY'},'J','KRX_FAILED_KIS_SECONDARY',raw,received,day);
      if(!quote.reported_trade_date||quote.open<quote.low||quote.open>quote.high)
        throw Error('KIS_DAILY_RESPONSE_INVALID');
      quote.source='KIS_REST_INQUIRE_DAILY_PRICE';
      quote.provisional_status='IN_PROGRESS';
      quote.provisional_date_basis='KIS_REPORTED_TRADE_DATE';
      quote.is_confirmed_daily=false;
      quotes.push(quote);
      emptyStreak=0;
      if(quotes.length===WRITE_BATCH)await flush();
    }catch(e){
      rejected++;
      if(e?.message==='KIS_RATE_LIMIT'){stopReason='KIS_RATE_LIMIT_BACKOFF';break;}
      if(['KIS_DAILY_EXACT_DATE_MISSING','KIS_DAILY_RESPONSE_INVALID',
        'KIS_DAILY_HTTP_UNAVAILABLE','KIS_RESPONSE_INVALID'].includes(e?.message)){
        emptyStreak++;
        if(emptyStreak>=MAX_EMPTY_DATE_STREAK){stopReason='KIS_PROVIDER_OR_DATE_UNAVAILABLE';break;}
      }else emptyStreak=0;
    }
    if(deps.maxSymbols&&attempted>=deps.maxSymbols)break; // test-only cap
  }
  await flush();
  return {status:stopReason||'KIS_PROVISIONAL_ATTEMPTED',day,
    reference_day:reference,reference_market_count:expected,
    already_saved:savedCodes.size,attempted,saved,rejected,
    complete:!stopReason&&savedCodes.size+saved===expected};
}

async function main(){
  let client;
  try{
    if(process.argv.length!==4||process.argv[2]!=='--mode=apply'||
      !process.argv[3].startsWith('--day='))throw Error('INVALID_KIS_FALLBACK_ARGUMENT');
    const day=process.argv[3].slice(6);
    const url=String(process.env.TURSO_DATABASE_URL||'').trim();
    const authToken=String(process.env.TURSO_AUTH_TOKEN||'').trim();
    if(!/^(libsql|https):\/\//.test(url)||!authToken)
      throw Error('TURSO_FALLBACK_NOT_CONFIGURED');
    client=createClient({url,authToken,intMode:'string'});
    const result=await collectKisAfterKrxFailure(client,process.env,day);
    console.log('BLUE_KRX_KIS_SECONDARY '+Object.entries(result).map(([k,v])=>k+'='+v).join(' '));
    if(!['KIS_PROVISIONAL_ATTEMPTED','KRX_EOD_ALREADY_AVAILABLE'].includes(result.status)||
      (result.status==='KIS_PROVISIONAL_ATTEMPTED'&&result.saved+result.already_saved===0))
      process.exitCode=1;
  }catch(e){
    const safe=new Set(['INVALID_KIS_FALLBACK_ARGUMENT','INVALID_KIS_FALLBACK_DAY',
      'TURSO_FALLBACK_NOT_CONFIGURED','NO_VERIFIED_KIS_REFERENCE',
      'INVALID_KIS_REFERENCE_AUDIT','INCOMPLETE_KIS_REFERENCE',
      'KIS_CONFIG_MISSING','TURSO_TOKEN_MISSING','TURSO_TOKEN_EXPIRED',
      'TURSO_TOKEN_VAULT_UNAVAILABLE','TURSO_TOKEN_METADATA_INVALID',
      'TURSO_TOKEN_DECRYPT_FAILED']);
    console.error(safe.has(e?.message)?e.message:'KIS_SECONDARY_UNAVAILABLE');
    process.exitCode=1;
  }finally{client?.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

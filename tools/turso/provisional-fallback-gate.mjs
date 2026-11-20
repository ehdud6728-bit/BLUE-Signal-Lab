/**
 * Read-only safety gate after a KRX exact-day fetch fails.
 * This does NOT confirm an EOD, analyze BLUE signals, issue KIS tokens, or
 * collect missing quotes. It only confirms a separately saved KIS subset.
 */
import {createClient} from '@libsql/client/web';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

function validDay(day){
  if(!/^20\d\d-\d\d-\d\d$/.test(day))return false;
  const date=new Date(day+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===day;
}

export async function checkKisFallback(client,day){
  if(!validDay(day))throw Error('INVALID_FALLBACK_DAY');
  const current=await client.execute({sql:`SELECT row_count FROM blue_eod_ingest_audit_v1
    WHERE trade_day=? AND row_count>=1700 LIMIT 1`,args:[day]});
  const currentCount=Number(current.rows?.[0]?.row_count||0);
  if(currentCount>=1700&&currentCount<=10000){
    const actual=await client.execute({sql:'SELECT COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day=?',args:[day]});
    if(Number(actual.rows?.[0]?.n)===currentCount)
      throw Error('EXISTING_EOD_RESEARCH_PENDING');
  }
  const prior=await client.execute({sql:`SELECT trade_day,row_count FROM blue_eod_ingest_audit_v1
    WHERE trade_day<? AND row_count>=1700 ORDER BY trade_day DESC LIMIT 1`,args:[day]});
  const audit=prior.rows?.[0];
  if(!audit||!validDay(String(audit.trade_day)))throw Error('NO_VERIFIED_KIS_REFERENCE');
  const reference=String(audit.trade_day),expected=Number(audit.row_count);
  if(!Number.isSafeInteger(expected)||expected<1700||expected>10000)
    throw Error('INVALID_KIS_REFERENCE_AUDIT');
  const validRows=await client.execute({sql:'SELECT COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day=?',args:[reference]});
  if(Number(validRows.rows?.[0]?.n)!==expected)throw Error('INCOMPLETE_KIS_REFERENCE');
  const found=await client.execute({sql:`SELECT 1 AS found FROM sqlite_master
    WHERE type='table' AND name='blue_kis_provisional_daily_v1' LIMIT 1`});
  if(!found.rows?.length)throw Error('KIS_PROVISIONAL_TABLE_MISSING');
  const rows=await client.execute({sql:`SELECT COUNT(*) AS n
    FROM blue_kis_provisional_daily_v1
    WHERE trade_day=? AND reference_day=? AND market='J' AND
      ((source='KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL' AND
        date_basis='KIS_REPORTED_TRADE_DATE') OR
       (source='KIS_REST_INQUIRE_PRICE_PROVISIONAL' AND
        date_basis IN ('KIS_REPORTED_TRADE_DATE','COLLECTOR_KST_REGULAR_SESSION')))
      AND open>0 AND low>0 AND high>=open AND open>=low
      AND close BETWEEN low AND high AND volume>=0`,args:[day,reference]});
  const n=Number(rows.rows?.[0]?.n);
  if(!Number.isSafeInteger(n)||n<1||n>expected)
    throw Error('KIS_PROVISIONAL_NOT_AVAILABLE');
  return {status:'KIS_PARTIAL_PROVISIONAL',day,reference_day:reference,
    provisional_count:n,reference_market_count:expected,verified_count:0};
}

export function fallbackGateLine(result){
  return 'BLUE_KRX_FALLBACK '+Object.entries(result).map(([k,v])=>k+'='+v).join(' ')+
    ' research_written=0 confirmed_eod_written=0';
}

async function main(){
  let client;
  try{
    if(process.argv.length!==3||!process.argv[2].startsWith('--day='))
      throw Error('INVALID_FALLBACK_ARGUMENT');
    const day=process.argv[2].slice('--day='.length);
    if(!validDay(day))throw Error('INVALID_FALLBACK_DAY');
    const url=String(process.env.TURSO_DATABASE_URL||'').trim();
    const authToken=String(process.env.TURSO_AUTH_TOKEN||'').trim();
    if(!/^(libsql|https):\/\//.test(url)||!authToken)throw Error('TURSO_FALLBACK_NOT_CONFIGURED');
    client=createClient({url,authToken,intMode:'string'});
    console.log(fallbackGateLine(await checkKisFallback(client,day)));
    console.log('BLUE_FALLBACK_READ_ONLY: KIS partial is not verified KRX EOD or BLUE research.');
  }catch(e){
    const safe=new Set(['INVALID_FALLBACK_ARGUMENT','INVALID_FALLBACK_DAY',
      'TURSO_FALLBACK_NOT_CONFIGURED','NO_VERIFIED_KIS_REFERENCE',
      'INVALID_KIS_REFERENCE_AUDIT','INCOMPLETE_KIS_REFERENCE',
      'KIS_PROVISIONAL_TABLE_MISSING','KIS_PROVISIONAL_NOT_AVAILABLE',
      'EXISTING_EOD_RESEARCH_PENDING']);
    console.error(safe.has(e?.message)?e.message:'TURSO_FALLBACK_AUDIT_UNAVAILABLE');
    process.exitCode=1;
  }finally{client?.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

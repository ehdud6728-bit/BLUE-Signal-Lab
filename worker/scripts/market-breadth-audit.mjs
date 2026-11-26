// Read-only audit: independent per-symbol comparison against production SQL.
// No raw price/code, credentials, provider calls, cache writes or deployment.
import {createClient} from '@libsql/client/web';
import {pathToFileURL} from 'node:url';
import {readMarketEodBreadth} from '../src/turso-market-ai.ts';
const MARKETS=['KOSDAQ','KOSPI'];
const SOURCES=new Set(['KRX_PYKRX_EXACT_DAY_VERIFIED','KRX_OPENAPI_EXACT_DAY_VERIFIED']);
const check=(ok,code)=>{if(!ok)throw Error(code);};
const integer=v=>{check(/^\d+$/.test(String(v)),'INVALID_INTEGER');return BigInt(v);};
const validDay=(d,now)=>typeof d==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d&&d<=new Date(now.getTime()+32400000).toISOString().slice(0,10);
export const READ_SQL=`WITH recent AS (
 SELECT trade_day,row_count,source,day_sha256 FROM blue_eod_ingest_audit_v1 ORDER BY trade_day DESC LIMIT 2
) SELECT a.trade_day AS day,a.row_count AS expected,a.source AS audit_source,a.day_sha256 AS audit_hash,
 e.code,e.market,e.close,e.source AS row_source
 FROM recent a LEFT JOIN blue_eod_daily_v1 e ON e.trade_day=a.trade_day
 ORDER BY a.trade_day,e.code LIMIT 20001`;
export function independentBreadth(rows,now=new Date()){
 check(Array.isArray(rows)&&rows.length<=20000,'ROW_LIMIT');
 const dates=new Map();
 for(const r of rows){
  check(validDay(r.day,now)&&SOURCES.has(r.audit_source)&&/^[0-9a-f]{64}$/.test(r.audit_hash),'BAD_AUDIT');
  const expected=Number(integer(r.expected));
  check(expected>=1700&&expected<=10000,'BAD_EXPECTED');
  if(!dates.has(r.day))dates.set(r.day,{expected,source:r.audit_source,hash:r.audit_hash,stocks:new Map()});
  const d=dates.get(r.day);
  check(d.expected===expected&&d.source===r.audit_source&&d.hash===r.audit_hash,'AUDIT_CHANGED');
  check(typeof r.code==='string'&&/^[0-9A-Z]{6}$/.test(r.code)&&MARKETS.includes(r.market)&&r.row_source===d.source&&!d.stocks.has(r.code),'BAD_ROW');
  const close=integer(r.close);check(close>0n,'BAD_CLOSE');
  d.stocks.set(r.code,{market:r.market,close});
 }
 const days=[...dates.keys()].sort();
 check(days.length===2,'TWO_DATES_REQUIRED');
 const [prior_day,day]=days,prior=dates.get(prior_day),latest=dates.get(day);
 for(const d of [prior,latest]){
  check(d.stocks.size===d.expected,'COUNT_MISMATCH');
  for(const m of MARKETS)check([...d.stocks.values()].filter(r=>r.market===m).length>=400,'MARKET_INCOMPLETE');
 }
 const markets=MARKETS.map(market=>{
  const m={market,universe:0,matched:0,up:0,down:0,flat:0,unmatched:0};
  for(const [code,stock] of latest.stocks){
   if(stock.market!==market)continue;
   m.universe++;
   const p=prior.stocks.get(code);
   if(!p||p.market!==market){m.unmatched++;continue;}
   m.matched++;
   if(stock.close>p.close)m.up++;else if(stock.close<p.close)m.down++;else m.flat++;
  }
  check(m.matched>0,'NO_MATCHED');
  return m;
 });
 return {status:'COUNT_AUDITED_EOD',day,prior_day,markets};
}
export function compareBreadth(independent,production){
 check(production?.status==='COUNT_AUDITED_EOD','PRODUCTION_UNAVAILABLE');
 check(independent.day===production.day&&independent.prior_day===production.prior_day,'DATE_CHANGED_RETRY');
 check(production.markets?.length===2,'MARKET_MISMATCH');
 for(const m of independent.markets){
  const p=production.markets.find(v=>v.market===m.market);
  check(p&&Object.keys(m).every(k=>m[k]===p[k]),'AGGREGATE_MISMATCH');
 }
}
export async function audit(env=process.env,now=new Date()){
 const url=env.TURSO_DATABASE_URL?.trim(),authToken=env.TURSO_AUTH_TOKEN?.trim();
 check(/^(https|libsql):\/\//.test(url||'')&&authToken,'MISSING_CONFIG');
 const db=createClient({url,authToken,intMode:'string'});
 try{
  const before=await readMarketEodBreadth(env,{now});
  const independent=independentBreadth((await db.execute({sql:READ_SQL,args:[]})).rows,now);
  const after=await readMarketEodBreadth(env,{now});
  compareBreadth(independent,before);compareBreadth(independent,after);
  return {...independent,verification:'INDEPENDENT_CLOSE_COMPARISON_SAME_STORED_SOURCE',limits:['NO_INDEPENDENT_SOURCE_OR_HASH_RECOMPUTATION','NO_TRADING_CALENDAR_OR_CORPORATE_ACTION_VERIFICATION','NO_AUTHENTICATED_BROWSER_OR_GEMINI_CHECK','SEPARATE_READS_NOT_ATOMIC_TOGETHER']};
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log('BLUE_MARKET_BREADTH_AUDIT',JSON.stringify(await audit()));}
 catch(e){const safe=new Set(['ROW_LIMIT','INVALID_INTEGER','BAD_AUDIT','BAD_EXPECTED','AUDIT_CHANGED','BAD_ROW','BAD_CLOSE','TWO_DATES_REQUIRED','COUNT_MISMATCH','MARKET_INCOMPLETE','NO_MATCHED','PRODUCTION_UNAVAILABLE','DATE_CHANGED_RETRY','MARKET_MISMATCH','AGGREGATE_MISMATCH','MISSING_CONFIG']);console.error('BLUE_MARKET_BREADTH_AUDIT_FAILED',safe.has(e?.message)?e.message:'READ_FAILED');process.exitCode=1;}
}

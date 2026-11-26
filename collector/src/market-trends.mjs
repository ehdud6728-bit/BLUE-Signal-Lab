/** Dated KIS index history, with conservative exclusion of current local date.
 * Separate from the intraday category snapshot; no new token issuance.
 */
import {createClient} from '@libsql/client';
import {tursoDirectCachedToken} from './turso-direct.mjs';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {readBenchmarkEvidence,inspectBenchmark} from './market-trends-regime.mjs';
const HOST='https://openapi.koreainvestment.com:9443';
const GLOBAL=[['.DJI','Dow Jones'],['.NDX','NASDAQ 100'],['.SPX','S&P 500'],['.SOX','Philadelphia Semiconductor'],['.VIX','VIX']];
const markets=[['KOSPI','0001'],['KOSDAQ','1001']];
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const validDay=d=>typeof d==='string'&&DAY.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const prior=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')-n*86400000).toISOString().slice(0,10);
const localDay=(now,timeZone)=>{const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));return p.year+'-'+p.month+'-'+p.day;};
const price=x=>typeof x==='string'&&/^\d+(\.\d+)?$/.test(x.trim())&&Number.isFinite(Number(x))&&Number(x)>0?Number(x):null;
const obj=x=>Array.isArray(x)?x.length===1?x[0]:null:x&&typeof x==='object'?x:null;
const code=x=>typeof x==='string'&&/^\d{1,5}$/.test(x.trim())?String(Number(x)).padStart(4,'0'):null;
const normalizeGlobal=x=>typeof x==='string'?x.trim().toUpperCase().replace(/^\./,''):'';
const normalizeName=x=>typeof x==='string'?x.normalize('NFKC').trim().toUpperCase().replace(/[\s·._-]/g,''):'';
const GLOBAL_NAMES={
  DJI:['다우산업','다우30','다우존스','다우존스산업평균','다우존스산업평균지수','DOW JONES INDUSTRIAL AVERAGE'],
  NDX:['나스닥100','나스닥100지수','NASDAQ 100','NASDAQ 100 INDEX'],
  SPX:['S&P500','S&P500지수','S&P 500 INDEX'],
  SOX:['필라델피아반도체지수','PHILADELPHIA SEMICONDUCTOR INDEX'],
  VIX:['VIX','VIX지수','CBOE VOLATILITY INDEX'],
};
// Never override an explicit conflicting symbol with the requested code or name.
export function globalIdentity(s,expected){
  if(!s)return 'NO_SUMMARY';
  const want=normalizeGlobal(expected),actual=normalizeGlobal(s.stck_shrn_iscd);
  if(!GLOBAL_NAMES[want])return 'UNKNOWN_REQUEST';
  if(actual&&actual!==want)return 'CODE_MISMATCH';
  const name=normalizeName(s.hts_kor_isnm);
  const matching=GLOBAL_NAMES[want].some(x=>normalizeName(x)===name);
  const conflict=Object.entries(GLOBAL_NAMES).some(([k,names])=>k!==want&&names.some(x=>normalizeName(x)===name));
  if(conflict)return 'NAME_MISMATCH';
  return actual===want?'EXACT_CODE':matching?'EXACT_NAME_NO_CODE':'CODE_MISSING';
}
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const rounded=x=>Math.round(x*10000)/10000;
const hash=x=>createHash('sha256').update(x).digest('hex');
export function parseHistory(body,expected,start,end,overseas=false){
  if(body?.rt_cd!=='0')throw Error('HISTORY_PROVIDER_REJECTED');
  const s=obj(body.output1);
  if(overseas){
    const identity=globalIdentity(s,expected);
    if(!['EXACT_CODE','EXACT_NAME_NO_CODE'].includes(identity))throw Error('HISTORY_IDENTITY_'+identity);
  }else if(!s||code(s.bstp_cls_code)!==expected)throw Error('HISTORY_IDENTITY_UNVERIFIED');
  const list=body.output2;
  if(!Array.isArray(list)||list.length>150)throw Error('HISTORY_RESPONSE_INVALID');
  const seen=new Set(),out=[];
  for(const b of list){
    const raw=b?.stck_bsop_date;
    if(raw===''||raw===undefined)continue;
    if(typeof raw!=='string'||!/^\d{8}$/.test(raw))throw Error('HISTORY_DATE_INVALID');
    const d=raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6);
    if(!validDay(d)||d<start||d>end||seen.has(d))throw Error('HISTORY_DATE_INVALID');
    seen.add(d);
    const close=price(b[overseas?'ovrs_nmix_prpr':'bstp_nmix_prpr']);
    if(close===null)continue;
    out.push({day:d,close});
  }
  return out.sort((a,b)=>a.day.localeCompare(b.day));
}
export function rotation(series,benchmark){
  const base=benchmark.slice(-26);
  if(base.length!==26)return null;
  const byDay=new Map(series.map(x=>[x.day,x.close]));
  if(base.some(x=>!byDay.has(x.day)))return null;
  const ratio=base.map(x=>byDay.get(x.day)/x.close);
  const rel=(n,i)=>100*(ratio[i]/ratio[i-n]-1);
  const rs5=rounded(rel(5,25)),rs10=rounded(rel(10,25)),rs20=rounded(rel(20,25)),momentum=rounded(rel(10,25)-rel(10,20));
  const quadrant=rs10===0||momentum===0?'NEUTRAL':rs10>0?momentum>0?'LEADING':'WEAKENING':momentum>0?'IMPROVING':'LAGGING';
  return {day:base[25].day,matched_sessions:26,rs5:rounded(rs5),rs10:rounded(rs10),rs20:rounded(rs20),momentum:rounded(momentum),quadrant};
}
export function globalSummary(series){
  if(series.length<2)return null;
  const last=series.at(-1),prev=series.at(-2),older=series.at(-6);
  return {day:last.day,close:last.close,previous_day:prev.day,change_pct:rounded(100*(last.close/prev.close-1)),
    change5_pct:older?rounded(100*(last.close/older.close-1)):null,sessions:series.length};
}
export async function captureTrends(env=process.env,{mode='plan',now=new Date(),factory=createClient,token=tursoDirectCachedToken,fetchFn=fetch,wait=pause}={}){
  if(mode==='plan')return {status:'PLAN_ONLY',kis_calls:0,turso_writes:0};
  if(!['inspect','apply','global_inspect','global_apply','benchmark_inspect'].includes(mode))throw Error('INVALID_TREND_MODE');
  const globalOnly=mode.startsWith('global_');
  const url=String(env.TURSO_DATABASE_URL||''),authToken=String(env.TURSO_AUTH_TOKEN||'');
  if(!/^(libsql|https):\/\//.test(url)||!authToken)throw Error('TREND_DB_NOT_CONFIGURED');
  const db=factory({url,authToken,intMode:'string'});
  try{
    const auth=await token(db,env,now);
    if(!auth.token)throw Error('TREND_TOKEN_NOT_READY');
    const receipt=localDay(now,'Asia/Seoul'),end=prior(receipt,1),usEnd=prior(localDay(now,'America/New_York'),1);
    const start=prior(end,55),usStart=prior(usEnd,55);
    let calls=0;
    async function get(expected,overseas=false){
      if(calls>=160)throw Error('TREND_CALL_CAP');
      if(calls++)await wait(1200);
      const path=overseas?'/uapi/overseas-price/v1/quotations/inquire-daily-chartprice':'/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice';
      const u=new URL(HOST+path);
      const lo=overseas?usStart:start,hi=overseas?usEnd:end;
      const params={FID_COND_MRKT_DIV_CODE:overseas?'N':'U',FID_INPUT_ISCD:expected,FID_INPUT_DATE_1:lo.replaceAll('-',''),FID_INPUT_DATE_2:hi.replaceAll('-',''),FID_PERIOD_DIV_CODE:'D'};
      for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
      const res=await fetchFn(u,{headers:{authorization:'Bearer '+auth.token,appkey:env.KIS_APP_KEY,appsecret:env.KIS_APP_SECRET,tr_id:overseas?'FHKST03030100':'FHKUP03500100',custtype:'P'},signal:AbortSignal.timeout(12000)});
      if(res.status===429||res.status===401||res.status===403)throw Error('TREND_PROVIDER_STOP');
      if(!res.ok)throw Error('HISTORY_HTTP_FAILURE');
      const body=await res.json();
      if(body?.msg_cd==='EGW00201')throw Error('TREND_PROVIDER_STOP');
      if(['M','F'].includes(res.headers.get('tr_cont')))throw Error('HISTORY_CONTINUATION_REQUIRED');
      if(overseas){
        const identity=body?.rt_cd==='0'?globalIdentity(obj(body.output1),expected):'PROVIDER_REJECTED';
        console.log('BLUE_GLOBAL_INDEX_PROBE',JSON.stringify({request:expected,identity,
          rows:Array.isArray(body?.output2)?body.output2.length:null}));
      }
      return parseHistory(body,expected,lo,hi,overseas);
    }
    const safe=async(expected,overseas=false)=>{try{return {series:await get(expected,overseas),reason:null};}
      catch(e){if(['TREND_PROVIDER_STOP','TREND_CALL_CAP'].includes(e?.message))throw e;
        return {series:[],reason:/^HISTORY_[A-Z_]+$/.test(e?.message||'')?e.message:'HISTORY_UNAVAILABLE'};}};
    if(mode==='benchmark_inspect'){
      const evidence=await readBenchmarkEvidence(db,start,end);
      const results=[];
      for(const [market,benchmarkCode] of markets){
        const r=await safe(benchmarkCode);
        results.push({...inspectBenchmark(r.series,market,evidence,end),reason:r.reason});
      }
      return {status:results.every(r=>r.observations>=25)?'INSPECT_ONLY':'BENCHMARK_HISTORY_INSUFFICIENT',scope:'DOMESTIC_BENCHMARK_ONLY',kis_calls:calls,turso_writes:0,cutoff:end,markets:results,limits:['RESEARCH_RULE_NOT_VALIDATED','EXACT_DATE_ALIGNMENT_FOR_BREADTH_ONLY','NO_INDEPENDENT_KIS_INDEX_SOURCE_CHECK','NO_CALENDAR_OR_CORPORATE_ACTION_VERIFICATION','NO_PREDICTION_ACCURACY_CLAIM','NO_RAW_INDEX_PRICES_PUBLISHED']};
    }
    const global=[];
    for(const [symbol,name] of GLOBAL){
      // Official examples include a leading dot, whereas HTS uses bare symbols.
      // Probe both only when the first response cannot verify identity/history.
      let result=await safe(symbol,true);
      if(!globalSummary(result.series))result=await safe(symbol.slice(1),true);
      const summary=globalSummary(result.series);
      global.push({symbol,name,status:summary?'AVAILABLE':'MISSING',reason:summary?null:result.reason||'INSUFFICIENT_HISTORY',summary});
    }
    if(globalOnly){
      const summary={status:mode==='global_inspect'?'INSPECT_ONLY':'OK',scope:'GLOBAL_ONLY',kis_calls:calls,
        global:global.map(({symbol,status,reason})=>({symbol,status,reason}))};
      if(mode==='global_apply'){
        if(!global.some(x=>x.summary))return {...summary,status:'NO_USABLE_GLOBAL_HISTORY'};
        const raw=JSON.stringify({schema:'BLUE_GLOBAL_TRENDS_V1',receipt_day:receipt,observed_at_utc:now.toISOString(),overseas_cutoff:usEnd,global});
        const digest=hash(raw);
        await db.execute('CREATE TABLE IF NOT EXISTS blue_global_trends_v1 (receipt_day TEXT PRIMARY KEY, observed_at_utc TEXT NOT NULL, payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL)');
        await db.execute({sql:'INSERT INTO blue_global_trends_v1 VALUES(?,?,?,?) ON CONFLICT(receipt_day) DO UPDATE SET observed_at_utc=excluded.observed_at_utc,payload_json=excluded.payload_json,payload_sha256=excluded.payload_sha256 WHERE excluded.observed_at_utc>blue_global_trends_v1.observed_at_utc',args:[receipt,now.toISOString(),raw,digest]});
        const check=await db.execute({sql:'SELECT payload_json,payload_sha256 FROM blue_global_trends_v1 WHERE receipt_day=?',args:[receipt]});
        if(check.rows[0]?.payload_json!==raw||check.rows[0]?.payload_sha256!==digest)throw Error('GLOBAL_READBACK_MISMATCH');
      }
      return summary;
    }
    const r=await db.execute({sql:'SELECT receipt_day,payload_json FROM blue_market_rotation_v1 WHERE receipt_day<=? ORDER BY receipt_day DESC LIMIT 1',args:[receipt]});
    if(!r.rows.length)throw Error('TREND_CATEGORY_CAPTURE_REQUIRED');
    const category=JSON.parse(String(r.rows[0].payload_json));
    if(category.schema!=='BLUE_KIS_MARKET_V1'||category.receipt_day!==r.rows[0].receipt_day||
      !validDay(category.receipt_day)||category.receipt_day>receipt||!Array.isArray(category.markets)||category.markets.length!==2)throw Error('TREND_BAD_CATEGORY');
    const data=[];
    for(const [market,benchmarkCode] of markets){
      const m=category.markets.find(x=>x.market===market);
      if(!m||!Array.isArray(m.sectors)||m.sectors.length<1||m.sectors.length>100)throw Error('TREND_BAD_CATEGORY');
      const seen=new Set();
      for(const s of m.sectors){
        if(code(s.code)!==s.code||s.code===benchmarkCode||seen.has(s.code)||typeof s.name!=='string'||!s.name||s.name.length>70)throw Error('TREND_BAD_CATEGORY');
        seen.add(s.code);
      }
      const benchmark=await safe(benchmarkCode);
      const base=benchmark.series;
      const rows=[];
      const target=mode==='inspect'?m.sectors.slice(0,2):m.sectors;
      if(base.length>=26){
        for(const s of target){
          const result=await safe(s.code);
          const trend=rotation(result.series,base);
          const previous=base.length>=27?rotation(result.series,base.slice(0,-1)):null;
          if(trend){trend.previous_day=previous?.day??null;trend.previous_quadrant=previous?.quadrant??null;}
          rows.push({code:s.code,name:s.name,status:trend?'AVAILABLE':'MISSING',reason:trend?null:result.reason||'INSUFFICIENT_MATCHED_SESSIONS',trend});
        }
      }else{
        for(const s of target)rows.push({code:s.code,name:s.name,status:'MISSING',reason:benchmark.reason||'BENCHMARK_INSUFFICIENT',trend:null});
      }
      data.push({market,benchmark:globalSummary(base),benchmark_sessions:base.length,benchmark_days:base.map(x=>x.day),universe:m.sectors.length,attempted:target.length,rows});
    }
    const snapshot={schema:'BLUE_ROTATION_TRENDS_V1',receipt_day:receipt,observed_at_utc:now.toISOString(),category_receipt_day:category.receipt_day,
      domestic_cutoff:end,overseas_cutoff:usEnd,markets:data,global};
    const summary={status:mode==='inspect'?'INSPECT_ONLY':'OK',kis_calls:calls,
      markets:data.map(m=>({market:m.market,universe:m.universe,attempted:m.attempted,benchmark_sessions:m.benchmark_sessions,available:m.rows.filter(r=>r.trend).length,
        missing_reasons:m.rows.reduce((a,r)=>{if(r.reason)a[r.reason]=(a[r.reason]||0)+1;return a;},{})})),
      global:global.map(x=>({symbol:x.symbol,status:x.status,reason:x.reason}))};
    if(mode==='apply'){
      // Partial history is explicit; never overwrite the last good snapshot
      // if the complete attempted universe yielded no usable domestic trend.
      if(!data.some(m=>m.rows.some(r=>r.trend)))return {...summary,status:'NO_USABLE_DOMESTIC_HISTORY'};
      const raw=JSON.stringify(snapshot);
      if(Buffer.byteLength(raw)>48000)throw Error('TREND_PAYLOAD_TOO_LARGE');
      const digest=hash(raw);
      await db.execute('CREATE TABLE IF NOT EXISTS blue_market_trends_v1 (receipt_day TEXT PRIMARY KEY, observed_at_utc TEXT NOT NULL, payload_json TEXT NOT NULL, payload_sha256 TEXT NOT NULL)');
      await db.execute({sql:'INSERT INTO blue_market_trends_v1 VALUES(?,?,?,?) ON CONFLICT(receipt_day) DO UPDATE SET observed_at_utc=excluded.observed_at_utc,payload_json=excluded.payload_json,payload_sha256=excluded.payload_sha256 WHERE excluded.observed_at_utc>blue_market_trends_v1.observed_at_utc',args:[receipt,now.toISOString(),raw,digest]});
      const check=await db.execute({sql:'SELECT payload_json,payload_sha256 FROM blue_market_trends_v1 WHERE receipt_day=?',args:[receipt]});
      if(check.rows[0]?.payload_json!==raw||check.rows[0]?.payload_sha256!==digest)throw Error('TREND_READBACK_MISMATCH');
    }
    return summary;
  }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const result=await captureTrends(process.env,{mode:process.argv[2]||'plan'});console.log('BLUE_MARKET_TRENDS',JSON.stringify(result));if(!['PLAN_ONLY','INSPECT_ONLY','OK'].includes(result.status))process.exitCode=1;}
  catch(e){console.error('BLUE_MARKET_TRENDS_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1;}
}

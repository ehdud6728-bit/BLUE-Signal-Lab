/** BLUE R1.5.3 separate authenticated watch queue processor.
 * Runs on Cron only; never exposes KIS calls to the public or the browser.
 * Does not alter existing R1.4.2 candidate selection or its DB schema.
 */
import {cachedToken,kstParts,marketsFor,getKisQuote,parseQuote} from './core.mjs';
const BASE='https://openapi.koreainvestment.com:9443';
const addDays=(s,n)=>new Date(Date.parse(s+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
const cmp=(a,b)=>a.localeCompare(b);
const iso=(d)=>d.toISOString();
const delay=(ms)=>new Promise(ok=>setTimeout(ok,ms));
const dayQuery=(s)=>s.replaceAll('-','');
const positive=(v)=>{const n=Number(v);return Number.isSafeInteger(n)&&n>0?n:null;};
function finalDay(now){const p=kstParts(now);return p.seconds>=20*3600+10*60?p.date:addDays(p.date,-1);}
export function verifiedDailyRows(json,start,end,baseDay){
 if(!json||json.rt_cd!=='0'||!Array.isArray(json.output2))throw Error('INVALID_DAILY_RESPONSE');
 const dedup=new Map();
 for(const v of json.output2){
  const d=String(v.stck_bsop_date||'');
  if(!/^\d{8}$/.test(d))continue;
  const day=`${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
  if(day<start||day>end||day<=baseDay)continue;
  const high=positive(v.stck_hgpr),close=positive(v.stck_clpr),low=positive(v.stck_lwpr);
  if(!high||!close||!low||low>close||close>high)continue;
  dedup.set(day,{day,high,close});
 }
 return [...dedup.values()].sort((a,b)=>cmp(a.day,b.day));
}
export function mergeDaily(prev,rows){
 let top=positive(prev.highest_price),topDay=prev.highest_day||null;
 let close=positive(prev.recent_close),closeDay=prev.recent_day||null;
 for(const row of rows){
  if(!top||row.high>top||(row.high===top&&row.day<topDay)){top=row.high;topDay=row.day;}
  if(!closeDay||row.day>closeDay){close=row.close;closeDay=row.day;}
 }
 return {highest_price:top,highest_day:topDay,recent_close:close,recent_day:closeDay};
}
export async function dailyCandles(env,token,code,start,end){
 const url=new URL('/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice',BASE);
 for(const [k,v] of Object.entries({FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code,
  FID_INPUT_DATE_1:dayQuery(start),FID_INPUT_DATE_2:dayQuery(end),
  FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'1'}))url.searchParams.set(k,v);
 const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),12000);
 try{
  const r=await fetch(url,{signal:ctrl.signal,method:'GET',headers:{
   authorization:'Bearer '+token,appkey:env.KIS_APP_KEY,appsecret:env.KIS_APP_SECRET,
   tr_id:'FHKST03010100',custtype:'P',accept:'application/json'}});
  if(!r.ok)throw Error('DAILY_HTTP_FAILURE');
  const data=await r.json();if(data?.rt_cd!=='0')throw Error('DAILY_NOT_READY');
  return data;
 }finally{clearTimeout(timer);}
}
const schema=`CREATE TABLE IF NOT EXISTS blue_basket_watch_r153 (
 code TEXT NOT NULL, base_day TEXT NOT NULL, baseline_close REAL NOT NULL,
 created_at_utc TEXT NOT NULL, last_seen_at_utc TEXT NOT NULL,
 next_due_utc TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'QUEUED',
 checked_at_utc TEXT, progress_to_day TEXT, highest_price REAL, highest_day TEXT,
 recent_close REAL, recent_day TEXT, quote_price REAL, quote_high REAL,
 quote_day TEXT, quote_at_utc TEXT, quote_market TEXT,
 last_error TEXT, PRIMARY KEY(code,base_day))`;
async function ensure(db){
 await db.prepare(schema).run();
 await db.prepare('CREATE TABLE IF NOT EXISTS blue_basket_lock_r153 (id INTEGER PRIMARY KEY CHECK(id=1),lease_until_ms INTEGER NOT NULL)').run();
 await db.prepare('INSERT OR IGNORE INTO blue_basket_lock_r153(id,lease_until_ms) VALUES(1,0)').run();
}
async function setState(db,r,values){
 const cols=Object.keys(values);
 await db.prepare(`UPDATE blue_basket_watch_r153 SET ${cols.map(x=>`${x}=?`).join(',')} WHERE code=? AND base_day=?`)
  .bind(...cols.map(x=>values[x]),r.code,r.base_day).run();
}
export async function collectBasket(env,now=new Date(),deps={}){
 if(String(env.COLLECTOR_ENABLED).toLowerCase()!=='true')return {status:'DISABLED'};
 const db=env.DB;
 await ensure(db);
 const taken=await db.prepare('UPDATE blue_basket_lock_r153 SET lease_until_ms=? WHERE id=1 AND lease_until_ms<?')
  .bind(now.getTime()+90000,now.getTime()).run();
 if(taken.meta?.changes!==1)return {status:'BUSY'};
 const stamp=iso(now),phases=marketsFor(now,env.CLOSED_DATES||''),today=kstParts(now).date;
 let processed=0,success=0;
 try{
  const due=await db.prepare(`SELECT * FROM blue_basket_watch_r153
    WHERE next_due_utc<=? AND last_seen_at_utc>=?
    ORDER BY next_due_utc ASC,created_at_utc ASC LIMIT 3`)
   .bind(stamp,iso(new Date(now.getTime()-7*86400000))).all();
  if(!due.results.length)return {status:'IDLE'};
  let token=null;
  if(env.KIS_APP_KEY&&env.KIS_APP_SECRET){try{token=await cachedToken(db,env.KIS_APP_KEY,env.KIS_APP_SECRET,now);}catch{/* no token */}}
  if(!token){for(const r of due.results){
   await setState(db,r,{status:'WAITING_TOKEN',last_error:'CACHED_TOKEN_UNAVAILABLE',checked_at_utc:stamp,
     next_due_utc:iso(new Date(now.getTime()+15*60000))});
  }return {status:'WAITING_TOKEN',processed:due.results.length};}
  const lastFinal=finalDay(now);
  for(const r of due.results){
   processed++;
   try{
    const base=String(r.base_day),next=addDays(r.progress_to_day||base,1);
    const values={};let end=null;
    if(next<=lastFinal){
     // On first registration, fetch the most recent window first so the latest
     // confirmed close can appear quickly even for a 2025 discovery. Highest
     // price is hidden by the API until ALL earlier windows are covered.
     if(!r.progress_to_day && addDays(next,88)<lastFinal){
      const recentStart=addDays(lastFinal,-88);
      const quick=await (deps.daily||dailyCandles)(env,token,r.code,recentStart,lastFinal);
      const recentBars=verifiedDailyRows(quick,recentStart,lastFinal,base);
      const newest=mergeDaily(r,recentBars);
      Object.assign(r,newest);
      await setState(db,r,{...newest,status:'HISTORY_PARTIAL',checked_at_utc:stamp});
      if(!deps.daily)await delay(450);
     }
     // Backfill 89-calendar-day blocks from discovery+1 until today. The
     // oldest block is included, not quietly omitted, before showing a MAX.
     end=addDays(next,88);if(end>lastFinal)end=lastFinal;
     const payload=await (deps.daily||dailyCandles)(env,token,r.code,next,end);
     const bars=verifiedDailyRows(payload,next,end,base);
     Object.assign(values,mergeDaily(r,bars),{progress_to_day:end});
    }
    if(phases.length && base<today){
     const [market,phase]=phases.find(x=>x[0]==='J')||phases[0];
     try{
      const raw=await (deps.quote||getKisQuote)(env,token,market,r.code);
      const quote=parseQuote({code:r.code,name:'',eod_close:r.baseline_close,
        eod_asof:base,eod_signals:'',origin:'BASKET_WATCH'},market,phase,raw,now,today);
      Object.assign(values,{quote_price:quote.price,quote_high:quote.high,quote_day:quote.trade_date_kst,
       quote_at_utc:stamp,quote_market:market});
     }catch{/* keep last verified quote */}
    }
    const progress=values.progress_to_day||r.progress_to_day||base;
    const complete=progress>=lastFinal;
    const hasLaterDay=(values.recent_day||r.recent_day)!=null;
    const status=complete?(hasLaterDay?'READY':'WAITING_NEXT_SESSION'):'HISTORY_PARTIAL';
    const nextDue=phases.length?5*60000:(status==='HISTORY_PARTIAL'?60000:45*60000);
    await setState(db,r,{...values,status,last_error:null,checked_at_utc:stamp,
      next_due_utc:iso(new Date(now.getTime()+nextDue))});
    success++;
    if(!deps.daily&&!deps.quote)await delay(500);
   }catch{
    await setState(db,r,{status:'PROVIDER_RETRY',last_error:'PROVIDER_OR_DATA_NOT_READY',checked_at_utc:stamp,
      next_due_utc:iso(new Date(now.getTime()+5*60000))});
   }
  }
  return {status:success?'PROCESSED':'RETRY',processed,success};
 }finally{
  try{await db.prepare('UPDATE blue_basket_lock_r153 SET lease_until_ms=0 WHERE id=1').run();}catch{}
  console.log(`BLUE_R153_BASKET processed=${processed} success=${success}`);
 }
}

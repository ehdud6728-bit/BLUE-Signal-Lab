/** BLUE R1.5.9.3 - authenticated D1-only comparison of historical discovery dates.
 * No KIS calls, no scheduled enrollments, no orders or D1 mutation.
 * Never promotes a discovery-day close into a more recent quote.
 */
export type CompareItem = {code:string;day:string};
export type PriceCompareRow = {
 code:string;day:string;status:'READY'|'NO_LATER_PRICE'|'NOT_VERIFIED';
 latest_price:number|null;latest_day:string|null;latest_source:string|null;
 latest_at:string|null;latest_market:string|null;
 period_high:number|null;period_high_day:string|null;period_high_source:string|null;
 high_coverage_to:string|null;high_complete:boolean;
};
type Observation={price:number;day:string;source:string;at:string|null;market:string|null;priority:number};
type HighObservation={price:number;day:string;source:string;coverageTo:string;full:boolean};
const validDay=(s:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const money=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>0?v:null;
const iso=(s:unknown):s is string=>typeof s==='string'&&validDay(s);
const reply=(x:unknown,n=200)=>new Response(JSON.stringify(x),{status:n,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
export function decodePairs(value:string,today:string):CompareItem[]|null {
 if(!value||value.length>1250)return null;
 const parts=value.split(',');if(parts.length>24)return null;
 const pairs:CompareItem[]=[];const seen=new Set<string>();
 for(const part of parts){const [code,day,...extra]=part.split(':');
  if(extra.length||!/^\d{6}$/.test(code)||!validDay(day)||day<'2025-01-01'||day>today)return null;
  if(!seen.has(part)){pairs.push({code,day});seen.add(part);}
 }
 return pairs;
}
export function chartAfterSearch(json:string,baseDay:string,asof:string):{
 latest:Observation|null; high:HighObservation|null
} {
 try{
  const chart=JSON.parse(json) as {bars?:unknown};
  if(!Array.isArray(chart.bars)||chart.bars.length>500)return {latest:null,high:null};
  const bars=chart.bars.flatMap(raw=>{
   if(!raw||typeof raw!=='object')return [];
   const b=raw as Record<string,unknown>;
   if(!iso(b.t)||b.t>asof)return [];
   const close=money(b.c),high=money(b.h);
   if(close===null||high===null||high<close)return [];
   return [{day:b.t,c:close,h:high}];
  }).sort((a,b)=>a.day.localeCompare(b.day));
  const later=bars.filter(x=>x.day>baseDay);
  if(!later.length)return {latest:null,high:null};
  const last=later[later.length-1];
  const best=later.reduce((a,b)=>b.h>a.h?b:a);
  return {latest:{price:last.c,day:last.day,source:'VERIFIED_CHART_EOD',at:null,market:null,priority:45},
   high:{price:best.h,day:best.day,source:'VERIFIED_CHART_HIGH',coverageTo:last.day,
    full:bars.some(x=>x.day<=baseDay)}};
 }catch{return {latest:null,high:null};}
}
export function bestObservation(all:Observation[]):Observation|null {
 const values=all.filter(x=>money(x.price)!==null&&iso(x.day));
 values.sort((a,b)=>b.day.localeCompare(a.day)||b.priority-a.priority||(b.at||'').localeCompare(a.at||''));
 return values[0]||null;
}
export function highSummary(all:HighObservation[],latestDay:string|null):{
 price:number|null;day:string|null;source:string|null;coverageTo:string|null;complete:boolean
} {
 const valid=all.filter(x=>money(x.price)!==null&&iso(x.day)&&iso(x.coverageTo)&&x.day<=x.coverageTo);
 if(!valid.length)return {price:null,day:null,source:null,coverageTo:null,complete:false};
 const highest=valid.reduce((a,b)=>b.price>a.price?b:a);
 const cover=valid.filter(x=>x.full).sort((a,b)=>b.coverageTo.localeCompare(a.coverageTo))[0];
 const complete=!!(cover&&latestDay&&cover.coverageTo>=latestDay);
 return {price:highest.price,day:highest.day,source:highest.source,
  coverageTo:cover?.coverageTo||valid.map(x=>x.coverageTo).sort().reverse()[0],complete};
}
export async function comparePrices(db:D1Database,url:URL):Promise<Response>{
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const pairs=decodePairs(url.searchParams.get('items')||'',today);
 if(!pairs)return reply({error:'INVALID_PAIRS',message:'최대 24개 코드:날짜 조합만 조회할 수 있습니다.'},400);
 const tableRows=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('blue_basket_watch_r153','blue_kis_live_quotes_r141','blue_kis_live_quotes_r14','chart_snapshots')").all<{name:string}>();
 const tables=new Set(tableRows.results.map(x=>x.name));
 const out:PriceCompareRow[]=[];
 for(const {code,day} of pairs){
  // A user may only compare a verified, non-demo historical search observation.
  const proof=await db.prepare(`SELECT s.close_price FROM signals s JOIN runs r ON r.run_id=s.run_id
    WHERE s.code=? AND s.day=? AND s.close_price>0 AND r.is_demo=0
      AND r.latest_price_date=s.day ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1`)
    .bind(code,day).first<{close_price:number}>();
  if(!money(proof?.close_price)){
   out.push({code,day,status:'NOT_VERIFIED',latest_price:null,latest_day:null,latest_source:null,
    latest_at:null,latest_market:null,period_high:null,period_high_day:null,
    period_high_source:null,high_coverage_to:null,high_complete:false});continue;
  }
  const candidates:Observation[]=[];const highs:HighObservation[]=[];
  if(tables.has('blue_basket_watch_r153')){
   // Multiple discovery dates for one ticker share *latest quote* evidence,
   // but NEVER share a period high computed from a different start date.
   const saved=await db.prepare(`SELECT base_day,status,progress_to_day,highest_price,highest_day,
       recent_close,recent_day,quote_price,quote_high,quote_day,quote_at_utc,quote_market
       FROM blue_basket_watch_r153 WHERE code=? ORDER BY (base_day=?) DESC,base_day DESC LIMIT 30`)
       .bind(code,day).all<Record<string,unknown>>();
   for(const v of saved.results){
    if(iso(v.recent_day)&&v.recent_day>day&&money(v.recent_close))
     candidates.push({price:v.recent_close as number,day:v.recent_day,source:'KIS_DAILY_CLOSE',at:null,market:null,priority:65});
    if(iso(v.quote_day)&&v.quote_day>day&&money(v.quote_price))
     candidates.push({price:v.quote_price as number,day:v.quote_day,source:'KIS_SAVED_QUOTE',
      at:typeof v.quote_at_utc==='string'?v.quote_at_utc:null,market:typeof v.quote_market==='string'?v.quote_market:null,priority:80});
    if(v.base_day===day&&v.status==='READY'&&iso(v.highest_day)&&v.highest_day>day&&money(v.highest_price)&&
       iso(v.progress_to_day)&&v.progress_to_day>=v.highest_day){
      highs.push({price:v.highest_price as number,day:v.highest_day,
       source:'KIS_DAILY_HIGH',coverageTo:v.progress_to_day,full:true});
    }
    // Intraday highs are supplemental observations, never proof of full coverage.
    if(iso(v.quote_day)&&v.quote_day>day&&money(v.quote_high))
     highs.push({price:v.quote_high as number,day:v.quote_day,source:'KIS_QUOTE_DAY_HIGH',coverageTo:v.quote_day,full:false});
   }
  }
  for(const table of ['blue_kis_live_quotes_r141','blue_kis_live_quotes_r14']){
   if(!tables.has(table))continue;
   const raw=await db.prepare(`SELECT payload_json FROM ${table} WHERE code=? AND trade_date>? ORDER BY trade_date DESC,received_at_utc DESC LIMIT 8`)
     .bind(code,day).all<{payload_json:string}>();
   for(const record of raw.results){
    try{
     const q=JSON.parse(record.payload_json) as Record<string,unknown>;
     if(q.code!==code||!iso(q.trade_date_kst)||q.trade_date_kst<=day||!money(q.price))continue;
     const market=typeof q.market==='string'?q.market:'J';if(market!=='J'&&market!=='NX')continue;
     candidates.push({price:q.price as number,day:q.trade_date_kst,source:'KIS_STORED_SNAPSHOT',
      at:typeof q.received_at_utc==='string'?q.received_at_utc:null,market,priority:market==='J'?75:73});
     if(money(q.high))highs.push({price:q.high as number,day:q.trade_date_kst,
      source:'KIS_SNAPSHOT_DAY_HIGH',coverageTo:q.trade_date_kst,full:false});
    }catch{/* malformed quote is omitted */}
   }
  }
  if(tables.has('chart_snapshots')){
   const snap=await db.prepare(`SELECT c.chart_json,c.day FROM chart_snapshots c
    JOIN runs r ON r.run_id=c.run_id WHERE c.code=? AND c.day>?
    AND r.is_demo=0 AND r.latest_price_date=c.day
    ORDER BY c.day DESC,r.created_at DESC,r.run_id DESC LIMIT 1`)
    .bind(code,day).first<{chart_json:string;day:string}>();
   if(snap){const summary=chartAfterSearch(snap.chart_json,day,snap.day);
    if(summary.latest)candidates.push(summary.latest);
    if(summary.high)highs.push(summary.high);
   }
  }
  // A later verified signal-day close is only a fallback (not continuous daily data).
  const eod=await db.prepare(`SELECT s.day,s.close_price FROM signals s JOIN runs r ON r.run_id=s.run_id
   WHERE s.code=? AND s.day>? AND s.close_price>0 AND r.is_demo=0
   AND r.latest_price_date=s.day ORDER BY s.day DESC,r.created_at DESC LIMIT 1`)
   .bind(code,day).first<{day:string;close_price:number}>();
  if(eod&&iso(eod.day)&&money(eod.close_price))candidates.push({price:eod.close_price,
   day:eod.day,source:'MATCHED_SIGNAL_EOD_ONLY',at:null,market:null,priority:35});
  const latest=bestObservation(candidates);
  const high=highSummary(highs,latest?.day||null);
  out.push({code,day,status:latest?'READY':'NO_LATER_PRICE',latest_price:latest?.price||null,
   latest_day:latest?.day||null,latest_source:latest?.source||null,latest_at:latest?.at||null,
   latest_market:latest?.market||null,period_high:high.price,period_high_day:high.day,
   period_high_source:high.source,high_coverage_to:high.coverageTo,high_complete:high.complete});
 }
 return reply({status:'OK',items:out,asof:today,source:'D1_VERIFIED_SAVED_ONLY',note:
  '최근 확인가는 서버 저장 시세이며 실시간 체결 보장이 없습니다. 기간 최고가는 저장된 검증 자료 범위 안에서만 계산합니다.'});
}

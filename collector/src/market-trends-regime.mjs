// Read-only, bounded index/breadth research. No raw index prices in public output.
const SCOPES=['KOSPI','KOSDAQ'];
const SOURCES=['KRX_PYKRX_EXACT_DAY_VERIFIED','KRX_OPENAPI_EXACT_DAY_VERIFIED'];
const day=d=>typeof d==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const integer=v=>{if(!/^\d+$/.test(String(v)))throw Error('BENCHMARK_BAD_COUNT');const n=Number(v);if(!Number.isSafeInteger(n)||n<0||n>10000)throw Error('BENCHMARK_BAD_COUNT');return n;};
export const BREADTH_SQL=`WITH audits AS (
 SELECT trade_day,row_count,source,day_sha256,
 LAG(trade_day,5) OVER(ORDER BY trade_day) AS prior5
 FROM blue_eod_ingest_audit_v1 WHERE trade_day BETWEEN ? AND ?
), actual AS (
 SELECT e.trade_day,COUNT(*) AS actual,
 SUM(CASE WHEN e.close IS NULL OR e.close<=0 OR e.source IS NULL OR e.source<>a.source OR e.market IS NULL OR e.market NOT IN ('KOSPI','KOSDAQ') THEN 1 ELSE 0 END) AS invalid
 FROM audits a JOIN blue_eod_daily_v1 e ON e.trade_day=a.trade_day GROUP BY e.trade_day
)
SELECT a.trade_day AS day,a.prior5,a.row_count AS expected,a.source,a.day_sha256 AS hash,
 t.actual,t.invalid,e.market,COUNT(*) AS universe,
 SUM(CASE WHEN p.close>0 AND p.market=e.market THEN 1 ELSE 0 END) AS matched,
 SUM(CASE WHEN p.close>0 AND p.market=e.market AND e.close>p.close THEN 1 ELSE 0 END) AS up
 FROM audits a JOIN actual t ON t.trade_day=a.trade_day
 JOIN blue_eod_daily_v1 e ON e.trade_day=a.trade_day
 LEFT JOIN blue_eod_daily_v1 p ON p.trade_day=a.prior5 AND p.code=e.code
 GROUP BY a.trade_day,e.market ORDER BY a.trade_day,e.market`;
export function checkedBreadth(rows){
 const all=new Map();
 for(const r of rows){
  if(!day(r.day)||!(r.prior5===null||day(r.prior5)&&r.prior5<r.day)||!SCOPES.includes(r.market))throw Error('BENCHMARK_BAD_AUDIT_KEY');
  if(!all.has(r.day))all.set(r.day,{valid:true,prior5:r.prior5,expected:integer(r.expected),markets:new Map()});
  const a=all.get(r.day);
  if(a.markets.has(r.market)||a.prior5!==r.prior5||a.expected!==integer(r.expected))throw Error('BENCHMARK_BAD_AUDIT_KEY');
  const universe=integer(r.universe),matched=integer(r.matched),up=integer(r.up);
  a.valid&&=a.expected>=1700&&integer(r.actual)===a.expected&&integer(r.invalid)===0&&SOURCES.includes(r.source)&&/^[a-f0-9]{64}$/.test(r.hash)&&universe>=400&&up<=matched&&matched<=universe;
  a.markets.set(r.market,{universe,matched,up});
 }
 for(const a of all.values())a.valid&&=a.markets.size===2&&[...a.markets.values()].reduce((n,m)=>n+m.universe,0)===a.expected;
 return all;
}
export function classifyIndex(series,i){
 if(i<24)return {trend:'UNKNOWN',short:'UNKNOWN'};
 const c=series[i].close,ma=series.slice(i-19,i+1).reduce((s,x)=>s+x.close,0)/20,prev=series.slice(i-24,i-4).reduce((s,x)=>s+x.close,0)/20;
 const trend=c>ma&&ma>prev&&c>series[i-20].close?'UP':c<ma&&ma<prev&&c<series[i-20].close?'DOWN':'MIXED';
 const short=c>series[i-5].close?'UP':c<series[i-5].close?'DOWN':'FLAT';
 return {trend,short};
}
function breadthAt(series,i,scope,all,auditDays){
 if(i<5)return 'UNKNOWN';
 const d=series[i].day,a=all.get(d),pos=auditDays.indexOf(d);
 const dates=series.slice(i-5,i+1).map(x=>x.day);
 if(!a?.valid||pos<5||a.prior5!==dates[0]||auditDays.slice(pos-5,pos+1).some((v,j)=>v!==dates[j])||dates.some(x=>!all.get(x)?.valid))return 'UNKNOWN';
 const m=a.markets.get(scope);
 if(!m.matched||5*m.matched<4*m.universe)return 'UNKNOWN';
 return 5*m.up>=3*m.matched?'BROAD_UP':5*m.up<=2*m.matched?'BROAD_WEAK':'MIXED';
}
export function stateOf(index,breadth){
 if(index.trend==='UNKNOWN'||breadth==='UNKNOWN')return 'UNKNOWN';
 if(index.trend==='UP'&&index.short==='UP'&&breadth==='BROAD_UP')return 'UP_CONFIRMED';
 if(index.trend==='DOWN'&&index.short==='DOWN'&&breadth==='BROAD_WEAK')return 'DOWN_CONFIRMED';
 if(index.trend==='DOWN'&&index.short==='UP'&&breadth==='BROAD_UP')return 'RECOVERY_WATCH';
 if(index.trend==='UP'&&index.short==='DOWN'&&breadth==='BROAD_WEAK')return 'WEAKENING_WATCH';
 return 'MIXED_OR_DIVERGENT';
}
export function inspectBenchmark(series,scope,all,cutoff,{includeDaily=false}={}){
 if(!SCOPES.includes(scope)||!Array.isArray(series)||series.length>150||series.some((v,i)=>!day(v.day)||v.day>cutoff||!Number.isFinite(v.close)||v.close<=0||(i>0&&v.day<=series[i-1].day)))throw Error('BENCHMARK_SERIES_INVALID');
 const auditDays=[...all.keys()].sort(),counts={},trends={},breadths={};let latest=null;
 const pairs=[],daily=[];
 for(let i=0;i<series.length;i++){
  const index=classifyIndex(series,i),breadth=breadthAt(series,i,scope,all,auditDays),state=stateOf(index,breadth);
  counts[state]=(counts[state]||0)+1;trends[index.trend]=(trends[index.trend]||0)+1;breadths[breadth]=(breadths[breadth]||0)+1;
  latest={day:series[i].day,index_trend:index.trend,short_direction:index.short,breadth,state};
  pairs.push({i,state});
  if(includeDaily)daily.push({...latest});
 }
 // Descriptive forward direction counts only; not an accuracy estimate.
 const outcomes={};
 for(const {i,state} of pairs){
  if(state==='UNKNOWN')continue;
  const x=outcomes[state]??={up:0,down:0,flat:0,pending:0};
  if(i+5>=series.length)x.pending++;
  else if(series[i+5].close>series[i].close)x.up++;
  else if(series[i+5].close<series[i].close)x.down++;
  else x.flat++;
 }
 return {market:scope,observations:series.length,first_day:series[0]?.day??null,latest,trend_days:trends,breadth_days:breadths,state_days:counts,subsequent_5_index_observations:outcomes,...(includeDaily?{daily_states:daily}:{})};
}
export async function readBenchmarkEvidence(db,start,end){
 const r=await db.execute({sql:BREADTH_SQL,args:[start,end]});
 if(r.rows.length>300)throw Error('BENCHMARK_ROW_CAP');
 return checkedBreadth(r.rows);
}

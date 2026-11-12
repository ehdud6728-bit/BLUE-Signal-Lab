/** R1.5.9.3 browser-only reader. D1 results are optional and never interpreted as live trades. */
export type PriceCompare = {
 code:string;day:string;status:'READY'|'NO_LATER_PRICE'|'NOT_VERIFIED';
 latest_price:number|null;latest_day:string|null;latest_source:string|null;latest_at:string|null;latest_market:string|null;
 period_high:number|null;period_high_day:string|null;period_high_source:string|null;
 high_coverage_to:string|null;high_complete:boolean;
};
export const comparisonKey=(v:{code:string;day:string})=>`${v.code}:${v.day}`;
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
export function sourceName(s:string|null|undefined):string {
 switch(s){
  case 'KIS_DAILY_CLOSE':return 'KIS 일봉 종가';
  case 'KIS_SAVED_QUOTE':return 'KIS 저장 시세';
  case 'KIS_STORED_SNAPSHOT':return 'KIS 저장 시세';
  case 'VERIFIED_CHART_EOD':return '검증 일봉 종가';
  case 'VERIFIED_CHART_HIGH':return '검증 일봉 고가';
  case 'KIS_DAILY_HIGH':return 'KIS 일봉 고가';
  case 'KIS_QUOTE_DAY_HIGH':return 'KIS 저장 장중 고가';
  case 'KIS_SNAPSHOT_DAY_HIGH':return 'KIS 저장 장중 고가';
  case 'MATCHED_SIGNAL_EOD_ONLY':return '저장된 검색일 종가';
  default:return '저장된 시세';
 }
}
export async function fetchCompared(items:{code:string;day:string}[],signal?:AbortSignal):Promise<Record<string,PriceCompare>>{
 const unique=[...new Map(items.filter(x=>/^\d{6}$/.test(x.code)&&/^20\d{2}-\d{2}-\d{2}$/.test(x.day))
  .map(x=>[comparisonKey(x),x] as const)).values()];
 const all:Record<string,PriceCompare>={};
 for(let i=0;i<unique.length;i+=20){
  if(signal?.aborted)throw new Error('CANCELLED');
  const u=new URL(API+'/api/prices/compare');
  u.searchParams.set('items',unique.slice(i,i+20).map(comparisonKey).join(','));
  const r=await fetch(u.toString(),{credentials:'include',cache:'no-store',signal});
  if(!r.ok)throw new Error(r.status===401?'Cloudflare Access 로그인이 필요합니다.':
   r.status===404?'시세 비교 API 배포가 필요합니다.':`시세 비교 API ${r.status}`);
  const data=await r.json() as {items?:PriceCompare[]};
  for(const item of data.items||[])if(item&&/^\d{6}$/.test(item.code))all[comparisonKey(item)]=item;
 }
 return all;
}

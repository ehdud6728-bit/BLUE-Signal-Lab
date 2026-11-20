/** Browser-only reader. Saved quotes and audited EOD are never live trades. */
export type PriceCompare = {
 code:string;day:string;status:'READY'|'NO_LATER_PRICE'|'NOT_VERIFIED';
 latest_price:number|null;latest_day:string|null;latest_source:string|null;latest_at:string|null;latest_market:string|null;
 period_high:number|null;period_high_day:string|null;period_high_source:string|null;
 high_coverage_to:string|null;high_complete:boolean;high_coverage_from?:string|null;
 quote_status?:string|null;quote_checked_at?:string|null;quote_error?:string|null;
};
export const comparisonKey=(v:{code:string;day:string})=>`${v.code}:${v.day}`;
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
export type TursoInstantResult={status:string;storage:'TURSO';code:string;
 price?:number|null;market?:string|null;trade_date?:string|null;
 received_at_utc?:string|null;message:string};
/** Explicit user click only; the API/Collector own KIS authentication and
 * rate limits. Never contact the legacy D1 quote queue from this request. */
export async function refreshKisQuoteToTurso(code:string,signal?:AbortSignal):Promise<TursoInstantResult>{
 if(!/^[0-9A-Z]{6}$/.test(code))throw Error('INVALID_CODE');
 const response=await fetch(API+'/api/eod/quotes/refresh',{method:'POST',credentials:'include',cache:'no-store',signal,
  headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({code})});
 if(response.status===401||response.status===403)throw Error('CLOUDFLARE_ACCESS_REQUIRED');
 const body=await response.json() as TursoInstantResult;
 if(!body||body.storage!=='TURSO'||body.code!==code||typeof body.status!=='string'||
  typeof body.message!=='string')throw Error('TURSO_KIS_INVALID_RESPONSE');
 return body;
}
export function sourceName(s:string|null|undefined):string {
 switch(s){
  case 'KIS_DAILY_CLOSE':return 'KIS 일봉 종가';
  case 'KRX_VERIFIED_EOD_CLOSE':return 'Turso KRX 확정 종가';
  case 'KRX_VERIFIED_EOD_HIGH':return 'Turso KRX 일봉 고가';
  case 'KIS_SAVED_QUOTE':return 'KIS 저장 시세';
  case 'KIS_STORED_SNAPSHOT':return 'KIS 저장 시세';
  case 'KIS_TURSO_SNAPSHOT':return 'Turso KIS 저장 시세 (체결 시각 미검증)';
  case 'KIS_TURSO_DAY_HIGH':return 'Turso KIS 장중 고가';
  case 'KIS_SEARCH_PRIORITY_R1594':return 'KIS 우선 수집 시세';
  case 'KIS_SEARCH_PRIORITY_DAY_HIGH_R1594':return 'KIS 우선 수집 장중 고가';
  case 'VERIFIED_CHART_EOD':return '검증 일봉 종가';
  case 'VERIFIED_CHART_HIGH':return '검증 일봉 고가';
  case 'KIS_DAILY_HIGH':return 'KIS 일봉 고가';
  case 'KIS_QUOTE_DAY_HIGH':return 'KIS 저장 장중 고가';
  case 'KIS_SNAPSHOT_DAY_HIGH':return 'KIS 저장 장중 고가';
  case 'MATCHED_SIGNAL_EOD_ONLY':return '저장된 검색일 종가';
  default:return '저장된 시세';
 }
}

/** Prefer audited Turso EOD, falling back to legacy D1 ONLY on an unavailable
 * Turso endpoint or invalid/incomplete response. No D1 calls on valid empty
 * Turso results. D1-only comparison remains available for D1 search mode.
 */
export async function fetchComparedTursoFirst(items:{code:string;day:string}[],signal?:AbortSignal,
 onBatch?:(partial:Record<string,PriceCompare>)=>void):Promise<Record<string,PriceCompare>>{
 return fetchComparedTursoInternal(items,signal,onBatch,true);
}
/** Used after a Turso-only KIS request. A D1 error must not create another
 * dependency or make a saved Turso price look unavailable. */
export async function fetchComparedTursoOnly(items:{code:string;day:string}[],signal?:AbortSignal,
 onBatch?:(partial:Record<string,PriceCompare>)=>void):Promise<Record<string,PriceCompare>>{
 return fetchComparedTursoInternal(items,signal,onBatch,false);
}
async function fetchComparedTursoInternal(items:{code:string;day:string}[],signal:AbortSignal|undefined,
 onBatch:((partial:Record<string,PriceCompare>)=>void)|undefined,allowD1Fallback:boolean):Promise<Record<string,PriceCompare>>{
 const unique=[...new Map(items.filter(x=>/^[0-9A-Z]{6}$/.test(x.code)&&/^20\d{2}-\d{2}-\d{2}$/.test(x.day))
  .map(x=>[comparisonKey(x),x] as const)).values()];
 const out:Record<string,PriceCompare>={};
 for(let i=0;i<unique.length;i+=8){
  if(signal?.aborted)throw Error('CANCELLED');
  const batch=unique.slice(i,i+8), keys=new Set(batch.map(comparisonKey));
  const url=new URL(API+'/api/eod/prices/compare');
  url.searchParams.set('items',batch.map(comparisonKey).join(','));
  let turso:Record<string,PriceCompare>|null=null;
  try{
   const response=await fetch(url.toString(),{credentials:'include',cache:'no-store',signal});
   if(!response.ok)throw Error(`TURSO_EOD_HTTP_${response.status}`);
   const body=await response.json() as {storage?:string;items?:PriceCompare[]};
   if(body.storage!=='TURSO'||!Array.isArray(body.items)||body.items.length!==keys.size)
    throw Error('TURSO_EOD_COMPARE_INVALID_RESPONSE');
   const valid:Record<string,PriceCompare>={};
   for(const row of body.items){
    const key=comparisonKey(row);
    if(!keys.has(key)||valid[key]||!['READY','NO_LATER_PRICE'].includes(row.status)||
      (row.status==='READY'&&(!row.latest_day||
        (row.latest_day<=row.day&&!(row.latest_day===row.day&&
          row.day===new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())&&
          ['KIS_TURSO_SNAPSHOT','KRX_VERIFIED_EOD_CLOSE'].includes(row.latest_source||'')))||
        !Number.isFinite(row.latest_price)||Number(row.latest_price)<=0)))
      throw Error('TURSO_EOD_COMPARE_INVALID_RESPONSE');
    valid[key]=row;
   }
   turso=valid;
  }catch(e){
   if(signal?.aborted)throw e;
   if(!allowD1Fallback)throw e;
   // Only a Turso transport/provider problem warrants using the D1 fallback.
   // Authorization errors also affect the protected D1 route, so surface them.
   if(e instanceof Error&&/TURSO_EOD_HTTP_(400|401|403)/.test(e.message))throw e;
  }
  const partial=turso??await fetchCompared(batch,signal);
  Object.assign(out,partial);
  onBatch?.(partial);
 }
 return out;
}
export async function fetchCompared(items:{code:string;day:string}[],signal?:AbortSignal,
 onBatch?:(partial:Record<string,PriceCompare>)=>void):Promise<Record<string,PriceCompare>>{
 const unique=[...new Map(items.filter(x=>/^[0-9A-Z]{6}$/.test(x.code)&&/^20\d{2}-\d{2}-\d{2}$/.test(x.day))
  .map(x=>[comparisonKey(x),x] as const)).values()];
 const all:Record<string,PriceCompare>={};
 let failed=0,firstError='';
 // Eight date-pairs per request avoid large D1 work per Worker invocation.
 // Each successfully completed chunk is rendered before the remaining requests finish.
 for(let i=0;i<unique.length;i+=8){
  if(signal?.aborted)throw new Error('CANCELLED');
  const u=new URL(API+'/api/prices/compare');
  u.searchParams.set('items',unique.slice(i,i+8).map(comparisonKey).join(','));
  try{
   const r=await fetch(u.toString(),{credentials:'include',cache:'no-store',signal});
   if(!r.ok){
    const err=r.status===401?'Cloudflare Access 로그인이 필요합니다.':
     r.status===404?'시세 비교 API 배포가 필요합니다.':`시세 비교 API ${r.status}`;
    if(r.status===401||r.status===404)throw new Error(err);
    throw new Error(err);
   }
   const data=await r.json() as {items?:PriceCompare[]};
   const partial:Record<string,PriceCompare>={};
   for(const item of data.items||[]){if(item&&/^[0-9A-Z]{6}$/.test(item.code)){
    const key=comparisonKey(item);partial[key]=item;all[key]=item;
   }}
   if(Object.keys(partial).length)onBatch?.(partial);
  }catch(e){
   if(signal?.aborted)throw e;
   failed++;if(!firstError)firstError=e instanceof Error?e.message:String(e);
   if(firstError.includes('Access 로그인')||firstError.includes('API 배포'))throw e;
  }
 }
 if(failed)throw new Error(`시세 ${failed}묶음 조회 실패 · 확인된 자료는 유지 (${firstError})`);
 return all;
}

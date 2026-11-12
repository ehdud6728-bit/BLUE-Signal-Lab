/** Non-blocking protected request to the server's bounded collector queue. */
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
export type SearchPriorityResult={status:string;queued:number;throttled:number;not_verified:number};
export async function requestSearchPriority(items:{code:string;day:string}[],signal?:AbortSignal):Promise<SearchPriorityResult>{
 const unique=[...new Map(items.filter(x=>/^\d{6}$/.test(x.code)&&/^20\d{2}-\d{2}-\d{2}$/.test(x.day))
 .map(x=>[x.code,x] as const)).values()].slice(0,8);
 if(!unique.length)return {status:'EMPTY',queued:0,throttled:0,not_verified:0};
 // Use an empty authenticated POST: a tiny batch no longer traverses body-size / content filters.
 // Access and Origin checks, verified search proof and quotas still apply on the Worker.
 const url=new URL(API+'/api/prices/request');
 url.searchParams.set('items',unique.map(x=>x.code+':'+x.day).join(','));
 const r=await fetch(url.toString(),{method:'POST',credentials:'include',cache:'no-store',signal});
 if(!r.ok){
  const contentType=r.headers.get('content-type')||'';
  let providerError='';
  if(contentType.includes('application/json')){try{const json=await r.json() as {error?:string};providerError=json.error||'';}catch{}}
  throw new Error(r.status===401?'Cloudflare Access 로그인 필요':
   r.status===403?'접근 권한 또는 허용된 출처 확인 필요':
   r.status===404?'우선 시세 수집 API 배포 필요':
   r.status===413?`시세 요청 413 (빈 POST) · Cloudflare 요청 제한 확인 필요${providerError?' · '+providerError:''}`:
   `시세 수집 요청 실패 (${r.status}${providerError?' '+providerError:''})`);
 }
 return r.json() as Promise<SearchPriorityResult>;
}

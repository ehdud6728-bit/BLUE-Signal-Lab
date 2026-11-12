/** Non-blocking protected request to the server's bounded collector queue. */
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
export type SearchPriorityResult={status:string;queued:number;throttled:number;not_verified:number};
export async function requestSearchPriority(items:{code:string;day:string}[],signal?:AbortSignal):Promise<SearchPriorityResult>{
 const unique=[...new Map(items.filter(x=>/^\d{6}$/.test(x.code)&&/^20\d{2}-\d{2}-\d{2}$/.test(x.day))
 .map(x=>[x.code,x] as const)).values()].slice(0,8);
 if(!unique.length)return {status:'EMPTY',queued:0,throttled:0,not_verified:0};
 const r=await fetch(API+'/api/prices/request',{method:'POST',credentials:'include',cache:'no-store',signal,
   headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({items:unique})});
 if(!r.ok)throw new Error(r.status===404?'빠른 시세 수집 API 배포 전':`시세 수집 요청 실패 (${r.status})`);
 return r.json() as Promise<SearchPriorityResult>;
}

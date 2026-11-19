/** Browser readers for verified research evidence.
 * A valid Turso answer is authoritative for an audited day. Older, not-yet-
 * migrated days can still use the existing D1 archive without rewriting data.
 * Neither reader issues quotes or writes to either database.
 */
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const CODE=/^[0-9A-Z]{6}$/;

type ChartBar={t:string;c:number};
export type ResearchChart={status:'READY';chart:{asof:string;bars:ChartBar[]};stats?:unknown};
export type ResearchEvidence={code:string;day:string;extras?:Record<string,unknown>};

function path(route:string,code:string,day:string){
 const u=new URL(API+route);u.searchParams.set('code',code);u.searchParams.set('date',day);
 return u;
}
function validPair(code:string,day:string){return CODE.test(code)&&DAY.test(day)&&
  !Number.isNaN(Date.parse(day+'T00:00:00Z'));}
function validChart(data:unknown,day:string):data is ResearchChart{
 if(!data||typeof data!=='object')return false;
 const d=data as {status?:string;chart?:{asof?:string;bars?:ChartBar[]}};
 if(d.status!=='READY'||d.chart?.asof!==day||!Array.isArray(d.chart.bars)||!d.chart.bars.length)return false;
 const bars=d.chart.bars;
 return bars[bars.length-1].t===day&&bars.every((b,i)=>b&&DAY.test(b.t)&&
   Number.isFinite(b.c)&&b.c>0&&(i===0||bars[i-1].t<b.t));
}

/** No D1 request for a verified Turso chart. A date missing from the Turso
 * research archive remains eligible for legacy D1 chart fallback. */
export async function fetchResearchChartTursoFirst(code:string,day:string):Promise<ResearchChart|null>{
 if(!validPair(code,day))return null;
 try{
  const r=await fetch(path('/api/research/chart',code,day),{credentials:'include',cache:'no-store'});
  if(r.status===400||r.status===401||r.status===403)return null;
  if(r.ok){
   const data:unknown=await r.json();
   if(validChart(data,day))return data;
   // An audited day with NO_SIGNAL_FOR_SYMBOL is authoritative. Only an
   // explicitly absent whole day may use D1; old untyped responses fail closed.
   const missing=data as {status?:string;reason?:string}|null;
   if(missing?.status!=='NOT_AVAILABLE'||missing.reason!=='DAY_NOT_IMPORTED')return null;
  }
 }catch{/* Older API deployment or temporary Turso outage: legacy archive only. */}
 try{
  const r=await fetch(path('/api/chart',code,day),{credentials:'include',cache:'no-store'});
  if(!r.ok)return null;
  const data:unknown=await r.json();
  return validChart(data,day)?data:null;
 }catch{return null;}
}

/** Audited Turso research records carry the same scanner evidence fields as
 * D1. A valid empty audited result must not trigger an expensive D1 scan. */
export async function fetchResearchEvidenceTursoFirst(code:string,day:string,minSamples:number):Promise<ResearchEvidence|null>{
 if(!validPair(code,day)||!Number.isInteger(minSamples)||minSamples<3||minSamples>30)return null;
 let useLegacy=true;
 try{
  const u=path('/api/research/search',code,day);
  u.searchParams.set('mode','single');u.searchParams.set('limit','1');
  u.searchParams.set('min_pattern_n',String(minSamples));
  const r=await fetch(u,{credentials:'include',cache:'no-store'});
  if(r.status===400||r.status===401||r.status===403)return null;
  if(r.ok){
   const data=await r.json() as {storage?:string;data_status?:string;items?:ResearchEvidence[]};
   if(data.storage==='TURSO'&&data.data_status==='AVAILABLE'&&Array.isArray(data.items)){
    useLegacy=false;
    return data.items.find(x=>x?.code===code&&x?.day===day)||null;
   }
   // A valid NOT_IMPORTED day has no Turso evidence yet; retain legacy coverage.
   if(data.storage==='TURSO'&&data.data_status!=='NOT_IMPORTED')useLegacy=false;
  }
 }catch{/* Turso transport error: retain legacy fallback. */}
 if(!useLegacy)return null;
 try{
  const u=path('/api/search',code,day);
  u.searchParams.set('mode','single');u.searchParams.set('limit','1');
  u.searchParams.set('min_pattern_n',String(minSamples));
  const r=await fetch(u,{credentials:'include',cache:'no-store'});
  if(!r.ok)return null;
  const data=await r.json() as {items?:ResearchEvidence[]};
  return data.items?.find(x=>x?.code===code&&x?.day===day)||null;
 }catch{return null;}
}

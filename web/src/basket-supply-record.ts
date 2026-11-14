/** BLUE R1.5.10.13 — immutable basket discovery-day supply evidence. */
import {dailySupplyProfile, type DailyOHLCV, type SupplyBin} from './supply-profile';

export type BasketSupplyOutlook={status:string;breakout:number|null;pullback:number|null;undecided:number|null;confidence:string;source:string;basisN:number;direction:string};
export type BasketSupplyRecord={
 version:1;asof:string;capturedAt:string;status:'READY'|'PARTIAL'|'UNAVAILABLE';
 source:'CHART_EOD'|'SEARCH_EXTRAS'|'NONE';method:string;
 low:number|null;high:number|null;grade:string;volume:number|null;
 sharePct:number|null;relativePct:number|null;poc:number|null;
 bins:SupplyBin[];outlook5?:BasketSupplyOutlook;outlook10?:BasketSupplyOutlook;
};
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
const numeric=(v:unknown):number|null=>{
 if(v==null||v==='')return null;
 const n=Number(v);return Number.isFinite(n)&&n>=0?n:null;
};
const validDate=(v:unknown)=>typeof v==='string'&&/^20\d\d-\d\d-\d\d$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'));
const pct=(v:unknown)=>{const n=numeric(v);return n!==null&&n<=100?n:null;};
const grade=(v:unknown)=>['강','중','약','낮음','미확인'].includes(String(v))?String(v):'미확인';
const outlookFrom=(src:unknown):BasketSupplyOutlook|undefined=>{
 if(!src||typeof src!=='object')return undefined;
 const o=src as Record<string,unknown>;
 const predicted=o.estimated_pct&&typeof o.estimated_pct==='object'?o.estimated_pct as Record<string,unknown>:null;
 return {status:String(o.status||'').slice(0,48),breakout:pct(predicted?.BREAKOUT),
  pullback:pct(predicted?.PULLBACK),undecided:pct(predicted?.UNDECIDED),
  confidence:String(o.confidence||'미검증').slice(0,35),source:String(o.source||'').slice(0,40),
  basisN:Math.max(0,Math.trunc(numeric(o.basis_n)??0)),direction:String(o.direction||'').slice(0,120)};
};
const base=(asof:string):BasketSupplyRecord=>({version:1,asof,capturedAt:new Date().toISOString(),
 status:'UNAVAILABLE',source:'NONE',method:'NONE',low:null,high:null,grade:'미확인',
 volume:null,sharePct:null,relativePct:null,poc:null,bins:[]});

/** Immediately store existing search evidence; never invent a volume if absent. */
export function supplyFromSearchExtras(extras:Record<string,unknown>|undefined,day:string):BasketSupplyRecord|undefined{
 if(!extras||!validDate(day))return undefined;
 const ref=numeric(extras.supply_reference_price);
 const lo=numeric(extras.supply_zone_low),hi=numeric(extras.supply_zone_high);
 if(!ref&&!lo)return undefined;
 const r=base(day);r.status='PARTIAL';r.source='SEARCH_EXTRAS';
 r.method=String(extras.supply_strength_method||'OLDER_DAILY_PROXY').slice(0,70);
 r.low=lo??ref;r.high=hi??ref;r.grade=grade(extras.supply_strength_grade);
 r.volume=numeric(extras.supply_volume_est_shares);r.sharePct=pct(extras.supply_bin_share_pct);
 r.relativePct=pct(extras.supply_strength_relative_pct);r.poc=numeric(extras.supply_poc_price);
 return r;
}

/** Server chart is accepted only if the final candle matches the selected discovery day and close. */
export function supplyFromChart(payload:unknown,day:string,discoveryClose:number):BasketSupplyRecord|null{
 if(!payload||typeof payload!=='object'||!validDate(day)||!Number.isFinite(discoveryClose)||discoveryClose<=0)return null;
 const data=payload as {status?:string;chart?:{asof?:string;bars?:DailyOHLCV[]};stats?:{asof?:string;zone_reaction?:{asof?:string;pattern_outlook?:{horizons?:Record<string,unknown>}}}};
 if(data.status!=='READY'||!Array.isArray(data.chart?.bars))return null;
 const bars=data.chart.bars.filter(x=>x&&typeof x.t==='string'&&x.t<=day);
 const last=bars[bars.length-1];
 if(!last||last.t!==day||!Number.isFinite(last.c)||Math.abs(last.c-discoveryClose)>Math.max(.01,discoveryClose*.001))return null;
 const profile=dailySupplyProfile(bars);
 if(!profile)return null;
 const r=base(day);r.status='READY';r.source='CHART_EOD';r.method='DAILY_HL_UNIFORM_120_V2';
 const ref=profile.reference;
 r.low=ref?.low??null;r.high=ref?.high??null;r.grade=ref?.grade??'미확인';
 r.volume=ref?.volume_shares??null;r.sharePct=ref?.share_pct??null;
 r.relativePct=ref?.relative_pct??null;r.poc=profile.pocPrice;
 r.bins=profile.bins.slice(0,8);
 const stats=data.stats;
 if(stats?.asof===day&&stats.zone_reaction?.asof===day){
  r.outlook5=outlookFrom(stats.zone_reaction.pattern_outlook?.horizons?.['5']);
  r.outlook10=outlookFrom(stats.zone_reaction.pattern_outlook?.horizons?.['10']);
 }
 return r;
}

export async function readSupplyAtDiscovery(code:string,day:string,discoveryClose:number):Promise<BasketSupplyRecord|null>{
 if(!/^\d{6}$/.test(code)||!validDate(day))return null;
 const u=new URL(API+'/api/chart');u.searchParams.set('code',code);u.searchParams.set('date',day);
 const res=await fetch(u.toString(),{credentials:'include',cache:'no-store'});
 if(!res.ok)return null;
 return supplyFromChart(await res.json(),day,discoveryClose);
}

/** Fail closed on malformed local/backup data; older basket items need no supply record. */
export function validSupplyRecord(v:unknown):v is BasketSupplyRecord{
 if(!v||typeof v!=='object')return false;
 const r=v as Record<string,unknown>;
 if(r.version!==1||!validDate(r.asof)||typeof r.capturedAt!=='string'||r.capturedAt.length>45||
   !['READY','PARTIAL','UNAVAILABLE'].includes(String(r.status))||
   !['CHART_EOD','SEARCH_EXTRAS','NONE'].includes(String(r.source))||
   typeof r.method!=='string'||r.method.length>70||!['강','중','약','낮음','미확인'].includes(String(r.grade)))return false;
 for(const key of ['low','high','volume','sharePct','relativePct','poc']){
  if(r[key]!==null&&(!Number.isFinite(r[key])||Number(r[key])<0))return false;
 }
 if(!Array.isArray(r.bins)||r.bins.length>8)return false;
 if(!r.bins.every((b:unknown)=>{
  if(!b||typeof b!=='object')return false;
  const x=b as Record<string,unknown>;
  return ['low','high','price','volume_shares','share_pct','relative_pct'].every(k=>Number.isFinite(x[k])&&Number(x[k])>=0)
    &&['강','중','약','낮음'].includes(String(x.grade));
 }))return false;
 for(const name of ['outlook5','outlook10']){
  const x=r[name];if(x===undefined)continue;
  if(!x||typeof x!=='object')return false;
  const o=x as Record<string,unknown>;
  if(['breakout','pullback','undecided'].some(k=>o[k]!==null&&(!Number.isFinite(o[k])||Number(o[k])<0||Number(o[k])>100))||
     !Number.isInteger(o.basisN)||Number(o.basisN)<0||Number(o.basisN)>100000||
     typeof o.confidence!=='string'||o.confidence.length>35||typeof o.direction!=='string'||o.direction.length>120||
     typeof o.status!=='string'||o.status.length>48||typeof o.source!=='string'||o.source.length>40)return false;
 }
 return JSON.stringify(v).length<=4500;
}

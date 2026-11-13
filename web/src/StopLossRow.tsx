import {useEffect,useMemo,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {calculateStopCandidates,preferredStopMethod,type StopBar,type StopMethod} from './stop-loss';
import './r15107-stop-loss.css';

const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
const inFlight=new Map<string,Promise<StopBar[]|null>>();
const pending:Array<()=>void>=[];
let running=0;
function schedule<T>(task:()=>Promise<T>):Promise<T>{
 return new Promise((resolve,reject)=>{
  pending.push(()=>{running++;void task().then(resolve,reject).finally(()=>{running--;pending.shift()?.();});});
  if(running<2)pending.shift()?.();
 });
}
function loadBars(code:string,day:string,refreshKey:number):Promise<StopBar[]|null>{
 const key=`${code}:${day}:${refreshKey}`;
 const current=inFlight.get(key);if(current)return current;
 if(inFlight.size>300)inFlight.clear();
 const promise=schedule(async()=>{
  const u=new URL(API+'/api/chart');u.searchParams.set('code',code);u.searchParams.set('date',day);
  const r=await fetch(u.toString(),{credentials:'include',cache:'no-store'});
  if(!r.ok)return null;
  const data=await r.json() as {status?:string;chart?:{bars?:StopBar[]}};
  return data.status==='READY'&&Array.isArray(data.chart?.bars)?data.chart.bars:null;
 }).catch(()=>null);
 inFlight.set(key,promise);return promise;
}
const money=(price:number)=>Math.floor(price).toLocaleString('ko-KR')+'원';
const percent=(v:number)=>`${v>0?'+':''}${v.toFixed(2)}%`;

type Props={active:boolean;code:string;day:string;baseline:number;signals:string[];
 highestObserved:number|null;highestDay:string|null;selectedMethod?:StopMethod;
 onSelectMethod:(method:StopMethod)=>void;refreshKey:number};
export default function StopLossRow({active,code,day,baseline,signals,highestObserved,highestDay,
 selectedMethod,onSelectMethod,refreshKey}:Props){
 const [bars,setBars]=useState<StopBar[]|null|undefined>(undefined);
 useEffect(()=>{
  if(!active)return;
  let alive=true;setBars(undefined);
  void loadBars(code,day,refreshKey).then(v=>{if(alive)setBars(v);});
  return()=>{alive=false;};
 },[active,code,day,refreshKey]);
 const candidates=useMemo(()=>calculateStopCandidates(bars,day,baseline,highestObserved,highestDay),
  [bars,day,baseline,highestObserved,highestDay]);
 const preferred=selectedMethod||preferredStopMethod(signals);
 const selected=candidates.find(x=>x.method===preferred)||candidates[0];
 const fallback=selectedMethod?selected:candidates.find(x=>x.method===preferred&&x.price!==null)
  ||candidates.find(x=>x.price!==null)||selected;
 const waiting=bars===undefined;
 const readable=waiting?'계산 중':fallback.price===null?'산출 불가':money(fallback.price);
 return <details className="r15107-stop">
  <summary className="r15107-stop-summary">
   <span className="r15107-stop-label">대표 손절선</span>
   <strong className="r15107-stop-number">{readable}</strong>
   {fallback.baselinePct!==null&&<small className="r15107-stop-pct">{percent(fallback.baselinePct)}</small>}
   <span className="r15107-stop-more">더보기 <ChevronDown size={13}/></span>
  </summary>
  <div className="r15107-stop-details">
   <small className="r15107-stop-origin">발견가 {money(baseline)} 대비 · 발견일({day})까지의 저장 일봉 기준</small>
   {candidates.map(row=><button type="button" key={row.method}
    className={'r15107-stop-option'+(row.method===fallback.method?' is-selected':'')}
    aria-pressed={row.method===fallback.method} disabled={waiting||row.price===null}
    onClick={()=>onSelectMethod(row.method)}>
    <span className="r15107-stop-option-name">{row.label}<small>{row.basis}</small></span>
    <span className="r15107-stop-option-value"><b>{waiting?'계산 중':row.price===null?'산출 불가':money(row.price)}</b>
     {row.baselinePct!==null&&<small>{percent(row.baselinePct)}</small>}</span>
   </button>)}
   <small className="r15107-stop-note">대표 기준을 누르면 이 기기의 장바구니에 저장됩니다. 트레일링은 이후 관측 최고가에 발견일 ATR을 적용한 추정치입니다. 실제 주문 호가단위·장중 체결·수정주가는 반영하지 않습니다. 자동 매도나 손절 경고가 아닙니다.</small>
  </div>
 </details>;
}

import type {PriceCompare} from './price-compare';
import {sourceName} from './price-compare';
import './r1593-price-compare.css';

const cash=(n:number|null|undefined)=>typeof n==='number'&&Number.isFinite(n)&&n>0?n.toLocaleString('ko-KR')+'원':'—';
const difference=(n:number|null|undefined,base:number|null|undefined)=>typeof n==='number'&&typeof base==='number'&&n>0&&base>0?` · 발견가 대비 ${n>=base?'+':''}${((n/base-1)*100).toFixed(2)}%`:'';
const received=(s:string|null|undefined)=>{if(!s)return '';const d=new Date(s);return Number.isFinite(d.valueOf())?' · 수집 '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d):'';};
export default function PriceCompareMini({data,baseline,loading=false,compact=false}: {data?:PriceCompare;baseline?:number|null;loading?:boolean;compact?:boolean}){
 const hasLatest=typeof data?.latest_price==='number'&&data.latest_price>0&&!!data.latest_day;
 const hasHigh=typeof data?.period_high==='number'&&data.period_high>0&&!!data.period_high_day;
 return <div className={'r1593-compare'+(compact?' r1593-compare-compact':'')}>
  <div className="r1593-compare-line"><span>최근 확인가</span><strong>{hasLatest?cash(data!.latest_price):'—'}</strong>
   <small>{hasLatest?`${data!.latest_day} · ${sourceName(data!.latest_source)}${data!.latest_market?' · '+(data!.latest_market==='J'?'KRX':data!.latest_market==='NX'?'NXT':data!.latest_market):''}${received(data!.latest_at)}${difference(data!.latest_price,baseline)}`:loading?'저장 시세 조회 중':'후속 시세 미수집'}</small></div>
  <div className="r1593-compare-line"><span>검색 이후 기간 최고가</span><strong>{hasHigh?cash(data!.period_high):'—'}</strong>
   <small>{hasHigh?`${data!.period_high_day} · ${data!.high_complete?'저장된 전 기간 확인':'확인된 구간만'}${data!.high_coverage_to?' ('+data!.high_coverage_to+'까지)':''}${difference(data!.period_high,baseline)}`:loading?'고가 조회 중':'기간 고가 미확인'}</small></div>
 </div>;
}

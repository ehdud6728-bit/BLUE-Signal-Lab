import {stockCardClassification} from './stock-card-classification';
import './stock-card-classification.css';
export default function StockCardClassification({code,name,day,extras}:{code:string;name:string;day:string;extras?:Record<string,unknown>}){
 const c=stockCardClassification(code,name,day,extras);
 const tags=[...c.labels.map(label=>({label,key:'index:'+label,event:false})),...(c.event?[{label:c.event.label,key:'event:'+c.event.label,event:true}]:[])];
 return <div className="stock-classification" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
   <div className="stock-classification-line"><span className="stock-classification-industry">{c.industry?c.industry:'업종 미확인'}</span>
   {tags.length===0?<small>테마 미확인</small>:tags.slice(0,3).map(t=><span className={'stock-classification-tag'+(t.event?' stock-classification-event':'')} key={t.key}>{t.label}{t.event?' · 보도':''}</span>)}
   {tags.length>3&&<small>+{tags.length-3}</small>}</div>
   {(c.asof||c.event)&&<details><summary>분류 근거{c.asof?' · '+c.asof.slice(5):''}</summary>
   {c.asof&&<small>KRX 업종 · {c.asof} 기준{c.asof!==day?' (이전 자료 참고)':''}. 테마는 일부 지수의 요청일 구성종목이며 과거 편입일 독립 확인 전입니다.</small>}
   {c.themes.map((t,i)=><small key={t.index+':'+i}>{t.label} · {t.index}</small>)}
   {c.event&&<small>{c.event.label} · {c.event.basis} ({c.event.day}) · <a href={c.event.url} target="_blank" rel="noreferrer">{c.event.source} 원문</a>. 현재 보유 여부와 당일 주가 상승 원인은 미확인입니다.</small>}
   </details>}
 </div>;
}

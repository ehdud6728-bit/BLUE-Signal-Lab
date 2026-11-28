import {exploratorySearchTip} from './exploratory-search-tip';
import './exploratory-search-tip.css';
export default function ExploratorySearchTip({day,extras,provisional}:{day:string;extras?:Record<string,unknown>;provisional?:boolean}){
 const tip=exploratorySearchTip(day,extras,provisional);
 if(!tip)return null;
 const e=tip.evidence;
 const pct=(n:number,d:number)=>(100*n/d).toFixed(1)+'%';
 return <aside className="blue-exploratory-tip" aria-label="연구 진행 중 참고 정보">
   <strong>{tip.title}</strong>
   <span>5일 최고수익 평균 +{e.yesPeak.toFixed(2)}% vs +{e.noPeak.toFixed(2)}% · 68 vs 675건</span>
   <small>+15% 도달 {pct(e.yesHit15,e.yes)} vs {pct(e.noHit15,e.no)} · -10% 도달 {pct(e.yesDown10,e.yes)} vs {pct(e.noDown10,e.no)}</small>
   <small>11/27 기준 · 다음날 시가 기준 과거 관측 · {tip.retrospective?'사후 참고 · ':''}10일/독립기간 검증 전 · 검색 지표와 연구용 이력 검증은 별개</small>
 </aside>;
}

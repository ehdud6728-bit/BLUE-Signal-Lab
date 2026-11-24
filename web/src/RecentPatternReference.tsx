import {RECENT_ASOF,RECENT_ROWS,RECENT_RECOMMENDATIONS} from './recent-pattern-data';
export default function RecentPatternReference({day,signals,matched=false,onDetails}:{day:string;signals:string[];matched?:boolean;onDetails?:()=>void}){
 if(day<=RECENT_ASOF)return null;
 const rec=matched?RECENT_RECOMMENDATIONS.filter(x=>x.tier==='SHORT_RECOMMENDATION'&&x.group==='detail_rankings'&&x.pattern==='ENV20_LOWER_TOUCH|BULL|CLOSE_MID').sort((a,b)=>b.positive_return_probability_pct-a.positive_return_probability_pct)[0]:undefined;
 const base=signals.flatMap(name=>(RECENT_ROWS[name]??[]).filter(r=>r[0]===3&&r[1]>=30).map(r=>({name,r}))).sort((a,b)=>a.r[3]-b.r[3])[0];
 if(!rec&&(!base||base.r[3]>=50||base.r[5]>=0))return null;
 return <div className="r15106-search-pattern-evidence blue-research" role="note">
 {rec?<><strong className="r-research-gold-label">★ 단기 추천 조건 일치</strong><small>{rec.horizon_trading_days}일 상승 관측 {rec.positive_return_probability_pct.toFixed(2)}% · 중앙 {rec.median_return_pct.toFixed(2)}% · 표본 {rec.sample_count}건</small><small>최근 연구에서 양호한 성과를 보인 복합 조건입니다. 독립 검증 전입니다.</small></>:base&&<><strong>하락 위험 관찰 · {base.name}</strong><small>3일 상승 관측 {base.r[3].toFixed(2)}% · 중앙 {base.r[5].toFixed(2)}% · 표본 {base.r[1]}건. 반등을 단정하기 어렵습니다.</small></>}
 <small>{RECENT_ASOF} 기준 · 과거 관측 결과</small>
 {onDetails&&<button type="button" className="filter-toggle" onClick={e=>{e.stopPropagation();onDetails();}}>AI 패턴 상세 보기</button>}
 </div>;
}

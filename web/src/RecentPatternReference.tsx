import './compact-ai-evidence.css';
import {matchedRecent} from './recent-match';
import {patternLabel} from './research-pattern-label';
import {RECENT_ASOF,RECENT_ROWS} from './recent-pattern-data';
export default function RecentPatternReference({day,signals,matched=false,features,onDetails}:{day:string;signals:string[];matched?:boolean;features?:unknown;onDetails?:()=>void}){
 if(day<=RECENT_ASOF&&!matched)return null;
 const rec=matched?matchedRecent(day,signals,features,true)[0]:undefined;
 const base=signals.flatMap(name=>(RECENT_ROWS[name]??[]).filter(r=>r[0]===3&&r[1]>=30).map(r=>({name,r}))).sort((a,b)=>a.r[3]-b.r[3])[0];
 if(!rec&&(!base||base.r[3]>=50||base.r[5]>=0))return null;
 if(rec)return <div className="blue-compact-ai-evidence" role="note" onClick={e=>e.stopPropagation()}>
 <strong>{patternLabel(rec.pattern)}</strong>
 <div className="blue-compact-ai-metrics">
 <div><span>{rec.horizon_trading_days}일 상승 관측률</span><b>{rec.positive_return_probability_pct.toFixed(2)}%</b></div>
 <div><span>중앙 수익률</span><b className={rec.median_return_pct>0?'positive':rec.median_return_pct<0?'negative':''}>{rec.median_return_pct>0?'+':''}{rec.median_return_pct.toFixed(2)}%</b></div>
 <div><span>표본</span><b>{rec.sample_count}건</b></div>
 </div>
 <div className="blue-compact-ai-footer"><span>{RECENT_ASOF.slice(5).replace('-','.')} 연구 · {day<=RECENT_ASOF?'과거 조건 일치':'독립 검증 전'}</span>
 <details><summary aria-label="연구 성과 안내">ⓘ</summary><p>{day<=RECENT_ASOF?'최신 연구 조건의 과거 일치 사례이며 당시 추천이 아닙니다. ':''}독립 검증 전의 과거 관측 성과입니다.</p></details>
 {onDetails&&<button type="button" onClick={e=>{e.stopPropagation();onDetails();}}>상세 ›</button>}</div>
 </div>;
 return <div className="r15106-search-pattern-evidence blue-research" role="note">
 {base&&<><strong>하락 위험 관찰 · {base.name}</strong><small>3일 상승 관측 {base.r[3].toFixed(2)}% · 중앙 {base.r[5].toFixed(2)}% · 표본 {base.r[1]}건. 반등을 단정하기 어렵습니다.</small></>}
 <small>{RECENT_ASOF} 기준 · 과거 관측 결과</small>
 {onDetails&&<button type="button" className="filter-toggle" onClick={e=>{e.stopPropagation();onDetails();}}>AI 패턴 상세 보기</button>}
 </div>;
}

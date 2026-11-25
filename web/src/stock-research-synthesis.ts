/** Descriptive evidence synthesis only. Never combine unlike cohorts into a
 * probability, score, trading recommendation, rank or highlight.
 */
type Profit={pattern:string;mean_pct:number;median_pct:number;profit_factor:number|null;payoff_ratio:number|null;worst_5pct_mean_pct:number;min_pct:number;n:number};
type High={pattern:string;status:string;feature:string;value:string};
type Tomato={label:string;up:number;n:number}|null;
type Recent={pattern:string;horizon_trading_days:number;positive_return_probability_pct:number;median_return_pct:number;sample_count:number}|null;
export function synthesizeStockResearch(profits:readonly Profit[],high:readonly High[],tomato:Tomato,recent:Recent,validated:string|null){
 const positive:string[]=[],risk:string[]=[],limits:string[]=[];
 const favorable=profits.filter(r=>r.mean_pct>0&&r.median_pct>0&&r.profit_factor!==null&&r.profit_factor>1);
 const unfavorable=profits.filter(r=>r.mean_pct<0||r.profit_factor!==null&&r.profit_factor<1);
 const mixed=profits.filter(r=>!favorable.includes(r)&&!unfavorable.includes(r));
 if(favorable.length)positive.push('3일 시장 연구 '+favorable.length+'개 조건: 평균·중앙 수익 양수, 총이익 우세.');
 if(unfavorable.length)risk.push('3일 시장 연구 '+unfavorable.length+'개 조건: 평균 수익 음수 또는 총손실 우세.');
 if(mixed.length)limits.push('3일 시장 연구 '+mixed.length+'개 조건: 수익성 방향이 혼재하거나 판단 지표 부족.');
 if(tomato){
  (tomato.up>=70?positive:limits).push('토마토: 해당 종목 10일 과거 상승 관측 '+tomato.up.toFixed(1)+'% ('+tomato.n+'건).');
  if(tomato.n<30)limits.push('토마토 표본 '+tomato.n+'건: 작은 표본으로 장기적인 상승 가능성을 단정할 수 없음.');
 }
 if(recent)positive.push('골드 표시 관련 단기 탐색 조건: '+recent.horizon_trading_days+'일 상승 관측 '+recent.positive_return_probability_pct.toFixed(1)+'% ('+recent.sample_count+'건).');
 if(validated)limits.push('별도 검증 연구 신호 일치: '+validated+'. 이 신호와 다른 연구의 결합 성과는 별개.');
 const agreeing=high.filter(r=>r.status==='HOLDOUT_AGREES_EXPLORATORY').length;
 const insufficient=high.filter(r=>r.status==='INSUFFICIENT_HOLDOUT').length;
 const disagree=high.filter(r=>r.status==='HOLDOUT_DISAGREES').length;
 if(agreeing)positive.push('고수익 특징 '+agreeing+'건: 후속 구간에서도 방향 일치(탐색).');
 if(insufficient)limits.push('고수익 특징 '+insufficient+'건: 후속 표본 부족.');
 if(disagree)risk.push('고수익 특징 '+disagree+'건: 후속 구간 불일치.');
 const tail=[...profits].filter(r=>Number.isFinite(r.worst_5pct_mean_pct)).sort((a,b)=>a.worst_5pct_mean_pct-b.worst_5pct_mean_pct)[0];
 const worst=[...profits].filter(r=>Number.isFinite(r.min_pct)).sort((a,b)=>a.min_pct-b.min_pct)[0];
 if(tail&&tail.worst_5pct_mean_pct<0)risk.push('표시 조건 중 가장 낮은 하위 5% 평균 수익률 '+tail.worst_5pct_mean_pct.toFixed(2)+'%.');
 if(worst&&worst.min_pct<0)risk.push('표시 조건 중 가장 낮은 과거 종료 종가 수익률 '+worst.min_pct.toFixed(2)+'%.');
 const opposing=positive.length>0&&(unfavorable.length>0||disagree>0);
 const label=opposing?'긍정·부정 근거 혼재':unfavorable.length?'수익성 주의':positive.length?'긍정적 관측 근거 있음':risk.length?'위험 관측 근거 있음':'판단 자료 부족';
 return {label,positive,risk,limits,opposing};
}

/** Descriptive evidence synthesis only. No score, probability, promotion or highlight changes. */
type Profit={pattern:string;mean_pct:number;median_pct:number;profit_factor:number|null;payoff_ratio:number|null;worst_5pct_mean_pct:number;min_pct:number;n:number;dates?:number;stocks?:number;calculation_audit?:string};
type High={pattern:string;status:string;feature:string;value:string};
type Tomato={label:string;up:number;n:number}|null;
type Recent={pattern:string;horizon_trading_days:number;positive_return_probability_pct:number;median_return_pct:number;sample_count:number}|null;
type CombinedEvidence={label:string;status:string;n:number;dates?:number;stocks?:number;mean:number|null;median:number|null;profitFactor:number|null};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const validPct=(v:unknown):v is number=>finite(v)&&v>=0&&v<=100;
const validN=(v:unknown):v is number=>finite(v)&&Number.isSafeInteger(v)&&v>0;
const floor=(n:unknown,dates:unknown,stocks:unknown)=>validN(n)&&n>=30&&validN(dates)&&dates>=5&&validN(stocks)&&stocks>=10&&dates<=n&&stocks<=n;
const negative=(a:unknown,b:unknown,p:unknown)=>finite(a)&&a<0||finite(b)&&b<0||finite(p)&&p>=0&&p<1;
const favorable=(a:unknown,b:unknown,p:unknown)=>finite(a)&&a>0&&finite(b)&&b>0&&finite(p)&&p>1;
export function synthesizeStockResearch(profits:readonly Profit[],high:readonly High[],tomato:Tomato,recent:Recent,validated:string|null,combined:readonly CombinedEvidence[]=[]){
 const positive:string[]=[],risk:string[]=[],limits:string[]=[];
 let downside=false;
 for(const r of profits){
  const t='3일 시장 연구 '+r.pattern+' ('+r.n+'건, '+(r.dates??'?')+'일, '+(r.stocks??'?')+'종목)';
  if(!floor(r.n,r.dates,r.stocks)){limits.push(t+': 표본·날짜·종목 분산 기준 부족.');continue;}
  if(negative(r.mean_pct,r.median_pct,r.profit_factor)){downside=true;risk.push(t+': 평균·중앙 수익 중 음수 또는 총손실 우세.');}
  else if(favorable(r.mean_pct,r.median_pct,r.profit_factor)&&r.calculation_audit==='RECOMPUTED_MATCH')positive.push(t+': 평균·중앙 양수, 총이익 우세, 저장 자료 재계산 일치(과거 관측).');
  else limits.push(t+': 방향 혼재 또는 저장 자료 재계산 미확인.');
  if(finite(r.worst_5pct_mean_pct)&&r.worst_5pct_mean_pct<0)risk.push(r.pattern+' 하위 5% 평균 '+r.worst_5pct_mean_pct.toFixed(2)+'%.');
  if(finite(r.min_pct)&&r.min_pct<0)risk.push(r.pattern+' 최악 과거 종료 수익률 '+r.min_pct.toFixed(2)+'%.');
 }
 if(tomato&&validPct(tomato.up)&&validN(tomato.n)){
  limits.push('토마토: 해당 종목 10일 과거 상승 관측 '+tomato.up.toFixed(1)+'% ('+tomato.n+'건). '+(tomato.n<30?'작은 표본. ':'')+'별도 단일 종목 연구, 종합 방향 근거에 합산하지 않음.');
 }
 if(recent&&validPct(recent.positive_return_probability_pct)&&validN(recent.sample_count)&&validN(recent.horizon_trading_days)&&finite(recent.median_return_pct)){
  limits.push('단기 탐색 조건: '+recent.horizon_trading_days+'일 상승 관측 '+recent.positive_return_probability_pct.toFixed(1)+'% · 중앙 '+recent.median_return_pct.toFixed(2)+'% ('+recent.sample_count+'건). 날짜·종목 분산 및 재계산 미확인; 별도 참고.');
 }
 for(const x of combined){
  if(x.status!=='DESCRIPTIVE_ONLY'||!floor(x.n,x.dates,x.stocks)){limits.push(x.label+' 복합 조건: 완료 표본 '+x.n+'건, 분산 또는 연구 상태 제한.');continue;}
  if(negative(x.mean,x.median,x.profitFactor)){
   downside=true;risk.push(x.label+' 복합 조건 3일 다음 시가 기준: 평균 '+(finite(x.mean)?x.mean.toFixed(2)+'%':'미확인')+' · 중앙 '+(finite(x.median)?x.median.toFixed(2)+'%':'미확인')+' ('+x.n+'건).');
  }else limits.push(x.label+' 복합 조건: 과거 성과 관측, 저장 지표 및 독립 기간 검증 전.');
 }
 if(validated)limits.push('별도 검증 연구 신호 일치: '+validated+'. 이 신호와 다른 연구의 결합 성과는 별개.');
 for(const r of high){
  if(r.status==='HOLDOUT_AGREES_EXPLORATORY')limits.push(r.pattern+' 고수익 특징: 후속 방향 일치(탐색), 전체 수익성과 별개.');
  if(r.status==='INSUFFICIENT_HOLDOUT')limits.push(r.pattern+' 고수익 특징: 후속 표본 부족.');
  if(r.status==='HOLDOUT_DISAGREES')limits.push(r.pattern+' 고수익 특징: 후속 구간 불일치, 일반화 주의.');
 }
 const opposing=positive.length>0&&downside;
 const label=opposing?'과거 수익성 근거 혼재':downside?'과거 수익성 주의':positive.length?'과거 긍정 성과 관측':'판단 자료 부족';
 return {label,positive,risk,limits,opposing};
}

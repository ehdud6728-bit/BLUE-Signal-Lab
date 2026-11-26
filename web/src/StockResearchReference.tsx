import {useState} from 'react';
import {RECENT_ASOF} from './recent-pattern-data';
import {PROFITABILITY_DATA} from './research-profitability-data';
import {HIGH_RETURN_PROFILES} from './high-return-profiles-data';
import {selectStockResearch} from './stock-research-reference';
import {synthesizeStockResearch} from './stock-research-synthesis';
import {stockObservationContext} from './stock-observation-context';
import {CombinedStockEvidence,selectCombinedRows} from './CombinedPatternResearch';
import {patternLabel} from './research-pattern-label';
import './stock-research-reference.css';
type Profit={calculation_audit?:string;pattern:string;group:string;horizon:number;n:number;dates:number;stocks:number;up_pct:number;mean_pct:number;median_pct:number;min_pct:number;mean_gain_pct:number|null;mean_loss_pct:number|null;payoff_ratio:number|null;profit_factor:number|null;worst_5pct_mean_pct:number;tail_count:number;target_10_pct:number;target_20_pct:number};
type Stats={n:number;dates:number;stocks:number;hits:number;hit_pct:number|null};
type Profile={pattern:string;window:number;horizon:number;outcome:string;target_pct:number;feature:string;value:string;status:string;train:Stats;train_control:Stats;train_lift_pp:number;holdout:Stats;holdout_control:Stats;holdout_lift_pp:number|null};
const profit=PROFITABILITY_DATA as {asof:string;rows:Profit[]}|null;
const profiles=HIGH_RETURN_PROFILES as {asof:string;rows:Profile[]}|null;
const fmt=(v:number|null)=>v==null||!Number.isFinite(v)?'—':(v>0?'+':'')+v.toFixed(2)+'%';
const pct=(v:number|null)=>v==null||!Number.isFinite(v)?'—':v.toFixed(1)+'%';
const ratio=(v:number|null)=>v==null||!Number.isFinite(v)?'—':v.toFixed(2);
const status:Record<string,string>={HOLDOUT_AGREES_EXPLORATORY:'후속 방향 일치 · 탐색',INSUFFICIENT_HOLDOUT:'후속 표본 부족',HOLDOUT_DISAGREES:'후속 불일치'};
export default function StockResearchReference({day,signals,features,provisional,tomato,recent,validated,extras,referencePrice,onCombined,onProfit,onHigh}:{day:string;signals:string[];features:unknown;provisional?:boolean;tomato:{label:string;up:number;n:number}|null;recent:{pattern:string;horizon_trading_days:number;positive_return_probability_pct:number;median_return_pct:number;sample_count:number}|null;validated:string|null;extras?:Record<string,unknown>;referencePrice?:number|null;onCombined:()=>void;onProfit:()=>void;onHigh:()=>void}){
 const [open,setOpen]=useState(false);
 const {profits,high,retrospective}=selectStockResearch({day,asof:RECENT_ASOF,signals,features,profit,profiles,allowRetrospective:!provisional});
 const combined=selectCombinedRows(signals,features,extras,provisional);
 const synthesis=synthesizeStockResearch(profits,high,tomato,recent,validated,combined.flatMap(x=>x.joint?[{
  label:patternLabel(x.base),status:x.joint.research_status,n:x.joint.all.n,dates:x.joint.all.dates,stocks:x.joint.all.stocks,
  mean:x.joint.all.mean_pct,median:x.joint.all.median_pct,profitFactor:x.joint.all.profile?.profit_factor??null
 }]:[]));
 const context=stockObservationContext(extras,referencePrice);
 return <div className="sr-context-wrap">
 <div className="sr-context" aria-label="신호일 관측 요약">
 <strong>신호일 종합 관찰 · {provisional?'잠정':'확정'}</strong>
 <small>{day} · {retrospective?'사후 연구 참고 · ':''}신호 시점 자료</small>
 <h4 className="sr-headline">{context.headline}</h4>
 <p>{context.explanation}</p>
 <div className="sr-verdict"><strong>{synthesis.label}</strong><p>{synthesis.opposing?'서로 다른 과거 연구의 성과가 상충합니다.':synthesis.risk.length?'과거 손실 관측과 분포를 확인하세요.':synthesis.positive.length?'과거 관측이며 현재 상승 예측은 아닙니다.':'충분한 일치·검증 자료가 없습니다.'}</p></div>
 <div className="sr-context-grid">
 <span>이평 배열 <b>{context.trend}</b></span>
 <span>거래대금/20일 평균 <b>{context.turnover}</b></span>
 <span>RSI <b>{context.rsi===null?'미계산':context.rsi.toFixed(1)}</b></span>
 <span>추정 매물대 <b>{context.supply?context.supply.grade+' · '+context.supply.price.toLocaleString('ko-KR')+'원':'미확인'}</b></span>
 </div>
 <small>{context.momentum}</small>
 {context.supply?.distancePct!=null&&<small>신호일 기준가격 대비 매물대 기준가 {fmt(context.supply.distancePct)} · 실제 매도잔량 아님</small>}
 <p>{[...(provisional?['확정 일봉에서 조건 유지 확인']:[]),...context.checks].join(' · ')||'추가 확인: 신호 유지와 손실 위험'}.</p>
 <div className="sr-scenarios"><strong>상황별 확인 관점</strong>{context.scenarios.map(t=><p key={t}>{t}</p>)}</div>
 <small>과거 연구와 당시 관측의 요약 · 현재가 예측이나 매수 추천 아님 · 실시간 시세·시장 국면 미연동</small>
 </div>
 <details className="sr-reference" open={open} onToggle={e=>setOpen(e.currentTarget.open)} onClick={e=>e.stopPropagation()}>
 <summary><span>연구 종합 해석</span><small>{synthesis.label} · 상세 보기</small></summary>
 {open&&<>
 <div className="sr-synthesis"><strong>{synthesis.label}</strong><small>{retrospective?'최신 시장 연구로 과거 신호 비교':provisional?'장중 잠정 조건':'확정 신호'} · 수익성 {profits.length}건 · 고수익 특징 {high.length}건</small>
 {synthesis.positive.length>0&&<div><strong className="sr-positive">긍정적 관측 근거</strong>{synthesis.positive.map(t=><p key={t}>{t}</p>)}</div>}
 {synthesis.risk.length>0&&<div><strong className="sr-risk">손실 위험</strong>{synthesis.risk.map(t=><p key={t}>{t}</p>)}</div>}
 {synthesis.limits.length>0&&<div><strong>판단 제한</strong>{synthesis.limits.map(t=><p key={t}>{t}</p>)}</div>}
 <div><strong>다음 확인 사항</strong>
 {provisional&&<p>잠정 신호: 정규장 확정 일봉에서 같은 조건이 유지되는지 확인.</p>}
 {retrospective&&<p>사후 연구: 발견 당시 이용 가능한 정보와 구분하며 과거 매수 판단에 소급 적용하지 않음.</p>}
 {synthesis.opposing&&<p>서로 반대되는 연구 결과: 진입 기준·기간·표본을 분리하여 손실 분포와 후속 검증을 확인.</p>}
 {!synthesis.opposing&&synthesis.risk.length>0&&<p>손실 관측 근거: 중앙 수익률, 하위 5% 손실과 후속 기간의 방향을 확인.</p>}
 {synthesis.positive.length>0&&<p>긍정 관측은 투자 우위 확정이 아님: 독립 기간 재현 여부와 비용 반영 여부 확인.</p>}
 {synthesis.positive.length===0&&synthesis.risk.length===0&&<p>방향 판단 보류: 일치 조건과 완료 표본 및 검증 범위를 확인.</p>}
 </div>
 <small>복합 조건: {combined.length?'아래 동일 조건 연구 참조 (탐색)':'확인 가능한 일치 집계 없음 또는 미게시'} 서로 다른 연구의 표본·기간·진입 기준을 합산하지 않습니다.</small></div>
 {combined.length>0&&<small>{RECENT_ASOF} 복합 연구 · {day<=RECENT_ASOF?'최신 연구로 이전 신호 비교 (당시 알 수 있었던 정보 아님)':'과거 시장 집계 참고'}</small>}<CombinedStockEvidence matches={combined} onDetails={onCombined}/>
 {tomato&&<section><strong>종목별 토마토 연구 · 다음 시가 → 10번째 종가</strong><small>{tomato.label||'조건명 미확보'} · 상승 관측 {pct(tomato.up)} · {tomato.n}건 · 탐색적 결과</small></section>}
 {recent&&<section><strong>시장 단기 연구 · 신호일 종가 기준</strong><small>{patternLabel(recent.pattern)} · {recent.horizon_trading_days}일 상승 관측 {pct(recent.positive_return_probability_pct)} · 중앙 {fmt(recent.median_return_pct)} · {recent.sample_count}건</small></section>}
 <p className="sr-note">{RECENT_ASOF} 연구 · 3일 종가 관측 · {retrospective?'최신 연구를 이전 신호와 비교한 결과이며 당시 알 수 있었던 정보가 아닙니다. ':''}{provisional?'장중 캔들은 확정 시 변할 수 있습니다. ':''}후속 검증 전 · 매수 추천 아님</p>
 {profits.map(r=><section key={r.group+'|'+r.pattern}><strong>{patternLabel(r.pattern)}</strong><small>{r.n}건 · {r.dates}일 · {r.stocks}종목 · {r.calculation_audit==='RECOMPUTED_MATCH'?'별도 재계산 일치':'독립 재계산 미확인'}</small><div className="sr-metrics"><div><span>평균 수익</span><b>{fmt(r.mean_pct)}</b></div><div><span>손익비</span><b>{ratio(r.payoff_ratio)}</b></div><div><span>상승 관측</span><b>{pct(r.up_pct)}</b></div></div><div className="sr-metrics"><div><span>+10% 종가</span><b>{pct(r.target_10_pct)}</b></div><div><span>평균 손실</span><b>{fmt(r.mean_loss_pct)}</b></div><div><span>최악 종가</span><b>{fmt(r.min_pct)}</b></div></div><small>평균 이익 {fmt(r.mean_gain_pct)} · Profit Factor {ratio(r.profit_factor)} · +20% 종가 {pct(r.target_20_pct)} · 하위 5% 평균 {fmt(r.worst_5pct_mean_pct)} ({r.tail_count}건)</small></section>)}
 {profits.length>0&&<button type="button" onClick={onProfit}>수익성 연구 상세 ›</button>}
 <strong>고수익 특징 일치</strong>
 {!high.length?<small>게시된 28일·3일·+10% 종가 연구에서 확인 가능한 캔들 특징 일치 없음 또는 정보 부족</small>:high.map(r=><section key={r.pattern+'|'+r.feature+'|'+r.value}><strong>{patternLabel(r.pattern)}</strong><small>추가 특징: {patternLabel(r.value)} · {status[r.status]}</small><div className="sr-metrics"><div><span>충족군 +10%</span><b>{pct(r.train.hit_pct)}</b></div><div><span>미충족군 +10%</span><b>{pct(r.train_control.hit_pct)}</b></div><div><span>발굴 차이</span><b>{r.train_lift_pp>0?'+':''}{r.train_lift_pp.toFixed(1)}%p</b></div></div><small>발굴 {r.train.hits}/{r.train.n} vs {r.train_control.hits}/{r.train_control.n}건 · 후속 {r.holdout.hits}/{r.holdout.n} vs {r.holdout_control.hits}/{r.holdout_control.n}건 · 후속 차이 {r.holdout_lift_pp==null?'미확인':r.holdout_lift_pp.toFixed(1)+'%p'}</small></section>)}
 <button type="button" onClick={onHigh}>고수익 특성 연구 상세 ›</button>
 <p className="sr-note">표시 가능한 캔들 형태·몸통·종가 위치만 비교합니다. 기타 특징은 미확인입니다. 패턴별 대표 조건은 세부 일치·표본 수 기준이며, 일치 건수는 확률이나 점수가 아닙니다. 거래비용·실제 체결·기업행동 검증 전.</p>
 </>}
 </details>
 </div>;
}

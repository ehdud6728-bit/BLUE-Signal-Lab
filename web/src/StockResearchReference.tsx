import {useState} from 'react';
import {RECENT_ASOF} from './recent-pattern-data';
import {PROFITABILITY_DATA} from './research-profitability-data';
import {HIGH_RETURN_PROFILES} from './high-return-profiles-data';
import {selectStockResearch} from './stock-research-reference';
import {patternLabel} from './research-pattern-label';
import './stock-research-reference.css';
type Profit={pattern:string;group:string;horizon:number;n:number;dates:number;stocks:number;up_pct:number;mean_pct:number;median_pct:number;min_pct:number;mean_gain_pct:number|null;mean_loss_pct:number|null;payoff_ratio:number|null;profit_factor:number|null;worst_5pct_mean_pct:number;tail_count:number;target_10_pct:number;target_20_pct:number};
type Stats={n:number;dates:number;stocks:number;hits:number;hit_pct:number|null};
type Profile={pattern:string;window:number;horizon:number;outcome:string;target_pct:number;feature:string;value:string;status:string;train:Stats;train_control:Stats;train_lift_pp:number;holdout:Stats;holdout_control:Stats;holdout_lift_pp:number|null};
const profit=PROFITABILITY_DATA as {asof:string;rows:Profit[]}|null;
const profiles=HIGH_RETURN_PROFILES as {asof:string;rows:Profile[]}|null;
const fmt=(v:number|null)=>v==null||!Number.isFinite(v)?'—':(v>0?'+':'')+v.toFixed(2)+'%';
const pct=(v:number|null)=>v==null||!Number.isFinite(v)?'—':v.toFixed(1)+'%';
const ratio=(v:number|null)=>v==null||!Number.isFinite(v)?'—':v.toFixed(2);
const status:Record<string,string>={HOLDOUT_AGREES_EXPLORATORY:'후속 방향 일치 · 탐색',INSUFFICIENT_HOLDOUT:'후속 표본 부족',HOLDOUT_DISAGREES:'후속 불일치'};
export default function StockResearchReference({day,signals,features,provisional,onProfit,onHigh}:{day:string;signals:string[];features:unknown;provisional?:boolean;onProfit:()=>void;onHigh:()=>void}){
 const [open,setOpen]=useState(false);
 const {profits,high,retrospective}=selectStockResearch({day,asof:RECENT_ASOF,signals,features,profit,profiles,allowRetrospective:!provisional});
 if(!profits.length&&!high.length)return null;
 return <details className="sr-reference" open={open} onToggle={e=>setOpen(e.currentTarget.open)} onClick={e=>e.stopPropagation()}>
 <summary><span>수익성·고수익 연구 참고</span><small>{retrospective?'과거 비교':provisional?'잠정 조건':'확정 신호'} · {profits.length} / {high.length}건</small></summary>
 {open&&<>
 <p className="sr-note">{RECENT_ASOF} 연구 · 3일 종가 관측 · {retrospective?'최신 연구를 이전 신호와 비교한 결과이며 당시 알 수 있었던 정보가 아닙니다. ':''}{provisional?'장중 캔들은 확정 시 변할 수 있습니다. ':''}후속 검증 전 · 매수 추천 아님</p>
 {profits.map(r=><section key={r.group+'|'+r.pattern}><strong>{patternLabel(r.pattern)}</strong><small>{r.n}건 · {r.dates}일 · {r.stocks}종목</small><div className="sr-metrics"><div><span>평균 수익</span><b>{fmt(r.mean_pct)}</b></div><div><span>손익비</span><b>{ratio(r.payoff_ratio)}</b></div><div><span>상승 관측</span><b>{pct(r.up_pct)}</b></div></div><div className="sr-metrics"><div><span>+10% 종가</span><b>{pct(r.target_10_pct)}</b></div><div><span>평균 손실</span><b>{fmt(r.mean_loss_pct)}</b></div><div><span>최악 종가</span><b>{fmt(r.min_pct)}</b></div></div><small>평균 이익 {fmt(r.mean_gain_pct)} · Profit Factor {ratio(r.profit_factor)} · +20% 종가 {pct(r.target_20_pct)} · 하위 5% 평균 {fmt(r.worst_5pct_mean_pct)} ({r.tail_count}건)</small></section>)}
 {profits.length>0&&<button type="button" onClick={onProfit}>수익성 연구 상세 ›</button>}
 <strong>고수익 특징 일치</strong>
 {!high.length?<small>게시된 28일·3일·+10% 종가 연구에서 확인 가능한 캔들 특징 일치 없음 또는 정보 부족</small>:high.map(r=><section key={r.pattern+'|'+r.feature+'|'+r.value}><strong>{patternLabel(r.pattern)}</strong><small>추가 특징: {patternLabel(r.value)} · {status[r.status]}</small><div className="sr-metrics"><div><span>충족군 +10%</span><b>{pct(r.train.hit_pct)}</b></div><div><span>미충족군 +10%</span><b>{pct(r.train_control.hit_pct)}</b></div><div><span>발굴 차이</span><b>{r.train_lift_pp>0?'+':''}{r.train_lift_pp.toFixed(1)}%p</b></div></div><small>발굴 {r.train.hits}/{r.train.n} vs {r.train_control.hits}/{r.train_control.n}건 · 후속 {r.holdout.hits}/{r.holdout.n} vs {r.holdout_control.hits}/{r.holdout_control.n}건 · 후속 차이 {r.holdout_lift_pp==null?'미확인':r.holdout_lift_pp.toFixed(1)+'%p'}</small></section>)}
 <button type="button" onClick={onHigh}>고수익 특성 연구 상세 ›</button>
 <p className="sr-note">표시 가능한 캔들 형태·몸통·종가 위치만 비교합니다. 기타 특징은 미확인입니다. 패턴별 대표 조건은 세부 일치·표본 수 기준이며, 일치 건수는 확률이나 점수가 아닙니다. 거래비용·실제 체결·기업행동 검증 전.</p>
 </>}
 </details>;
}

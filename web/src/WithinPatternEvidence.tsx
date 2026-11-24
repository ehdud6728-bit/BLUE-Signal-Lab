import {DIRECTIONAL_DISCOVERY} from './directional-discovery-data';
import {withinPattern} from './within-pattern-evidence';
import {patternLabel} from './research-pattern-label';
export default function WithinPatternEvidence({day,signals,features}:{day:string;signals:string[];features:unknown}){
 const m=withinPattern(DIRECTIONAL_DISCOVERY,signals,features);
 if(!m||(!m.up&&!m.down))return null;
 return <div className="blue-within-pattern" role="note" onClick={e=>e.stopPropagation()}>
 {([m.up,m.down]).map(r=>{if(!r)return null;const delta=r.train.up_pct!-r.train_base.up_pct!;return <div key={r.direction}><strong>{r.direction==='UPSIDE'?'상승 우위 관찰':'하락 위험 관찰'} · {patternLabel(r.pattern)}</strong><div>{r.horizon}일 상승 {r.train.up_pct!.toFixed(2)}% / 조건 제외 {r.train_base.up_pct!.toFixed(2)}% <b className={delta>0?'positive':'negative'}>({delta>0?'+':''}{delta.toFixed(2)}%p)</b></div><small>표본 {r.train.n}건 · {r.status==='HOLDOUT_AGREES_EXPLORATORY'?'후속 방향 일치':'후속 검증 부족'}{day<=m.asof?' · 과거 조건 일치':''}</small><details><summary>판단 근거</summary><p>{r.actual_sessions}일 연구 중 발굴 구간의 관측 성과입니다. 비교군은 해당 조건을 제외한 같은 기본 패턴입니다. 중앙 수익률 {r.train.median_pct?.toFixed(2)??'—'}% · 5% 이상 종가 손실 {r.train.loss_5_pct?.toFixed(2)??'—'}% · 후속 표본 {r.holdout.n}건. {m.asof} 연구 기준이며 미래 확률이나 매매 지시가 아닙니다.</p></details></div>})}
 {m.up&&m.down&&<small>서로 다른 방향의 조건이 함께 발견되었습니다. 단일 방향으로 판단하지 않습니다.</small>}
 </div>;
}

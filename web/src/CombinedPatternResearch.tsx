import {useState} from 'react';
import {COMBINED_DATA} from './combined-pattern-data';
import {RECENT_ASOF} from './recent-pattern-data';
import {patternLabel} from './research-pattern-label';
import {matchesJointBases} from './combined-pattern-match';
import './research-center.css';

type Profile={payoff_ratio:number|null;profit_factor:number|null;worst_5pct_mean_pct:number;mean_loss_pct:number|null;target_10_pct:number;target_20_pct:number};
type Stats={n:number;dates:number;stocks:number;up_pct:number|null;mean_pct:number|null;median_pct:number|null;min_pct:number|null;profile:Profile|null};
type Row={base:string;condition:string;sampling:string;entry_basis:string;horizon:number;total_signals:number;pending:number;missing:number;all:Stats;train:Stats;holdout:Stats;research_status:string};
type Data={schema:string;asof:string;audit_sessions:number;signal_audit_sessions:number;source_sha256:string;factors_sha256:string;report_sha256:string;quality:Record<string,number>;rows:Row[]};
export function currentCombined():Data|null{
 const d=COMBINED_DATA as Data|null;
 return d?.schema==='BLUE_COMBINED_WEB_V1'&&d.asof===RECENT_ASOF&&Array.isArray(d.rows)&&d.rows.length===240?d:null;
}
const groups=[['BASE_KNOWN','기본 신호'],['LONG_BULL','장대양봉'],['LONG_BULL_RSI_GC','장대양봉 + RSI GC'],['LONG_BULL_MA_DOWN','장대양봉 + 역배열'],['JOINT','장대양봉 + RSI GC + 역배열'],['LONG_BULL_NOT_JOINT','장대양봉 · 두 조건 동시 미충족']];
const percent=(v:number|null|undefined)=>v==null?'—':v.toFixed(2)+'%';
const ratio=(v:number|null|undefined)=>v==null?'—':v.toFixed(2);
const sign=(v:number|null|undefined)=>v==null?'—':(v>0?'+':'')+percent(v);
const tone=(v:number|null)=>v==null?'':v>0?'rc-up':v<0?'rc-down':'';
const status=(r:Row)=>r.research_status==='NO_MATURED_CASES'?'완료 표본 없음':r.research_status==='SMALL_SAMPLE'?'표본 부족':'과거 관측 · 독립 검증 전';
function Metrics({r}:{r:Row}){
 const a=r.all;
 return <><div className="rc-metrics"><div><span>평균 수익률</span><b className={tone(a.mean_pct)}>{sign(a.mean_pct)}</b></div><div><span>상승 관측률</span><b>{percent(a.up_pct)}</b></div><div><span>표본</span><b>{a.n}건</b></div></div><small>{a.dates}일 · {a.stocks}종목 · {status(r)}</small><small>중앙 {sign(a.median_pct)} · 손익비 {ratio(a.profile?.payoff_ratio)} · PF {ratio(a.profile?.profit_factor)} · 하위 5% {sign(a.profile?.worst_5pct_mean_pct)}</small></>;
}
export function selectCombinedRows(signals:string[],features:unknown,extras:Record<string,unknown>|undefined,provisional?:boolean){
 const d=currentCombined();
 return d?matchesJointBases(signals,features,extras,provisional).map(base=>({base,joint:d.rows.find(r=>r.base===base&&r.condition==='JOINT'&&r.sampling==='ALL_EVENTS'&&r.entry_basis==='NEXT_OPEN'&&r.horizon===3),control:d.rows.find(r=>r.base===base&&r.condition==='LONG_BULL_NOT_JOINT'&&r.sampling==='ALL_EVENTS'&&r.entry_basis==='NEXT_OPEN'&&r.horizon===3)})).filter(x=>x.joint&&x.control):[];
}
export function CombinedStockEvidence({matches,onDetails}:{matches:ReturnType<typeof selectCombinedRows>;onDetails:()=>void}){
 if(!matches.length)return null;
 return <section><strong>동시 조건 연구 · 시장 전체</strong><small>다음 날 시가 → 3번째 감사 관측일 종가 · 저장 지표 기반 탐색</small>{matches.map(x=>x.joint&&x.control&&<div className="sr-synthesis" key={x.base}><strong>{patternLabel(x.base)} + 장대양봉 + RSI GC + 역배열</strong><Metrics r={x.joint}/><small>동시 미충족 대조군 {x.control.all.n}건 · 평균 {sign(x.control.all.mean_pct)} · 상승 {percent(x.control.all.up_pct)}</small><small>후속 {x.joint.holdout.n}건 · 평균 {sign(x.joint.holdout.mean_pct)} · 표본/지표 검증 전</small></div>)}<button type="button" onClick={onDetails}>복합 연구 전체 비교 ›</button></section>;
}
export default function CombinedPatternResearch(){
 const d=currentCombined();
 const [base,setBase]=useState('ENV20'),[h,setH]=useState(3),[basis,setBasis]=useState('NEXT_OPEN'),[sampling,setSampling]=useState('ALL_EVENTS');
 const rows=(d?.rows??[]).filter(r=>r.base===base&&r.horizon===h&&r.entry_basis===basis&&r.sampling===sampling);
 return <section className="rc-section hr-dashboard"><h2>복합 조건 수익성 연구</h2><small>동일 신호일 조건의 실제 교집합 · 시장 전체</small>
 {!d?<p className="rc-note">동일 기준일의 복합 연구 집계 게시 대기 중입니다. 다른 날짜의 연구는 연결하지 않습니다.</p>:<>
 <small>{d.asof} 기준 · 감사 일봉 {d.audit_sessions}일 · 신호 감사 {d.signal_audit_sessions}일</small>
 <div className="rc-filter"><label>기본 패턴<select value={base} onChange={e=>setBase(e.target.value)}><option value="ENV20">엔벨20 중심선 돌파</option><option value="ENV20_LOWER_TOUCH">엔벨20 하단 터치</option></select></label><label>진입 기준<select value={basis} onChange={e=>setBasis(e.target.value)}><option value="NEXT_OPEN">다음 날 시가</option><option value="SIGNAL_CLOSE">신호일 종가</option></select></label><label>표본 방식<select value={sampling} onChange={e=>setSampling(e.target.value)}><option value="ALL_EVENTS">전체 발생 사례</option><option value="COOLDOWN_10_PER_CONDITION">조건별 10관측일 중복 제거</option></select></label></div>
 <div className="rc-periods">{[1,3,5,10,20].map(n=><button type="button" key={n} aria-pressed={h===n} onClick={()=>setH(n)}>{n}일</button>)}</div>
 {sampling!=='ALL_EVENTS'&&<p className="rc-note">조건마다 중복 제거 대상이 달라 직접적인 조건 추가 효과 비교에는 적합하지 않습니다.</p>}
 {groups.map(([g,label])=>{const r=rows.find(x=>x.condition===g);return r&&<article className="rc-profit-row hr-result-card" key={g}><strong>{label}</strong><Metrics r={r}/><details><summary>세부 성과 · 검증 범위</summary><dl className="rc-detail"><dt>전체 신호 / 미도래 / 누락</dt><dd>{r.total_signals} / {r.pending} / {r.missing}</dd><dt>최악 종료 종가 수익률</dt><dd>{sign(r.all.min_pct)}</dd><dt>평균 손실</dt><dd>{sign(r.all.profile?.mean_loss_pct)}</dd><dt>+10% / +20% 종료 종가</dt><dd>{percent(r.all.profile?.target_10_pct)} / {percent(r.all.profile?.target_20_pct)}</dd><dt>발굴 표본 / 평균</dt><dd>{r.train.n} / {sign(r.train.mean_pct)}</dd><dt>후속 표본 / 평균</dt><dd>{r.holdout.n} / {sign(r.holdout.mean_pct)}</dd></dl></details></article>})}
 <details className="rc-note"><summary>데이터 근거 및 검증 한계</summary><p>저장 지표 확인 {d.quality.known_factor_stock_days??0} / {d.quality.target_signal_stock_days??0} 종목·일. 독립 감사 일봉 MA 비교 {d.quality.ma_eod_checked??0}건. 집계 대조군 분할 검사 통과. RSI/MA 원본 독립 재계산, 거래일 연속성, 수정주가, 비용과 실제 체결은 검증 전입니다.</p><small>원천 {d.source_sha256}<br/>지표 {d.factors_sha256}<br/>보고서 {d.report_sha256}</small></details>
 </>}</section>;
}

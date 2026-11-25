import {useState} from 'react';
import {HIGH_RETURN_PROFILES} from './high-return-profiles-data';
import {RECENT_ASOF} from './recent-pattern-data';
import {patternLabel} from './research-pattern-label';
type Stats={n:number;dates:number;stocks:number;hits:number;hit_pct:number|null;median_return_pct:number|null};
type State='HOLDOUT_AGREES_EXPLORATORY'|'HOLDOUT_DISAGREES'|'INSUFFICIENT_HOLDOUT';
type Profile={window:number;horizon:number;outcome:'CLOSE'|'HIGH';target_pct:number;pattern:string;feature:string;value:string;status:State;train:Stats;train_control:Stats;train_lift_pp:number;holdout:Stats;holdout_control:Stats;holdout_lift_pp:number|null};
type Data={asof:string;available_sessions:number;windows:{window:number;actual_sessions:number;covered_sessions:number;train_sessions:number;holdout_sessions:number}[];rows:Profile[];coverage:{window:number;horizon:number;outcome:string;target_pct:number;status:State;total:number;published:number}[];source_rows:number;published_rows:number;cap_per_group:number};
const stateLabels:Record<State,string>={HOLDOUT_AGREES_EXPLORATORY:'후속 방향 일치 · 탐색',HOLDOUT_DISAGREES:'후속 불일치',INSUFFICIENT_HOLDOUT:'후속 표본 부족'};
const labels:Record<string,string>={CANDLE:'캔들 형태',BODY:'몸통 비율',CLOSE_POSITION:'종가 위치',MARKET:'시장 폭',AMOUNT_ABSOLUTE:'신호일 거래대금',AMOUNT_5:'5일 평균 거래대금 대비',AMOUNT_10:'10일 평균 거래대금 대비',AMOUNT_20:'20일 평균 거래대금 대비',RETURN_1:'전일 대비 수익률',RETURN_5:'직전 5일 수익률',RETURN_10:'직전 10일 수익률',RETURN_20:'직전 20일 수익률',PRIOR_20_HIGH_GAP:'20일 전고점까지 거리'};
const values:Record<string,string>={LT_5EOK:'5억 미만','5_50EOK':'5~50억','50_200EOK':'50~200억',GE_200EOK:'200억 이상',LT_NEG10:'-10% 미만',NEG10_NEG3:'-10~-3%',NEG3_0:'-3~0%','0_5':'0~5%','5_10':'5~10%',GE_10:'10% 이상',ABOVE_PRIOR_HIGH:'전고점 돌파',GAP_0_3:'0~3%',GAP_3_8:'3~8%',GAP_8_15:'8~15%',GAP_GE_15:'15% 이상'};
const fmt=(v:number|null)=>v==null?'—':v.toFixed(2)+'%';
const lift=(v:number|null)=>v==null?'—':(v>0?'+':'')+v.toFixed(2)+'%p';
export function currentHighReturn(){
 const d=HIGH_RETURN_PROFILES as Data|null;
 return d&&d.asof===RECENT_ASOF&&Array.isArray(d.rows)&&Array.isArray(d.coverage)&&Array.isArray(d.windows)?d:null;
}
function Comparison({title,a,b,delta}:{title:string;a:Stats;b:Stats;delta:number|null}){
 return <div className="hr-compare"><div className="rc-heading"><strong>{title}</strong><b className={delta==null?'':delta>0?'rc-up':'rc-down'}>{lift(delta)}</b></div>{([['특징 충족',a],['특징 미충족',b]] as const).map(([label,s],i)=><div key={label}><div className="hr-line"><span>{label}</span><b>{fmt(s.hit_pct)}</b></div><div className="hr-track"><div style={{width:(s.hit_pct??0)+'%',background:i===0?'#c04436':'#4779ba'}}/></div><small>목표 도달 {s.hits}/{s.n}건 · {s.dates}일 · {s.stocks}종목</small></div>)}</div>;
}
export default function HighReturnProfiles(){
 const [w,setW]=useState(28),[h,setH]=useState(3),[target,setTarget]=useState(10),[outcome,setOutcome]=useState<'CLOSE'|'HIGH'>('CLOSE'),[status,setStatus]=useState<State>('HOLDOUT_AGREES_EXPLORATORY'),[q,setQ]=useState(''),[limit,setLimit]=useState(10);
 const d=currentHighReturn();
 const meta=d?.windows.find(x=>x.window===w);
 const bucket=d?.coverage.find(x=>x.window===w&&x.horizon===h&&x.outcome===outcome&&x.target_pct===target&&x.status===status);
 const rows=(d?.rows??[]).filter(r=>r.window===w&&r.horizon===h&&r.outcome===outcome&&r.target_pct===target&&r.status===status&&(!q||patternLabel(r.pattern).toLowerCase().includes(q.toLowerCase())||r.pattern.toLowerCase().includes(q.toLowerCase())));
 const reset=()=>setLimit(10);
 return <section className="rc-section">
 <h2>고수익 종목 특성</h2><small>같은 패턴 안에서 추가 특징이 있는 사례와 없는 사례의 목표 도달률을 비교합니다.</small>
 {!d?<p className="rc-note">고수익 특성 집계 게시 대기 또는 기준일 불일치 · 수치를 추정하지 않습니다.</p>:<>
 <small>{d.asof} 기준 · 전체 연구 {d.source_rows.toLocaleString()}건 / 게시 {d.published_rows.toLocaleString()}건</small>
 <div className="rc-filter"><label>연구 구간<select value={w} onChange={e=>{setW(Number(e.target.value));reset();}}><option value={28}>최근 28관측일</option><option value={60}>최근 60관측일</option></select></label><label>성과 기간<select value={h} onChange={e=>{setH(Number(e.target.value));reset();}}>{[1,2,3,5,10,20].map(n=><option key={n} value={n}>{n}일</option>)}</select></label><label>상승 목표<select value={target} onChange={e=>{setTarget(Number(e.target.value));reset();}}><option value={10}>+10%</option><option value={20}>+20%</option></select></label><label>성과 기준<select value={outcome} onChange={e=>{setOutcome(e.target.value as 'CLOSE'|'HIGH');reset();}}><option value="CLOSE">기간 종료 종가</option><option value="HIGH">기간 내 고가</option></select></label><label>검증 상태<select value={status} onChange={e=>{setStatus(e.target.value as State);reset();}}>{Object.entries(stateLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>패턴 찾기<input value={q} onChange={e=>{setQ(e.target.value);reset();}} placeholder="엔벨20, ENV20 등"/></label></div>
 {meta&&<p className="rc-note">실제 관측일 {meta.actual_sessions} / 신호 감사 {meta.covered_sessions} · 발굴 {meta.train_sessions}일 / 후속 {meta.holdout_sessions}일</p>}
 <small>선택 구간 전체 {bucket?.total??0}건 · 게시 {bucket?.published??0}건 · 검색 일치 {rows.length}건{bucket&&bucket.total>bucket.published?' · 상위 '+d.cap_per_group+'건만 게시':''}</small>
 {!rows.length&&<p>선택한 상태의 게시 결과가 없습니다. 후속 표본 부족 또는 다른 기간을 확인하세요.</p>}
 {rows.slice(0,limit).map(r=><article className="rc-profit-row" key={r.pattern+'|'+r.feature+'|'+r.value}><strong>{patternLabel(r.pattern)}</strong><p className="hr-feature">{labels[r.feature]??r.feature} · {values[r.value]??patternLabel(r.value)}</p><small>{stateLabels[r.status]}</small><Comparison title="발굴 구간" a={r.train} b={r.train_control} delta={r.train_lift_pp}/><Comparison title="후속 구간" a={r.holdout} b={r.holdout_control} delta={r.holdout_lift_pp}/></article>)}
 {rows.length>limit&&<button className="rc-action" type="button" onClick={()=>setLimit(v=>v+10)}>10건 더 보기</button>}
 </>}
 <p className="rc-note">고가는 도달 관측이지 체결 수익이 아닙니다. 미확인 특징은 양쪽 비교군에서 제외합니다. 날짜별 대조군 매칭·수정주가·거래일 연속성·비용·독립 실전 검증은 미완료입니다. 후속 표본 부족이나 불일치 조건을 추천으로 승격하지 않습니다.</p>
 </section>;
}

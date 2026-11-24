import {patternLabel} from './research-pattern-label';
import './adaptive-research.css';
import {useState} from 'react';
import {RADAR_DATA,RADAR_HISTORY} from './adaptive-radar-data';
type Perf={horizon:number;sample_count:number;unobserved:number;positive_pct:number|null;median_pct:number|null};
type Row={pattern:string;events:number;frequency_delta:number|null;events_per_session:number|null;performance:Perf[]};
type Window={requested_sessions:number;actual_sessions:number;prior_sessions:number;rows:Row[]};
type History={asof:string;previous_asof:string|null;changes:{group:string;pattern:string;horizon:number;status:string;rate_delta_pp:number|null}[]};
const labels:Record<string,string>={NEW:'신규',REMOVED:'해제',STRENGTHENED:'강화',WEAKENED:'약화',MAINTAINED:'유지'};
export default function AdaptiveRadar(){
 const [w,setW]=useState(5),[h,setH]=useState(3),[tab,setTab]=useState<'market'|'history'>('market'),[day,setDay]=useState('');
 const data=RADAR_DATA as {asof:string;windows:Window[]}|null;
 const history=RADAR_HISTORY as History[];
 const selected=data?.windows.find(x=>x.requested_sessions===w);
 const rows=[...(selected?.rows??[])].sort((a,b)=>(b.frequency_delta??-Infinity)-(a.frequency_delta??-Infinity));
 const record=history.find(x=>x.asof===day)??history[0];
 const fmt=(v:number|null|undefined)=>v==null?'미확인':v.toFixed(2)+'%';
 return <div className="r15106-search-pattern-evidence blue-research">
 <div style={{display:'flex',gap:6}}><button type="button" aria-pressed={tab==='market'} onClick={()=>setTab('market')}>시장 변화</button><button type="button" aria-pressed={tab==='history'} onClick={()=>setTab('history')}>추천 변경 이력</button></div>
 {tab==='market'?<>
 <small>{data?data.asof+' 기준':'연구 데이터 게시 대기'}</small>
 <strong>최근 며칠 동안 어떤 신호가 늘었나요?</strong>
 <div className="blue-periods">{[3,5,10,20,28,60].map(n=><button key={n} type="button" aria-pressed={w===n} onClick={()=>{setW(n);if(h>=n)setH(n===3?1:3);}}>{n}일</button>)}</div>
 <label>신호 발생 후 <select value={h} onChange={e=>setH(Number(e.target.value))}>{[1,2,3,5,10,20].filter(n=>n<w).map(n=><option key={n} value={n}>{n}거래일</option>)}</select> 성과</label>
 {selected&&<div className="blue-note">최근 {selected.actual_sessions}일과 직전 {selected.prior_sessions}일 자료입니다. {selected.prior_sessions<w?'동일 기간 비교 자료가 부족합니다.':'출현 증가가 곧 상승을 의미하지는 않습니다.'}</div>}
 {rows.map(r=>{const p=r.performance.find(x=>x.horizon===h);const delta=r.frequency_delta;const mature=!!p&&p.sample_count>0;const weak=!!p&&p.sample_count>=30&&p.positive_pct!==null&&p.positive_pct<50&&p.median_pct!==null&&p.median_pct<0;return <div key={r.pattern} className="blue-research-card"><strong>{patternLabel(r.pattern)}</strong><p>{delta==null?'직전 기간 비교 자료 부족':delta>0?'하루 평균 '+delta.toFixed(1)+'건 더 발생':delta<0?'하루 평균 '+Math.abs(delta).toFixed(1)+'건 감소':'출현 빈도 변화 없음'} · 총 {r.events}건</p><div className="blue-metrics"><div className="blue-metric"><small>상승 관측률</small><b>{fmt(p?.positive_pct)}</b></div><div className="blue-metric"><small>중앙 수익률</small><b>{fmt(p?.median_pct)}</b></div><div className="blue-metric"><small>확인 표본</small><b>{p?.sample_count??0}건</b></div></div><p>{!mature?'아직 결과를 확인할 수 있는 표본이 없습니다.':weak?'확인된 표본의 상승 성과가 부진합니다. 반등을 단정하기 어렵습니다.':p.sample_count<30?'확인 표본이 적어 판단을 보류합니다.':'확인된 과거 성과를 참고하되 향후 상승을 보장하지 않습니다.'}</p><small>결과 미확인 {p?.unobserved??0}건</small></div>})}
 </>:<>
 <strong>추천 조건이 어떻게 바뀌었나요?</strong>
 {record?<><label>연구 날짜 <select value={record.asof} onChange={e=>setDay(e.target.value)}>{history.map(d=><option key={d.asof}>{d.asof}</option>)}</select></label><p className="blue-note">{record.previous_asof?record.previous_asof+' 연구와 비교한 결과입니다.':'최초 연구 저장일입니다. 아직 이전 연구와 비교할 수 없습니다.'}</p>{record.changes.filter(r=>r.status!=='MAINTAINED').map(r=><div className="blue-research-card" key={r.group+'|'+r.pattern+'|'+r.horizon}><strong>{labels[r.status]??r.status} · {patternLabel(r.pattern)}</strong><small>{r.horizon}일 성과 · 상승 관측률 변화 {r.rate_delta_pp==null?'비교 불가':r.rate_delta_pp.toFixed(2)+'%p'}</small></div>)}{record.previous_asof&&!record.changes.some(r=>r.status!=='MAINTAINED')&&<p>변경된 추천 조건이 없습니다.</p>}</>:<p>저장된 연구 이력이 없습니다.</p>}
 </>}
 <small>탐색적 과거 관측 결과이며 미래 확률이 아닙니다.</small>
 </div>;
}

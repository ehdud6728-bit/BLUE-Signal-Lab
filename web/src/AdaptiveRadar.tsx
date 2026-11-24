import './adaptive-research.css';
import {useState} from 'react';
import {RADAR_DATA,RADAR_HISTORY} from './adaptive-radar-data';
type Perf={horizon:number;sample_count:number;unobserved:number;positive_pct:number|null;median_pct:number|null};
type Row={pattern:string;events:number;frequency_delta:number|null;events_per_session:number|null;performance:Perf[]};
type Window={requested_sessions:number;actual_sessions:number;prior_sessions:number;rows:Row[]};
type History={asof:string;previous_asof:string|null;changes:{group:string;pattern:string;horizon:number;status:string;rate_delta_pp:number|null}[]};
const labels:Record<string,string>={NEW:'신규',REMOVED:'해제',STRENGTHENED:'강화',WEAKENED:'약화',MAINTAINED:'유지'};
export default function AdaptiveRadar(){
 const [w,setW]=useState(5),[h,setH]=useState(3);
 const data=RADAR_DATA as {asof:string;windows:Window[]}|null;
 const history=RADAR_HISTORY as History[];
 const selected=data?.windows.find(x=>x.requested_sessions===w);
 const rows=[...(selected?.rows??[])].sort((a,b)=>(b.frequency_delta??-Infinity)-(a.frequency_delta??-Infinity));
 return <details className="r15106-search-pattern-evidence blue-research"><summary>시장 변화 레이더 · 추천 변경 이력</summary>
 <small>{data?data.asof+' 기준 · 검증 일봉':'연구 데이터 게시 대기'}</small>
 <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>{[3,5,10,20,28,60].map(n=><button key={n} type="button" aria-pressed={w===n} onClick={()=>setW(n)}>{n}일</button>)}</div>
 <label>성과 기간 <select value={h} onChange={e=>setH(Number(e.target.value))}>{[1,2,3,5,10,20].map(n=><option key={n} value={n}>{n}일</option>)}</select></label>
 {selected&&<small>확보 {selected.actual_sessions}/{w}일 · 직전 {selected.prior_sessions}/{w}일</small>}
 {rows.map(r=>{const p=r.performance.find(x=>x.horizon===h);const label=r.frequency_delta===null?'비교 기간 부족':r.frequency_delta>0&&p&&p.sample_count>=30&&p.positive_pct!==null&&p.median_pct!==null?(p.positive_pct>=70&&p.median_pct>0?'강세 관찰':p.positive_pct<50&&p.median_pct<0?'하락 위험 관찰':'출현 증가'):'관찰';return <div key={r.pattern} className="blue-research-card"><strong>{r.pattern} · {label}</strong><small>출현 {r.events}건 · 일평균 변화 {r.frequency_delta??'비교 불가'}</small><small>상승 {p?.positive_pct??'미확인'}% · 중앙 {p?.median_pct??'미확인'}% · 표본 {p?.sample_count??0}건 · 결과 미확인 {p?.unobserved??0}건</small></div>})}
 <small>관찰 분류는 탐색적 기준이며 추천이나 미래 확률이 아닙니다.</small>
 <details><summary>날짜별 추천 변경 이력</summary>{history.length===0&&<small>게시된 이력 없음</small>}{history.map(d=><details key={d.asof}><summary>{d.asof} · {d.previous_asof?'변경 '+d.changes.filter(r=>r.status!=='MAINTAINED').length+'건':'최초 저장'}</summary>{d.changes.map(r=><div className="blue-research-card" key={r.group+'|'+r.pattern+'|'+r.horizon}><strong>{labels[r.status]??r.status} · {r.pattern} · {r.horizon}일</strong><small>상승 관측률 변화 {r.rate_delta_pp===null?'비교 불가':r.rate_delta_pp+'%p'}</small></div>)}</details>)}</details>
 </details>;
}

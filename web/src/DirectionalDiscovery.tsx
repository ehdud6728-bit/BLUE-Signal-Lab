import {useState} from 'react';
import {DIRECTIONAL_DISCOVERY} from './directional-discovery-data';
import {patternLabel} from './research-pattern-label';
type Stats={n:number;dates:number;stocks:number;up_pct:number|null;median_pct:number|null;loss_5_pct:number|null};
type Row={window:number;actual_sessions:number;covered_sessions:number;train_sessions:number;holdout_sessions:number;horizon:number;pattern:string;direction:'UPSIDE'|'DOWNSIDE';train:Stats;train_base:Stats;holdout:Stats;holdout_base:Stats;holdout_lift_pp:number|null;status:string};
const fmt=(v:number|null)=>v==null?'—':v.toFixed(2)+'%';
const status:Record<string,string>={HOLDOUT_AGREES_EXPLORATORY:'후속 구간 방향 일치',HOLDOUT_DISAGREES:'후속 구간 불일치',INSUFFICIENT_HOLDOUT:'후속 검증 부족'};
export default function DirectionalDiscovery(){
 const data=DIRECTIONAL_DISCOVERY as {asof:string;available_sessions:number;rows:Row[]}|null;
 const [direction,setDirection]=useState<'UPSIDE'|'DOWNSIDE'>('UPSIDE'),[w,setW]=useState(28),[h,setH]=useState(3),[filter,setFilter]=useState('all'),[limit,setLimit]=useState(20);
 if(!data)return <p className="blue-note">방향성 연구 실행 및 게시 대기 중입니다.</p>;
 const windows=[...new Set(data.rows.map(r=>r.window))].sort((a,b)=>a-b);
 const selected=windows.includes(w)?w:windows[windows.length-1];
 const rows=data.rows.filter(r=>r.window===selected&&r.horizon===h&&r.direction===direction);
 const visible=rows.filter(r=>filter==='all'||r.status===filter).sort((a,b)=>Math.abs(b.train.up_pct!-b.train_base.up_pct!)-Math.abs(a.train.up_pct!-a.train_base.up_pct!));
 const meta=data.rows.find(r=>r.window===selected);
 return <section className="blue-research">
 <strong>상승·하락 복합 조건 발굴</strong><small>{data.asof} 기준 · 확보 일봉 {data.available_sessions}거래일</small>
 <div className="blue-filter-grid"><button type="button" aria-pressed={direction==='UPSIDE'} onClick={()=>{setDirection('UPSIDE');setLimit(20)}}>상승 유리</button><button type="button" aria-pressed={direction==='DOWNSIDE'} onClick={()=>{setDirection('DOWNSIDE');setLimit(20)}}>하락 위험</button></div>
 <div className="blue-periods">{windows.map(n=><button key={n} type="button" aria-pressed={selected===n} onClick={()=>{setW(n);setLimit(20)}}>{n}일</button>)}</div>
 <div className="blue-filter-grid"><label>성과 기간<select value={h} onChange={e=>{setH(Number(e.target.value));setLimit(20)}}>{[1,2,3,5,10,20].map(n=><option key={n} value={n}>{n}일</option>)}</select></label><label>검증 상태<select value={filter} onChange={e=>{setFilter(e.target.value);setLimit(20)}}><option value="all">전체</option>{Object.entries(status).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
 {meta&&<p className="blue-note">실제 {meta.actual_sessions}일 · 신호 감사 {meta.covered_sessions}일 · 발굴 {meta.train_sessions}일 / 후속 {meta.holdout_sessions}일</p>}
 <small>조건 {visible.length}건 · 후속 방향 일치 {rows.filter(r=>r.status==='HOLDOUT_AGREES_EXPLORATORY').length}건</small>
 {!visible.length&&<p>선택 조건의 발굴 결과가 없습니다. 기간이나 검증 상태를 변경해 보세요.</p>}
 {visible.slice(0,limit).map(r=><div className="blue-research-card" key={r.pattern}><strong>{patternLabel(r.pattern)}</strong><small>{status[r.status]??r.status}</small>
 {([['발굴 구간',r.train,r.train_base],['후속 구간',r.holdout,r.holdout_base]] as const).map(([label,s,b])=><div key={label}><small>{label} · 조건 외 기본 패턴 상승률 {fmt(b.up_pct)}</small><div className="blue-metrics">{[['상승 관측률',fmt(s.up_pct)],['중앙 수익률',fmt(s.median_pct)],['표본',s.n+'건']].map(([k,v])=><div className="blue-metric" key={k}><small>{k}</small><b>{v}</b></div>)}</div><small>발생일 {s.dates}일 · 종목 {s.stocks}개 · 5% 이상 종가 손실 {fmt(s.loss_5_pct)}</small></div>)}
 <small>후속 상승률 차이 {r.holdout_lift_pp==null?'—':r.holdout_lift_pp.toFixed(2)+'%p'}</small></div>)}
 {visible.length>limit&&<button type="button" onClick={()=>setLimit(n=>n+20)}>20건 더 보기</button>}
 <p className="blue-note">조건 외 기본 패턴과 비교합니다. 날짜·종목 매칭 대조군은 아니며 중복 표본, 다중 검정, 거래일 및 기업행사 검증 한계가 있습니다. 자동 추천 승격은 하지 않습니다.</p>
 </section>;
}

import React,{useEffect,useState} from 'react';
import{createRoot}from'react-dom/client';
import{Search,CalendarRange,BarChart3,AlertCircle}from'lucide-react';
import './style.css';
const API=import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev';
type Signal={code:string;name:string|null;day:string;signals:string[];close_price:number|null;supply_distance_pct:number|null;extras:Record<string,unknown>};
type Day={day:string;observed_stocks:number;signal_events:number;matched_stocks:number};
const tags=['BB20','BB30','BB40','ENV20','ENV40'];
const todayKST=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function App(){
 const [mode,setMode]=useState<'single'|'range'>('single');
 const [date,setDate]=useState(todayKST());const [start,setStart]=useState(todayKST());const [end,setEnd]=useState(todayKST());
 const [latest,setLatest]=useState<string|null>(null);const [signals,setSignals]=useState<string[]>(tags);const [logic,setLogic]=useState('any');
 const [rows,setRows]=useState<Signal[]>([]),[days,setDays]=useState<Day[]>([]),[total,setTotal]=useState<number|null>(null),[page,setPage]=useState(1);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState<Signal|null>(null),[status,setStatus]=useState('');
 useEffect(()=>{fetch(API+'api/dates').then(async r=>{if(!r.ok)throw Error('API response '+r.status);return r.json()}).then(d=>{if(d.latest){setLatest(d.latest);setDate(d.latest);setStart(d.latest);setEnd(d.latest)}}).catch(()=>setError('검색 가능 날짜 확인 실패 — API 배포 및 D1 상태를 확인하세요.'))},[]);
 async function search(p=1){setBusy(true);setError('');setStatus('');try{
  const u=new URL(API+'/api/search');u.searchParams.set('mode',mode);
  if(mode==='single')u.searchParams.set('date',date);else{u.searchParams.set('start',start);u.searchParams.set('end',end)}
  u.searchParams.set('signals',signals.join(','));u.searchParams.set('logic',logic);u.searchParams.set('page',String(p));
  const r=await fetch(u);const d=await r.json();if(!r.ok)throw Error(d.error||'검색 오류');
  setRows(d.items||[]);setDays(d.daily_counts||[]);setTotal(d.total);setPage(p);setSelected(null);
  if(d.data_status==='NOT_IMPORTED')setStatus('해당 날짜의 분석 결과가 아직 저장되지 않았습니다. 검색 결과 0종목을 의미하지 않습니다.');
 }catch(e){setError(String(e));setRows([]);setDays([]);setTotal(null)}finally{setBusy(false)}}
 const selectedName=(r:Signal)=>r.name||String(r.extras?.name||r.extras?.Name||'종목명 미등록');
 const profileLabel=(r:Signal)=>r.supply_distance_pct==null?'미계산':r.supply_distance_pct.toFixed(2)+'% (일봉 추정)';
 return <div className="shell">
  <header><div><p className="eyebrow">STOCK-HUNTER / INDEPENDENT RESEARCH</p><h1>BLUE <span>Signal Lab</span></h1><p className="sub">날짜만 선택하면 내부에서 데이터셋을 자동 선택합니다.</p></div><div className="pill">RESEARCH ONLY · R0.6</div></header>
  <main><aside className="panel"><h2><Search size={18}/> 검색 조건</h2>
   <p className="small">저장된 최신 거래일: <strong>{latest||'확인 중'}</strong></p>
   <label>검색 방법</label><div className="switch"><button className={mode==='single'?'active':''} onClick={()=>setMode('single')}>지정 날짜</button><button className={mode==='range'?'active':''} onClick={()=>setMode('range')}>기간 검색</button></div>
   {mode==='single'?<><label>검색 날짜</label><input type="date" value={date} onChange={e=>setDate(e.target.value)}/></>:<><label>시작일</label><input type="date" value={start} onChange={e=>setStart(e.target.value)}/><label>종료일</label><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></>}
   <label>기술 신호</label><div className="checks">{tags.map(t=><label className="check" key={t}><input type="checkbox" checked={signals.includes(t)} onChange={()=>setSignals(a=>a.includes(t)?a.filter(s=>s!==t):[...a,t])}/>{t.replace('BB','BLUE')}</label>)}</div>
   <label>신호 조합</label><select value={logic} onChange={e=>setLogic(e.target.value)}><option value="any">하나라도 충족 (OR)</option><option value="all">모두 충족 (AND)</option></select>
   <button className="primary" disabled={busy} onClick={()=>search(1)}>{busy?'조회 중…':'날짜로 검색'}</button>
   <p className="small">검색은 저장된 분석 결과를 조회합니다. 미분석 날짜를 새로 계산하는 웹 실행 기능은 별도 구현 예정입니다.</p>
  </aside><section className="content"><div className="stats"><div className="metric"><span>검색 결과</span><strong>{total==null?'—':total.toLocaleString()}</strong><small>종목·날짜 신호</small></div><div className="metric"><span>검색 거래일</span><strong>{total==null?'—':days.length}</strong><small>분석 결과가 있는 날짜 수</small></div><div className="metric"><span>저장된 최신 기준일</span><strong className="smallnum">{latest||'미확인'}</strong><small>실시간 시세 아님</small></div></div>
   {error&&<div className="notice error"><AlertCircle size={16}/>{error}</div>}{status&&<div className="notice"><AlertCircle size={16}/>{status}</div>}
   <div className="panel result"><h2><BarChart3 size={18}/> 검색된 종목 <small>{total==null?'아직 검색하지 않음':`${total}건`}</small></h2><div className="tablewrap"><table><thead><tr><th>날짜</th><th>종목명 / 코드</th><th>신호</th><th>종가</th><th>상단 매물대 거리</th></tr></thead><tbody>
   {rows.length?rows.map((r,i)=><tr key={`${r.code}-${r.day}-${i}`} onClick={()=>setSelected(r)} className="clickable"><td>{r.day}</td><td><b>{selectedName(r)}</b><div className="small">{r.code}</div></td><td>{r.signals.map(s=><span className="tag" key={s}>{s.replace('BB','BLUE')}</span>)}</td><td>{r.close_price?.toLocaleString()??'—'}</td><td>{profileLabel(r)}</td></tr>):<tr><td className="empty" colSpan={5}>조회된 종목이 없습니다. 검색 조건과 데이터 보유 여부를 확인하세요.</td></tr>}
   </tbody></table></div>{total!==null&&total>100&&<div className="pager"><button disabled={page===1} onClick={()=>search(page-1)}>이전</button><span>{page} / {Math.ceil(total/100)}</span><button disabled={page>=Math.ceil(total/100)} onClick={()=>search(page+1)}>다음</button></div>}</div>
   {selected&&<div className="panel detail"><h2>{selectedName(selected)} ({selected.code}) · {selected.day}</h2><p>발생 신호: {selected.signals.join(', ')}</p><p>일봉 추정 상단 매물대 거리: {profileLabel(selected)}</p><div className="notice"><AlertCircle size={16}/> 일봉 추정 매물대는 실제 체결가별 매물대가 아니며, 검증된 차트가 아닙니다. 실제 OHLCV 차트는 추가 데이터 연동이 필요합니다.</div></div>}
   {days.length>0&&<div className="panel"><h2><CalendarRange size={18}/> 날짜별 요약</h2><div className="tablewrap"><table><thead><tr><th>날짜</th><th>데이터 관측 종목</th><th>신호 건수</th><th>신호 종목</th></tr></thead><tbody>{days.map(d=><tr key={d.day}><td>{d.day}</td><td>{d.observed_stocks}</td><td>{d.signal_events}</td><td>{d.matched_stocks}</td></tr>)}</tbody></table></div></div>}
  </section></main><footer>연구 전용 · 데이터 기준일과 검증 상태 확인 필수 · 투자 권유 아님</footer>
 </div>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

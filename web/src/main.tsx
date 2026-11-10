import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Search, CalendarRange, BarChart3, AlertCircle, RefreshCw, Play} from 'lucide-react';
import './style.css';

// Important: normalize exactly once. All paths below begin with ONE slash.
const API = (import.meta.env.VITE_API_BASE ||
  'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/, '');

type Signal = {code:string;name:string|null;day:string;signals:string[];
  close_price:number|null;supply_distance_pct:number|null;extras:Record<string,unknown>};
type Day = {day:string;observed_stocks:number;signal_events:number;matched_stocks:number};
type ScanStatus = 'READY'|'NOT_IMPORTED'|'PENDING'|'FAILED'|'';
const tags = ['BB20','BB30','BB40','ENV20','ENV40'];
const todayKST = () => new Intl.DateTimeFormat('en-CA',
  {timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

function App() {
  const [mode,setMode] = useState<'single'|'range'>('single');
  const [date,setDate] = useState(todayKST());
  const [start,setStart] = useState(todayKST());
  const [end,setEnd] = useState(todayKST());
  const [latest,setLatest] = useState<string|null>(null);
  const [signals,setSignals] = useState<string[]>(tags);
  const [logic,setLogic] = useState('any');
  const [rows,setRows] = useState<Signal[]>([]);
  const [days,setDays] = useState<Day[]>([]);
  const [total,setTotal] = useState<number|null>(null);
  const [page,setPage] = useState(1);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [selected,setSelected] = useState<Signal|null>(null);
  const [status,setStatus] = useState('');
  const [dataStatus,setDataStatus] = useState<ScanStatus>('');
  const [adminKey,setAdminKey] = useState(''); // Memory only; never bundled, persisted or logged.
  const [requestBusy,setRequestBusy] = useState(false);
  const [watchDate,setWatchDate] = useState('');
  const [scanInfo,setScanInfo] = useState('');
  const [actionsUrl,setActionsUrl] = useState('');

  async function loadDates() {
    const r = await fetch(API+'/api/dates');
    if (!r.ok) throw new Error(`날짜 API 오류: ${r.status}`);
    const d = await r.json();
    if (d.latest) {
      setLatest(d.latest);
      // Never change the user's selected date during a background refresh.
      return d.latest as string;
    }
    return null;
  }
  useEffect(() => {
    loadDates().then(d => {
      if(d) {setDate(d);setStart(d);setEnd(d);}
    }).catch(e=>setError(`검색 가능 날짜 확인 실패: ${String(e)}`));
  }, []);

  async function search(p=1) {
    setBusy(true);setError('');setStatus('');
    try {
      const u = new URL(API+'/api/search');
      u.searchParams.set('mode',mode);
      if(mode === 'single') u.searchParams.set('date',date);
      else {u.searchParams.set('start',start);u.searchParams.set('end',end);}
      u.searchParams.set('signals',signals.join(','));
      u.searchParams.set('logic',logic);
      u.searchParams.set('page',String(p));
      const r=await fetch(u);
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||`검색 오류: ${r.status}`);
      setRows(d.items||[]);setDays(d.daily_counts||[]);
      setTotal(d.total);setPage(p);setSelected(null);
      setDataStatus(d.data_status||'');
      if(d.data_status==='NOT_IMPORTED') {
        setStatus('해당 날짜의 분석 결과가 저장되지 않았습니다. 0종목이 아니라 미분석 상태입니다.');
      }
    } catch(e) {
      setError(String(e));setRows([]);setDays([]);setTotal(null);setDataStatus('');
    } finally {setBusy(false);}
  }

  async function requestScan() {
    if (mode !== 'single' || !date || !adminKey) return;
    setRequestBusy(true);setError('');setScanInfo('');
    try {
      const r = await fetch(API+'/api/scan', {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Scan-Key':adminKey},
        body:JSON.stringify({date}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `분석 요청 실패: ${r.status}`);
      setActionsUrl(d.actions_url||'');
      if(d.status==='READY') {
        setScanInfo('이미 분석된 날짜입니다. 결과를 다시 조회합니다.');
        await search(1);
      } else {
        setScanInfo(d.deduplicated?'이미 진행 중인 분석입니다.':'GitHub Actions 분석 요청을 접수했습니다.');
        setWatchDate(date);
      }
    } catch(e) {setError(String(e));}
    finally {setRequestBusy(false);}
  }

  useEffect(() => {
    if(!watchDate) return;
    let cancelled=false;
    async function poll() {
      try {
        const r=await fetch(API+'/api/scan/status?date='+encodeURIComponent(watchDate), {
          headers:{'X-Scan-Key':adminKey},
        });
        const d=await r.json();
        if(!r.ok) throw new Error(d.error||`상태 조회 오류 ${r.status}`);
        if(cancelled) return;
        if(d.actions_url) setActionsUrl(d.actions_url);
        if(d.status==='READY') {
          setWatchDate('');setScanInfo('D1 등록이 완료됐습니다. 검색 결과를 갱신합니다.');
          await loadDates().catch(()=>null);
          await search(1);
        } else if(d.status==='FAILED') {
          setWatchDate('');setScanInfo('분석 실패: '+(d.reason||'Actions 실행 기록을 확인하세요.'));
        } else if(d.status==='PENDING') {
          setScanInfo('분석 및 D1 등록 진행 중입니다. 이 페이지에서 완료 상태를 확인합니다.');
        }
      } catch(e) {if(!cancelled) setScanInfo('상태 확인 오류: '+String(e));}
    }
    void poll();
    const timer=window.setInterval(()=>{void poll();},8000);
    return ()=>{cancelled=true;window.clearInterval(timer);};
  },[watchDate]);

  const displayName=(r:Signal)=>r.name||String(r.extras?.name||r.extras?.Name||'종목명 미등록');
  const profile=(r:Signal)=>r.supply_distance_pct==null?'미계산':r.supply_distance_pct.toFixed(2)+'% (일봉 추정)';
  const flip=(t:string)=>setSignals(a=>a.includes(t)?a.filter(s=>s!==t):[...a,t]);

  return <div className="shell">
    <header><div><p className="eyebrow">INDEPENDENT RESEARCH · KOSPI + KOSDAQ</p>
      <h1>BLUE <span>Signal Lab</span></h1>
      <p className="sub">날짜 기반 검색 · 종목명 · 일봉 추정 매물대 · 관리자 분석 요청</p></div>
      <div className="pill">RESEARCH ONLY · R0.7</div></header>
    <main><aside className="panel">
      <h2><Search size={18}/> 검색 조건</h2>
      <p className="small">저장된 최신 거래일: <strong>{latest||'확인 중'}</strong></p>
      <label>검색 방법</label>
      <div className="switch">
        <button className={mode==='single'?'active':''} onClick={()=>setMode('single')}>지정 날짜</button>
        <button className={mode==='range'?'active':''} onClick={()=>setMode('range')}>기간 검색</button>
      </div>
      {mode==='single'?<><label>검색 날짜</label><input type="date" value={date} onChange={e=>{setDate(e.target.value);setDataStatus('');setWatchDate('');}}/></>:
      <><label>시작일</label><input type="date" value={start} onChange={e=>setStart(e.target.value)}/>
        <label>종료일</label><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></>}
      <label>기술 신호</label><div className="checks">
        {tags.map(t=><label className="check" key={t}><input type="checkbox" checked={signals.includes(t)} onChange={()=>flip(t)}/>{t.replace('BB','BLUE')}</label>)}
      </div>
      <label>신호 조합</label><select value={logic} onChange={e=>setLogic(e.target.value)}>
        <option value="any">하나라도 충족 (OR)</option><option value="all">모두 충족 (AND)</option>
      </select>
      <button className="primary" disabled={busy} onClick={()=>{void search(1);}}>{busy?'조회 중…':'날짜로 검색'}</button>
      <p className="small">저장된 결과는 바로 조회됩니다. 새 분석은 관리자 키가 있어야 실행됩니다.</p>
      {mode==='single' && dataStatus==='NOT_IMPORTED' && <div className="scan-box">
        <h2><Play size={16}/> 미분석 날짜 실행</h2>
        <p className="small">{date} 검색을 GitHub Actions에서 계산하고 D1에 저장합니다.</p>
        <label htmlFor="scan-admin-key">관리자 실행 키</label>
        <input id="scan-admin-key" type="password" value={adminKey}
          onChange={e=>setAdminKey(e.target.value)} autoComplete="off" placeholder="Cloudflare에 등록한 관리자 키"/>
        <button className="primary" disabled={requestBusy||!adminKey||!!watchDate} onClick={()=>{void requestScan();}}>
          <RefreshCw size={14} style={{verticalAlign:'middle',marginRight:5}}/>
          {requestBusy?'요청 중…':watchDate?'분석 진행 중':'이 날짜 분석 요청'}
        </button>
        <p className="small">키는 브라우저 메모리에만 보관하며 새로고침하면 사라집니다.</p>
      </div>}
    </aside>
    <section className="content">
      <div className="stats"><div className="metric"><span>검색 결과</span><strong>{total==null?'—':total.toLocaleString()}</strong><small>종목·날짜</small></div>
        <div className="metric"><span>검색 거래일</span><strong>{total==null?'—':days.length}</strong><small>분석 결과가 있는 날짜</small></div>
        <div className="metric"><span>최신 데이터 기준일</span><strong className="smallnum">{latest||'미확인'}</strong><small>실시간 시세 아님</small></div></div>
      {error&&<div className="notice error"><AlertCircle size={16}/>{error}</div>}
      {status&&<div className="notice"><AlertCircle size={16}/>{status}</div>}
      {scanInfo&&<div className="notice"><RefreshCw size={16}/><div>{scanInfo}
        {actionsUrl&&<div><a href={actionsUrl} target="_blank" rel="noreferrer">GitHub Actions 실행 결과 보기</a></div>}</div></div>}
      <div className="panel result"><h2><BarChart3 size={18}/> 검색된 종목 <small>{total==null?'검색 전':total+'건'}</small></h2>
        <div className="tablewrap"><table><thead><tr><th>날짜</th><th>종목명 / 코드</th><th>신호</th><th>종가</th><th>상단 매물대 거리</th></tr></thead><tbody>
          {rows.length?rows.map((r,i)=><tr key={`${r.code}-${r.day}-${i}`} onClick={()=>setSelected(r)} className="clickable">
            <td>{r.day}</td><td><b>{displayName(r)}</b><div className="small">{r.code}</div></td>
            <td>{r.signals.map(s=><span className="tag" key={s}>{s.replace('BB','BLUE')}</span>)}</td>
            <td>{r.close_price?.toLocaleString()??'—'}</td><td>{profile(r)}</td>
          </tr>):<tr><td className="empty" colSpan={5}>검색 조건과 저장된 거래일을 확인하세요.</td></tr>}
        </tbody></table></div>
        {total!==null&&total>100&&<div className="pager"><button disabled={page===1} onClick={()=>{void search(page-1);}}>이전</button>
          <span>{page} / {Math.ceil(total/100)}</span><button disabled={page>=Math.ceil(total/100)} onClick={()=>{void search(page+1);}}>다음</button></div>}
      </div>
      {selected&&<div className="panel detail"><h2>{displayName(selected)} ({selected.code}) · {selected.day}</h2>
        <p>발생 신호: {selected.signals.join(', ')}</p>
        <p>일봉 추정 상단 매물대 거리: {profile(selected)}</p>
        <div className="notice"><AlertCircle size={16}/> 일봉 매물대 추정치는 실제 체결가별 거래량이 아닙니다. Stock-Hunter 계산식과의 일치도도 미검증 상태입니다.</div>
      </div>}
      {days.length>0&&<div className="panel"><h2><CalendarRange size={18}/> 날짜별 요약</h2>
        <div className="tablewrap"><table><thead><tr><th>날짜</th><th>데이터 관측 종목</th><th>신호 건수</th><th>신호 종목</th></tr></thead>
          <tbody>{days.map(d=><tr key={d.day}><td>{d.day}</td><td>{d.observed_stocks}</td><td>{d.signal_events}</td><td>{d.matched_stocks}</td></tr>)}</tbody></table></div>
      </div>}
    </section></main>
    <footer>RESEARCH_ONLY · 실제 매매 주문 기능 없음 · 원천 데이터 지연 가능 · 투자 권유 아님</footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

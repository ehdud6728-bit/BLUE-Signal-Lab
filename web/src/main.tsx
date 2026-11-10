import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Search, CalendarRange, BarChart3, AlertCircle, RefreshCw} from 'lucide-react';
import './style.css';
import './r08.css';

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
  const [requestBusy,setRequestBusy] = useState(false);
  const [watchDate,setWatchDate] = useState('');
  const [scanInfo,setScanInfo] = useState('');
  const [actionsUrl,setActionsUrl] = useState('');

  async function loadDates() {
    const r = await fetch(API+'/api/dates', {credentials:'include'});
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
      const r=await fetch(u, {credentials:'include'});
      const d=await r.json();
      if(!r.ok) throw new Error(d.error||`검색 오류: ${r.status}`);
      setRows(d.items||[]);setDays(d.daily_counts||[]);
      setTotal(d.total);setPage(p);setSelected(null);
      setDataStatus(d.data_status||'');
      if(d.data_status==='NOT_IMPORTED') {
        if(mode === 'single') {
          setStatus('저장된 결과가 없어 GitHub Actions 분석을 자동 요청합니다.');
          await requestScan(date);
        } else {
          setStatus('기간 중 저장된 결과만 조회했습니다. 미분석 날짜의 일괄 실행은 지원하지 않습니다.');
        }
      }
    } catch(e) {
      setError(String(e));setRows([]);setDays([]);setTotal(null);setDataStatus('');
    } finally {setBusy(false);}
  }

  async function requestScan(day: string) {
    if (mode !== 'single' || !day) return;
    setRequestBusy(true);setError('');setScanInfo('');
    try {
      const r = await fetch(API+'/api/scan', {
        method:'POST',
        // text/plain is a CORS-safelisted POST. Access does not permit anonymous OPTIONS preflight.
        // The API still parses and validates the JSON body.
        headers:{'Content-Type':'text/plain;charset=UTF-8'},
        credentials:'include',
        body:JSON.stringify({date:day}),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `분석 요청 실패: ${r.status}`);
      setActionsUrl(d.actions_url||'');
      if(d.status==='READY') {
        setScanInfo('이미 분석된 날짜입니다. 결과를 다시 조회합니다.');
        await search(1);
      } else {
        setScanInfo(d.deduplicated?'이미 진행 중인 분석입니다.':'GitHub Actions 분석 요청을 접수했습니다.');
        setWatchDate(day);
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
          credentials:'include',
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
  const extra=(r:Signal,k:string):unknown=>r.extras?.[k];
  const num=(r:Signal,k:string):number|null=>{
    const v=extra(r,k);
    if(v==null || v==='') return null;
    const n=Number(v);
    return Number.isFinite(n)?n:null;
  };
  const fmt=(r:Signal,k:string,digits=2):string=>{
    const n=num(r,k);return n==null?'—':n.toLocaleString('ko-KR',{maximumFractionDigits:digits,minimumFractionDigits:digits});
  };
  const flag=(r:Signal,k:string):boolean=>extra(r,k)===true||['true','True','1'].includes(String(extra(r,k)));
  const present=(r:Signal,k:string):boolean=>extra(r,k)!==undefined && extra(r,k)!==null && extra(r,k)!=='';
  const crossed=(r:Signal,k:string):string=>!present(r,k)?'재분석 필요':flag(r,k)?'오늘 GC':'GC 없음';
  const lastCross=(r:Signal,k:string):string=>String(extra(r,k)||'확인되지 않음');
  const validLines=(r:Signal):Array<{signal:string;price:number;gap_from_close_pct:number;slope_pct:number|null;status:string}>=>{
    const x=extra(r,'valid_line_candidates_json');
    if(typeof x!=='string')return [];
    try {const d=JSON.parse(x);return Array.isArray(d)?d:[];}catch{return [];}
  };
  const supplyGrade=(r:Signal):string=>String(extra(r,'supply_strength_grade')||'재분석 필요');
  const flip=(t:string)=>setSignals(a=>a.includes(t)?a.filter(s=>s!==t):[...a,t]);

  return <div className="shell">
    <header><div><p className="eyebrow">INDEPENDENT RESEARCH · KOSPI + KOSDAQ</p>
      <h1>BLUE <span>Signal Lab</span></h1>
      <p className="sub">1인 전용 · 종가(EOD) 기준 검색 · 기술지표 연구 정보</p></div>
      <div className="pill">RESEARCH ONLY · R0.8</div></header>
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
      <p className="small">저장된 날짜는 즉시 조회하고 미분석 과거 거래일은 자동 분석합니다. 장중 현재가는 제공하지 않습니다.
        30분 단위 재분석은 장중 시세 공급원을 연결한 다음 적용합니다.</p>
    </aside>
    <section className="content">
      <div className="stats"><div className="metric"><span>검색 결과</span><strong>{total==null?'—':total.toLocaleString()}</strong><small>종목·날짜</small></div>
        <div className="metric"><span>검색 거래일</span><strong>{total==null?'—':days.length}</strong><small>분석 결과가 있는 날짜</small></div>
        <div className="metric"><span>최신 데이터 기준일</span><strong className="smallnum">{latest||'미확인'}</strong><small>실시간 시세 아님</small></div></div>
      {error&&<div className="notice error"><AlertCircle size={16}/>{error}</div>}
      {status&&<div className="notice"><AlertCircle size={16}/>{status}</div>}
      {scanInfo&&<div className="notice"><RefreshCw size={16}/><div>{scanInfo}
        {actionsUrl&&<div><a href={actionsUrl} target="_blank" rel="noreferrer">GitHub Actions 실행 결과 보기</a></div>}</div></div>}
      <div className="info-note">현재 결과는 일봉 종가 기준의 과거 시세를 이용합니다. RSI·Slow·MACD·유효선 후보·매물대 강도는 연구용 계산값이며, 장중 현재가 또는 실시간 신호가 아닙니다. 기존에 분석한 날짜는 R0.8로 한 번 재분석해야 신규 진단 항목이 표시됩니다.</div>
      <div className="panel result"><h2><BarChart3 size={18}/> 검색된 종목 <small>{total==null?'검색 전':total+'건'}</small></h2>
        <div className="tablewrap"><table><thead><tr><th>날짜</th><th>종목명 / 코드</th><th>신호</th><th>종가</th><th>RSI / GC</th><th>Slow(14,3,3) / GC</th><th>MACD / GC</th><th>돌파 기준선 후보</th><th>상단 매물대 거리·강도</th></tr></thead><tbody>
          {rows.length?rows.map((r,i)=><tr key={`${r.code}-${r.day}-${i}`} onClick={()=>setSelected(r)} className="clickable">
            <td>{r.day}</td><td><b>{displayName(r)}</b><div className="small">{r.code}</div></td>
            <td>{r.signals.map(s=><span className="tag" key={s}>{s.replace('BB','BLUE')}</span>)}</td>
            <td>{r.close_price?.toLocaleString()??'—'}</td>
            <td><span className={'mini-indicator '+(flag(r,'rsi_gc')?'up':'')}>{fmt(r,'rsi')}<small>{crossed(r,'rsi_gc')}</small></span></td>
            <td><span className={'mini-indicator '+(flag(r,'slow_14_3_3_gc')?'up':'')}>{fmt(r,'slow_14_3_3_k')} / {fmt(r,'slow_14_3_3_d')}<small>{crossed(r,'slow_14_3_3_gc')}</small></span></td>
            <td><span className={'mini-indicator '+(flag(r,'macd_gc')?'up':'')}>{fmt(r,'macd_12_26_9')}<small>{crossed(r,'macd_gc')}</small></span></td>
            <td>{present(r,'valid_line_candidates_json')?`${validLines(r).length}개 (상세 보기)`:'재분석 필요'}</td>
            <td><span className="mini-indicator">{profile(r)}<small>상대 강도: {supplyGrade(r)}</small></span></td>
          </tr>):<tr><td className="empty" colSpan={9}>검색 조건과 저장된 거래일을 확인하세요.</td></tr>}
        </tbody></table></div>
        {total!==null&&total>100&&<div className="pager"><button disabled={page===1} onClick={()=>{void search(page-1);}}>이전</button>
          <span>{page} / {Math.ceil(total/100)}</span><button disabled={page>=Math.ceil(total/100)} onClick={()=>{void search(page+1);}}>다음</button></div>}
      </div>
      {selected&&<div className="panel detail"><h2>{displayName(selected)} ({selected.code}) · {selected.day}</h2>
        <div className="study-tags">{selected.signals.map(s=><span key={s}>{s.replace('BB','BLUE')}</span>)}</div>
        <div className="info-grid">
          <div><strong>RSI (14) / Signal (9)</strong><p>{fmt(selected,'rsi')} / {fmt(selected,'rsi_signal')}</p><p>{crossed(selected,'rsi_gc')} · 최근 GC: {lastCross(selected,'rsi_last_gc')}</p></div>
          <div><strong>Slow Stochastic (14,3,3)</strong><p>%K {fmt(selected,'slow_14_3_3_k')} · %D {fmt(selected,'slow_14_3_3_d')}</p><p>{crossed(selected,'slow_14_3_3_gc')} · 최근 GC: {lastCross(selected,'slow_14_3_3_last_gc')}</p></div>
          <div><strong>MACD (12,26,9)</strong><p>MACD {fmt(selected,'macd_12_26_9')} · Signal {fmt(selected,'macd_signal_9')}</p><p>{crossed(selected,'macd_gc')} · 최근 GC: {lastCross(selected,'macd_last_gc')}</p></div>
          <div><strong>Slow (12,5,5)</strong><p>%K {fmt(selected,'slow_12_5_5_k')} · %D {fmt(selected,'slow_12_5_5_d')}</p><p>{crossed(selected,'slow_12_5_5_gc')} · 최근 GC: {lastCross(selected,'slow_12_5_5_last_gc')}</p></div>
          <div><strong>Slow (20,12,12)</strong><p>%K {fmt(selected,'slow_20_12_12_k')} · %D {fmt(selected,'slow_20_12_12_d')}</p><p>{crossed(selected,'slow_20_12_12_gc')} · 최근 GC: {lastCross(selected,'slow_20_12_12_last_gc')}</p></div>
          <div><strong>상단 매물대 (120봉 추정)</strong><p>현재 종가와 거리: {profile(selected)}</p><p>상대 강도: {supplyGrade(selected)} · {fmt(selected,'supply_strength_relative_pct')}%</p><p>추정 중심 가격: {fmt(selected,'supply_reference_price',0)}원</p></div>
        </div>
        <h2>돌파 기준선 후보 (연구용)</h2>
        {present(selected,'valid_line_candidates_json')?
          (validLines(selected).length?<ul className="study-list">{validLines(selected).map((l,i)=><li key={i}><strong>{l.signal.replace('BB','BLUE')}</strong> · 선 가격 {l.price.toLocaleString('ko-KR')}원 · 종가 대비 {l.gap_from_close_pct}% · 선 기울기 {l.slope_pct==null?'미계산':l.slope_pct+'%'}</li>)}</ul>
           :<p className="small">돌파 기준선 후보를 확인할 수 없습니다.</p>):
          <p className="small">기존 R0.7.2 저장 결과입니다. R0.8 분석으로 재실행하면 선 가격이 기록됩니다.</p>}
        <div className="notice"><AlertCircle size={16}/> 기준선은 당일 몸통 돌파에 사용된 계산선의 후보이며, 원본 Stock-Hunter의 검증된 ‘유효선’과 동일하지 않습니다. 매물 강도도 거래 체결가격별 실제 매물량이 아닌 이전 120봉의 대표가격 기반 상대 거래량 추정치입니다.</div>
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

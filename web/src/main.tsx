import StockChart from './StockChart';
import AiWidget from './AiWidget';
import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Search, CalendarDays, BarChart3, AlertCircle, RefreshCw, SlidersHorizontal, ListFilter, X, ChevronRight, Download, ArrowLeft, Activity, Clock3, Database, CheckCircle2} from 'lucide-react';
import './style.css';
import './r08.css';
import './mobile-pwa.css';
import './ai.css';

// Keep the existing production API and Cloudflare Access cookies.
const API = (import.meta.env.VITE_API_BASE || 'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/, '');
type Signal = {code:string;name:string|null;day:string;signals:string[];close_price:number|null;supply_distance_pct:number|null;extras:Record<string,unknown>};
type Day = {day:string;observed_stocks:number;signal_events:number;matched_stocks:number};
type ScanStatus = 'READY'|'NOT_IMPORTED'|'PENDING'|'FAILED'|'';
type Line = {signal:string;price:number;gap_from_close_pct:number;slope_pct:number|null;status:string};
type GcKey='rsi'|'slow14'|'slow12'|'slow20'|'macd';
const GC_OPTIONS:{key:GcKey;label:string}[]=[
  {key:'rsi',label:'RSI GC'},
  {key:'slow14',label:'Slow 14·3·3 GC'},
  {key:'slow12',label:'Slow 12·5·5 GC'},
  {key:'slow20',label:'Slow 20·12·12 GC'},
  {key:'macd',label:'MACD GC'},
];
const ALL_GC_KEYS=GC_OPTIONS.map(x=>x.key);
type InstallPrompt = Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
const tags=['BB20','BB30','BB40','ENV20','ENV40'];
const todayKST=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const showSignal=(t:string)=>t.replace(/^BB/,'BLUE');
const money=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('ko-KR');

function App(){
  const [mode,setMode]=useState<'single'|'range'>('single');
  const [date,setDate]=useState(todayKST());
  const [start,setStart]=useState(todayKST());
  const [end,setEnd]=useState(todayKST());
  const [latest,setLatest]=useState<string|null>(null);
  const [signals,setSignals]=useState<string[]>(tags);
  const [logic,setLogic]=useState('any');
  const [rows,setRows]=useState<Signal[]>([]);
  const [days,setDays]=useState<Day[]>([]);
  const [total,setTotal]=useState<number|null>(null);
  const [page,setPage]=useState(1);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [selected,setSelected]=useState<Signal|null>(null);
  const [localQuery,setLocalQuery]=useState('');
  const [gcFields,setGcFields]=useState<GcKey[]>([]);
  const [gcLogic,setGcLogic]=useState<'any'|'all'>('any');
  const [marketAiOpen,setMarketAiOpen]=useState(false);
  const [status,setStatus]=useState('');
  const [dataStatus,setDataStatus]=useState<ScanStatus>('');
  const [requestBusy,setRequestBusy]=useState(false);
  const [watchDate,setWatchDate]=useState('');
  const [scanInfo,setScanInfo]=useState('');
  const [actionsUrl,setActionsUrl]=useState('');
  const [filterOpen,setFilterOpen]=useState(false);
  const [installPrompt,setInstallPrompt]=useState<InstallPrompt|null>(null);
  const [installGuide,setInstallGuide]=useState(false);
  const [standalone,setStandalone]=useState(false);
  const resultRef=useRef<HTMLElement>(null);
  const formRef=useRef<HTMLElement>(null);
  const summaryRef=useRef<HTMLDivElement>(null);
  const aiRef=useRef<HTMLDivElement>(null);
  const searchVersion=useRef(0);

  useEffect(()=>{
    const onBeforeInstall=(event:Event)=>{event.preventDefault();setInstallPrompt(event as InstallPrompt);};
    const onInstalled=()=>{setStandalone(true);setInstallPrompt(null);setInstallGuide(false);};
    const standaloneMode=window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && Boolean((navigator as Navigator & {standalone?:boolean}).standalone));
    setStandalone(standaloneMode);
    window.addEventListener('beforeinstallprompt',onBeforeInstall);
    window.addEventListener('appinstalled',onInstalled);
    if('serviceWorker' in navigator){
      const register=()=>navigator.serviceWorker.register('/sw.js').catch(()=>{/* The app still works without offline-shell support. */});
      if(document.readyState==='complete')void register();
      else window.addEventListener('load',register,{once:true});
    }
    return ()=>{window.removeEventListener('beforeinstallprompt',onBeforeInstall);window.removeEventListener('appinstalled',onInstalled);};
  },[]);

  async function installApp(){
    if(installPrompt){await installPrompt.prompt();await installPrompt.userChoice;setInstallPrompt(null);}
    else setInstallGuide(v=>!v);
  }
  async function loadDates():Promise<string|null>{
    const r=await fetch(API+'/api/dates',{credentials:'include',cache:'no-store'});
    if(!r.ok)throw new Error(`날짜 API 오류: ${r.status}`);
    const d=await r.json();
    setLatest(d.latest||null);
    return d.latest||null;
  }
  useEffect(()=>{loadDates().then(d=>{if(d){setDate(d);setStart(d);setEnd(d);}}).catch(e=>setError(`검색 가능 날짜 확인 실패: ${String(e)}`));},[]);

  // Only single-day missing results trigger the existing server-managed scan workflow.
  async function requestScan(day:string){
    if(!day)return;
    setRequestBusy(true);setScanInfo('');
    try{
      const r=await fetch(API+'/api/scan',{
        method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},credentials:'include',body:JSON.stringify({date:day}),
      });
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||`분석 요청 실패: ${r.status}`);
      setActionsUrl(d.actions_url||'');
      if(d.status==='READY')setScanInfo('분석이 완료된 날짜입니다. 검색 버튼을 누르면 결과를 확인할 수 있습니다.');
      else{setScanInfo(d.deduplicated?'다른 PC에서 이미 진행 중인 분석입니다.':'서버에 분석 요청을 접수했습니다.');setWatchDate(day);}
    }catch(e){setError(String(e));}
    finally{setRequestBusy(false);}
  }
  async function search(p=1,scroll=true,selectedGc:GcKey[]=gcFields,selectedGcLogic:'any'|'all'=gcLogic){
    const serial=++searchVersion.current;
    setBusy(true);setError('');setStatus('');
    const queryMode=mode,queryDate=date;
    try{
      const u=new URL(API+'/api/search');
      u.searchParams.set('mode',queryMode);
      if(queryMode==='single')u.searchParams.set('date',queryDate);
      else {u.searchParams.set('start',start);u.searchParams.set('end',end);}
      u.searchParams.set('signals',signals.join(','));u.searchParams.set('logic',logic);u.searchParams.set('page',String(p));
      if(selectedGc.length){u.searchParams.set('gc',selectedGc.join(','));u.searchParams.set('gc_logic',selectedGcLogic);}
      const r=await fetch(u.toString(),{credentials:'include',cache:'no-store'});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||`검색 오류: ${r.status}`);
      if(serial!==searchVersion.current)return;
      setRows(d.items||[]);setDays(d.daily_counts||[]);setTotal(d.total);setPage(p);setSelected(null);setLocalQuery('');setDataStatus(d.data_status||'');
      if(scroll){setFilterOpen(false);requestAnimationFrame(()=>resultRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));}
      if(d.data_status==='NOT_IMPORTED'){
        if(queryMode==='single'){
          if(queryDate>=todayKST()){setStatus('오늘 및 미래 날짜는 확정 일봉이 준비되지 않았습니다. 장중 현재가를 제공하지 않습니다.');}
          else{setStatus('저장된 결과가 없어 해당 날짜의 분석을 요청합니다.');await requestScan(queryDate);}
        }else setStatus('기간 중 저장된 날짜만 조회했습니다. 미분석 날짜의 일괄 실행은 지원하지 않습니다.');
      }
    }catch(e){if(serial===searchVersion.current){setError(String(e));setRows([]);setDays([]);setTotal(null);setDataStatus('');}}
    finally{if(serial===searchVersion.current)setBusy(false);}
  }
  useEffect(()=>{
    if(!watchDate)return;
    let cancelled=false;
    const poll=async()=>{
      try{
        const r=await fetch(API+'/api/scan/status?date='+encodeURIComponent(watchDate),{credentials:'include',cache:'no-store'});
        const d=await r.json();if(!r.ok)throw new Error(d.error||`상태 조회 오류 ${r.status}`);
        if(cancelled)return;
        if(d.actions_url)setActionsUrl(d.actions_url);
        if(d.status==='READY'){
          setWatchDate('');setScanInfo('D1 등록 완료 · 결과를 갱신합니다.');
          await loadDates().catch(()=>null);
          // The selected date may have changed while waiting: do not overwrite that selection.
          if(mode==='single'&&date===watchDate)void search(1,false);
        }else if(d.status==='FAILED'){setWatchDate('');setScanInfo('분석 실패: '+(d.reason||'Actions 실행 기록 확인 필요'));}
        else if(d.status==='PENDING')setScanInfo('서버에서 분석 중입니다. 다른 PC에서도 동일한 상태가 표시됩니다.');
      }catch(e){if(!cancelled)setScanInfo('상태 확인 오류: '+String(e));}
    };
    void poll();const timer=window.setInterval(()=>{void poll();},8000);
    return()=>{cancelled=true;window.clearInterval(timer);};
  // Intentionally only restart when the watched date changes.
  },[watchDate]);

  const extra=(r:Signal,k:string):unknown=>r.extras?.[k];
  const num=(r:Signal,k:string):number|null=>{const v=extra(r,k);if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
  const fmt=(r:Signal,k:string,digits=2)=>{const n=num(r,k);return n==null?'—':n.toLocaleString('ko-KR',{minimumFractionDigits:digits,maximumFractionDigits:digits});};
  const flag=(r:Signal,k:string)=>extra(r,k)===true||['true','True','1'].includes(String(extra(r,k)));
  const present=(r:Signal,k:string)=>extra(r,k)!==undefined&&extra(r,k)!==null&&extra(r,k)!=='';
  const crossed=(r:Signal,k:string)=>!present(r,k)?'미계산':flag(r,k)?'당일 GC':'GC 없음';
  const lastCross=(r:Signal,k:string)=>String(extra(r,k)||'확인되지 않음');
  const validLines=(r:Signal):Line[]=>{const x=extra(r,'valid_line_candidates_json');if(typeof x!=='string')return [];try{const v=JSON.parse(x);return Array.isArray(v)?v:[];}catch{return [];}};
  const supplyGrade=(r:Signal)=>String(extra(r,'supply_strength_grade')||'미계산');
  const displayName=(r:Signal)=>r.name||String(r.extras?.name||r.extras?.Name||'종목명 미등록');
  const visibleRows=rows.filter(r=>(displayName(r)+' '+r.code).toLocaleLowerCase().includes(localQuery.trim().toLocaleLowerCase()));
  const changeGc=(next:GcKey[],mode:'any'|'all'=gcLogic)=>{
    setGcFields(next);setGcLogic(mode);setLocalQuery('');
    // Search in D1 across all stored result pages, not only the 100 rows currently loaded.
    if(total!==null)void search(1,false,next,mode);
  };
  const profile=(r:Signal)=>r.supply_distance_pct==null?'미계산':r.supply_distance_pct.toFixed(2)+'%';
  const flip=(t:string)=>setSignals(a=>a.includes(t)?a.filter(s=>s!==t):[...a,t]);
  const nav=(target:'search'|'results'|'summary'|'ai')=>{
    if(target==='search'){setFilterOpen(true);setTimeout(()=>formRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),20);}
    if(target==='results')resultRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
    if(target==='summary')summaryRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
    if(target==='ai'){setMarketAiOpen(true);window.setTimeout(()=>aiRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),30);}
  };
  const openDetail=(r:Signal)=>setSelected(r);
  const closeDetail=()=>setSelected(null);
  useEffect(()=>{
    if(!selected)return;
    const f=(e:KeyboardEvent)=>{if(e.key==='Escape')closeDetail();};
    window.addEventListener('keydown',f);return()=>window.removeEventListener('keydown',f);
  },[selected]);

  return <div className="shell app-shell">
    <header className="app-header">
      <div className="brand-lockup"><img className="brand-symbol brand-logo-image" src="/icons/icon-192.png" alt="BLUE Signal Lab 앱 아이콘"/><div>
        <p className="eyebrow">KOSPI · KOSDAQ / RESEARCH ONLY</p>
        <h1>BLUE <span>Signal Lab</span></h1>
        <p className="sub">일봉 기준 · 종목 발굴 연구</p>
      </div></div>
      <div className="header-actions">
        <span className="pill version-pill">R1.0 · BLUE AI</span>
        {!standalone&&<button className="install-btn" onClick={()=>{void installApp();}} aria-label="앱 설치 방법"><Download size={17}/><span>앱 설치</span></button>}
      </div>
    </header>
    {installGuide&&<div className="install-guide" role="status"><button className="guide-close" onClick={()=>setInstallGuide(false)} aria-label="안내 닫기"><X size={17}/></button>
      <strong>휴대폰에 설치하는 방법</strong><p>안드로이드 Chrome: 오른쪽 위 ⋮ → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b></p>
      <p>아이폰 Safari: 공유 버튼 → <b>홈 화면에 추가</b></p>
      <p><strong>설치 상태:</strong> {installPrompt?'Chrome이 앱 설치 요청을 허용했습니다.':'Chrome 설치 이벤트가 아직 감지되지 않았습니다. 앱 파일 응답을 검사해 주세요.'}</p>
      <p><a href="/pwa-check.html" target="_blank" rel="noopener noreferrer">PWA 설치 진단 열기</a></p>
      <small>Cloudflare Access 로그인 페이지가 manifest·아이콘을 대신 반환하면 설치할 수 없을 수 있습니다. 접근 제어를 해제하지 말고 진단 결과를 확인하세요.</small>
    </div>}
    <main className="app-main">
      <aside className={'panel search-panel '+(filterOpen?'filter-open':'filter-closed')} ref={formRef} id="search-panel">
        <div className="search-heading"><h2><SlidersHorizontal size={18}/> 검색 조건</h2><button type="button" className="filter-toggle" onClick={()=>setFilterOpen(v=>!v)} aria-expanded={filterOpen} aria-controls="filter-body">{filterOpen?'조건 접기':'조건 변경'} <ListFilter size={16}/></button></div>
        <div className="filter-body" id="filter-body">
          <p className="latest-label"><Database size={14}/> 저장된 최신 거래일 <strong>{latest||'확인 중'}</strong></p>
          <label>검색 방법</label><div className="switch"><button className={mode==='single'?'active':''} type="button" onClick={()=>setMode('single')}>지정 날짜</button><button className={mode==='range'?'active':''} type="button" onClick={()=>setMode('range')}>기간 검색</button></div>
          {mode==='single'?<><label htmlFor="scan-date">검색 날짜</label><input id="scan-date" type="date" value={date} onChange={e=>{setDate(e.target.value);setWatchDate('');setDataStatus('');}}/></>:
          <><label htmlFor="scan-start">시작일</label><input id="scan-start" type="date" value={start} onChange={e=>setStart(e.target.value)}/><label htmlFor="scan-end">종료일</label><input id="scan-end" type="date" value={end} onChange={e=>setEnd(e.target.value)}/></>}
          <label>기술 신호</label><div className="checks">{tags.map(t=><label className="check" key={t}><input type="checkbox" checked={signals.includes(t)} onChange={()=>flip(t)}/>{showSignal(t)}</label>)}</div>
          <label htmlFor="scan-logic">신호 조합</label><select id="scan-logic" value={logic} onChange={e=>setLogic(e.target.value)}><option value="any">하나라도 충족 (OR)</option><option value="all">모두 충족 (AND)</option></select>
          <button className="primary search-submit" disabled={busy||requestBusy} onClick={()=>{void search(1);}}><Search size={18}/>{busy?'검색 중…':'종목 검색하기'}</button>
          <p className="small">저장된 결과는 즉시 조회하고, 미분석 과거 거래일은 서버에 분석을 요청합니다. 장중 현재가 아님.</p>
        </div>
        <div className="search-compact"><div><small>기준일</small><strong>{mode==='single'?date:`${start} ~ ${end}`}</strong></div><button onClick={()=>setFilterOpen(true)}><SlidersHorizontal size={16}/> 수정</button><button className="compact-run" disabled={busy||requestBusy} onClick={()=>{void search(1);}}><Search size={16}/> 검색</button></div>
      </aside>
      <section className="content">
        <div className="stats" ref={summaryRef} id="summary-panel">
          <div className="metric"><span>검색 결과</span><strong>{total==null?'—':total.toLocaleString()}</strong><small>종목</small></div>
          <div className="metric"><span>검색 거래일</span><strong>{total==null?'—':days.length}</strong><small>저장된 날짜</small></div>
          <div className="metric"><span>최신 저장일</span><strong className="smallnum">{latest?.slice(5)||'—'}</strong><small>종가 데이터</small></div>
        </div>
        {error&&<div className="notice error" role="alert"><AlertCircle size={17}/>{error}</div>}
        {status&&<div className="notice"><AlertCircle size={17}/>{status}</div>}
        {scanInfo&&<div className="notice" role="status"><RefreshCw size={17}/><div>{scanInfo}{actionsUrl&&<div><a href={actionsUrl} target="_blank" rel="noreferrer">GitHub 실행 결과 확인</a></div>}</div></div>}
        <section ref={aiRef} id="ai-panel" className="ai-accordion" style={{scrollMarginTop:12}}>
          <button type="button" className="ai-accordion-toggle" aria-expanded={marketAiOpen} aria-controls="ai-market-body" onClick={()=>setMarketAiOpen(v=>!v)}>
            <span><Activity size={19}/> <strong>BLUE AI · 시황 브리핑</strong><small>{mode==='single'?date:latest||end} 종가 기준</small></span>
            <span className="ai-collapse-label">{marketAiOpen?'접기':'펼치기'} <ChevronRight size={19} className={marketAiOpen?'rotated':''}/></span>
          </button>
          {marketAiOpen&&<div id="ai-market-body"><AiWidget key={'market-'+(mode==='single'?date:latest||end)} kind="market" date={mode==='single'?date:latest||end} observed={mode==='single'?days.find(d=>d.day===date)?.observed_stocks:null} matched={mode==='single'?days.find(d=>d.day===date)?.matched_stocks:null} events={mode==='single'?days.find(d=>d.day===date)?.signal_events:null} searchMatched={rows}/></div>}
        </section>
        <section className="panel result" ref={resultRef} id="results-panel">
          <div className="result-heading"><h2><BarChart3 size={18}/> 검색된 종목 <small>{total===null?'검색 전':total+'건'}</small></h2><span className="eod-pill"><Clock3 size={13}/> EOD</span></div>
          <p className="result-hint">종목을 누르면 RSI · Slow · MACD · 돌파선 · 상단 매물대 정보를 볼 수 있습니다.</p>
          <div className="gc-filter-panel" aria-label="골든크로스 종목 필터">
            <div className="gc-filter-heading"><strong><ListFilter size={15}/> 골든크로스 필터</strong><span>검색 전체 결과에 적용 · 당일 발생만</span></div>
            <div className="gc-quick-actions">
              <button type="button" className={!gcFields.length?'active':''} disabled={busy} onClick={()=>changeGc([])}>전체 종목</button>
              <button type="button" className={gcFields.length===ALL_GC_KEYS.length&&gcLogic==='any'?'active':''} disabled={busy} onClick={()=>changeGc([...ALL_GC_KEYS],'any')}>GC 하나라도</button>
            </div>
            <div className="gc-filter-options">
              {GC_OPTIONS.map(item=><label key={item.key} className={'gc-filter-chip '+(gcFields.includes(item.key)?'selected':'')}>
                <input type="checkbox" checked={gcFields.includes(item.key)} disabled={busy} onChange={()=>changeGc(gcFields.includes(item.key)?gcFields.filter(k=>k!==item.key):[...gcFields,item.key])}/>
                {item.label}
              </label>)}
            </div>
            {gcFields.length>1&&<div className="gc-logic">
              <span>선택 조건:</span>
              <button type="button" className={gcLogic==='any'?'active':''} disabled={busy} onClick={()=>changeGc(gcFields,'any')}>하나라도 (OR)</button>
              <button type="button" className={gcLogic==='all'?'active':''} disabled={busy} onClick={()=>changeGc(gcFields,'all')}>모두 (AND)</button>
            </div>}
            <p className="gc-filter-note">선택 즉시 D1 전체 검색 결과를 다시 조회합니다. 필터는 검색 날짜·BLUE 신호 조건에 추가 적용되며, 당일 실제 GC만 찾습니다.</p>
          </div>
          {rows.length>0&&<label className="result-quick-search"><Search size={16}/><span className="sr-only">현재 페이지 종목명 또는 코드 찾기</span><input type="search" value={localQuery} onChange={e=>setLocalQuery(e.target.value)} placeholder="현재 페이지에서 종목명 · 코드 찾기" aria-label="현재 페이지에서 종목명 또는 코드 찾기"/></label>}
          <div className="desktop-results tablewrap"><table><thead><tr><th>날짜</th><th>종목명 / 코드</th><th>신호</th><th>종가</th><th>RSI / GC</th><th>Slow(14,3,3) / GC</th><th>MACD / GC</th><th>돌파선 후보</th><th>상단 매물대</th></tr></thead><tbody>
            {visibleRows.length?visibleRows.map((r,i)=><tr key={`${r.code}-${r.day}-${i}`} className="clickable" tabIndex={0} onClick={()=>openDetail(r)} onKeyDown={e=>{if(e.key==='Enter')openDetail(r);}}>
              <td>{r.day}</td><td><b>{displayName(r)}</b><div className="small">{r.code}</div></td>
              <td>{r.signals.map(s=><span className="tag" key={s}>{showSignal(s)}</span>)}</td><td>{money(r.close_price)}</td>
              <td>{fmt(r,'rsi')} <small>{crossed(r,'rsi_gc')}</small></td><td>{fmt(r,'slow_14_3_3_k')} / {fmt(r,'slow_14_3_3_d')} <small>{crossed(r,'slow_14_3_3_gc')}</small></td>
              <td>{fmt(r,'macd_12_26_9')} <small>{crossed(r,'macd_gc')}</small></td><td>{present(r,'valid_line_candidates_json')?`${validLines(r).length}개`:'미계산'}</td>
              <td>{profile(r)} · {supplyGrade(r)}</td>
            </tr>):<tr><td className="empty" colSpan={9}>{total!==null?'조건에 맞는 종목이 없습니다.':'날짜와 조건을 선택해 검색하세요.'}</td></tr>}</tbody></table></div>
          <div className="mobile-results">
            {visibleRows.length?visibleRows.map((r,i)=><button key={`${r.code}-${r.day}-${i}`} className="stock-card" onClick={()=>openDetail(r)} aria-label={`${displayName(r)} 상세 분석 보기`}>
              <div className="stock-top"><div className="stock-identity"><strong>{displayName(r)}</strong><span>{r.code} <span className="stock-dot">·</span> {r.day}</span></div><div className="stock-price"><b>{money(r.close_price)}<small>원</small></b><span>종가</span></div><ChevronRight size={19} className="stock-chevron"/></div>
              <div className="stock-tags">{r.signals.slice(0,4).map(s=><span className="tag" key={s}>{showSignal(s)}</span>)}{r.signals.length>4&&<span className="tag tag-more">+{r.signals.length-4}</span>}</div>
              <div className="stock-quick"><div><small>RSI</small><strong>{fmt(r,'rsi',1)}</strong></div><div><small>Slow GC</small><strong className={flag(r,'slow_14_3_3_gc')?'positive':''}>{crossed(r,'slow_14_3_3_gc')}</strong></div><div><small>MACD GC</small><strong className={flag(r,'macd_gc')?'positive':''}>{crossed(r,'macd_gc')}</strong></div><div><small>상단 매물</small><strong>{supplyGrade(r)}</strong></div></div>
            </button>):<div className="mobile-empty"><Search size={30}/><strong>{localQuery?'현재 페이지에서 일치하는 종목이 없습니다.':total===0?'해당 조건의 종목이 없습니다.':'검색 조건을 선택해 주세요.'}</strong><p>{gcFields.length?'선택한 골든크로스 조건을 만족하는 종목이 없습니다.':'과거 거래일을 선택한 다음 검색 버튼을 누르세요.'}</p><button onClick={()=>nav('search')}>검색 조건 열기</button></div>}
          </div>
          {total!==null&&total>100&&<div className="pager"><button disabled={busy||page===1} onClick={()=>{void search(page-1,false);}}>이전</button><span>{page} / {Math.ceil(total/100)}</span><button disabled={busy||page>=Math.ceil(total/100)} onClick={()=>{void search(page+1,false);}}>다음</button></div>}
        </section>
        {days.length>0&&<section className="panel daily-panel"><h2><CalendarDays size={18}/> 날짜별 요약</h2><div className="tablewrap"><table><thead><tr><th>날짜</th><th>관측 종목</th><th>신호 건수</th><th>신호 종목</th></tr></thead><tbody>{days.map(d=><tr key={d.day}><td>{d.day}</td><td>{d.observed_stocks}</td><td>{d.signal_events}</td><td>{d.matched_stocks}</td></tr>)}</tbody></table></div></section>}
        <p className="disclaimer"><AlertCircle size={14}/> RSI·MACD·유효선 후보·상단 매물대 강도는 연구용 계산값이며 현재가·실제 호가 매물대가 아닙니다. R0.8 이전 분석 기록은 재분석해야 신규 정보가 표시됩니다.</p>
      </section>
    </main>
    <footer>BLUE Signal Lab · RESEARCH ONLY · 매매 주문 기능 없음</footer>
    <nav className="mobile-dock" aria-label="모바일 메뉴">
      <button onClick={()=>nav('search')}><SlidersHorizontal size={20}/><span>검색</span></button>
      <button onClick={()=>nav('results')}><BarChart3 size={20}/><span>종목 결과</span></button>
      <button className="dock-primary" onClick={()=>nav('ai')}><Activity size={20}/><span>AI 시황</span></button>
      <button onClick={()=>nav('summary')}><Activity size={20}/><span>요약</span></button>
    </nav>
    {selected&&<div className="detail-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)closeDetail();}}>
      <section className="detail-sheet" role="dialog" aria-modal="true" aria-label={`${displayName(selected)} 상세 분석`}>
        <div className="detail-handle" aria-hidden="true"/><div className="detail-toolbar"><button onClick={closeDetail} className="detail-back"><ArrowLeft size={19}/> 뒤로</button><span className="detail-eod">일봉 · 연구용</span><button onClick={closeDetail} className="detail-x" aria-label="상세 닫기"><X size={21}/></button></div>
        <div className="detail-head"><div><small>{selected.code} · {selected.day}</small><h2>{displayName(selected)}</h2></div><div className="detail-close"><span>종가</span><strong>{money(selected.close_price)} <small>원</small></strong></div></div>
        <div className="study-tags">{selected.signals.map(s=><span key={s}>{showSignal(s)}</span>)}</div>
        <StockChart key={'chart-'+selected.code+'-'+selected.day} code={selected.code}
          day={selected.day} name={displayName(selected)}
          supplyPrice={num(selected,'supply_reference_price')}
          supplyGrade={supplyGrade(selected)}
          lineCandidates={validLines(selected).map(l=>({signal:l.signal,price:l.price}))}/>
        <h3 className="detail-section-title"><Activity size={17}/> 보조지표</h3>
        <div className="info-grid indicator-grid">
          <div><strong>RSI (14) / Signal (9)</strong><p className="indicator-value">{fmt(selected,'rsi')} <small>/ {fmt(selected,'rsi_signal')}</small></p><p className={flag(selected,'rsi_gc')?'positive':''}>{crossed(selected,'rsi_gc')} · 최근 GC {lastCross(selected,'rsi_last_gc')}</p></div>
          <div><strong>Slow (14,3,3)</strong><p className="indicator-value">{fmt(selected,'slow_14_3_3_k')} <small>/ {fmt(selected,'slow_14_3_3_d')}</small></p><p className={flag(selected,'slow_14_3_3_gc')?'positive':''}>{crossed(selected,'slow_14_3_3_gc')} · 최근 GC {lastCross(selected,'slow_14_3_3_last_gc')}</p></div>
          <div><strong>MACD (12,26,9)</strong><p className="indicator-value">{fmt(selected,'macd_12_26_9')} <small>/ {fmt(selected,'macd_signal_9')}</small></p><p className={flag(selected,'macd_gc')?'positive':''}>{crossed(selected,'macd_gc')} · 최근 GC {lastCross(selected,'macd_last_gc')}</p></div>
          <div><strong>Slow (12,5,5)</strong><p className="indicator-value">{fmt(selected,'slow_12_5_5_k')} <small>/ {fmt(selected,'slow_12_5_5_d')}</small></p><p>{crossed(selected,'slow_12_5_5_gc')} · 최근 GC {lastCross(selected,'slow_12_5_5_last_gc')}</p></div>
          <div><strong>Slow (20,12,12)</strong><p className="indicator-value">{fmt(selected,'slow_20_12_12_k')} <small>/ {fmt(selected,'slow_20_12_12_d')}</small></p><p>{crossed(selected,'slow_20_12_12_gc')} · 최근 GC {lastCross(selected,'slow_20_12_12_last_gc')}</p></div>
          <div><strong>상단 매물대 (120봉 추정)</strong><p className="indicator-value">{profile(selected)} <small>· {supplyGrade(selected)}</small></p><p>상대 강도 {fmt(selected,'supply_strength_relative_pct')}% · 기준 {fmt(selected,'supply_reference_price',0)}원</p></div>
        </div>
        <h3 className="detail-section-title"><CheckCircle2 size={17}/> 돌파 기준선 후보</h3>
        {present(selected,'valid_line_candidates_json')?(validLines(selected).length?<div className="line-list">{validLines(selected).map((l,i)=><div key={`${l.signal}-${i}`} className="line-card"><strong>{showSignal(l.signal)}</strong><span>선 가격 <b>{money(l.price)}원</b></span><span>종가와 차이 {l.gap_from_close_pct}%</span><span>기울기 {l.slope_pct==null?'미계산':l.slope_pct+'%'}</span></div>)}</div>:<p className="small">해당 날짜의 돌파 기준선 후보가 없습니다.</p>):<p className="small">R0.8로 다시 분석하면 돌파선 후보 정보가 표시됩니다.</p>}
        <div className="detail-disclaimer"><AlertCircle size={16}/>돌파선은 원본 Stock-Hunter 유효선과 동일하다고 검증되지 않았습니다. 상단 매물 강도도 체결가별 실제 매물량이 아니라 과거 일봉 기반 추정치입니다.</div>
        <AiWidget key={'stock-'+selected.day+'-'+selected.code} kind="stock" date={selected.day} stock={selected}/>
        <button className="detail-done" onClick={closeDetail}>종목 목록으로 돌아가기</button>
      </section>
    </div>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

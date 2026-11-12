import StockChart from './StockChart';
import LiveMarket from './LiveMarket';
import SmartBasket from './SmartBasket';
import PriceCompareMini from './PriceCompareMini';
import {requestSearchPriority} from './search-priority';
import {comparisonKey,fetchCompared,type PriceCompare} from './price-compare';
import './r1595-group-price.css';
import AiWidget from './AiWidget';
import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Search, CalendarDays, BarChart3, AlertCircle, RefreshCw, SlidersHorizontal, ListFilter, X, ChevronRight, Download, ArrowLeft, Activity, Clock3, Database, CheckCircle2, ShoppingBasket, Radar} from 'lucide-react';
import './style.css';
import './r08.css';
import './mobile-pwa.css';
import './ai.css';
import './r151-navigation.css';
import './r152-four-tabs.css';
import './r153-performance.css';
// R154_CLARITY: technical signal chips and verified tracking metadata.
import './r154-clarity.css';
// R155_AI_REPAIR: restore independent AI briefing styles.
import './r155-ai-repair.css';
// R157_UI_FILTERS
import './r157-ui.css';
// R159_MA_EVIDENCE
import './r159-ma-evidence.css';
import './r1591-evidence-basket.css';
import './r1594-refresh.css';
import './r1599-pattern-filters.css';
// R1581_SCAN_RESUME: persistent scan status across tabs and reloads.
import './r1581-scan-monitor.css';

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
const SCAN_WATCH_KEY='blue_r1581_pending_scan_date_v1';
const rememberedScanDate=():string=>{
  try{
    const day=localStorage.getItem(SCAN_WATCH_KEY)||'';
    if(!/^20\d{2}-\d{2}-\d{2}$/.test(day))return '';
    const d=new Date(day+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===day?day:'';
  }catch{return '';}
};
const showSignal=(t:string)=>t.replace(/^(?:BLUE|BB)(?=\d)/i,'B');
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
  // R1599 shared options: search outlines, detail chart and basket use same threshold.
  const [amountChoice,setAmountChoice]=useState(()=>{
    try{const v=localStorage.getItem('blue_r1599_amount_choice');return ['0','100','300','500','1000','custom'].includes(v||'')?v!:'500';}
    catch{return '500';}
  });
  const [customAmount,setCustomAmount]=useState(()=>{
    try{return localStorage.getItem('blue_r1599_custom_amount')||'500';}
    catch{return '500';}
  });
  const [patternThreshold,setPatternThreshold]=useState<'off'|'60'|'70'|'80'|'90'>(()=>{
    try{const v=localStorage.getItem('blue_r1599_pattern_threshold');
      return v==='off'||v==='60'||v==='70'||v==='80'||v==='90'?v:'70';}
    catch{return '70';}
  });
  const [onlyPattern,setOnlyPattern]=useState(()=>{
    try{return localStorage.getItem('blue_r1599_only_pattern')==='true';}catch{return false;}
  });
  // R1.5.10.5: existing chart snapshots can contain 3-7 case exploratory patterns.
  const [patternSampleMin,setPatternSampleMin]=useState<number>(()=>{
    try{const value=localStorage.getItem('blue_r15103_pattern_min_samples');
      return value&&['3','4','5','6','7','8','10','15','20','30'].includes(value)?Number(value):8;}
    catch{return 8;}
  });
  const amountEok=amountChoice==='custom'?Number(customAmount):Number(amountChoice);
  const [appliedAmountEok,setAppliedAmountEok]=useState<number|null>(null);
  const highlightMin=patternThreshold==='off'?null:Number(patternThreshold);
  useEffect(()=>{
    try{localStorage.setItem('blue_r1599_amount_choice',amountChoice);
      localStorage.setItem('blue_r1599_custom_amount',customAmount);
      localStorage.setItem('blue_r1599_pattern_threshold',patternThreshold);
      localStorage.setItem('blue_r1599_only_pattern',String(onlyPattern));
      localStorage.setItem('blue_r15103_pattern_min_samples',String(patternSampleMin));}
    catch{/* Browsers blocking storage can still use current choices. */}
  },[amountChoice,customAmount,patternThreshold,onlyPattern,patternSampleMin]);
  // R151_BASKET_TAB: keep both workspaces mounted, toggle only visibility.
  // R152_FOUR_TABS: separate search, live tracking, AI briefing and basket.
  const [activeView,setActiveView]=useState<'research'|'tracking'|'ai'|'basket'>('research');
  const [basketIds,setBasketIds]=useState<string[]>(()=>{
    try{const x=JSON.parse(localStorage.getItem('blue_r15_basket_v1')||'[]');
      return Array.isArray(x)?x.filter((i:unknown)=>Boolean(i&&typeof i==='object'&&'id' in i)).map((i:any)=>String(i.id)):[];
    }catch{return [];}
  });
  const basketSequence=useRef(0);
  const [basketRequest,setBasketRequest]=useState<{serial:number;item:Signal}|null>(null);
  const [status,setStatus]=useState('');
  const [dataStatus,setDataStatus]=useState<ScanStatus>('');
  const [requestBusy,setRequestBusy]=useState(false);
  const [watchDate,setWatchDate]=useState(rememberedScanDate);
  const [completedDate,setCompletedDate]=useState('');
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
  const [r1594Refresh,setR1594Refresh]=useState(0);
  const [r1594TrackingRefresh,setR1594TrackingRefresh]=useState(0);
  const [r1594BasketRefresh,setR1594BasketRefresh]=useState(0);
  const [r1594AiRefresh,setR1594AiRefresh]=useState(0);
  const [r1594QueueStatus,setR1594QueueStatus]=useState('');
  const [r1595Requesting,setR1595Requesting]=useState('');
  const [r1595RequestNote,setR1595RequestNote]=useState('');
  const r1595Timers=useRef<Map<string,number>>(new Map());
  useEffect(()=>()=>{for(const timer of r1595Timers.current.values())window.clearInterval(timer);r1595Timers.current.clear();},[]);
  // R1593: browser reads only validated D1 snapshots; no KIS call on search.
  const [r1593Prices,setR1593Prices]=useState<Record<string,PriceCompare>>({});
  const [r1593Busy,setR1593Busy]=useState(false);
  const [r1593Error,setR1593Error]=useState('');
  useEffect(()=>{
    if(activeView!=='research'||!rows.length)return;
    const ctrl=new AbortController();setR1593Busy(true);setR1593Error('');
    void fetchCompared(rows,ctrl.signal,partial=>{if(!ctrl.signal.aborted)setR1593Prices(prev=>({...prev,...partial}));}).then(result=>{if(!ctrl.signal.aborted)setR1593Prices(prev=>({...prev,...result}));})
      .catch(e=>{if(!ctrl.signal.aborted)setR1593Error(e instanceof Error?e.message:'최근 시세 확인 실패');})
      .finally(()=>{if(!ctrl.signal.aborted)setR1593Busy(false);});
    return ()=>ctrl.abort();
  },[rows,activeView,r1594Refresh]);

  // R1594: submit at most eight verified visible search symbols to the server queue.
  // This does NOT block the D1 search and NEVER calls KIS from the browser.
  useEffect(()=>{
    if(activeView!=='research'||!rows.length)return;
    const ctrl=new AbortController();let count=0;let timer=0;
    const priority=rows.filter(x=>/^\d{6}$/.test(x.code)&&x.close_price!==null&&x.close_price>0)
      .filter((x,i,a)=>a.findIndex(y=>y.code===x.code)===i).slice(0,8);
    setR1594QueueStatus('저장 시세는 즉시 조회 · 신규 시세 수집 요청 중');
    void requestSearchPriority(priority,ctrl.signal).then(result=>{
      if(ctrl.signal.aborted)return;
      const n=result.queued;
      setR1594QueueStatus(n?`KIS 서버 우선 수집 대기 ${n}종목 · 저장 시세를 자동 재확인합니다`:
        result.throttled?'최근 요청된 종목 · 저장 시세 확인 중':'저장 시세 확인 중');
      if(n||result.throttled){timer=window.setInterval(()=>{
        if(ctrl.signal.aborted||document.visibilityState==='hidden'||++count>12){window.clearInterval(timer);return;}
        void fetchCompared(priority,ctrl.signal).then(prices=>{
          if(!ctrl.signal.aborted)setR1593Prices(previous=>({...previous,...prices}));
        }).catch(()=>{});
      },12000);}
    }).catch(e=>{if(!ctrl.signal.aborted)setR1594QueueStatus(e instanceof Error?e.message:'우선 수집 요청 실패');});
    return ()=>{ctrl.abort();window.clearInterval(timer);};
  },[rows,activeView,r1594Refresh]);

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
  useEffect(()=>{loadDates().then(d=>{if(d){setDate(watchDate||d);setStart(d);setEnd(d);}}).catch(e=>setError(`검색 가능 날짜 확인 실패: ${String(e)}`));},[]);

  // R1581_SCAN_RESUME: refresh/reopen must not silently lose the server-side scan.
  useEffect(()=>{
    try{if(watchDate)localStorage.setItem(SCAN_WATCH_KEY,watchDate);
      else localStorage.removeItem(SCAN_WATCH_KEY);}catch{/* storage denied; this tab still polls */}
  },[watchDate]);

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
      if(d.status==='READY'){
        setCompletedDate(day);setWatchDate('');
        setScanInfo('검증된 분석 결과가 이미 준비됐습니다.');
        if(mode==='single'&&date===day)void search(1,false,gcFields,gcLogic,day);
      }else{
        setCompletedDate('');
        setScanInfo(d.deduplicated?'이미 진행 중인 분석을 이어서 확인합니다.':'서버에 분석 요청을 접수했습니다.');
        setWatchDate(day);
      }
    }catch(e){setError(String(e));}
    finally{setRequestBusy(false);}
  }
  async function search(p=1,scroll=true,selectedGc:GcKey[]=gcFields,selectedGcLogic:'any'|'all'=gcLogic,requestedDay?:string,patternOverride?:{enabled?:boolean;threshold?:number|null;minSamples?:number;amountEok?:number}){
    const serial=++searchVersion.current;
    const queryAmountEok=patternOverride?.amountEok??amountEok;
    if(!Number.isInteger(queryAmountEok)||queryAmountEok<0||queryAmountEok>50000){
      setError('거래대금은 0~50,000억원 사이 정수로 입력하세요.');return;
    }
    setBusy(true);setError('');setStatus('');
    const queryMode=requestedDay?'single':mode,queryDate=requestedDay||date;
    if(requestedDay){setMode('single');setDate(requestedDay);}
    try{
      const u=new URL(API+'/api/search');
      u.searchParams.set('mode',queryMode);
      if(queryMode==='single')u.searchParams.set('date',queryDate);
      else {u.searchParams.set('start',start);u.searchParams.set('end',end);}
      u.searchParams.set('signals',signals.join(','));u.searchParams.set('logic',logic);u.searchParams.set('page',String(p));
      if(selectedGc.length){u.searchParams.set('gc',selectedGc.join(','));u.searchParams.set('gc_logic',selectedGcLogic);}
      u.searchParams.set('min_amount_eok',String(queryAmountEok));
      // Chart-backed pattern extraction needs the actual selected sample floor,
      // even when highlighting all stocks rather than filtering only hot ones.
      u.searchParams.set('min_pattern_n',String(patternOverride?.minSamples??patternSampleMin));
      // Results-panel controls apply immediately without waiting for React state updates.
      const effectiveOnlyPattern=patternOverride?.enabled??onlyPattern;
      const effectiveHighlightMin=patternOverride?.threshold!==undefined?patternOverride.threshold:highlightMin;
      if(effectiveOnlyPattern&&effectiveHighlightMin!==null){
        u.searchParams.set('only_pattern','1');u.searchParams.set('min_pattern_up',String(effectiveHighlightMin));
      }
      const r=await fetch(u.toString(),{credentials:'include',cache:'no-store'});
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||`검색 오류: ${r.status}`);
      if(serial!==searchVersion.current)return;
      setRows(d.items||[]);setDays(d.daily_counts||[]);setTotal(d.total);setPage(p);setSelected(null);setLocalQuery('');setDataStatus(d.data_status||'');
      setAppliedAmountEok(queryAmountEok);
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
  // R1581_SCAN_RESUME: keep polling while navigating; persist and resume after reload.
  useEffect(()=>{
    if(!watchDate)return;
    let cancelled=false,inFlight=false;
    const poll=async()=>{
      if(inFlight)return;
      inFlight=true;
      try{
        const r=await fetch(API+'/api/scan/status?date='+encodeURIComponent(watchDate),{credentials:'include',cache:'no-store'});
        const d=await r.json();if(!r.ok)throw new Error(d.error||`상태 조회 오류 ${r.status}`);
        if(cancelled)return;
        if(d.actions_url)setActionsUrl(d.actions_url);
        if(d.status==='READY'){
          setWatchDate('');setCompletedDate(watchDate);
          setScanInfo(`${watchDate} 분석 완료 · 저장된 결과를 불러왔습니다.`);
          // Start the result fetch before setWatchDate clears this effect.
          // Otherwise cleanup might suppress auto-refresh while loadDates resolves.
          if(mode==='single'&&date===watchDate)
            void search(1,false,gcFields,gcLogic,watchDate);
          void loadDates().catch(()=>null);
        }else if(d.status==='FAILED'){
          setWatchDate('');setScanInfo(`${watchDate} 분석 실패: `+(d.reason||'GitHub 실행 기록을 확인하세요.'));
        }else if(d.status==='PENDING'){
          setScanInfo(`${watchDate} 분석 진행 중 · 다른 화면에서도 서버 작업은 계속됩니다.`);
        }else if(d.status==='NOT_IMPORTED'){
          setWatchDate('');setScanInfo(`${watchDate} 분석 요청 내역이 없어 검색 버튼으로 다시 요청할 수 있습니다.`);
        }
      }catch(e){if(!cancelled)setScanInfo('분석 상태 확인 오류: '+String(e));}
      finally{inFlight=false;}
    };
    const onVisible=()=>{if(document.visibilityState==='visible')void poll();};
    const onFocus=()=>{void poll();};
    void poll();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void poll();},8000);
    document.addEventListener('visibilitychange',onVisible);
    window.addEventListener('focus',onFocus);
    return()=>{cancelled=true;window.clearInterval(timer);
      document.removeEventListener('visibilitychange',onVisible);
      window.removeEventListener('focus',onFocus);};
  },[watchDate,mode,date,gcFields,gcLogic]);

  const extra=(r:Signal,k:string):unknown=>r.extras?.[k];
  const num=(r:Signal,k:string):number|null=>{const v=extra(r,k);if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
  // Only verified EOD chart evidence is eligible: selected floor 3-30, default 8.
  const patternUp=(r:Signal)=>{const p=num(r,'r159_pattern_up_10d');const n=num(r,'r159_pattern_n_10d');
    return highlightMin!==null&&n!==null&&n>=patternSampleMin&&p!==null&&p>=highlightMin?p:null;};
  // Single presentation predicate shared by outline, basket evidence and search filter.
  // R1.5.10.4 /api/search chooses a SAME-DAY active historical setup at the
  // user's selected minimum sample floor; never derive a rate from price moves.
  const patternEvidenceBlock=(r:Signal)=>{
    const up=patternUp(r);
    if(up===null)return null;
    const n=num(r,'r159_pattern_n_10d');
    const raw=extra(r,'r159_pattern_label_10d');
    const label=typeof raw==='string'?raw.trim().slice(0,150):'';
    return <div className="r15106-search-pattern-evidence" role="note" aria-label="기술 패턴 과거 상승 관측 결과">
      <span className="r1591-basket-evidence">과거 10일 상승 {up.toFixed(1)}% · 표본 {n}건 · 탐색적 결과</span>
      {label&&<small className="r15106-matched-pattern" title={label}>일치 기술 패턴: {label}</small>}
      {n!==null&&n<8&&<small className="r15106-small-sample">소표본 · 신뢰도 낮음 (미래 상승 확률 아님)</small>}
    </div>;
  };
  const patternDays=(r:Signal):string[]=>{
    const raw=extra(r,'r159_pattern_signal_days_10d_json');
    try{const v=typeof raw==='string'?JSON.parse(raw):raw;
      return Array.isArray(v)?v.filter((s):s is string=>typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&s<=r.day).slice(-12):[];
    }catch{return [];}
  };
  const amountLabel=(r:Signal)=>{const n=num(r,'traded_amount_krw');
    return n===null?'거래대금 미저장':`거래대금 ${(n/100000000).toLocaleString('ko-KR',{maximumFractionDigits:1})}억원`;};
  // R1591_SEARCH_BADGES: verified EOD indicators only, never inferred from absent data.
  const techBadges=(r:Signal):string[]=>{
    const out:string[]=[];const a=num(r,'ma20'),b=num(r,'ma40'),c=num(r,'ma60');
    if(a!==null&&b!==null&&c!==null&&a<b&&b<c)out.push('역배열');
    if(flag(r,'ma_to_up'))out.push('정배열 전환');
    if(flag(r,'ma112_cross'))out.push('112선 돌파');
    if(flag(r,'ma224_cross'))out.push('224선 돌파');
    return out;
  };
  const techFlag=(r:Signal,k:string)=>extra(r,k)===undefined?'미계산':flag(r,k)?'발생':'해당 없음';
  const maDown=(r:Signal)=>{const a=num(r,'ma20'),b=num(r,'ma40'),c=num(r,'ma60');return a===null||b===null||c===null?'미계산':a<b&&b<c?'해당':'해당 없음';};
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
  const inBasket=(r:Signal)=>basketIds.includes(`MANUAL:${r.code}:${r.day}`);
  const canBasket=(r:Signal)=>/^\d{6}$/.test(r.code)&&typeof r.close_price==='number'&&r.close_price>0;
  const quickBasket=(r:Signal)=>{
    if(!canBasket(r)||inBasket(r)||basketIds.length>=100)return;
    setBasketRequest({serial:++basketSequence.current,item:{...r,name:displayName(r)}});
  };
  const nav=(target:'search'|'results'|'summary'|'ai'|'basket'|'tracking')=>{
    if(target==='basket'||target==='tracking'||target==='ai'){
      setActiveView(target);
      window.setTimeout(()=>window.scrollTo({top:0,behavior:'smooth'}),20);
      return;
    }
    setActiveView('research');
    if(target==='search'){
      setFilterOpen(true);
      window.setTimeout(()=>formRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),35);
    }else if(target==='results'){
      window.setTimeout(()=>resultRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),35);
    }else if(target==='summary'){
      window.setTimeout(()=>summaryRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),35);
    }
  };
  const refreshCurrentView=()=>{
    if(activeView==='research'){
      setR1594Refresh(v=>v+1);
      void loadDates().catch(e=>setR1593Error(String(e)));
      if(total!==null)void search(page,false);
    }else if(activeView==='tracking')setR1594TrackingRefresh(v=>v+1);
    else if(activeView==='basket')setR1594BasketRefresh(v=>v+1);
    else setR1594AiRefresh(v=>v+1);
  };
  // R1595: manually request a missing verified symbol, then poll only that pair.
  // The protected API validates real discovery evidence; no KIS call from this browser.
  async function requestMissingQuote(r:Signal){
    const key=comparisonKey(r);
    if(r1595Requesting||r1595Timers.current.size>=3)return;
    if(!/^\d{6}$/.test(r.code)||!r.close_price||r.close_price<=0)return;
    setR1595Requesting(key);setR1595RequestNote('');
    try{
      const requestStartedAt=new Date().toISOString();
      const result=await requestSearchPriority([{code:r.code,day:r.day}]);
      if(result.not_verified){setR1595RequestNote(`${r.name||r.code}: 검증된 발견 기록이 없어 요청할 수 없습니다.`);return;}
      setR1595RequestNote(`${r.name||r.code}: ${result.queued?'수집 요청 완료':result.throttled?'최근 요청이 있어 대기 중':'수집 접수 확인 필요'} · 장중 거래시간에 수집됩니다.`);
      if(r1595Timers.current.has(key))return;
      let attempts=0,inFlight=false;
      const timer=window.setInterval(()=>{
        if(inFlight||document.visibilityState==='hidden')return;
        if(++attempts>12){window.clearInterval(timer);r1595Timers.current.delete(key);return;}
        inFlight=true;
        void fetchCompared([{code:r.code,day:r.day}]).then(data=>{
          setR1593Prices(prev=>({...prev,...data}));
          if(data[key]?.quote_status==='READY'&&data[key]?.latest_price&&
              data[key]?.quote_checked_at&&data[key].quote_checked_at>=requestStartedAt){
              window.clearInterval(timer);r1595Timers.current.delete(key);
            }
        }).catch(()=>{}).finally(()=>{inFlight=false;});
      },12000);
      r1595Timers.current.set(key,timer);
    }catch(e){setR1595RequestNote(e instanceof Error?e.message:'시세 수집 요청 오류');}
    finally{setR1595Requesting('');}
  }
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
    <div className="r1594-view-toolbar" role="group" aria-label="현재 화면 데이터 새로고침">
      <span>{({research:'종목 검색',tracking:'종목 추적',ai:'AI 시황',basket:'장바구니'} as const)[activeView]}</span>
      <button type="button" disabled={activeView==='research'&&(busy||requestBusy)}
        onClick={refreshCurrentView}><RefreshCw size={16}/> 새로고침</button>
    </div>
    {(watchDate||completedDate||scanInfo)&&<div className="r1581-scan-monitor" role="status">
      <RefreshCw size={16} className={watchDate?'r1581-pending':''}/>
      <div className="r1581-scan-text">
        <strong>{watchDate?`${watchDate} 검색 분석 중`:completedDate?`${completedDate} 분석 완료`:'검색 분석 안내'}</strong>
        <span>{scanInfo||'서버 처리 상태를 확인합니다.'}</span>
        {actionsUrl&&<a href={actionsUrl} rel="noopener noreferrer" target="_blank">GitHub 실행 기록</a>}
      </div>
      {completedDate&&<button type="button" onClick={()=>{
        const day=completedDate;setActiveView('research');setCompletedDate('');setScanInfo('');
        void search(1,false,gcFields,gcLogic,day);
      }}>완료 결과 보기</button>}
    </div>}
    {/* R153_BOTTOM_NAV_ONLY: navigation is in the bottom dock on every viewport. */}
    {installGuide&&<div className="install-guide" role="status"><button className="guide-close" onClick={()=>setInstallGuide(false)} aria-label="안내 닫기"><X size={17}/></button>
      <strong>휴대폰에 설치하는 방법</strong><p>안드로이드 Chrome: 오른쪽 위 ⋮ → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b></p>
      <p>아이폰 Safari: 공유 버튼 → <b>홈 화면에 추가</b></p>
      <p><strong>설치 상태:</strong> {installPrompt?'Chrome이 앱 설치 요청을 허용했습니다.':'Chrome 설치 이벤트가 아직 감지되지 않았습니다. 앱 파일 응답을 검사해 주세요.'}</p>
      <p><a href="/pwa-check.html" target="_blank" rel="noopener noreferrer">PWA 설치 진단 열기</a></p>
      <small>Cloudflare Access 로그인 페이지가 manifest·아이콘을 대신 반환하면 설치할 수 없을 수 있습니다. 접근 제어를 해제하지 말고 진단 결과를 확인하세요.</small>
    </div>}
    <main className={"app-main "+(activeView!=='research'?'r152-full-mode':'')}>
      <aside className={'panel search-panel '+(filterOpen?'filter-open':'filter-closed')} ref={formRef} id="search-panel">
        <div className="search-heading"><h2><SlidersHorizontal size={18}/> 검색 조건</h2><button type="button" className="filter-toggle" onClick={()=>setFilterOpen(v=>!v)} aria-expanded={filterOpen} aria-controls="filter-body">{filterOpen?'조건 접기':'조건 변경'} <ListFilter size={16}/></button></div>
        <div className="filter-body" id="filter-body">
          <p className="latest-label"><Database size={14}/> 저장된 최신 거래일 <strong>{latest||'확인 중'}</strong></p>
          <label>검색 방법</label><div className="switch"><button className={mode==='single'?'active':''} type="button" onClick={()=>setMode('single')}>지정 날짜</button><button className={mode==='range'?'active':''} type="button" onClick={()=>setMode('range')}>기간 검색</button></div>
          {mode==='single'?<><label htmlFor="scan-date">검색 날짜</label><input id="scan-date" type="date" value={date} onChange={e=>{setDate(e.target.value);setDataStatus('');}}/></>:
          <><label htmlFor="scan-start">시작일</label><input id="scan-start" type="date" value={start} onChange={e=>setStart(e.target.value)}/><label htmlFor="scan-end">종료일</label><input id="scan-end" type="date" value={end} onChange={e=>setEnd(e.target.value)}/></>}
          <label>기술 신호</label><div className="checks">{tags.map(t=><label className="check" key={t}><input type="checkbox" checked={signals.includes(t)} onChange={()=>flip(t)}/>{showSignal(t)}</label>)}</div>
          <label htmlFor="scan-logic">신호 조합</label><select id="scan-logic" value={logic} onChange={e=>setLogic(e.target.value)}><option value="any">하나라도 충족 (OR)</option><option value="all">모두 충족 (AND)</option></select>
          <div className="r1599-filters" role="group" aria-label="거래대금 검색 조건">
            <label htmlFor="r1599-amount">검색일 거래대금 최소 (억원)</label>
            <select id="r1599-amount" value={amountChoice} onChange={e=>{
              const next=e.target.value;setAmountChoice(next);
              // Preset turnover changes re-query immediately; custom entry still
              // needs Search to avoid requests for every keystroke.
              if(next!=='custom'&&total!==null)void search(1,false,gcFields,gcLogic,undefined,{amountEok:Number(next)});
            }}>
              <option value="0">전체 (제한 없음)</option><option value="100">100억원 이상</option>
              <option value="300">300억원 이상</option><option value="500">500억원 이상 (기본)</option>
              <option value="1000">1,000억원 이상</option><option value="custom">직접 입력</option>
            </select>
            {amountChoice==='custom'&&<input aria-label="최소 거래대금 직접 입력 (억원)" type="number" min="0" max="50000" step="1"
              value={customAmount} onChange={e=>setCustomAmount(e.target.value)}/>}
            <small>거래대금은 검색일 확정 일봉의 실제 원화 금액입니다. 금액이 저장되지 않은 과거 기록은 기준 검색에서 제외됩니다.</small>
          </div>
          <button className="primary search-submit" disabled={busy||requestBusy} onClick={()=>{void search(1);}}><Search size={18}/>{busy?'검색 중…':'종목 검색하기'}</button>
          <p className="small">저장된 결과를 조회합니다. 거래대금 기준은 당일 확정 일봉이며, 저장되지 않은 이전 금액은 추정하지 않습니다. 장중 현재가 아님.</p>
        </div>
        <div className="search-compact"><div><small>기준일</small><strong>{mode==='single'?date:`${start} ~ ${end}`}</strong></div><button onClick={()=>setFilterOpen(true)}><SlidersHorizontal size={16}/> 수정</button><button className="compact-run" disabled={busy||requestBusy} onClick={()=>{void search(1);}}><Search size={16}/> 검색</button></div>
      </aside>
      <section className="content">
        <div className={'r151-basket-content '+(activeView==='basket'?'':'r151-hidden')}>
          <SmartBasket quickAddRequest={basketRequest} onItemsChange={setBasketIds} active={activeView==='basket'} refreshKey={r1594BasketRefresh} patternHighlightMin={highlightMin} patternSampleMin={patternSampleMin}/>
        </div>
        <div className={'r152-tracking-content '+(activeView==='tracking'?'':'r151-hidden')}>
          <LiveMarket active={activeView==='tracking'} refreshKey={r1594TrackingRefresh}/>
        </div>
        <div className={'r152-ai-content '+(activeView==='ai'?'':'r151-hidden')}>
          <section ref={aiRef} id="ai-panel" className="r152-ai-section">
            <AiWidget key={'market-'+(mode==='single'?date:latest||end)+'-'+r1594AiRefresh} kind="market"
              date={mode==='single'?date:latest||end}
              observed={mode==='single'?days.find(d=>d.day===date)?.observed_stocks:null}
              matched={mode==='single'?days.find(d=>d.day===date)?.matched_stocks:null}
              events={mode==='single'?days.find(d=>d.day===date)?.signal_events:null}
              searchMatched={rows}/>
          </section>
        </div>
        <div className={'r151-research-content '+(activeView==='research'?'':'r151-hidden')}>
        <div className="stats" ref={summaryRef} id="summary-panel">
          <div className="metric"><span>검색 결과</span><strong>{total==null?'—':total.toLocaleString()}</strong><small>종목</small></div>
          <div className="metric"><span>검색 거래일</span><strong>{total==null?'—':days.length}</strong><small>저장된 날짜</small></div>
          <div className="metric"><span>최신 저장일</span><strong className="smallnum">{latest?.slice(5)||'—'}</strong><small>종가 데이터</small></div>
        </div>
        {error&&<div className="notice error" role="alert"><AlertCircle size={17}/>{error}</div>}
        {status&&<div className="notice"><AlertCircle size={17}/>{status}</div>}
        {scanInfo&&<div className="notice" role="status"><RefreshCw size={17}/><div>{scanInfo}{actionsUrl&&<div><a href={actionsUrl} target="_blank" rel="noreferrer">GitHub 실행 결과 확인</a></div>}</div></div>}
        <section className="panel result" ref={resultRef} id="results-panel">
          <div className="result-heading"><h2><BarChart3 size={18}/> 검색된 종목 <small>{total===null?'검색 전':total+'건'}</small></h2><span className="eod-pill"><Clock3 size={13}/> EOD</span></div>
          <p className="r1599-active-filters">검색 결과 기준 · 거래대금 {(appliedAmountEok??amountEok)>0?(appliedAmountEok??amountEok).toLocaleString('ko-KR')+'억원 이상':'전체'} · 토마토 강조 {highlightMin===null?'꺼짐':highlightMin+'% 이상 · 표본 '+patternSampleMin+'건 이상'}{onlyPattern&&highlightMin!==null?' · 해당 종목만 보기':''}{appliedAmountEok!==null&&appliedAmountEok!==amountEok?' · 거래대금 변경 미적용(검색 버튼을 누르세요)':''}</p>
          <p className="result-hint">검색일 확정 종가와 이후 D1 저장 시세·기간 고가를 구분해 표시합니다. 가격이 없으면 미수집으로 표시합니다.</p>
          {r1593Error&&<p className="r1593-comparison-status" role="status">가격 비교: {r1593Error}</p>}
          {r1595RequestNote&&<p className="r1595-request-status" role="status">{r1595RequestNote}</p>}
          {rows.length>0&&<p className="r1594-quote-note" role="status">{r1594QueueStatus} · 수집 가능한 시장 시간에만 KIS 가격이 갱신됩니다.</p>}
          <div className="gc-filter-panel r15102-unified-filter" aria-label="골든크로스 및 다중 조건 과거 패턴 필터">
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
            <div className="r15102-tomato-inline" role="group" aria-label="토마토색 과거 패턴 기준">
              <label htmlFor="r1599-pattern">토마토 기준</label>
              <select id="r1599-pattern" value={patternThreshold} onChange={e=>{
                const v=e.target.value as typeof patternThreshold;
                const nextMin=v==='off'?null:Number(v);
                setPatternThreshold(v);
                if(v==='off')setOnlyPattern(false);
                if(onlyPattern&&total!==null)void search(1,false,gcFields,gcLogic,undefined,{enabled:v!=='off',threshold:nextMin});
              }}>
                <option value="off">강조 안 함</option><option value="60">60% 이상</option>
                <option value="70">70% 이상 (기본)</option><option value="80">80% 이상</option><option value="90">90% 이상</option>
              </select>
              <label htmlFor="r15103-min-samples">표본</label>
              <select id="r15103-min-samples" aria-label="토마토 최소 표본 수" value={patternSampleMin}
                onChange={e=>{const nextMin=Number(e.target.value);setPatternSampleMin(nextMin);
                  if(total!==null)void search(1,false,gcFields,gcLogic,undefined,{minSamples:nextMin});
                }}>
                <option value={3}>3건 (소표본)</option><option value={4}>4건 (소표본)</option>
                <option value={5}>5건 (소표본)</option><option value={6}>6건 (소표본)</option>
                <option value={7}>7건 (소표본)</option><option value={8}>8건 (기본)</option>
                <option value={10}>10건</option><option value={15}>15건</option>
                <option value={20}>20건</option><option value={30}>30건</option>
              </select>
              <label className="r1599-hot-only"><input type="checkbox" checked={onlyPattern} disabled={patternThreshold==='off'}
                onChange={e=>{
                  const checked=e.target.checked;setOnlyPattern(checked);
                  if(total!==null)void search(1,false,gcFields,gcLogic,undefined,{enabled:checked});
                }}/> 해당 종목만 보기</label>
            </div>
            <p className="gc-filter-note">GC는 당일 발생 기준 · 토마토는 과거 10거래일 상승 관측 비율과 선택한 최소 표본 수를 함께 충족해야 합니다. 표본 3~7건은 소표본으로 통계적 신뢰도가 낮으며 미래 수익을 보장하지 않습니다.</p>
          </div>
          {rows.length>0&&<label className="result-quick-search"><Search size={16}/><span className="sr-only">현재 페이지 종목명 또는 코드 찾기</span><input type="search" value={localQuery} onChange={e=>setLocalQuery(e.target.value)} placeholder="현재 페이지에서 종목명 · 코드 찾기" aria-label="현재 페이지에서 종목명 또는 코드 찾기"/></label>}
          <div className="desktop-results tablewrap"><table><thead><tr><th>날짜</th><th>종목명 / 코드</th><th>신호</th><th>검색일 종가 / 최근 확인가 / 기간 최고가</th><th>RSI / GC</th><th>Slow(14,3,3) / GC</th><th>MACD / GC</th><th>돌파선 후보</th><th>상단 매물대</th></tr></thead><tbody>
            {visibleRows.length?visibleRows.map((r,i)=><tr key={`${r.code}-${r.day}-${i}`} className={'clickable'+(patternUp(r)!==null?' r159-tomato-stock':'')} tabIndex={0} onClick={()=>openDetail(r)} onKeyDown={e=>{if(e.key==='Enter')openDetail(r);}}>
              <td>{r.day}</td><td><div className="r151-desktop-stock">
                 <div><b>{displayName(r)}</b><div className="small">{r.code} · {amountLabel(r)}</div>
                 {patternEvidenceBlock(r)}
                 {patternDays(r).length>0&&<div className="r1599-pattern-dates" title={patternDays(r).join(' · ')}>과거 신호일 {patternDays(r).slice(-3).join(' · ')}{patternDays(r).length>3?' 외':''}</div>}</div>
                 <button type="button" className={'r151-quick-add '+(inBasket(r)?'saved':'')}
                   title={inBasket(r)?'이미 담긴 종목':'장바구니에 담기'}
                   aria-label={`${displayName(r)} ${inBasket(r)?'장바구니에 담김':'장바구니에 담기'}`}
                   disabled={inBasket(r)||!canBasket(r)||basketIds.length>=100}
                   onClick={e=>{e.stopPropagation();quickBasket(r);}}
                   onKeyDown={e=>e.stopPropagation()}>
                   {inBasket(r)?<CheckCircle2 size={16}/>:<ShoppingBasket size={16}/>}
                 </button>
               </div></td>
              <td>{r.signals.map(s=><span className="tag" key={s}>{showSignal(s)}</span>)}{techBadges(r).map(t=><span className="r1591-search-tech" key={t}>{t}</span>)}</td><td className="r1593-price-cell"><strong>{money(r.close_price)}원</strong><small> · 검색일 종가</small>
                <PriceCompareMini data={r1593Prices[comparisonKey(r)]} baseline={r.close_price} loading={r1593Busy&&!r1593Prices[comparisonKey(r)]}
                  onRequest={()=>{void requestMissingQuote(r);}} requesting={r1595Requesting===comparisonKey(r)}
                  requestDisabled={!!r1595Requesting||r1595Timers.current.size>=3}/>
              </td>
              <td>{fmt(r,'rsi')} <small>{crossed(r,'rsi_gc')}</small></td><td>{fmt(r,'slow_14_3_3_k')} / {fmt(r,'slow_14_3_3_d')} <small>{crossed(r,'slow_14_3_3_gc')}</small></td>
              <td>{fmt(r,'macd_12_26_9')} <small>{crossed(r,'macd_gc')}</small></td><td>{present(r,'valid_line_candidates_json')?`${validLines(r).length}개`:'미계산'}</td>
              <td>{profile(r)} · {supplyGrade(r)}</td>
            </tr>):<tr><td className="empty" colSpan={9}>{total!==null?'조건에 맞는 종목이 없습니다.':'날짜와 조건을 선택해 검색하세요.'}</td></tr>}</tbody></table></div>
          <div className="mobile-results">
            {visibleRows.length?visibleRows.map((r,i)=><div className={'r151-mobile-row'+(patternUp(r)!==null?' r159-tomato-stock':'')} key={`${r.code}-${r.day}-${i}`}>
              <div className="stock-card" role="button" tabIndex={0} onClick={()=>openDetail(r)}
                onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openDetail(r);}}}
                aria-label={`${displayName(r)} 상세 분석 보기`}>
              <div className="stock-top"><div className="stock-identity"><strong>{displayName(r)}</strong><span>{r.code} <span className="stock-dot">·</span> {r.day}</span></div><div className="stock-price"><b>{money(r.close_price)}<small>원</small></b><span>종가</span></div><ChevronRight size={19} className="stock-chevron"/></div>
              {patternEvidenceBlock(r)}
              <PriceCompareMini compact data={r1593Prices[comparisonKey(r)]} baseline={r.close_price} loading={r1593Busy&&!r1593Prices[comparisonKey(r)]}
                onRequest={()=>{void requestMissingQuote(r);}} requesting={r1595Requesting===comparisonKey(r)}
                requestDisabled={!!r1595Requesting||r1595Timers.current.size>=3}/>
              <div className="stock-tags">{r.signals.slice(0,4).map(s=><span className="tag" key={s}>{showSignal(s)}</span>)}{r.signals.length>4&&<span className="tag tag-more">+{r.signals.length-4}</span>}</div>
              <div className="r1599-mobile-meta">{amountLabel(r)}</div>
              {patternDays(r).length>0&&<div className="r1599-pattern-dates" title={patternDays(r).join(' · ')}>과거 신호일 {patternDays(r).slice(-3).join(' · ')}{patternDays(r).length>3?' 외':''}</div>}
              {techBadges(r).length>0&&<div className="r1591-mobile-tech">{techBadges(r).map(t=><span className="r1591-search-tech" key={t}>{t}</span>)}</div>}
               <div className="stock-quick"><div><small>RSI</small><strong>{fmt(r,'rsi',1)}</strong></div><div><small>Slow GC</small><strong className={flag(r,'slow_14_3_3_gc')?'positive':''}>{crossed(r,'slow_14_3_3_gc')}</strong></div><div><small>MACD GC</small><strong className={flag(r,'macd_gc')?'positive':''}>{crossed(r,'macd_gc')}</strong></div><div><small>상단 매물</small><strong>{supplyGrade(r)}</strong></div></div>
            </div>
              <button type="button" className={'r151-mobile-add '+(inBasket(r)?'saved':'')}
                title={inBasket(r)?'장바구니에 담김':'장바구니에 담기'}
                aria-label={`${displayName(r)} ${inBasket(r)?'장바구니에 담김':'장바구니에 담기'}`}
                disabled={inBasket(r)||!canBasket(r)||basketIds.length>=100}
                onClick={()=>quickBasket(r)}>
                {inBasket(r)?<CheckCircle2 size={19}/>:<ShoppingBasket size={19}/>}
                <span>{inBasket(r)?'담김':'담기'}</span>
              </button>
              {/* Quote refresh is now visible directly beside the saved quote above. */}
              </div>):<div className="mobile-empty"><Search size={30}/><strong>{localQuery?'현재 페이지에서 일치하는 종목이 없습니다.':total===0?'해당 조건의 종목이 없습니다.':'검색 조건을 선택해 주세요.'}</strong><p>{onlyPattern?'토마토 조건은 10거래일 패턴·최소 표본 수에 더해 선택한 골든크로스와 거래대금 조건도 모두 충족해야 합니다. GC 전체 종목 및 거래대금 전체로 비교해 보세요.':gcFields.length?'선택한 골든크로스 조건을 만족하는 종목이 없습니다.':'과거 거래일을 선택한 다음 검색 버튼을 누르세요.'}</p><button onClick={()=>nav('search')}>검색 조건 열기</button></div>}
          </div>
          {total!==null&&total>100&&<div className="pager"><button disabled={busy||page===1} onClick={()=>{void search(page-1,false);}}>이전</button><span>{page} / {Math.ceil(total/100)}</span><button disabled={busy||page>=Math.ceil(total/100)} onClick={()=>{void search(page+1,false);}}>다음</button></div>}
        </section>
        {days.length>0&&<section className="panel daily-panel"><h2><CalendarDays size={18}/> 날짜별 요약</h2><div className="tablewrap"><table><thead><tr><th>날짜</th><th>관측 종목</th><th>신호 건수</th><th>신호 종목</th></tr></thead><tbody>{days.map(d=><tr key={d.day}><td>{d.day}</td><td>{d.observed_stocks}</td><td>{d.signal_events}</td><td>{d.matched_stocks}</td></tr>)}</tbody></table></div></section>}
        <p className="disclaimer"><AlertCircle size={14}/> RSI·MACD·유효선 후보·상단 매물대 강도는 연구용 계산값이며 현재가·실제 호가 매물대가 아닙니다. R0.8 이전 분석 기록은 재분석해야 신규 정보가 표시됩니다.</p>
        </div>
      </section>
    </main>
    <footer>BLUE Signal Lab · RESEARCH ONLY · 매매 주문 기능 없음</footer>
    <nav className="mobile-dock" aria-label="모바일 메뉴">
      <button className={activeView==='research'?'dock-primary':''} onClick={()=>nav('search')}><BarChart3 size={20}/><span>검색</span></button>
      <button className={activeView==='tracking'?'dock-primary':''} onClick={()=>nav('tracking')}><Radar size={20}/><span>추적</span></button>
      <button className={activeView==='ai'?'dock-primary':''} onClick={()=>nav('ai')}><Activity size={20}/><span>AI 시황</span></button>
      <button className={activeView==='basket'?'dock-primary':''} onClick={()=>nav('basket')}><ShoppingBasket size={20}/><span>장바구니</span></button>
    </nav>
    {selected&&<div className="detail-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)closeDetail();}}>
      <section className="detail-sheet" role="dialog" aria-modal="true" aria-label={`${displayName(selected)} 상세 분석`}>
        <div className="detail-handle" aria-hidden="true"/><div className="detail-toolbar"><button onClick={closeDetail} className="detail-back"><ArrowLeft size={19}/> 뒤로</button><span className="detail-eod">일봉 · 연구용</span><button onClick={closeDetail} className="detail-x" aria-label="상세 닫기"><X size={21}/></button></div>
        <div className="detail-head"><div><small>{selected.code} · {selected.day}</small><h2>{displayName(selected)}</h2></div><div className="detail-close"><span>종가</span><strong>{money(selected.close_price)} <small>원</small></strong></div></div>
        <PriceCompareMini compact data={r1593Prices[comparisonKey(selected)]} baseline={selected.close_price} loading={r1593Busy&&!r1593Prices[comparisonKey(selected)]}
          onRequest={()=>{void requestMissingQuote(selected);}} requesting={r1595Requesting===comparisonKey(selected)}
          requestDisabled={!!r1595Requesting||r1595Timers.current.size>=3}/>
        <div className="study-tags">{selected.signals.map(s=><span key={s}>{showSignal(s)}</span>)}</div>
        <StockChart key={'chart-'+selected.code+'-'+selected.day} code={selected.code}
          day={selected.day} name={displayName(selected)}
          supplyPrice={num(selected,'supply_reference_price')}
          supplyGrade={supplyGrade(selected)}
          lineCandidates={validLines(selected).map(l=>({signal:l.signal,price:l.price}))} highlightThreshold={highlightMin} highlightSamplesMin={patternSampleMin}/>
        <h3 className="detail-section-title"><Activity size={17}/> 보조지표</h3>
        <div className="info-grid indicator-grid">
          <div><strong>RSI (14) / Signal (9)</strong><p className="indicator-value">{fmt(selected,'rsi')} <small>/ {fmt(selected,'rsi_signal')}</small></p><p className={flag(selected,'rsi_gc')?'positive':''}>{crossed(selected,'rsi_gc')} · 최근 GC {lastCross(selected,'rsi_last_gc')}</p></div>
          <div><strong>Slow (14,3,3)</strong><p className="indicator-value">{fmt(selected,'slow_14_3_3_k')} <small>/ {fmt(selected,'slow_14_3_3_d')}</small></p><p className={flag(selected,'slow_14_3_3_gc')?'positive':''}>{crossed(selected,'slow_14_3_3_gc')} · 최근 GC {lastCross(selected,'slow_14_3_3_last_gc')}</p></div>
          <div><strong>MACD (12,26,9)</strong><p className="indicator-value">{fmt(selected,'macd_12_26_9')} <small>/ {fmt(selected,'macd_signal_9')}</small></p><p className={flag(selected,'macd_gc')?'positive':''}>{crossed(selected,'macd_gc')} · 최근 GC {lastCross(selected,'macd_last_gc')}</p></div>
          <div><strong>Slow (12,5,5)</strong><p className="indicator-value">{fmt(selected,'slow_12_5_5_k')} <small>/ {fmt(selected,'slow_12_5_5_d')}</small></p><p>{crossed(selected,'slow_12_5_5_gc')} · 최근 GC {lastCross(selected,'slow_12_5_5_last_gc')}</p></div>
          <div><strong>Slow (20,12,12)</strong><p className="indicator-value">{fmt(selected,'slow_20_12_12_k')} <small>/ {fmt(selected,'slow_20_12_12_d')}</small></p><p>{crossed(selected,'slow_20_12_12_gc')} · 최근 GC {lastCross(selected,'slow_20_12_12_last_gc')}</p></div>
          <div><strong>상단 매물대 (120봉 추정)</strong><p className="indicator-value">{profile(selected)} <small>· {supplyGrade(selected)}</small></p><p>상대 강도 {fmt(selected,'supply_strength_relative_pct')}% · 기준 {fmt(selected,'supply_reference_price',0)}원</p></div>
        </div>
        <h3 className="detail-section-title"><BarChart3 size={17}/> 이동평균 배열·돌파 (확정 일봉)</h3>
         <div className="r159-tech-grid">
           <div><b>역배열 (20&lt;40&lt;60)</b><strong>{maDown(selected)}</strong></div>
           <div><b>정배열 전환</b><strong>{techFlag(selected,'ma_to_up')}</strong></div>
           <div><b>112일선 상향 돌파</b><strong>{techFlag(selected,'ma112_cross')}</strong><small>MA112 {fmt(selected,'ma112',0)}원</small></div>
           <div><b>224일선 상향 돌파</b><strong>{techFlag(selected,'ma224_cross')}</strong><small>MA224 {fmt(selected,'ma224',0)}원</small></div>
         </div>
         <p className="r159-data-note">상향 돌파는 전일 종가가 전일 이평선 이하이고, 당일 종가가 당일 이평선을 초과한 경우입니다. 이전 분석일은 재검색해야 전환 이벤트가 표시됩니다.</p>
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

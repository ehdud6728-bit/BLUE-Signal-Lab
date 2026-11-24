import RecentPatternReference from './RecentPatternReference';
import RecentPatternRanking from './RecentPatternRanking';
import StockChart from './StockChart';
import LiveMarket from './LiveMarket';
import SmartBasket, {type BasketQuickAddRequest} from './SmartBasket';
import PriceCompareMini from './PriceCompareMini';
import SymbolAnalysisPanel from './SymbolAnalysisPanel';
import TursoEodRecovery, {type TursoDay} from './TursoEodRecovery';
import TursoResearchProgress from './TursoResearchProgress';
import TursoProvisionalToday from './TursoProvisionalToday';
import TursoAiReadiness from './TursoAiReadiness';
import {type TursoProgressStage} from './turso-research-progress';
import {requestSearchPriority} from './search-priority';
import {comparisonKey,fetchCompared,fetchComparedTursoFirst,fetchComparedTursoOnly,
  refreshKisQuoteToTurso,type PriceCompare} from './price-compare';
import {missingKisSearchQuotes} from './auto-kis-search';
import {discoveryTechnicalBadges} from './discovery-technical';
import {researchCardClasses,validatedResearchSignal} from './research-gold-highlight';
import './r1595-group-price.css';
import AiWidget from './AiWidget';
import React, {useCallback,useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Search, CalendarDays, BarChart3, AlertCircle, RefreshCw, SlidersHorizontal, ListFilter, X, ChevronRight, Download, ArrowLeft, Activity, Clock3, Database, CheckCircle2, ShoppingBasket, Radar, ScanSearch} from 'lucide-react';
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
import './r15116-technical-filters.css';
import './r15125-result-tools.css';
// R1581_SCAN_RESUME: persistent scan status across tabs and reloads.
import './r1581-scan-monitor.css';
import './r-research-gold-outline.css';

// Keep the existing production API and Cloudflare Access cookies.
const API = (import.meta.env.VITE_API_BASE || 'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/, '');
type Signal = {code:string;name:string|null;day:string;signals:string[];close_price:number|null;supply_distance_pct:number|null;extras:Record<string,unknown>;
 observed_high_pct?:number|null;observed_low_pct?:number|null;amount_ratio20_sort?:number|null;research_recommendation?:unknown};
type Day = {day:string;observed_stocks:number;signal_events:number;matched_stocks:number};
type ScanStatus = 'READY'|'NOT_IMPORTED'|'PENDING'|'FAILED'|'';
type Line = {signal:string;price:number;gap_from_close_pct:number;slope_pct:number|null;status:string};
type GcKey='rsi'|'slow14'|'slow12'|'slow20'|'macd';
type TechKey='inverse'|'ma112'|'ma224';
type ResultSort='recent'|'highest_gain'|'lowest_return'|'amount_surge'|'amount_decline';
const TECH_OPTIONS:{key:TechKey;label:string}[]=[
  {key:'inverse',label:'역배열 (20<40<60)'},
  {key:'ma112',label:'112일선 상향 돌파'},
  {key:'ma224',label:'224일선 상향 돌파'}
];
const GC_OPTIONS:{key:GcKey;label:string}[]=[
  {key:'rsi',label:'RSI GC'},
  {key:'slow14',label:'Slow 14·3·3 GC'},
  {key:'slow12',label:'Slow 12·5·5 GC'},
  {key:'slow20',label:'Slow 20·12·12 GC'},
  {key:'macd',label:'MACD GC'},
];
const ALL_GC_KEYS=GC_OPTIONS.map(x=>x.key);
type InstallPrompt = Event & {prompt:()=>Promise<void>;userChoice:Promise<{outcome:string}>};
// Include existing lower-band signals in default OR searches so that
// historical rebounds are not silently hidden by the search UI.
const tags=['BB20','BB30','BB40','ENV20','ENV40',
  'BB20_LOWER','BB30_LOWER','BB40_LOWER','BB40_LOWER_ALT','BB30_LOWER_RECLAIM',
  'ENV20_LOWER_TOUCH'];
const todayKST=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const eodRequestReadyKST=()=>new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
}).format(new Date()) >= '15:40';
const provisionalWindowKST=()=>new Intl.DateTimeFormat('en-GB',{
  timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
}).format(new Date()) < '22:00';
const SCAN_WATCH_KEY='blue_r1581_pending_scan_date_v1';
const TURSO_WATCH_KEY='blue_turso_pending_research_date_v1';
const rememberedScanDate=():string=>{
  try{
    const day=localStorage.getItem(SCAN_WATCH_KEY)||'';
    if(!/^20\d{2}-\d{2}-\d{2}$/.test(day))return '';
    const d=new Date(day+'T00:00:00Z');
    return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===day?day:'';
  }catch{return '';}
};
const rememberedTursoDate=():string=>{
  try{const day=localStorage.getItem(TURSO_WATCH_KEY)||'';
    return /^20\d{2}-\d{2}-\d{2}$/.test(day)&&
      new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day?day:'';
  }catch{return '';}
};
const researchRequestError=(message:string)=>({
  VERIFIED_KRX_EOD_NOT_READY:'아직 해당 날짜의 확정 일봉이 완성되지 않았습니다. 15:40 이후 다시 요청해 주세요.',
  INVALID_TURSO_RESEARCH_DAY:'거래가 이루어진 과거 평일 날짜를 선택해 주세요.',
  TURSO_RESEARCH_QUEUE_FULL:'이미 분석 3건이 진행 중입니다. 완료 후 다시 요청해 주세요.',
  GITHUB_DISPATCH_NOT_CONFIGURED:'GitHub Actions 실행 연결이 설정되지 않았습니다.',
  GITHUB_DISPATCH_FAILED:'GitHub Actions 실행 요청에 실패했습니다.',
  ACCESS_REQUIRED:'로그인이 필요합니다. Cloudflare Access를 확인해 주세요.',
}[message]||'분석 시작에 실패했습니다. 서버 연결 상태를 확인해 주세요.');
const showSignal=(t:string)=>({
  BB20_LOWER:'B20 하단 돌파',
  BB30_LOWER:'B30 하단 돌파(하락선)',
  BB40_LOWER:'B40 하단 돌파',
  BB40_LOWER_ALT:'B40 하단 돌파(대체)',
  BB30_LOWER_RECLAIM:'B30 하단 반등(상승·수평선)',
  ENV20_LOWER_TOUCH:'엔벨(20,-20%) 하단 첫 터치',
}[t]||t.replace(/^(?:BLUE|BB)(?=\d)/i,'B'));
const money=(n:number|null|undefined)=>n==null?'—':n.toLocaleString('ko-KR');

function App(){
  // Turso is the primary source for verified EOD. D1 is the fallback for
  // its pre-existing signal interface, never a substitute for full EOD rows.
  const [storageMode,setStorageMode]=useState<'checking'|'turso'|'d1'|'unavailable'>('checking');
  const [tursoDays,setTursoDays]=useState<TursoDay[]>([]);
  const [eodRefresh,setEodRefresh]=useState(0);
  // Turso EOD candles alone cannot recreate signals. The separately audited
  // research snapshots serve patterns; the legacy D1 search remains fallback.
  const [searchSource,setSearchSource]=useState<'patterns'|'daily'>('patterns');
  const [patternStatus,setPatternStatus]=useState<'checking'|'ready'|'unavailable'>('checking');
  const [patternBackend,setPatternBackend]=useState<'turso'|'d1'>('turso');
  const [patternSourceError,setPatternSourceError]=useState('');
  const patternDatesInitialized=useRef(false);
  const patternSearchActive=(storageMode==='d1'||(storageMode==='turso'&&searchSource==='patterns'))&&patternBackend==='d1';
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
  const [appliedNameQuery,setAppliedNameQuery]=useState('');
  const [resultSort,setResultSort]=useState<ResultSort>('recent');
  const [appliedSort,setAppliedSort]=useState<ResultSort>('recent');
  const [gcFields,setGcFields]=useState<GcKey[]>([]);
  const [gcLogic,setGcLogic]=useState<'any'|'all'>('any');
  const [techFields,setTechFields]=useState<TechKey[]>([]);
  const [techLogic,setTechLogic]=useState<'any'|'all'>('any');
  // R1599 shared options: search outlines, detail chart and basket use same threshold.
  const [amountChoice,setAmountChoice]=useState(()=>{
    try{const v=localStorage.getItem('blue_r1599_amount_choice');return ['0','100','300','500','1000','custom'].includes(v||'')?v!:'0';}
    catch{return '0';}
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
  const [activeView,setActiveView]=useState<'research'|'analysis'|'tracking'|'ai'|'basket'>('research');
  const [analysisRefresh,setAnalysisRefresh]=useState(0);
  const [basketIds,setBasketIds]=useState<string[]>(()=>{
    try{const x=JSON.parse(localStorage.getItem('blue_r15_basket_v1')||'[]');
      return Array.isArray(x)?x.filter((i:unknown)=>Boolean(i&&typeof i==='object'&&'id' in i)).map((i:any)=>String(i.id)):[];
    }catch{return [];}
  });
  const [basketRegularCount,setBasketRegularCount]=useState(0);
  const onBasketItemsChange=useCallback((ids:string[],regularCount:number)=>{
    setBasketIds(ids);setBasketRegularCount(regularCount);
  },[]);
  const basketSequence=useRef(0);
  // Preserve rapid taps even before the user opens the basket tab.
  const [basketRequests,setBasketRequests]=useState<BasketQuickAddRequest[]>([]);
  const [basketNotice,setBasketNotice]=useState('');
  const [status,setStatus]=useState('');
  const [dataStatus,setDataStatus]=useState<ScanStatus>('');
  const [requestBusy,setRequestBusy]=useState(false);
  const [watchDate,setWatchDate]=useState(rememberedScanDate);
  const [completedDate,setCompletedDate]=useState('');
  const [scanInfo,setScanInfo]=useState('');
  const [actionsUrl,setActionsUrl]=useState('');
  const [tursoWatchDate,setTursoWatchDate]=useState(rememberedTursoDate);
  const [tursoRequestDate,setTursoRequestDate]=useState(rememberedTursoDate);
  const [tursoCompletedDate,setTursoCompletedDate]=useState('');
  const [tursoScanInfo,setTursoScanInfo]=useState('');
  const [tursoActionsUrl,setTursoActionsUrl]=useState('');
  const [tursoStage,setTursoStage]=useState<TursoProgressStage>('REQUESTED');
  const [tursoStartedAt,setTursoStartedAt]=useState(0);
  const [tursoFinishedAt,setTursoFinishedAt]=useState(0);
  const [filterOpen,setFilterOpen]=useState(true);
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
  // Research price comparison must follow the selected research backend.
  // Turso-first reads verified EOD/saved quotes without touching D1 on success.
  const [r1593Prices,setR1593Prices]=useState<Record<string,PriceCompare>>({});
  const [r1593Busy,setR1593Busy]=useState(false);
  const [r1593Error,setR1593Error]=useState('');
  const [r1593AutoStatus,setR1593AutoStatus]=useState('');
  const autoQuoteAttempted=useRef<Set<string>>(new Set());
  useEffect(()=>{
    if(activeView!=='research'||!rows.length)return;
    const ctrl=new AbortController();setR1593Busy(true);setR1593Error('');setR1593Prices({});
    setR1593AutoStatus('');
    const readPrices=patternBackend==='turso'?fetchComparedTursoFirst:fetchCompared;
    void readPrices(rows,ctrl.signal,partial=>{if(!ctrl.signal.aborted)setR1593Prices(prev=>({...prev,...partial}));}).then(result=>{
      if(ctrl.signal.aborted)return;
      setR1593Prices(prev=>({...prev,...result}));
      // A search itself authorizes a bounded missing-price check. The server
      // still requires Cloudflare Access and enforces global KIS quotas.
      if(patternBackend!=='turso')return;
      const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',weekday:'short',
        hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
      const clock=Object.fromEntries(parts.map(x=>[x.type,x.value]));
      const hhmm=Number(clock.hour)*60+Number(clock.minute);
      if(!['Mon','Tue','Wed','Thu','Fri'].includes(clock.weekday)||hhmm<540||hhmm>=1320)return;
      const today=todayKST();
      // A fresh search can recheck a stale quote in a later 15-minute window.
      // This remains bounded by the existing KIS server-side rate limits.
      const quoteWindow=Math.floor(Date.now()/(15*60*1000));
      const missing=missingKisSearchQuotes(rows,result,today).filter(item=>
        !autoQuoteAttempted.current.has(today+':'+quoteWindow+':'+item.code));
      if(!missing.length)return;
      void (async()=>{
        let refreshed=0;
        setR1593AutoStatus(`최신가 없는 ${missing.length}종목 KIS 자동 조회 시작 · 검색 결과는 바로 사용 가능`);
        for(let i=0;i<missing.length&&!ctrl.signal.aborted;i++){
          const item=missing[i];
          autoQuoteAttempted.current.add(today+':'+quoteWindow+':'+item.code);
          try{
            const fetched=await refreshKisQuoteToTurso(item.code,ctrl.signal);
            if(['SAVED','COOLDOWN'].includes(fetched.status)){
              const latest=await fetchComparedTursoOnly([item],ctrl.signal);
              if(!ctrl.signal.aborted){setR1593Prices(prev=>({...prev,...latest}));
                if(latest[comparisonKey(item)]?.status==='READY')refreshed++;}
            }
            if(!ctrl.signal.aborted)setR1593AutoStatus(`KIS 최신가 자동 확인 ${i+1}/${missing.length}종목 · ${refreshed}종목 반영`);
            if(fetched.status==='DISABLED'||fetched.status==='MARKET_CLOSED'||
              fetched.status==='RATE_LIMITED'||fetched.status.startsWith('TURSO_TOKEN_'))break;
          }catch(e){if(ctrl.signal.aborted)break;}
          // Twenty calls/minute is the instant-route server cap. Space
          // browser requests, and let the server refuse concurrent users.
          if(i<missing.length-1&&!ctrl.signal.aborted){
            await new Promise<void>(resolve=>{
              const timer=window.setTimeout(done,3100);
              function done(){ctrl.signal.removeEventListener('abort',onAbort);resolve();}
              function onAbort(){window.clearTimeout(timer);done();}
              ctrl.signal.addEventListener('abort',onAbort,{once:true});
            });
          }
        }
        if(!ctrl.signal.aborted)setR1593AutoStatus(refreshed?
          `KIS 최신가 ${refreshed}종목 반영 · 나머지는 저장 시각 또는 수집 제한을 확인하세요.`:
          'KIS 최신가를 확보하지 못했습니다. 저장 시세와 수집 상태를 유지합니다.');
      })();
    })
      .catch(e=>{if(!ctrl.signal.aborted)setR1593Error(e instanceof Error?e.message:'최근 시세 확인 실패');})
      .finally(()=>{if(!ctrl.signal.aborted)setR1593Busy(false);});
    return ()=>ctrl.abort();
  },[rows,activeView,r1594Refresh,patternBackend]);

  // R1594: submit at most eight verified visible search symbols to the server queue.
  // This does NOT block the D1 search and NEVER calls KIS from the browser.
  useEffect(()=>{
    // Turso research records alone are not proof of D1 queue enrollment.
    // Avoid implicit D1 writes/expensive reads while the D1 backend is down.
    if(activeView!=='research'||!rows.length||patternBackend==='turso')return;
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
  },[rows,activeView,r1594Refresh,patternBackend]);

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
  const fallbackToD1=useCallback(async(message='Turso 조회 불가'):Promise<string|null>=>{
    try{
      const response=await fetch(API+'/api/dates',{credentials:'include',cache:'no-store'});
      if(!response.ok)throw Error(`D1 조회 오류 ${response.status}`);
      const body=await response.json() as {latest?:string};
      if(typeof body.latest!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(body.latest))
        throw Error('D1 분석 데이터 없음');
      setStorageMode('d1');setTursoDays([]);setLatest(body.latest);
      setPatternBackend('d1');setPatternStatus('ready');
      setDate(body.latest);setStart(body.latest);setEnd(body.latest);
      setError(`${message} · 기존 D1 분석 데이터로 전환했습니다. D1에도 일부 기능 제한이 있을 수 있습니다.`);
      return body.latest;
    }catch(e){
      setStorageMode('unavailable');setTursoDays([]);setLatest(null);
      setError(`Turso와 D1 모두 조회할 수 없습니다. ${e instanceof Error?e.message:'연결 확인 필요'}. 두 DB의 데이터는 변경하지 않았습니다.`);
      return null;
    }
  },[]);
  const loadDates=useCallback(async():Promise<'turso'|'d1'|'unavailable'>=>{
    try{
      const response=await fetch(API+'/api/eod/dates',{credentials:'include',cache:'no-store'});
      if(!response.ok)throw Error(`Turso EOD 날짜 API ${response.status}`);
      const body=await response.json() as {storage?:string;items?:TursoDay[]};
      if(body.storage!=='TURSO'||!Array.isArray(body.items)||!body.items.length||
        !body.items.every(d=>/^20\d{2}-\d{2}-\d{2}$/.test(d.day)&&Number.isInteger(d.rows)&&d.rows>=1700))
        throw Error('Turso 검증 완료 날짜 없음');
      setStorageMode('turso');setTursoDays(body.items);setError('');setEodRefresh(x=>x+1);
      return 'turso';
    }catch(e){
      const last=await fallbackToD1(e instanceof Error?e.message:'Turso 연결 오류');
      return last?'d1':'unavailable';
    }
  },[fallbackToD1]);
  const loadPatternDates=useCallback(async(forceD1=false)=>{
    setPatternStatus('checking');setPatternSourceError('');
    try{
      let latestDay:string|null=null,source:'turso'|'d1'='turso';
      let tursoError='';
      if(!forceD1){
        try{
          const response=await fetch(API+'/api/research/dates',{credentials:'include',cache:'no-store'});
          if(!response.ok)throw Error(`Turso 연구 분석 날짜 조회 오류 ${response.status}`);
          const body=await response.json() as {storage?:string;latest?:string};
          if(body.storage!=='TURSO'||typeof body.latest!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(body.latest))
            throw Error('Turso에 검증된 패턴 분석 날짜가 없습니다.');
          latestDay=body.latest;
        }catch(e){tursoError=e instanceof Error?e.message:'Turso 연결 오류';}
      }
      if(!latestDay){
        const response=await fetch(API+'/api/dates',{credentials:'include',cache:'no-store'});
        if(!response.ok)throw Error(`D1 분석 날짜 조회 오류 ${response.status}`);
        const body=await response.json() as {latest?:string};
        if(typeof body.latest!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(body.latest))
          throw Error('저장된 기술 패턴 분석 날짜가 없습니다.');
        latestDay=body.latest;source='d1';
      }
      setPatternBackend(source);
      setPatternSourceError(source==='d1'?tursoError:'');
      setLatest(latestDay);setDate(latestDay);setStart(latestDay);setEnd(latestDay);
      setPatternStatus('ready');
    }catch(e){
      setPatternStatus('unavailable');
      setPatternSourceError(e instanceof Error?e.message:'Turso/D1 분석 날짜를 조회하지 못했습니다.');
      setRows([]);setDays([]);setTotal(null);
    }
  },[]);
  const onTursoUnavailable=useCallback((message:string)=>{void fallbackToD1(message);},[fallbackToD1]);
  useEffect(()=>{void loadDates();},[loadDates]);
  useEffect(()=>{
    if(storageMode==='turso'&&searchSource==='patterns'&&!patternDatesInitialized.current){
      patternDatesInitialized.current=true;
      void loadPatternDates();
    }
  },[storageMode,searchSource,loadPatternDates]);

  // R1581_SCAN_RESUME: refresh/reopen must not silently lose the server-side scan.
  useEffect(()=>{
    try{if(watchDate)localStorage.setItem(SCAN_WATCH_KEY,watchDate);
      else localStorage.removeItem(SCAN_WATCH_KEY);}catch{/* storage denied; this tab still polls */}
  },[watchDate]);
  useEffect(()=>{
    try{if(tursoWatchDate)localStorage.setItem(TURSO_WATCH_KEY,tursoWatchDate);
      else localStorage.removeItem(TURSO_WATCH_KEY);}catch{/* storage denied; this tab still polls */}
  },[tursoWatchDate]);

  async function requestTursoScan(day:string){
    setRequestBusy(true);
    setTursoRequestDate(day);
    setTursoStage('REQUESTED');setTursoStartedAt(Date.now());setTursoFinishedAt(0);
    setTursoActionsUrl('');
    setTursoScanInfo(`${day}의 Turso 패턴 분석 시작을 요청하고 있습니다.`);
    try{
      const response=await fetch(API+'/api/research/request',{
        method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},
        credentials:'include',body:JSON.stringify({date:day}),
      });
      const result=await response.json() as {status?:string;error?:string;deduplicated?:boolean};
      if(!response.ok)throw Error(result.error||'TURSO_RESEARCH_REQUEST_UNAVAILABLE');
      if(result.status==='READY'){
        setTursoWatchDate('');setTursoCompletedDate(day);
        setTursoStage('READY');setTursoFinishedAt(Date.now());
        setTursoScanInfo(`${day} 패턴 분석이 이미 준비되어 있습니다.`);
        if(mode==='single'&&date===day)void search(1,false,gcFields,gcLogic,day);
      }else{
        setTursoCompletedDate('');setTursoWatchDate(day);
        setTursoStage('QUEUED');
        setTursoScanInfo(result.deduplicated?
          `${day} 분석이 이미 진행 중입니다. 완료 상태를 이어서 확인합니다.`:
          `${day} KRX 일봉 검증과 전체시장 패턴 분석을 시작했습니다. 완료되면 자동으로 검색합니다.`);
      }
    }catch(e){
      setTursoWatchDate('');setTursoCompletedDate('');setTursoStage('FAILED');
      setTursoFinishedAt(Date.now());
      setTursoScanInfo(researchRequestError(e instanceof Error?e.message:''));
    }finally{setRequestBusy(false);}
  }

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
  async function search(p=1,scroll=true,selectedGc:GcKey[]=gcFields,selectedGcLogic:'any'|'all'=gcLogic,requestedDay?:string,patternOverride?:{enabled?:boolean;threshold?:number|null;minSamples?:number;amountEok?:number},selectedTech:TechKey[]=techFields,selectedTechLogic:'any'|'all'=techLogic,queryOverride?:{q?:string;sort?:ResultSort}){
    if(storageMode==='turso'&&patternStatus!=='ready'){
      setError('기술 패턴 검색에 사용할 감사 완료 분석 데이터 연결을 먼저 확인해 주세요.');
      return;
    }
    const serial=++searchVersion.current;
    const queryAmountEok=patternOverride?.amountEok??amountEok;
    const queryName=(queryOverride?.q??appliedNameQuery).trim();
    const querySort=queryOverride?.sort??appliedSort;
    if(!Number.isInteger(queryAmountEok)||queryAmountEok<0||queryAmountEok>50000){
      setError('거래대금은 0~50,000억원 사이 정수로 입력하세요.');return;
    }
    setBusy(true);setError('');setStatus('');
    const queryMode=requestedDay?'single':mode,queryDate=requestedDay||date;
    if(requestedDay){setMode('single');setDate(requestedDay);}
    try{
      const u=new URL(API+(patternBackend==='turso'?'/api/research/search':'/api/search'));
      u.searchParams.set('mode',queryMode);
      if(queryMode==='single')u.searchParams.set('date',queryDate);
      else {u.searchParams.set('start',start);u.searchParams.set('end',end);}
      u.searchParams.set('signals',signals.join(','));u.searchParams.set('logic',logic);u.searchParams.set('page',String(p));
      if(queryName)u.searchParams.set('q',queryName);
      u.searchParams.set('sort',querySort);
      if(selectedGc.length){u.searchParams.set('gc',selectedGc.join(','));u.searchParams.set('gc_logic',selectedGcLogic);}
      if(selectedTech.length){u.searchParams.set('tech',selectedTech.join(','));u.searchParams.set('tech_logic',selectedTechLogic);}
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
      // Fast path: a day later than the latest audited research snapshot
      // cannot already have a Turso pattern result. Do not wait for a costly
      // missing-day SQL search before showing the real collection status.
      if(queryMode==='single'&&patternBackend==='turso'&&latest&&queryDate>latest){
        setRows([]);setDays([]);setTotal(null);setPage(1);setSelected(null);
        setDataStatus('NOT_IMPORTED');setAppliedNameQuery(queryName);
        setAppliedSort(querySort);setAppliedAmountEok(queryAmountEok);
        if(queryDate>todayKST())setStatus('아직 거래가 이루어지지 않은 날짜입니다.');
        else if(queryDate===todayKST()&&provisionalWindowKST())
          setStatus('오늘 KRX 확정 분석은 아직 없습니다. 22시까지는 아래 KIS 수집분의 잠정 일봉 관찰을 보여드립니다. 확정 BLUE 패턴은 별도 검증이 필요합니다.');
        else await requestTursoScan(queryDate);
        return;
      }
      let r=await fetch(u.toString(),{credentials:'include',cache:'no-store'});
      // D1 is only a secondary path. An HTTP 400 means the query was invalid
      // and must not silently turn into a different source/result.
      if(patternBackend==='turso'&&r.status>=500){
        u.pathname='/api/search';
        r=await fetch(u.toString(),{credentials:'include',cache:'no-store'});
        if(r.ok){setPatternBackend('d1');setPatternSourceError('Turso 패턴 검색 불가 · D1 보조 DB로 전환됨');}
      }
      const d=await r.json();
      if(!r.ok)throw new Error(d.error||`검색 오류: ${r.status}`);
      // An older API silently ignores q/sort and would show an incorrect
      // page-local-looking result; require the new server to echo both values.
      if(d.q!==queryName||d.sort!==querySort)
        throw new Error('전체페이지 종목명 검색·정렬용 API Worker가 아직 배포되지 않았습니다. API 배포 후 다시 검색해 주세요.');
      if(serial!==searchVersion.current)return;
      // No imported daily candles is NOT a genuine zero-signal scan.
      setRows(d.items||[]);setDays(d.daily_counts||[]);
      setTotal(d.data_status==='NOT_IMPORTED'?null:d.total);
      setPage(p);setSelected(null);setDataStatus(d.data_status||'');
      setAppliedNameQuery(queryName);setAppliedSort(querySort);
      setAppliedAmountEok(queryAmountEok);
      if(scroll&&d.data_status!=='NOT_IMPORTED'){
        setFilterOpen(false);
        requestAnimationFrame(()=>resultRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));
      }
      if(d.data_status==='NOT_IMPORTED'){
        if(queryMode==='single'){
          if(patternBackend==='turso'){
            if(queryDate===todayKST()&&provisionalWindowKST())
              setStatus('KRX 확정 일봉 대기 중입니다. KIS 잠정 관찰은 아래에서 확인하세요.');
            else{
              // An inline progress card carries the KRX request outcome.
              setStatus('');await requestTursoScan(queryDate);
            }
          }else if(queryDate>todayKST()){
            setStatus('미래 날짜의 주가 데이터는 아직 존재하지 않습니다.');
          }else if(queryDate===todayKST()&&!eodRequestReadyKST()){
            setStatus('장중 전체시장 잠정 검색은 아직 지원되지 않습니다. 15:40 이후 확정 일봉 검증을 요청할 수 있습니다.');
          }else{
            setStatus('해당 날짜의 확정 일봉이 아직 저장되지 않았습니다. 서버에 수집 및 분석을 요청합니다.');
            await requestScan(queryDate);
          }
        }else setStatus('기간 중 저장된 날짜만 조회했습니다. 미분석 날짜의 일괄 실행은 지원하지 않습니다.');
      }
    }catch(e){if(serial===searchVersion.current){setError(String(e));setRows([]);setDays([]);setTotal(null);setDataStatus('');}}
    finally{if(serial===searchVersion.current)setBusy(false);}
  }
  // R1581_SCAN_RESUME: keep polling while navigating; persist and resume after reload.
  useEffect(()=>{
    if(!watchDate||!patternSearchActive)return;
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
        }else if(d.status==='PROVISIONAL'){
          setWatchDate('');setScanInfo(`${watchDate} KIS 잠정 자료만 확인됨 · `+
            (d.reason||'KRX 확정 패턴은 아직 저장되지 않았습니다.'));
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
  },[watchDate,mode,date,gcFields,gcLogic,patternSearchActive]);

  // The Turso queue and poll never access /api/scan or the old D1 request table.
  // Polling survives a mobile PWA reload and reports GitHub failure distinctly.
  useEffect(()=>{
    if(!tursoWatchDate||storageMode!=='turso'||searchSource!=='patterns'||patternBackend!=='turso')return;
    let cancelled=false,inFlight=false;
    const poll=async()=>{
      if(inFlight)return;
      inFlight=true;
      try{
        const response=await fetch(API+'/api/research/request/status?date='+encodeURIComponent(tursoWatchDate),
          {credentials:'include',cache:'no-store'});
        const result=await response.json() as {status?:string;error?:string;reason?:string;
          actions_url?:string;stage?:TursoProgressStage;requested_at_utc?:string};
        if(!response.ok)throw Error(result.error||`분석 상태 오류 ${response.status}`);
        if(cancelled)return;
        if(result.actions_url)setTursoActionsUrl(result.actions_url);
        if(result.requested_at_utc){
          const started=Date.parse(result.requested_at_utc);
          if(Number.isFinite(started))setTursoStartedAt(started);
        }
        if(result.status==='READY'){
          setTursoWatchDate('');setTursoCompletedDate(tursoWatchDate);
          setTursoStage('READY');setTursoFinishedAt(Date.now());
          setTursoScanInfo(`${tursoWatchDate} 패턴 분석 완료 · 저장된 결과를 불러옵니다.`);
          if(!latest||tursoWatchDate>latest)setLatest(tursoWatchDate);
          if(mode==='single'&&date===tursoWatchDate)void search(1,false,gcFields,gcLogic,tursoWatchDate);
        }else if(result.status==='FAILED'){
          setTursoWatchDate('');
          setTursoStage('FAILED');setTursoFinishedAt(Date.now());
          setTursoScanInfo(`${tursoWatchDate} 분석 실패: ${result.reason||'실행 기록을 확인해 주세요.'}`);
        }else if(result.status==='PENDING'){
          setTursoStage(['REQUESTED','QUEUED','RUNNING','EOD','RESEARCH','SAVING','VERIFYING'].includes(result.stage||'')?
            result.stage!:'RUNNING');
          setTursoScanInfo(`${tursoWatchDate} 전체시장 분석 진행 중 · 다른 화면에서도 계속됩니다.`);
        }else if(result.status==='NOT_IMPORTED'){
          setTursoWatchDate('');
          setTursoStage('FAILED');setTursoFinishedAt(Date.now());
          setTursoScanInfo(`${tursoWatchDate} 분석 요청이 없습니다. 검색 버튼으로 다시 요청할 수 있습니다.`);
        }
      }catch(e){if(!cancelled)setTursoScanInfo('상태를 일시적으로 확인하지 못했습니다. 15초 후 다시 시도합니다. · '+
        researchRequestError(e instanceof Error?e.message:''));}
      finally{inFlight=false;}
    };
    const visible=()=>{if(document.visibilityState==='visible')void poll();};
    void poll();
    const timer=window.setInterval(visible,15000);
    document.addEventListener('visibilitychange',visible);
    window.addEventListener('focus',visible);
    return()=>{cancelled=true;window.clearInterval(timer);
      document.removeEventListener('visibilitychange',visible);
      window.removeEventListener('focus',visible);};
  },[tursoWatchDate,storageMode,searchSource,patternBackend,mode,date,gcFields,gcLogic,latest]);

  const extra=(r:Signal,k:string):unknown=>r.extras?.[k];
  const num=(r:Signal,k:string):number|null=>{const v=extra(r,k);if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};
  // Only verified EOD chart evidence is eligible: selected floor 3-30, default 8.
  const patternUp=(r:Signal)=>{const p=num(r,'r159_pattern_up_10d');const n=num(r,'r159_pattern_n_10d');
    return highlightMin!==null&&n!==null&&n>=patternSampleMin&&p!==null&&p>=highlightMin?p:null;};
  // Never promote frequency growth or exploratory tomato observations to gold.
  // Only a future, independently verified Turso v2 recommendation can qualify.
  const goldSignal=(r:Signal)=>validatedResearchSignal(r,storageMode==='turso'&&searchSource==='patterns'&&patternBackend==='turso');
  const recentMatch=(r:Signal)=>patternBackend==='turso'&&r.day>'2026-11-23'&&r.signals.includes('ENV20_LOWER_TOUCH')&&r.extras?.recent_candle_match==='ENV20_BULL_CLOSE_MID_20261123';
  const stockHighlight=(r:Signal)=>researchCardClasses(goldSignal(r)!==null||recentMatch(r),patternUp(r)!==null);
  const goldEvidenceBlock=(r:Signal)=>{const signal=goldSignal(r);
    return signal?<div className="r-research-gold-label" role="note">★ 검증 연구 추천 패턴 · {showSignal(signal)}</div>:null;};
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
  const amountChange=(r:Signal):string=>{
    const ratio=num(r,'amount_ratio20');
    if(ratio===null||ratio<0)return '20일 평균 대비 미계산';
    const pct=(ratio-1)*100;
    const amount=num(r,'traded_amount_krw');
    const avg=amount!==null&&ratio>0?`직전 20일 평균 약 ${(amount/ratio/1e8).toLocaleString('ko-KR',{maximumFractionDigits:1})}억원 대비 `:'20일 평균 대비 ';
    return `${avg}${pct>0?'+':''}${pct.toFixed(1)}% (${ratio.toFixed(2)}배)`;
  };
  const sortedPercent=(r:Signal):string|null=>{
    const value=appliedSort==='highest_gain'?r.observed_high_pct:
      appliedSort==='lowest_return'?r.observed_low_pct:null;
    if(value===undefined||value===null||!Number.isFinite(value))return null;
    return `${appliedSort==='highest_gain'?'후속 확인 일봉 최고':'후속 확인 일봉 최저'} ${value>0?'+':''}${value.toFixed(2)}%`;
  };
  // Search chips and the basket's immutable discovery record share one rule.
  const techBadges=(r:Signal)=>discoveryTechnicalBadges(r.extras);
  const techFlag=(r:Signal,k:string)=>extra(r,k)===undefined?'미계산':flag(r,k)?'발생':'해당 없음';
  const maDown=(r:Signal)=>{const a=num(r,'ma20'),b=num(r,'ma40'),c=num(r,'ma60');return a===null||b===null||c===null?'미계산':a<b&&b<c?'해당':'해당 없음';};
  const fmt=(r:Signal,k:string,digits=2)=>{const n=num(r,k);return n==null?'—':n.toLocaleString('ko-KR',{minimumFractionDigits:digits,maximumFractionDigits:digits});};
  const flag=(r:Signal,k:string)=>extra(r,k)===true||['true','True','1'].includes(String(extra(r,k)));
  const present=(r:Signal,k:string)=>extra(r,k)!==undefined&&extra(r,k)!==null&&extra(r,k)!=='';
  const crossed=(r:Signal,k:string)=>!present(r,k)?'미계산':flag(r,k)?'당일 GC':'GC 없음';
  const lastCross=(r:Signal,k:string)=>String(extra(r,k)||'확인되지 않음');
  const validLines=(r:Signal):Line[]=>{const x=extra(r,'valid_line_candidates_json');if(typeof x!=='string')return [];try{const v=JSON.parse(x);return Array.isArray(v)?v:[];}catch{return [];}};
  const isSupplyV2=(r:Signal)=>extra(r,'supply_strength_method')==='DAILY_HL_UNIFORM_120_V2';
  const supplyGrade=(r:Signal)=>{const grade=String(extra(r,'supply_strength_grade')||'');
    return isSupplyV2(r)&&(num(r,'supply_reference_price')??0)>0&&['강','중','약'].includes(grade)?grade:'미확인';};
  const supplyTag=(r:Signal)=>{const grade=supplyGrade(r);
    if(grade==='미확인')return null;
    const tone=grade==='강'?'strong':grade==='중'?'medium':'weak';
    return <span className={'r15108-supply-grade r15108-supply-'+tone}
      title={'일봉 H-L 균등분배 추정 · 이 가격대 '+money(num(r,'supply_volume_est_shares'))+'주 · 전체 중 '+fmt(r,'supply_bin_share_pct',2)+'% · 최대 구간 대비 '+fmt(r,'supply_strength_relative_pct',1)+'% · 매도잔량 아님'}>상단물량 {grade}</span>;};
  const displayName=(r:Signal)=>r.name||String(r.extras?.name||r.extras?.Name||'종목명 미등록');
  // The API searches and sorts *before* paging, so every returned row belongs
  // to the complete filtered dataset, not a browser-only page subset.
  const visibleRows=rows;
  const changeGc=(next:GcKey[],mode:'any'|'all'=gcLogic)=>{
    setGcFields(next);setGcLogic(mode);
    // Search in D1 across all stored result pages, not only the 100 rows currently loaded.
    if(total!==null)void search(1,false,next,mode);
  };
  const changeTech=(next:TechKey[],mode:'any'|'all'=techLogic)=>{
    setTechFields(next);setTechLogic(mode);
    // Rerun server-side search before pagination; not just the visible 100 rows.
    if(total!==null)void search(1,false,gcFields,gcLogic,undefined,undefined,next,mode);
  };
  const flip=(t:string)=>setSignals(a=>a.includes(t)?a.filter(s=>s!==t):[...a,t]);
  const inBasket=(r:Signal)=>basketIds.includes(`MANUAL:${r.code}:${r.day}`);
  const canBasket=(r:Signal)=>/^\d{6}$/.test(r.code)&&typeof r.close_price==='number'&&Number.isFinite(r.close_price)&&r.close_price>0;
  const basketBlocked=(r:Signal)=>!/^\d{6}$/.test(r.code)?'현재 장바구니는 숫자 6자리 종목코드만 지원합니다.':
    typeof r.close_price!=='number'||!Number.isFinite(r.close_price)||r.close_price<=0?'검색일 확정 종가가 없어 담을 수 없습니다.':
    basketRegularCount>=100?'장바구니 일반 관찰 100건 한도에 도달했습니다.':'장바구니에 담기';
  const basketLabel=(r:Signal)=>inBasket(r)?'담김':!/^\d{6}$/.test(r.code)?'코드 제한':
    !canBasket(r)?'가격 없음':basketRegularCount>=100?'한도 초과':'담기';
  const enqueueBasket=(item:BasketQuickAddRequest['item'],other?:Pick<BasketQuickAddRequest,'selectionOrigin'|'analysisMatched'>)=>{
    setBasketNotice(`${item.name||item.code} · 장바구니에 저장 중…`);
    const request:BasketQuickAddRequest={serial:++basketSequence.current,item,...other};
    setBasketRequests(prev=>[...prev,request]);
  };
  const quickBasket=(r:Signal)=>{
    if(!canBasket(r)||inBasket(r)||basketRegularCount>=100)return;
    enqueueBasket({...r,name:displayName(r)});
  };
  const nav=(target:'search'|'results'|'summary'|'ai'|'basket'|'tracking'|'analysis')=>{
    if(target==='basket'||target==='tracking'||target==='ai'||target==='analysis'){
      setActiveView(target);
      window.setTimeout(()=>window.scrollTo({top:0,behavior:'smooth'}),20);
      return;
    }
    setActiveView('research');
    if(storageMode==='turso'&&searchSource==='daily'){
      window.setTimeout(()=>window.scrollTo({top:0,behavior:'smooth'}),20);
      return;
    }
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
      if(storageMode==='turso'&&searchSource==='patterns')void loadPatternDates();
      else void loadDates().then(source=>{if(source==='d1'&&total!==null)void search(page,false);});
    }else if(activeView==='tracking')setR1594TrackingRefresh(v=>v+1);
    else if(activeView==='basket')setR1594BasketRefresh(v=>v+1);
    else if(activeView==='analysis')setAnalysisRefresh(v=>v+1);
    else setR1594AiRefresh(v=>v+1);
  };
  const aiReportDay=mode==='single'?(latest&&date>latest?latest:date):latest||end;
  // A user click requests one Access-protected KIS quote through the Turso-only
  // Collector RPC. It never enters the D1 queue, even when D1 is exhausted.
  async function requestMissingQuote(r:Signal){
    const key=comparisonKey(r);
    if(r1595Requesting||r1595Timers.current.size>=3)return;
    if(!/^[0-9A-Z]{6}$/.test(r.code)||!r.close_price||r.close_price<=0)return;
    setR1595Requesting(key);setR1595RequestNote('');
    try{
      if(patternBackend==='turso'){
        const result=await refreshKisQuoteToTurso(r.code);
        if(['SAVED','COOLDOWN','MARKET_CLOSED'].includes(result.status)){
          const saved=await fetchComparedTursoOnly([{code:r.code,day:r.day}]);
          setR1593Prices(prev=>({...prev,...saved}));
        }
        const received=result.received_at_utc?new Date(result.received_at_utc):null;
        const observed=received&&Number.isFinite(received.getTime())
          ?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',
              hour:'2-digit',minute:'2-digit',hour12:false}).format(received):'';
        const latest=result.status==='SAVED'&&typeof result.price==='number'&&result.price>0
          ?` · KIS 조회가 ${result.price.toLocaleString('ko-KR')}원${observed?' ('+observed+' 수신)':''}`:'';
        setR1595RequestNote(`${r.name||r.code}: ${result.message}${latest}`);
        return;
      }
      if(!/^\d{6}$/.test(r.code))return;
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
      <span>{activeView==='ai'&&storageMode==='turso'?'AI 패턴':
        ({research:'종목 검색',analysis:'종목 정밀분석',tracking:'종목 추적',ai:'AI 시황',basket:'장바구니'} as const)[activeView]}</span>
      <button type="button" disabled={activeView==='research'&&(busy||requestBusy)}
        onClick={refreshCurrentView}><RefreshCw size={16}/> 새로고침</button>
    </div>
    {activeView==='research'&&storageMode==='turso'&&searchSource==='daily'&&
      <div className="blue-daily-return"><button type="button" onClick={()=>setSearchSource('patterns')}>
        ← 종목 검색으로 돌아가기</button><span>전체 종목 · 검증된 일봉 자료</span></div>}
    {storageMode==='d1'&&<div className="turso-fallback-banner" role="status">보조 DB · D1 분석 모드 {error&&'· Turso 일봉 조회 불가'} · 상단 새로고침으로 Turso 재연결 시도</div>}
    {storageMode==='unavailable'&&<div className="turso-unavailable-banner" role="alert">{error}<button type="button" onClick={()=>{void loadDates();}}>다시 연결</button></div>}
    {patternSearchActive&&(watchDate||completedDate||scanInfo)&&<div className="r1581-scan-monitor" role="status">
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
    <main className={"app-main "+(activeView!=='research'?'r152-full-mode':'')+(storageMode==='turso'&&activeView==='research'&&searchSource==='daily'?' eod-recovery-active':'')}>
      <aside className={'panel search-panel '+(filterOpen?'filter-open':'filter-closed')} ref={formRef} id="search-panel">
        <div className="search-heading"><h2><SlidersHorizontal size={18}/> 검색 조건</h2><button type="button" className="filter-toggle" onClick={()=>setFilterOpen(v=>!v)} aria-expanded={filterOpen} aria-controls="filter-body">{filterOpen?'조건 접기':'조건 변경'} <ListFilter size={16}/></button></div>
        {activeView==='research'&&storageMode==='turso'&&searchSource==='patterns'&&
          <div className="blue-search-subsource">
            <span>{patternBackend==='turso'?'Turso 분석 자료':'D1 보조 분석 자료'} · {patternStatus==='checking'?'확인 중':patternStatus==='unavailable'?'연결 오류':latest||'날짜 미확인'}</span>
            <button type="button" onClick={()=>setSearchSource('daily')}>전체 종목 보기</button>
          </div>}
        <div className="filter-body" id="filter-body">
          {activeView==='research'&&storageMode==='turso'&&searchSource==='patterns'&&
            <details className="blue-source-details"><summary>분석 데이터 안내</summary>
              <p>{patternBackend==='turso'
                ?'기술 신호는 Turso에 저장된 검증 연구 결과를 사용합니다. 과거 전체 이력과 이후 가격 관측은 아직 일부입니다.'
                :'Turso 분석 자료가 부족하거나 조회할 수 없어 기존 D1 분석 결과를 사용합니다.'}</p>
              {patternSourceError&&<p className="blue-pattern-source-error">{patternSourceError}</p>}
              {patternStatus==='unavailable'&&<p className="blue-pattern-source-error">분석 데이터 연결에 문제가 있습니다.</p>}
              <button type="button" onClick={()=>void loadPatternDates(patternBackend==='turso')}>
                {patternBackend==='turso'?'D1 과거 자료 확인':'Turso 분석 다시 확인'}
              </button>
            </details>}
          <p className="latest-label"><Database size={14}/> 저장된 최신 거래일 <strong>{latest||'확인 중'}</strong></p>
          <label>검색 방법</label><div className="switch"><button className={mode==='single'?'active':''} type="button" onClick={()=>setMode('single')}>지정 날짜</button><button className={mode==='range'?'active':''} type="button" onClick={()=>setMode('range')}>기간 검색</button></div>
          {mode==='single'?<><label htmlFor="scan-date">검색 날짜</label><input id="scan-date" type="date" value={date} onChange={e=>{setDate(e.target.value);setDataStatus('');}}/></>:
          <><label htmlFor="scan-start">시작일</label><input id="scan-start" type="date" value={start} onChange={e=>setStart(e.target.value)}/><label htmlFor="scan-end">종료일</label><input id="scan-end" type="date" value={end} onChange={e=>setEnd(e.target.value)}/></>}
          <label>기술 신호</label><div className="checks">{tags.map(t=><label className="check" key={t}><input type="checkbox" checked={signals.includes(t)} onChange={()=>flip(t)}/>{showSignal(t)}</label>)}</div>
          <p className="small">하단 돌파도 기본 검색에 포함됩니다. B30 하단 반등은 기존 B30 하락선 돌파와 구분한 별도 탐색 신호이며, 과거 날짜는 재분석 후 표시될 수 있습니다.</p>
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
              <option value="300">300억원 이상</option><option value="500">500억원 이상</option>
              <option value="1000">1,000억원 이상</option><option value="custom">직접 입력</option>
            </select>
            {amountChoice==='custom'&&<input aria-label="최소 거래대금 직접 입력 (억원)" type="number" min="0" max="50000" step="1"
              value={customAmount} onChange={e=>setCustomAmount(e.target.value)}/>}
            <small>거래대금은 검색일 확정 일봉의 실제 원화 금액입니다. 금액이 저장되지 않은 과거 기록은 기준 검색에서 제외됩니다.</small>
          </div>
          <button className="primary search-submit" disabled={busy||requestBusy||(storageMode==='turso'&&patternStatus!=='ready')} onClick={()=>{void search(1);}}><Search size={18}/>{busy?'검색 중…':'종목 검색·미분석일 분석 시작'}</button>
          {storageMode==='turso'&&patternStatus!=='ready'&&
            <p className="small" role="status">{patternStatus==='checking'?
              'Turso 패턴 분석 연결을 확인하고 있습니다. 잠시 후 검색할 수 있습니다.':
              '패턴 분석 연결이 필요합니다. 위의 ‘분석 데이터 안내’에서 다시 확인해 주세요.'}</p>}
          <p className="small">저장된 결과를 조회합니다. 거래대금 기준은 당일 확정 일봉이며, 저장되지 않은 이전 금액은 추정하지 않습니다. 장중 현재가 아님.</p>
        </div>
        <div className="search-compact r15108-quickbar" role="group" aria-label="빠른 검색 날짜와 거래대금 변경">
          <div className="r15108-quick-controls">
            {mode==='single'?<label className="r15108-quick-field r15108-date-field">
              <span>기준일</span><input type="date" aria-label="빠른 검색 기준일 변경" value={date}
                onChange={e=>{setDate(e.target.value);setDataStatus('');}}/>
            </label>:<div className="r15108-range-fields" aria-label="기간 검색 날짜 변경">
              <label className="r15108-quick-field"><span>시작일</span><input aria-label="빠른 검색 시작일" type="date" value={start} onChange={e=>setStart(e.target.value)}/></label>
              <label className="r15108-quick-field"><span>종료일</span><input aria-label="빠른 검색 종료일" type="date" value={end} onChange={e=>setEnd(e.target.value)}/></label>
            </div>}
            <label className="r15108-quick-field r15108-amount-field"><span>거래대금</span>
              <select aria-label="빠른 검색 최소 거래대금 (억원)" value={amountChoice} onChange={e=>setAmountChoice(e.target.value)}>
                <option value="0">전체</option><option value="100">100억+</option><option value="300">300억+</option>
                <option value="500">500억+</option><option value="1000">1,000억+</option><option value="custom">직접 입력</option>
              </select>
            </label>
            {amountChoice==='custom'&&<label className="r15108-quick-field r15108-custom-field"><span>억 원</span>
              <input type="number" min="0" max="50000" step="1" value={customAmount}
                aria-label="빠른 검색 거래대금 직접 입력 (억원)" onChange={e=>setCustomAmount(e.target.value)}/>
            </label>}
          </div>
          <button type="button" className="compact-run" disabled={busy||requestBusy} onClick={()=>{void search(1);}}>
            <Search size={16}/>{busy?'검색 중':'검색'}
          </button>
        </div>
      </aside>
      <section className="content">
        <div className={'r152-analysis-content '+(activeView==='analysis'?'':'r151-hidden')}>
          {(storageMode==='d1'||(storageMode==='turso'&&activeView==='analysis'))&&<SymbolAnalysisPanel key={analysisRefresh} defaultDate={date}
            isInBasket={(code,day)=>basketIds.includes(`MANUAL:${code}:${day}`)}
            onAddToBasket={(item,analysisMatched)=>{
              enqueueBasket(item,{selectionOrigin:'ANALYSIS',analysisMatched});
              nav('basket');
            }}/>}
        </div>
        <div className={'r151-basket-content '+(activeView==='basket'?'':'r151-hidden')}>
          {(storageMode==='d1'||storageMode==='turso')&&<SmartBasket quickAddRequests={basketRequests}
            onItemsChange={onBasketItemsChange} onAddFeedback={setBasketNotice}
            onQuickAddsHandled={serial=>setBasketRequests(prev=>prev.filter(x=>x.serial>serial))}
            active={activeView==='basket'}
            refreshKey={r1594BasketRefresh} patternHighlightMin={highlightMin} patternSampleMin={patternSampleMin}/>
          }
        </div>
        <div className={'r152-tracking-content '+(activeView==='tracking'?'':'r151-hidden')}>
          {(storageMode==='d1'||(storageMode==='turso'&&activeView==='tracking'))&&<LiveMarket active={activeView==='tracking'} refreshKey={r1594TrackingRefresh}/>}
        </div>
        <div className={'r152-ai-content '+(activeView==='ai'?'':'r151-hidden')}>
          {storageMode==='d1'&&mode==='single'&&latest&&date>latest&&<p className="r159-data-note">{date}에는 저장된 확정 일봉이 없어, AI 시황은 최근 저장일 {latest} 기준으로 조회합니다.</p>}
          {storageMode==='turso'&&activeView==='ai'&&<section ref={aiRef} id="ai-panel" className="r152-ai-section">
            <TursoAiReadiness key={r1594AiRefresh} api={API} active={true}/>
          </section>}
          {storageMode==='d1'&&<section ref={aiRef} id="ai-panel" className="r152-ai-section">
            <AiWidget key={'market-'+aiReportDay+'-'+r1594AiRefresh} kind="market"
              date={aiReportDay}
              observed={mode==='single'?days.find(d=>d.day===aiReportDay)?.observed_stocks:null}
              matched={mode==='single'?days.find(d=>d.day===aiReportDay)?.matched_stocks:null}
              events={mode==='single'?days.find(d=>d.day===aiReportDay)?.signal_events:null}
              searchMatched={rows}/>
          </section>}
        </div>
        <div className={'r151-research-content '+(activeView==='research'?'':'r151-hidden')}>
          <RecentPatternRanking/>
        {storageMode==='turso'&&searchSource==='daily'&&<TursoEodRecovery key={eodRefresh} api={API} dates={tursoDays} onUnavailable={onTursoUnavailable}/>}
        <div className="stats" ref={summaryRef} id="summary-panel">
          <div className="metric"><span>검색 결과</span><strong>{total==null?'—':total.toLocaleString()}</strong><small>종목</small></div>
          <div className="metric"><span>검색 거래일</span><strong>{total==null?'—':days.length}</strong><small>저장된 날짜</small></div>
          <div className="metric"><span>최신 저장일</span><strong className="smallnum">{latest?.slice(5)||'—'}</strong><small>종가 데이터</small></div>
        </div>
        {error&&<div className="notice error" role="alert"><AlertCircle size={17}/>{error}</div>}
        {status&&<div className="notice"><AlertCircle size={17}/><div>{status}
          {mode==='single'&&date===todayKST()&&latest&&latest<date&&<div>
            <button type="button" className="filter-toggle" disabled={busy||requestBusy}
              onClick={()=>{void search(1,false,gcFields,gcLogic,latest);}}>
              최근 확정 거래일({latest})로 검색
            </button>
          </div>}
        </div></div>}
        {scanInfo&&<div className="notice" role="status"><RefreshCw size={17}/><div>{scanInfo}{actionsUrl&&<div><a href={actionsUrl} target="_blank" rel="noreferrer">GitHub 실행 결과 확인</a></div>}</div></div>}
        {storageMode==='turso'&&searchSource==='patterns'&&
          (tursoWatchDate||tursoCompletedDate||tursoScanInfo)&&
          <TursoResearchProgress day={tursoWatchDate||tursoCompletedDate||tursoRequestDate}
            stage={tursoStage} info={tursoScanInfo} actionsUrl={tursoActionsUrl}
            startedAt={tursoStartedAt} finishedAt={tursoFinishedAt}
            onViewResults={()=>{
              const day=tursoCompletedDate;setActiveView('research');
              void search(1,false,gcFields,gcLogic,day);
            }}/>}
        {storageMode==='turso'&&searchSource==='patterns'&&patternBackend==='turso'&&
          mode==='single'&&date===todayKST()&&(!rows.length||dataStatus==='NOT_IMPORTED')&&
          <TursoProvisionalToday api={API} day={date} query={appliedNameQuery}/>}
        <section className="panel result" ref={resultRef} id="results-panel">
          <div className="result-heading"><h2><BarChart3 size={18}/> 검색된 종목 <small>{dataStatus==='NOT_IMPORTED'?'일봉 미수집':total===null?'검색 전':total+'건'}</small></h2><span className="eod-pill"><Clock3 size={13}/> EOD</span></div>
          <p className="r1599-active-filters">검색 결과 기준 · 거래대금 {(appliedAmountEok??amountEok)>0?(appliedAmountEok??amountEok).toLocaleString('ko-KR')+'억원 이상':'전체'} · 토마토 강조 {highlightMin===null?'꺼짐':highlightMin+'% 이상 · 표본 '+patternSampleMin+'건 이상'}{onlyPattern&&highlightMin!==null?' · 해당 종목만 보기':''}{appliedAmountEok!==null&&appliedAmountEok!==amountEok?' · 거래대금 변경 미적용(검색 버튼을 누르세요)':''}</p>
          <p className="result-hint">{patternBackend==='turso'
            ?'검색일 Turso 검증 종가와 이후 저장된 확정 일봉 관측가를 구분합니다. 현재 후속 관측 기간은 불완전할 수 있습니다.'
            :'검색일 확정 종가와 이후 D1 저장 시세·기간 고가를 구분해 표시합니다. 가격이 없으면 미수집으로 표시합니다.'}</p>
          <div className="r-research-color-key" aria-label="검색 종목 카드 강조색 안내">
            <span><i aria-hidden="true"/> 골드: 별도 검증 연구 추천</span>
            <span><i className="tomato-key" aria-hidden="true"/> 토마토: 과거 10일 탐색 관측</span>
            <span><i className="dual-key" aria-hidden="true"/> 대각선: 두 조건 동시 충족</span>
            <em>골드는 검증된 추천 자료가 검색 결과에 있을 때만 표시</em>
          </div>
          {basketNotice&&<p className="r1595-request-status" role="status">{basketNotice}</p>}
          {total===0&&(appliedAmountEok??amountEok)>0&&<p className="r15125-result-scope" role="status">현재 거래대금 최소 {(appliedAmountEok??amountEok).toLocaleString('ko-KR')}억원 조건으로는 검색 대상이 없습니다. 저거래대금 하단 터치 종목도 찾으려면 거래대금을 ‘전체(0억원)’로 바꾸고 검색해 보세요.</p>}
          {r1593Error&&<p className="r1593-comparison-status" role="status">가격 비교: {r1593Error}</p>}
          {r1593AutoStatus&&patternBackend==='turso'&&<p className="r1593-comparison-status" role="status">{r1593AutoStatus}</p>}
          {r1595RequestNote&&<p className="r1595-request-status" role="status">{r1595RequestNote}</p>}
          {rows.length>0&&<p className="r1594-quote-note" role="status">{patternBackend==='turso'
            ?'저장된 확정 일봉을 기본으로 표시합니다. 장중에는 종목별 ‘KIS 최신가 조회’를 누르면 Turso에 새 시세를 저장합니다. KIS 수신 시각은 체결 시각과 다를 수 있습니다.'
            :r1594QueueStatus+' · 수집 가능한 시장 시간에만 KIS 가격이 갱신됩니다.'}</p>}
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
              <div className="r15116-technical-filter" role="group" aria-label="역배열 및 장기 이동평균선 돌파 검색 필터">
                <div className="r15116-tech-heading"><strong>추세·돌파 필터</strong><small>검색일 기준 · 전체 검색 결과에 적용</small></div>
                <div className="gc-filter-options">
                  {TECH_OPTIONS.map(item=><label key={item.key} className={'gc-filter-chip '+(techFields.includes(item.key)?'selected':'')}>
                    <input type="checkbox" checked={techFields.includes(item.key)} disabled={busy}
                      onChange={()=>changeTech(techFields.includes(item.key)?techFields.filter(x=>x!==item.key):[...techFields,item.key])}/>{item.label}
                  </label>)}
                  <button type="button" className="r15116-tech-clear" disabled={busy||techFields.length===0} onClick={()=>changeTech([])}>추세 조건 해제</button>
                </div>
                {techFields.length>1&&<div className="gc-logic"><span>선택 조건:</span>
                  <button type="button" className={techLogic==='any'?'active':''} disabled={busy} onClick={()=>changeTech(techFields,'any')}>하나라도 (OR)</button>
                  <button type="button" className={techLogic==='all'?'active':''} disabled={busy} onClick={()=>changeTech(techFields,'all')}>모두 (AND)</button>
                </div>}
                <small className="r15116-tech-note">이동평균선 값이나 돌파 신호가 저장되지 않은 과거 종목은 해당 조건에 포함하지 않습니다. GC·거래대금 조건과 함께 적용됩니다.</small>
              </div>
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
          <div className="r15125-result-tools" role="search" aria-label="전체 검색 결과 종목명 검색 및 정렬">
            <label className="result-quick-search"><Search size={16}/><span className="sr-only">전체 페이지에서 종목명 또는 코드 찾기</span>
              <input type="search" value={localQuery} onChange={e=>{
                const next=e.target.value;
                setLocalQuery(next);
                // Clearing the field also clears the applied server-side query.
                // Otherwise later sorting/paging silently keeps the last stock.
                if(!next.trim()&&(appliedNameQuery||localQuery.trim())&&total!==null)
                  void search(1,false,gcFields,gcLogic,undefined,undefined,techFields,techLogic,{q:''});
              }}
                onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void search(1,false,gcFields,gcLogic,undefined,undefined,techFields,techLogic,{q:localQuery});}}}
                placeholder="선택한 날짜·기간의 전체 페이지에서 찾기" aria-label="전체 검색 결과에서 종목명 또는 코드 찾기"/>
            </label>
            <button type="button" disabled={busy} className="r15125-result-run"
              onClick={()=>{void search(1,false,gcFields,gcLogic,undefined,undefined,techFields,techLogic,{q:localQuery});}}>
              <Search size={15}/>{busy?'검색 중':'전체 찾기'}
            </button>
            {(localQuery||appliedNameQuery)&&<button type="button" className="r15125-result-clear" disabled={busy}
              onClick={()=>{setLocalQuery('');void search(1,false,gcFields,gcLogic,undefined,undefined,techFields,techLogic,{q:''});}}>
              <X size={14}/>전체 보기
            </button>}
            <label className="r15125-result-sort"><span>전체 검색 결과 정렬</span>
              <select value={resultSort} disabled={busy} onChange={e=>{
                const next=e.target.value as ResultSort;setResultSort(next);
                // Sort what the user currently sees in the input, not a stale
                // applied query from a previous search (e.g. 'LK삼양').
                if(total!==null)void search(1,false,gcFields,gcLogic,undefined,undefined,techFields,techLogic,{q:localQuery,sort:next});
              }}>
                <option value="recent">최신 발견일순</option>
                <option value="highest_gain">발견가 대비 확인 최고 수익률순</option>
                <option value="lowest_return">발견가 대비 확인 최저 수익률순</option>
                <option value="amount_surge">20일 평균 거래대금 증가율 높은순</option>
                <option value="amount_decline">20일 평균 거래대금 감소율 큰순</option>
              </select>
            </label>
          </div>
          {(appliedNameQuery||localQuery!==appliedNameQuery||appliedSort!=='recent')&&
            <p className="r15125-result-scope" role="status">저장된 전체 검색 결과에서 필터·정렬한 {total===null?'미확인':total.toLocaleString()+'건'}을 페이지별로 표시합니다.
              {appliedNameQuery?` · 종목 검색: ${appliedNameQuery}`:''}
              {localQuery!==appliedNameQuery?' · 입력한 종목명은 ‘전체 찾기’ 또는 정렬 변경으로 적용됩니다.':''}
            </p>}
          {(appliedSort==='highest_gain'||appliedSort==='lowest_return')&&
            <p className="r15125-result-scope">최고·최저 수익률은 발견일 이후 저장된 검증 일봉 중 확인된 구간만 사용합니다. 후속 일봉이 없는 종목은 정렬 뒤쪽에 표시되며, 전체 보유기간 최저·최고를 보장하지 않습니다.</p>}
          <div className="desktop-results tablewrap"><table><thead><tr><th>날짜</th><th>종목명 / 코드</th><th>신호</th><th>검색일 종가 / 최근 확인가 / 기간 최고가</th><th>RSI / GC</th><th>Slow(14,3,3) / GC</th><th>MACD / GC</th><th>돌파선 후보</th><th>상단 매물대</th></tr></thead><tbody>
            {visibleRows.length?visibleRows.map((r,i)=><tr key={`${r.code}-${r.day}-${i}`} className={'clickable'+stockHighlight(r)} tabIndex={0} onClick={()=>openDetail(r)} onKeyDown={e=>{if(e.key==='Enter')openDetail(r);}}>
              <td>{r.day}</td><td><div className="r151-desktop-stock">
                 <div><b>{displayName(r)}</b><div className="small">{r.code} · {amountLabel(r)}</div>
                 <div className="r15125-amount-change">{amountChange(r)}{sortedPercent(r)&&<span> · {sortedPercent(r)}</span>}</div>
                 {goldEvidenceBlock(r)}
              <RecentPatternReference day={r.day} signals={r.signals} matched={recentMatch(r)}/>
                 {patternEvidenceBlock(r)}
                 {patternDays(r).length>0&&<div className="r1599-pattern-dates" title={patternDays(r).join(' · ')}>과거 신호일 {patternDays(r).slice(-3).join(' · ')}{patternDays(r).length>3?' 외':''}</div>}</div>
                 <button type="button" className={'r151-quick-add '+(inBasket(r)?'saved':'')}
                   title={inBasket(r)?'이미 담긴 종목':basketBlocked(r)}
                   aria-label={`${displayName(r)} ${inBasket(r)?'장바구니에 담김':basketBlocked(r)}`}
                   disabled={inBasket(r)||!canBasket(r)||basketRegularCount>=100}
                   onClick={e=>{e.stopPropagation();quickBasket(r);}}
                   onKeyDown={e=>e.stopPropagation()}>
                   {inBasket(r)?<CheckCircle2 size={16}/>:<ShoppingBasket size={16}/>}
                 </button>
               </div></td>
              <td>{r.signals.map(s=><span className="tag" key={s}>{showSignal(s)}</span>)}{techBadges(r).map(t=><span className="r1591-search-tech" key={t}>{t}</span>)}{supplyTag(r)}</td><td className="r1593-price-cell"><strong>{money(r.close_price)}원</strong><small> · 검색일 종가</small>
                <PriceCompareMini data={r1593Prices[comparisonKey(r)]} baseline={r.close_price} loading={r1593Busy&&!r1593Prices[comparisonKey(r)]}
                  onRequest={()=>{void requestMissingQuote(r);}} requesting={r1595Requesting===comparisonKey(r)}
                  requestLabel={patternBackend==='turso'?'↻ KIS 최신가 조회':'↻ 시세 갱신'}
                  requestDisabled={!!r1595Requesting||r1595Timers.current.size>=3}/>
              </td>
              <td>{fmt(r,'rsi')} <small>{crossed(r,'rsi_gc')}</small></td><td>{fmt(r,'slow_14_3_3_k')} / {fmt(r,'slow_14_3_3_d')} <small>{crossed(r,'slow_14_3_3_gc')}</small></td>
              <td>{fmt(r,'macd_12_26_9')} <small>{crossed(r,'macd_gc')}</small></td><td>{present(r,'valid_line_candidates_json')?`${validLines(r).length}개`:'미계산'}</td>
              <td>{supplyGrade(r)==='미확인'?'매물대 추정 재분석 필요':`상단물량 ${supplyGrade(r)} · ${money(num(r,'supply_reference_price'))}원 · 약 ${money(num(r,'supply_volume_est_shares'))}주 · 비중 ${fmt(r,'supply_bin_share_pct',2)}%`}</td>
            </tr>):<tr><td className="empty" colSpan={9}>{total!==null?'조건에 맞는 종목이 없습니다.':'날짜와 조건을 선택해 검색하세요.'}</td></tr>}</tbody></table></div>
          <div className="mobile-results">
            {visibleRows.length?visibleRows.map((r,i)=><div className={'r151-mobile-row'+stockHighlight(r)} key={`${r.code}-${r.day}-${i}`}>
              <div className="stock-card" role="button" tabIndex={0} onClick={()=>openDetail(r)}
                onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openDetail(r);}}}
                aria-label={`${displayName(r)} 상세 분석 보기`}>
              <div className="stock-top"><div className="stock-identity"><strong>{displayName(r)}</strong><span>{r.code} <span className="stock-dot">·</span> {r.day}</span></div><div className="stock-price"><b>{money(r.close_price)}<small>원</small></b><span>종가</span></div><ChevronRight size={19} className="stock-chevron"/></div>
              {goldEvidenceBlock(r)}
              <RecentPatternReference day={r.day} signals={r.signals} matched={recentMatch(r)}/>
              {patternEvidenceBlock(r)}
              <PriceCompareMini compact data={r1593Prices[comparisonKey(r)]} baseline={r.close_price} loading={r1593Busy&&!r1593Prices[comparisonKey(r)]}
                onRequest={()=>{void requestMissingQuote(r);}} requesting={r1595Requesting===comparisonKey(r)}
                requestLabel={patternBackend==='turso'?'↻ KIS 최신가 조회':'↻ 시세 갱신'}
                requestDisabled={!!r1595Requesting||r1595Timers.current.size>=3}/>
              <div className="stock-tags">{r.signals.slice(0,4).map(s=><span className="tag" key={s}>{showSignal(s)}</span>)}{r.signals.length>4&&<span className="tag tag-more">+{r.signals.length-4}</span>}{supplyTag(r)}</div>
              <div className="r1599-mobile-meta">{amountLabel(r)}</div>
              <div className="r15125-amount-change">{amountChange(r)}{sortedPercent(r)&&<span> · {sortedPercent(r)}</span>}</div>
              {patternDays(r).length>0&&<div className="r1599-pattern-dates" title={patternDays(r).join(' · ')}>과거 신호일 {patternDays(r).slice(-3).join(' · ')}{patternDays(r).length>3?' 외':''}</div>}
              {techBadges(r).length>0&&<div className="r1591-mobile-tech">{techBadges(r).map(t=><span className="r1591-search-tech" key={t}>{t}</span>)}</div>}
               <div className="stock-quick"><div><small>RSI</small><strong>{fmt(r,'rsi',1)}</strong></div><div><small>Slow GC</small><strong className={flag(r,'slow_14_3_3_gc')?'positive':''}>{crossed(r,'slow_14_3_3_gc')}</strong></div><div><small>MACD GC</small><strong className={flag(r,'macd_gc')?'positive':''}>{crossed(r,'macd_gc')}</strong></div><div><small>매물대 기준가</small><strong>{supplyGrade(r)==='미확인'?'미확인':money(num(r,'supply_reference_price'))+'원'}</strong></div></div>
            </div>
              <button type="button" className={'r151-mobile-add '+(inBasket(r)?'saved':'')}
                title={inBasket(r)?'장바구니에 담김':basketBlocked(r)}
                aria-label={`${displayName(r)} ${inBasket(r)?'장바구니에 담김':basketBlocked(r)}`}
                disabled={inBasket(r)||!canBasket(r)||basketRegularCount>=100}
                onClick={()=>quickBasket(r)}>
                {inBasket(r)?<CheckCircle2 size={19}/>:<ShoppingBasket size={19}/>}
                <span>{basketLabel(r)}</span>
              </button>
              {/* Quote refresh is now visible directly beside the saved quote above. */}
              </div>):<div className="mobile-empty"><Search size={30}/><strong>{appliedNameQuery?'전체 검색 결과에서 일치하는 종목이 없습니다.':total===0?'해당 조건의 종목이 없습니다.':'검색 조건을 선택해 주세요.'}</strong><p>{onlyPattern?'토마토 조건은 10거래일 패턴·최소 표본 수에 더해 선택한 골든크로스와 거래대금 조건도 모두 충족해야 합니다. GC 전체 종목 및 거래대금 전체로 비교해 보세요.':gcFields.length?'선택한 골든크로스 조건을 만족하는 종목이 없습니다.':'과거 거래일을 선택한 다음 검색 버튼을 누르세요.'}</p><button onClick={()=>nav('search')}>검색 조건 열기</button></div>}
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
      <button className={activeView==='analysis'?'dock-primary':''} onClick={()=>nav('analysis')}><ScanSearch size={20}/><span>정밀분석</span></button>
      <button className={activeView==='tracking'?'dock-primary':''} onClick={()=>nav('tracking')}><Radar size={20}/><span>추적</span></button>
      <button className={activeView==='ai'?'dock-primary':''} onClick={()=>nav('ai')}><Activity size={20}/><span>{storageMode==='turso'?'AI 패턴':'AI 시황'}</span></button>
      <button className={activeView==='basket'?'dock-primary':''} onClick={()=>nav('basket')}><ShoppingBasket size={20}/><span>장바구니</span></button>
    </nav>
    {selected&&<div className="detail-overlay" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)closeDetail();}}>
      <section className="detail-sheet" role="dialog" aria-modal="true" aria-label={`${displayName(selected)} 상세 분석`}>
        <div className="detail-handle" aria-hidden="true"/><div className="detail-toolbar"><button onClick={closeDetail} className="detail-back"><ArrowLeft size={19}/> 뒤로</button><span className="detail-eod">일봉 · 연구용</span><button onClick={closeDetail} className="detail-x" aria-label="상세 닫기"><X size={21}/></button></div>
        <div className="detail-head"><div><small>{selected.code} · {selected.day}</small><h2>{displayName(selected)}</h2></div><div className="detail-close"><span>종가</span><strong>{money(selected.close_price)} <small>원</small></strong></div></div>
        <PriceCompareMini compact data={r1593Prices[comparisonKey(selected)]} baseline={selected.close_price} loading={r1593Busy&&!r1593Prices[comparisonKey(selected)]}
          onRequest={()=>{void requestMissingQuote(selected);}} requesting={r1595Requesting===comparisonKey(selected)}
          requestLabel={patternBackend==='turso'?'↻ KIS 최신가 조회':'↻ 시세 갱신'}
          requestDisabled={!!r1595Requesting||r1595Timers.current.size>=3}/>
        <div className="study-tags">{selected.signals.map(s=><span key={s}>{showSignal(s)}</span>)}</div>
        <StockChart key={'chart-'+selected.code+'-'+selected.day} code={selected.code}
          day={selected.day} name={displayName(selected)} researchBackend={patternBackend}
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
          <div><strong>상단 가격대별 추정 거래량 (이전 120봉)</strong><p className="indicator-value">{supplyGrade(selected)} <small>· {isSupplyV2(selected)?money(num(selected,'supply_reference_price'))+'원':'구형 기록'}</small></p><p>{isSupplyV2(selected)?`해당 구간 추정 ${money(num(selected,'supply_volume_est_shares'))}주 · 전체 비중 ${fmt(selected,'supply_bin_share_pct',2)}% · 최대 구간 대비 ${fmt(selected,'supply_strength_relative_pct',1)}%`:'차트의 새 거래량 분포를 확인하세요. 기존 스캔 값은 재분석 전까지 구형입니다.'}</p></div>
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

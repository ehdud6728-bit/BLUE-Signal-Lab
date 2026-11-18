import {useEffect,useState} from 'react';
import {ShoppingBasket} from 'lucide-react';
import StockChart from './StockChart';
import type {BasketQuickItem} from './SmartBasket';
import './symbol-analysis.css';

const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
type Diagnosis={code:string;name?:string;asof:string;matched:boolean;selected_signals:string;reason:string;
 quality_status?:string;large_historical_gap_review?:boolean;non_adjusted_history?:boolean;
 corporate_action?:{first_session:string;old_shares_per_new_share:number;source:string}|null;
 open?:number|null;high?:number|null;low?:number|null;close?:number|null;
 ma20?:number|null;ma40?:number|null;ma112?:number|null;ma224?:number|null;
 env20_lower_20pct?:number|null;amount_krw?:number|null;
 research_features?:{prior_45_day_high?:number|null;prior_55_day_high?:number|null;
  amount_ratio_prior20?:number|null;close_position_in_day_range?:number|null};
 signal_predicates?:Record<string,boolean|null>;additional_predicates?:Record<string,boolean|null>};
type Result={status:string;message?:string;diagnosis?:Diagnosis;quality_status?:string;
 chart?:{bars:unknown[]}|null;stored_at?:string;source?:string};
type SymbolMatch={code:string;name:string;market:string};
type Catalog={status:string;results?:SymbolMatch[];message?:string};
type LiveSnapshot={code:string;market:'J'|'NX';market_label:string;phase:string;
 trade_date_kst:string;received_at_utc:string;price:number;open:number;high:number;low:number;
 accumulated_volume:number;accumulated_turnover_raw?:string|null;
 turnover_unit_verified?:boolean;change_from_prev_close_pct?:number|null;
 provider_trade_day_verified?:boolean;reported_trade_date?:string|null;
 exchange_tick_time_verified?:boolean;official_eod?:boolean};
type LiveReference={day:string;quality_status:string;ma20?:number|null;ma40?:number|null;
 ma112?:number|null;ma224?:number|null;env20_lower_20pct?:number|null};
type LiveResult={status:string;code?:string;name?:string;message?:string;
 snapshot?:LiveSnapshot;reference?:LiveReference|null;
  request?:{status:string;requested_at_utc:string;message?:string|null}|null;
  refresh_status?:string;error?:string};
const labels:Record<string,string>={
 BB20_UPPER_SIGNAL:'BLUE20 상단 신호',BB30_UPPER_SIGNAL:'BLUE30 상단 신호',
 BB40_UPPER_SIGNAL:'BLUE40 상단 신호',BB20_LOWER_SIGNAL:'BLUE20 하단 신호',
 BB30_LOWER_SIGNAL:'BLUE30 하단 신호',BB40_LOWER_SIGNAL:'BLUE40 하단 신호',
 ENV20_SIGNAL:'ENV20 중심선 신호',ENV40_SIGNAL:'ENV40 중심선 신호',
 ENV20_LOWER_TOUCH_SIGNAL:'엔벨로프(20,-20%) 첫 터치',
 MA_INVERSE:'역배열(20 < 40 < 60)',MA112_CROSS:'112일선 상향 돌파',
 MA224_CROSS:'224일선 상향 돌파',AMOUNT_500_EOK:'거래대금 500억원 이상',
 RSI_GC:'RSI 골든크로스',SLOW_14_3_3_GC:'Slow(14,3,3) 골든크로스',MACD_GC:'MACD 골든크로스',
 BREAK_45_PRIOR_HIGH:'종가가 직전 45거래일 고가 돌파(연구)',
 BREAK_55_PRIOR_HIGH:'종가가 직전 55거래일 고가 돌파(연구)',
 CLOSE_IN_TOP_20PCT:'종가가 당일 범위 상위 20%(연구)',
 AMOUNT_OVER_2X_PRIOR20:'거래대금이 이전 20거래일 평균의 2배 이상(연구)'
};
const price=(n:number|null|undefined)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('ko-KR',{maximumFractionDigits:2})+'원':'미계산';
export default function SymbolAnalysisPanel({defaultDate,onAddToBasket,isInBasket}: {
 defaultDate:string;
 onAddToBasket?:(item:BasketQuickItem,analysisMatched:boolean)=>void;
 isInBasket?:(code:string,day:string)=>boolean;
}){
 const [term,setTerm]=useState('225190');const [code,setCode]=useState('225190');
 const [chosen,setChosen]=useState(false);const [name,setName]=useState('');
 const [matches,setMatches]=useState<SymbolMatch[]>([]);
 const [catalogMessage,setCatalogMessage]=useState('');
 const [day,setDay]=useState(defaultDate);
 const [result,setResult]=useState<Result|null>(null);const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 const [live,setLive]=useState<LiveResult|null>(null);const [liveBusy,setLiveBusy]=useState(false);
 const [liveNotice,setLiveNotice]=useState('');
 useEffect(()=>{setDay(defaultDate);setResult(null);},[defaultDate]);
 // A stored diagnosis is a quick D1 lookup; it must not trigger a slow GitHub
 // backfill merely because the user selected a different stock or date.
 useEffect(()=>{
  if(!/^[0-9A-Z]{6}$/.test(code)||!/^20\d{2}-\d{2}-\d{2}$/.test(day))return;
  const controller=new AbortController();
  const timer=window.setTimeout(async()=>{
   try{
    const u=new URL(API+'/api/analysis/symbol');u.searchParams.set('code',code);u.searchParams.set('asof',day);
    const r=await fetch(u.toString(),{credentials:'include',cache:'no-store',signal:controller.signal});
    if(!r.ok)return;
    const data=await r.json() as Result;
    if(!controller.signal.aborted)setResult(data.status==='READY'?data:null);
   }catch{/* A missing historical record does not stop today's quote lookup. */}
  },200);
  return()=>{window.clearTimeout(timer);controller.abort();};
 },[code,day]);
 // Show the last saved KIS quote first, then attempt one bounded, authenticated
 // direct refresh. The user never has to wait for the minute Cron to see cache.
 useEffect(()=>{
  if(!/^[0-9A-Z]{6}$/.test(code))return;
  const controller=new AbortController();
  const timer=window.setTimeout(async()=>{
   try{
    const u=new URL(API+'/api/analysis/live');u.searchParams.set('code',code);
    const saved=await fetch(u.toString(),{credentials:'include',cache:'no-store',signal:controller.signal});
    if(!saved.ok)return;
    const data=await saved.json() as LiveResult;
    if(!controller.signal.aborted)setLive(data);
   }catch{/* Manual lookup remains available. */}
   if(controller.signal.aborted)return;
   try{
    const r=await fetch(API+'/api/analysis/live/refresh',{
     method:'POST',credentials:'include',signal:controller.signal,
     headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({code})});
    if(!r.ok)return;
    const refreshed=await r.json() as LiveResult;
    if(!controller.signal.aborted){setLive(refreshed);setLiveNotice(refreshed.message||'');}
   }catch{/* Existing snapshot stays visible if direct refresh is unavailable. */}
  },450);
  return()=>{window.clearTimeout(timer);controller.abort();};
 },[code]);
 useEffect(()=>{
  if(chosen||!term.trim()){setMatches([]);return;}
  const controller=new AbortController();
  const timer=window.setTimeout(async()=>{
   try{
    const u=new URL(API+'/api/analysis/symbols');u.searchParams.set('q',term.trim());
    const r=await fetch(u.toString(),{credentials:'include',cache:'no-store',signal:controller.signal});
    if(!r.ok)throw Error('종목 목록 API '+r.status);
    const data=await r.json() as Catalog;
    if(controller.signal.aborted)return;
    setMatches(data.results||[]);
    setCatalogMessage(data.status==='CATALOG_NOT_READY'?'종목명 목록 준비 중 · 종목코드로는 조회할 수 있습니다.':
      data.status==='PARTIAL_CATALOG'?'전체 종목명 목록 저장 전 · 기존 검색 종목부터 검색됩니다.':'');
    if(/^[0-9A-Z]{6}$/.test(term.toUpperCase())){
     const exact=(data.results||[]).find(x=>x.code===term.toUpperCase());
     setName(exact?.name||'');
    }
   }catch(e){if(!controller.signal.aborted){setMatches([]);setCatalogMessage('종목명 검색 연결을 확인해 주세요. 종목코드 직접 입력은 가능합니다.');}}
  },250);
  return()=>{window.clearTimeout(timer);controller.abort();};
 },[term,chosen]);
 const choose=(symbol:SymbolMatch)=>{
  setChosen(true);setTerm(`${symbol.name} (${symbol.code})`);setCode(symbol.code);setName(symbol.name);
  setMatches([]);setResult(null);setNotice('');setCatalogMessage('');setLive(null);setLiveNotice('');
 };
 const valid=/^[0-9A-Z]{6}$/.test(code.toUpperCase())&&/^20\d{2}-\d{2}-\d{2}$/.test(day);
 const validLive=/^[0-9A-Z]{6}$/.test(code.toUpperCase());
 async function lookupLive(){
  if(!validLive)return;setLiveBusy(true);setLiveNotice('');
  try{
   const u=new URL(API+'/api/analysis/live');u.searchParams.set('code',code.trim().toUpperCase());
   const r=await fetch(u.toString(),{credentials:'include',cache:'no-store'});
   const data=await r.json() as LiveResult;
   if(!r.ok)throw Error(data.message||data.error||`현재 시세 조회 실패 (${r.status})`);
   setLive(data);
  }catch(e){setLiveNotice(e instanceof Error?e.message:'최근 시세를 조회할 수 없습니다.');}
  finally{setLiveBusy(false);}
 }
 async function requestLive(){
  if(!validLive)return;setLiveBusy(true);setLiveNotice('');
  try{
   const r=await fetch(API+'/api/analysis/live/refresh',{method:'POST',credentials:'include',
    headers:{'Content-Type':'text/plain;charset=UTF-8'},
    body:JSON.stringify({code:code.trim().toUpperCase()})});
   const data=await r.json() as LiveResult;
   if(!r.ok)throw Error(data.message||data.error||`현재 시세 수집 요청 실패 (${r.status})`);
   setLive(data);setLiveNotice(data.message||'저장 시세를 확인하거나 다음 수집을 기다려 주세요.');
  }catch(e){setLiveNotice(e instanceof Error?e.message:'현재 시세 수집을 요청하지 못했습니다.');}
  finally{setLiveBusy(false);}
 }
 async function lookup(){
  if(!valid)return;setBusy(true);setNotice('');setResult(null);
  try{
   const u=new URL(API+'/api/analysis/symbol');u.searchParams.set('code',code.trim().toUpperCase());u.searchParams.set('asof',day);
   const r=await fetch(u.toString(),{credentials:'include',cache:'no-store'});
   const data=await r.json() as Result&{error?:string};
   if(!r.ok)throw Error(data.message||data.error||`정밀분석 API ${r.status}`);
   setResult(data);
  }catch(e){setNotice(e instanceof Error?e.message:'조회에 실패했습니다.');}
  finally{setBusy(false);}
 }
 async function requestAnalysis(){
  if(!valid)return;setBusy(true);setNotice('');
  try{
   if(result?.status==='READY'){
    setNotice('이미 저장된 분석입니다. 아래 분석 결과를 확인해 주세요.');return;
   }
   // Avoid dispatching a redundant GitHub run for an already-stored diagnosis.
   const checkUrl=new URL(API+'/api/analysis/symbol');
   checkUrl.searchParams.set('code',code.trim().toUpperCase());checkUrl.searchParams.set('asof',day);
   const check=await fetch(checkUrl.toString(),{credentials:'include',cache:'no-store'});
   const saved=await check.json() as Result&{error?:string};
   if(!check.ok)throw Error(saved.message||saved.error||`기존 기록 확인 실패 (${check.status})`);
   if(saved.status==='READY'){
    setResult(saved);setNotice('이미 저장된 분석입니다. 분석 요청 없이 기존 기록을 표시했습니다.');return;
   }
   if(saved.status!=='NOT_STORED')throw Error(saved.message||'분석 기록 상태를 확인할 수 없습니다.');
   const r=await fetch(API+'/api/analysis/request',{method:'POST',credentials:'include',
    // text/plain is a CORS-simple request. Avoid JSON preflight through Access.
    headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({code:code.trim().toUpperCase(),asof:day})});
   const data=await r.json() as Result&{error?:string};
   if(!r.ok)throw Error(data.message||data.error||`분석 요청 실패 (HTTP ${r.status})`);
   setNotice(data.status==='READY'?'이미 분석 기록이 있습니다. 조회해 주세요.':
    '분석 요청이 접수됐습니다. GitHub 분석·D1 저장 후 다시 조회해 주세요.');
  }catch(e){
   const msg=e instanceof Error?e.message:'분석을 요청할 수 없습니다.';
   setNotice(/Failed to fetch|NetworkError|Load failed/i.test(msg)
    ?'분석 API와 연결하지 못했습니다. API Worker 배포·Access 로그인·브라우저 네트워크를 확인해 주세요. 같은 요청을 반복해서 누르지 않아도 됩니다.'
    :msg);
  }
  finally{setBusy(false);}
 }
 const d=result?.diagnosis,quality=result?.quality_status||result?.diagnosis?.quality_status;
 const displayName=(d?.name||name||'').trim();
 const fullName=displayName?`${displayName} (${d?.code||code})`:(d?.code||code);
 const predicates={...(d?.signal_predicates||{}),...(d?.additional_predicates||{})};
 const canAddAnalyzed=!!d&&result?.status==='READY'&&/^\d{6}$/.test(d.code)&&
  d.asof===day&&d.code===code&&quality!=='CORPORATE_ACTION_REVIEW_REQUIRED'&&
  typeof d.close==='number'&&Number.isFinite(d.close)&&d.close>0;
 const addedAlready=!!d&&isInBasket?.(d.code,d.asof)===true;
 const basketDisabledReason=addedAlready?'이 종목과 분석 기준일은 이미 사용자 장바구니에 담겨 있습니다.':
  !onAddToBasket?'장바구니 연결이 준비되지 않았습니다.':
  !d||result?.status!=='READY'?'해당 날짜의 저장된 확정 일봉 분석이 필요합니다.':
  !/^\d{6}$/.test(d.code)?'종목코드가 확인되지 않았습니다.':
  d.asof!==day||d.code!==code?'현재 선택한 종목·날짜와 분석 기록이 다릅니다. 분석을 다시 조회해 주세요.':
  quality==='CORPORATE_ACTION_REVIEW_REQUIRED'?'주식병합·분할에 따른 가격 단절을 확인하기 전에는 기준가를 확정할 수 없습니다.':
  typeof d.close!=='number'||!Number.isFinite(d.close)||d.close<=0?'확정 종가가 없거나 유효하지 않아 기준가격을 기록할 수 없습니다.':'';
 const addAnalyzed=()=>{
  if(!canAddAnalyzed||!d||!onAddToBasket||addedAlready)return;
  onAddToBasket({code:d.code,name:displayName||d.code,day:d.asof,close_price:d.close!,
   // Persist only verified signals actually satisfied on this historical day.
   signals:d.matched?d.selected_signals.split(',').map(x=>x.trim()).filter(Boolean):[]},d.matched);
 };
 return <section className="symbol-analysis-panel" aria-label="종목 정밀분석">
   <div className="symbol-analysis-intro"><h2>🔎 종목 정밀분석</h2><small>전체 종목명·코드 검색 · 과거 기준일 선택</small></div>
   <p className="symbol-analysis-hint">종목명 또는 코드로 찾을 수 있습니다. 먼저 저장된 분석을 조회하고, 기록이 없을 때 분석을 요청하세요.</p>
   <div className="symbol-analysis-controls">
    <div className="symbol-analysis-search"><label htmlFor="symbol-search-input">종목명 · 종목코드</label>
     <input id="symbol-search-input" type="search" autoComplete="off" value={term}
      onChange={e=>{const t=e.target.value.slice(0,60);setTerm(t);setChosen(false);setCode(/^[0-9a-zA-Z]{6}$/.test(t.trim())?t.trim().toUpperCase():'');setName('');setResult(null);setNotice('');setLive(null);setLiveNotice('');}}
      onKeyDown={e=>{if(e.key==='Enter'&&matches.length){e.preventDefault();choose(matches[0]);}}}
      placeholder="예: LK삼양 또는 225190" aria-label="종목명 또는 종목코드" aria-autocomplete="list" aria-expanded={matches.length>0} aria-controls="symbol-search-suggestions"/>
     {matches.length>0&&<div className="symbol-analysis-suggestions" id="symbol-search-suggestions" role="listbox">
      {matches.map(item=><button type="button" role="option" aria-selected={false} key={item.code}
       onClick={()=>choose(item)}><b>{item.name}</b><span>{item.code} · {item.market}</span></button>)}
     </div>}
     {catalogMessage&&<small className="symbol-analysis-catalog-note">{catalogMessage}</small>}
     {!valid&&term.trim()&&<small className="symbol-analysis-catalog-note">종목명을 입력했다면 목록에서 종목을 선택해 주세요.</small>}
    </div>
    <label>분석 기준일<input type="date" value={day} onChange={e=>{setDay(e.target.value);setResult(null);}}/></label>
    <button type="button" disabled={!valid||busy} onClick={()=>{void lookup();}}>{busy?'확인 중…':'분석 조회'}</button>
    <button type="button" className="outline" disabled={!valid||busy||result?.status==='READY'} onClick={()=>{void requestAnalysis();}}>{result?.status==='READY'?'저장된 분석':'분석 요청'}</button>
   </div>
   <div className="symbol-live-panel">
    <div className="symbol-live-heading"><div><strong>📡 최신 시세 기반 분석</strong><small>당일 확정 일봉 없이 수집 · KIS 시세 · 잠정 연구</small></div>
     <span className="symbol-live-pill">장중 잠정</span></div>
    <p className="symbol-analysis-hint">종목 선택 시 저장된 시세를 먼저 보여주고 KIS에 새 시세를 요청합니다. 거래시간 밖이거나 공급자 응답이 늦으면 기존 저장값을 표시합니다. 실시간 체결 보장은 아닙니다.</p>
    <div className="symbol-live-actions">
     <button type="button" disabled={!validLive||liveBusy} onClick={()=>{void lookupLive();}}>{liveBusy?'처리 중…':'저장 시세 조회'}</button>
     <button type="button" className="outline" disabled={!validLive||liveBusy} onClick={()=>{void requestLive();}}>KIS 시세 바로 갱신</button>
    </div>
    {liveNotice&&<p role="status" className="symbol-analysis-message">{liveNotice}</p>}
    {live&&!live.snapshot&&<p role="status" className="symbol-analysis-warning">{live.message||'시세가 저장되지 않았습니다.'}{live.request?.status&&` · 요청 상태: ${live.request.status}`}</p>}
    {live?.snapshot&&<>
     <div className="symbol-live-summary"><div><b>{live.name||name||live.snapshot.code} ({live.snapshot.code})</b>
      <small>{live.snapshot.market_label} · {live.snapshot.phase} · {live.snapshot.trade_date_kst}</small></div>
      <strong>{price(live.snapshot.price)}</strong></div>
     <p className="symbol-analysis-hint">{live.message} · 수집 시각: {new Date(live.snapshot.received_at_utc).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</p>
     <div className="symbol-live-facts">
      <span>시가 <b>{price(live.snapshot.open)}</b></span><span>고가 <b>{price(live.snapshot.high)}</b></span>
      <span>저가 <b>{price(live.snapshot.low)}</b></span><span>누적 거래량 <b>{live.snapshot.accumulated_volume.toLocaleString('ko-KR')}주</b></span>
      <span>전일 대비율 <b>{live.snapshot.change_from_prev_close_pct==null?'미확인':`${live.snapshot.change_from_prev_close_pct.toFixed(2)}%`}</b></span>
      <span>거래대금 제공값 <b>{live.snapshot.accumulated_turnover_raw||'미확인'}</b></span>
     </div>
     <p className="symbol-analysis-hint">거래대금 원본값의 단위를 아직 검증하지 않았으므로 500억 조건 판정에는 사용하지 않습니다. KRX 정규장과 NXT·시간외 거래를 합산하지 않습니다.</p>
     {live.reference&&<details className="symbol-analysis-conditions"><summary>저장된 과거 기술지표와 비교 (잠정 참고)</summary>
      <p className="symbol-analysis-hint">과거 기준일 {live.reference.day}의 지표이며 오늘의 새 이동평균이 아닙니다. 현재가와의 위치 비교만 가능합니다.</p>
      {live.reference.quality_status==='CORPORATE_ACTION_REVIEW_REQUIRED'?
       <p className="symbol-analysis-warning">가격 단절·주식병합 가능성으로 지표 비교를 보류했습니다.</p>:
       <div>{([['MA20',live.reference.ma20],['MA112',live.reference.ma112],['MA224',live.reference.ma224],['ENV20 하단',live.reference.env20_lower_20pct]] as Array<[string,number|null|undefined]>).map(([label,value])=><div key={label}><span>{label} · {price(value)}</span>
        <strong className={value==null?'unknown':live.snapshot!.price>=value?'yes':'no'}>{value==null?'자료 부족':live.snapshot!.price>=value?'현재가 상회':'현재가 하회'}</strong></div>)}</div>}
     </details>}
     <p className="symbol-analysis-hint">제공 시각이 아닌 실제 체결시각은 별도 검증되지 않았습니다. 이 자료는 확정 일봉·매매 신호·성과 통계로 저장하지 않습니다.</p>
    </>}
   </div>
   {notice&&<p role="status" className="symbol-analysis-message">{notice}</p>}
   {result&&result.status!=='READY'&&<p className="symbol-analysis-warning" role="status">{result.message||'분석 자료를 확인하지 못했습니다. 관리자에게 저장 상태를 문의해 주세요.'}</p>}
   {d&&<>
    <div className="symbol-analysis-head">
     <div><strong>{fullName} · {d.asof}</strong><span>{d.matched?'검색 신호 적중':'검색 미적중'} · {d.reason}</span></div>
     <strong>{price(d.close)}</strong>
    </div>
    <div className="symbol-analysis-basket-actions">
     <button type="button" disabled={!canAddAnalyzed||addedAlready||!onAddToBasket}
      title={basketDisabledReason||'확정 일봉 분석 기준가격으로 사용자 직접 선택'} onClick={addAnalyzed}>
      <ShoppingBasket size={17}/>{addedAlready?'이미 장바구니에 담김':'분석 후 직접 선택 · 장바구니 담기'}
     </button>
     <small role={basketDisabledReason?'status':undefined}>{basketDisabledReason?`담기 비활성화 이유: ${basketDisabledReason}`:
      '사용자 직접 선택으로 기록합니다. 분석 기준일의 확정 종가를 사용하며 AI 후보 선정과 구분됩니다.'}
      {!basketDisabledReason&&!d.matched?' 이 날짜에는 검색 신호를 충족하지 않았지만 개인 관찰용으로 담을 수 있습니다.':''}</small>
    </div>
    {quality==='CORPORATE_ACTION_REVIEW_REQUIRED'&&<p className="symbol-analysis-warning" role="alert">주식병합·분할 등 과거 가격 단절 검토가 필요합니다. 신호와 장기 이동평균은 미확정이며 과거 성과 통계를 숨겼습니다.</p>}
    {quality==='VERIFIED_CORPORATE_ACTION_ADJUSTED'&&<p className="symbol-analysis-hint">공식 주식병합 내역{d.corporate_action?` (${d.corporate_action.first_session} 첫 거래일 · ${d.corporate_action.old_shares_per_new_share}:1 병합)`:''}을 반영해 과거 가격·거래량을 같은 주식수 기준으로 비교합니다. 연구 결과의 수익률을 보장하지 않습니다.</p>}
    {quality==='UNADJUSTED_RESEARCH_ONLY'&&<p className="symbol-analysis-hint">미수정 일봉 기반 탐색적 분석입니다. 실제 매매 근거로 확정되지 않았습니다.</p>}
    <div className="symbol-analysis-facts">
     <span>시가 {price(d.open)}</span><span>고가 {price(d.high)}</span><span>저가 {price(d.low)}</span>
     <span>MA20 {price(d.ma20)}</span><span>ENV20 하단 {price(d.env20_lower_20pct)}</span>
     <span>MA112 {price(d.ma112)}</span><span>MA224 {price(d.ma224)}</span>
     <span>거래대금 {typeof d.amount_krw==='number'?(d.amount_krw/1e8).toFixed(1)+'억원':'미계산'}</span>
    </div>
    <details className="symbol-analysis-conditions" open><summary>조건별 판정과 누락 이유</summary>
      <div>{Object.entries(predicates).map(([key,value])=><div key={key}><span>{labels[key]||key}</span>
       <strong className={value===true?'yes':value===false?'no':'unknown'}>{value===true?'충족':value===false?'미충족':quality==='CORPORATE_ACTION_REVIEW_REQUIRED'?'검증 대기':'자료 부족'}</strong></div>)}</div>
    </details>
    {d.research_features&&<details className="symbol-analysis-conditions"><summary>종가베팅·45/55일 돌파 단서 (검증 전 가설)</summary>
      <p className="symbol-analysis-hint">직전 거래일까지만 계산한 기준선과 당일 확정 거래대금입니다. 장마감 동시호가 체결 가능성이나 다음 날 수익률을 의미하지 않습니다.</p>
      <div>
       <div><span>직전 45거래일 최고가</span><strong>{price(d.research_features.prior_45_day_high)}</strong></div>
       <div><span>직전 55거래일 최고가</span><strong>{price(d.research_features.prior_55_day_high)}</strong></div>
       <div><span>이전 20일 대비 거래대금</span><strong>{d.research_features.amount_ratio_prior20==null?'미계산':d.research_features.amount_ratio_prior20+'배'}</strong></div>
       <div><span>종가의 일중 위치</span><strong>{d.research_features.close_position_in_day_range==null?'미계산':(d.research_features.close_position_in_day_range*100).toFixed(1)+'%'}</strong></div>
      </div>
    </details>}
    {result?.chart&&<StockChart key={d.code+':'+d.asof} analysisMode code={d.code} day={d.asof} name={fullName}/>} 
    {!result?.chart&&<p className="symbol-analysis-warning">기준일 일봉이 없어 차트는 생성되지 않았습니다. 다른 날짜의 가격으로 대신하지 않습니다.</p>}
    <p className="symbol-analysis-hint">자료 원천: {result?.source||'미확인'} · 저장 {result?.stored_at||'시간 미확인'} · 기준일 이후 가격은 신호 판정에 사용하지 않습니다.</p>
   </>}
 </section>;
}

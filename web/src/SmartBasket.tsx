/** BLUE R1.5.0 — local-first AI observation basket.
 * No brokerage orders, no synthetic entries or invented real-time prices.
 * Stored in this browser only until user exports/imports a backup.
 */
import {useEffect,useState} from 'react';
import {Bot,Download,Upload,Trash2,RefreshCw,AlertCircle,ShoppingBasket} from 'lucide-react';
import './smart-basket.css';

// R153_PERFORMANCE_MONITOR: KIS results are server-verified; never fabricate missing candles.
type Performance={code:string;day:string;status:string;baseline?:number;
 registered_at?:string;checked_at?:string;last_covered_day?:string;
 highest_price?:number|null;highest_day?:string|null;
 recent_close?:number|null;recent_day?:string|null;
 quote_price?:number|null;quote_high?:number|null;quote_day?:string|null;
 quote_at?:string|null;quote_market?:string|null;last_error?:string|null;signal_names?:string|null};
const perfId=(x:{code:string;day:string})=>`${x.code}:${x.day}`;
const pctChange=(n:number|null|undefined,base:number)=>typeof n==='number'&&Number.isFinite(n)&&n>0&&base>0?(n/base-1)*100:null;
const pctText=(p:number|null)=>p===null?'—':`${p>0?'+':''}${p.toFixed(2)}%`;
// R154_CLARITY: distinguish original scan signals from later AI commentary.
const discoveredSignals=(stored:string[]|undefined,verified:string|null|undefined):string[]=>{
 const source=stored?.length?stored:(verified||'').split(',');
 return [...new Set(source.flatMap(s=>String(s).split(',')).map(s=>s.trim())
   .filter(s=>/^[A-Za-z0-9_\-]{2,48}$/.test(s)).map(s=>s.replace(/^BB/i,'BLUE')))];
};
const statusText=(s:string)=>({QUEUED:'등록 완료 · 수집 대기',NOT_REGISTERED:'수집 요청 전',
  HISTORY_PARTIAL:'과거 가격 확인 중',WAITING_TOKEN:'KIS 토큰 확인 필요',
  PROVIDER_RETRY:'시세 조회 재시도 예정',WAITING_NEXT_SESSION:'다음 거래일 대기',
  READY:'가격 확인 완료',UNVERIFIED_EOD:'검증된 종가 정보 없음',
  CAPACITY_LIMIT:'수집 대기열 한도 도달'} as Record<string,string>)[s]||'수집 상태 확인 중';
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
const STORE='blue_r15_basket_v1';
type SearchRow={code:string;name:string|null;day:string;close_price:number|null;signals:string[];extras?:Record<string,unknown>};
type AiPick={code:string;name:string;day:string;close_price:number;signals:string[];reason:string;risk:string;watch:string;source:'AI'};
type AiResult={status:string;asof?:string;items?:AiPick[];generated_at?:string;model?:string;cached?:boolean;message?:string;error?:string};
type BasketItem={id:string;source:'MANUAL'|'AI';code:string;name:string;day:string;baseline:number;
  added_at:string;signals:string[];memo:string;reason?:string;risk?:string;watch?:string};
type Quote={code:string;market:string;trade_date_kst:string;price:number;received_at_utc:string;exchange_tick_time_verified?:boolean};
type Quotes={status:string;items:Quote[];age_minutes?:number|null;latest_received_at_utc?:string|null};
const cash=(v:number|null|undefined)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ko-KR'):'—';
const validDay=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'));
const validCode=(s:unknown)=>typeof s==='string'&&/^\d{6}$/.test(s);
function readItems():BasketItem[]{
 try {const json=localStorage.getItem(STORE);if(!json)return [];const arr=JSON.parse(json);
  return Array.isArray(arr)?arr.filter(validItem).slice(0,100):[];
 } catch{return [];}
}
function validItem(x:any):x is BasketItem{
 return x&&typeof x==='object'&&validCode(x.code)&&validDay(x.day)&&
  (x.source==='MANUAL'||x.source==='AI')&&Number.isFinite(x.baseline)&&x.baseline>0&&
  typeof x.id==='string'&&x.id===`${x.source}:${x.code}:${x.day}`;
}
function baselineReturn(item:BasketItem,quote:Quote|undefined):number|null{
 if(!quote||!Number.isFinite(quote.price)||quote.price<=0||quote.trade_date_kst<=item.day)return null;
 return (quote.price/item.baseline-1)*100;
}
// R151_QUICK_ADD: controlled one-tap requests from the search results list.
export default function SmartBasket({quickAddRequest,onItemsChange,active=true}: {
 quickAddRequest?:{serial:number;item:SearchRow}|null;
 onItemsChange?:(ids:string[])=>void;
 active?:boolean;
}){
 const [items,setItems]=useState<BasketItem[]>(readItems);
 const [filter,setFilter]=useState<'ALL'|'MANUAL'|'AI'>('ALL');
 const [ai,setAi]=useState<AiResult|null>(null);
  const [aiBusy,setAiBusy]=useState(false);
  // R152_COMPACT_BASKET: AI results stay collapsed until requested.
  const [showAi,setShowAi]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [quotes,setQuotes]=useState<Quotes|null>(null);
 const [performance,setPerformance]=useState<Record<string,Performance>>({});
 const [performanceError,setPerformanceError]=useState('');
 const [performanceChecked,setPerformanceChecked]=useState('');
 const idsKey=items.map(x=>perfId(x)).join(',');
 // Register immediately after any new item (including quick-add from hidden search tab).
 useEffect(()=>{
   if(!idsKey)return;
   let disposed=false;
   const register=async()=>{
    const entries=idsKey.split(',').map(x=>{const pos=x.indexOf(':');return {code:x.slice(0,pos),day:x.slice(pos+1)};});
    for(let i=0;i<entries.length;i+=20){
     if(disposed)break;
     try{const r=await fetch(API+'/api/basket/watch',{method:'POST',credentials:'include',
       headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({items:entries.slice(i,i+20)}),cache:'no-store'});
       if(!r.ok)throw Error(r.status===404?'수집 API 배포 전':`등록 API 오류 ${r.status}`);
       if(!disposed)setPerformanceError('');
     }catch(e){if(!disposed)setPerformanceError(e instanceof Error?e.message:'수집 등록 실패');break;}
    }
   };
   void register();return()=>{disposed=true;};
 },[idsKey]);
 // The UI checks frequently; server collection itself occurs via separate Cron.
 useEffect(()=>{
   if(!active||!idsKey)return;
   let disposed=false,inFlight=false;
   const load=async()=>{
    if(inFlight||document.visibilityState==='hidden')return;
    inFlight=true;
    try{
     const url=new URL(API+'/api/basket/watch');url.searchParams.set('items',idsKey);
     const r=await fetch(url.toString(),{credentials:'include',cache:'no-store'});
     if(!r.ok)throw Error(r.status===404?'수집 API 배포 전':`조회 API 오류 ${r.status}`);
     const data=await r.json() as {items:Performance[]};
     if(!disposed){setPerformance(Object.fromEntries((data.items||[]).map(x=>[perfId(x),x])));
       setPerformanceChecked(new Date().toISOString());setPerformanceError('');}
    }catch(e){if(!disposed)setPerformanceError(e instanceof Error?e.message:'가격 확인 실패');}
    finally{inFlight=false;}
   };
   void load();const timer=window.setInterval(()=>{void load();},30000);
   const wake=()=>{if(document.visibilityState==='visible')void load();};
   document.addEventListener('visibilitychange',wake);
   return()=>{disposed=true;window.clearInterval(timer);document.removeEventListener('visibilitychange',wake);};
 },[active,idsKey]);
 useEffect(()=>{onItemsChange?.(items.map(x=>x.id));},[items,onItemsChange]);
 useEffect(()=>{
  if(quickAddRequest)add(quickAddRequest.item,'MANUAL');
  // Only react to new requests, not unrelated changes to basket items.
 },[quickAddRequest]);
 useEffect(()=>{try{localStorage.setItem(STORE,JSON.stringify(items));}catch{setError('이 기기 저장 공간이 부족합니다. JSON 백업을 내려받아 주세요.');}},[items]);
 useEffect(()=>{
  let mounted=true;
  const fetchAi=async()=>{try{
   const r=await fetch(API+'/api/basket/ai',{credentials:'include',cache:'no-store'});
   if(!r.ok)return;
   const data=await r.json() as AiResult;if(mounted)setAi(data);
  }catch{/* optional candidate cache */}};
  void fetchAi();return()=>{mounted=false;};
 },[]);
 useEffect(()=>{
  let mounted=true;
  const load=async()=>{if(document.visibilityState==='hidden')return;
   try{const r=await fetch(API+'/api/live/quotes',{credentials:'include',cache:'no-store'});
    if(!r.ok)return;const data=await r.json() as Quotes;if(mounted)setQuotes(data);
   }catch{/* show previous retrieved snapshots with label */}
  };
  void load();const id=window.setInterval(()=>void load(),60000);
  return()=>{mounted=false;window.clearInterval(id);};
 },[]);
 function add(data:SearchRow|AiPick,source:'MANUAL'|'AI'){
  if(!validCode(data.code)||!validDay(data.day)||!Number.isFinite(data.close_price)||!data.close_price||data.close_price<=0){
   setError('확정 종가와 거래일이 있는 종목만 담을 수 있습니다.');return;
  }
  const id=`${source}:${data.code}:${data.day}`;
  if(items.some(it=>it.id===id)){setMessage('이미 담긴 종목입니다.');return;}
  if(items.length>=100){setError('관찰함은 최대 100건까지 저장합니다.');return;}
  const p=source==='AI'?data as AiPick:null;
  setItems(prev=>[{id,source,code:data.code,name:data.name||data.code,day:data.day,
    baseline:data.close_price as number,added_at:new Date().toISOString(),signals:data.signals||[],memo:'',
    reason:p?.reason,risk:p?.risk,watch:p?.watch},...prev]);
  setError('');setMessage(`${data.name||data.code} 관찰함에 추가했습니다.`);
 }
 async function generateAi(){if(aiBusy)return;setAiBusy(true);setError('');setMessage('');
  try{const r=await fetch(API+'/api/basket/ai',{method:'POST',credentials:'include',
   headers:{'Content-Type':'text/plain;charset=UTF-8'},body:'{}',cache:'no-store'});
   const d=await r.json() as AiResult;
   if(!r.ok)throw Error(`${d.message||'AI 후보 생성 실패'}${d.error?' ('+d.error+')':''} · HTTP ${r.status}`);
   setAi(d);if(d.status==='READY')setShowAi(true);if(d.status==='PENDING')setMessage('다른 요청에서 분석 중입니다. 잠시 뒤 화면을 다시 열어 주세요.');
   else if(d.status!=='READY')setMessage(d.message||'검증된 최근 종가 후보를 찾지 못했습니다.');
  }catch(e){setError(e instanceof Error?e.message:'AI 후보 생성 실패');}
  finally{setAiBusy(false);}
 }
 function saveBackup(){
  const blob=new Blob([JSON.stringify({version:1,exported_at:new Date().toISOString(),items},null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;
  a.download='BLUE_R15_관찰함_'+new Date().toISOString().slice(0,10)+'.json';a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),3000);
 }
 async function importBackup(file:File|undefined){if(!file)return;if(file.size>200000){setError('백업 파일은 200KB 이하만 가능합니다.');return;}
  try{const obj=JSON.parse(await file.text());if(obj.version!==1||!Array.isArray(obj.items))throw Error('지원하지 않는 파일입니다.');
   if(obj.items.length>100||obj.items.some((x:unknown)=>!validItem(x)))throw Error('관찰함 데이터 형식이 맞지 않습니다.');
   setItems(current=>{const all=new Map(current.map(x=>[x.id,x]));for(const x of obj.items as BasketItem[])all.set(x.id,x);
    return [...all.values()].slice(0,100);});setError('');setMessage('백업을 가져왔습니다. 동일 종목·날짜는 백업 내용으로 갱신했습니다.');
  }catch(e){setError(e instanceof Error?e.message:'백업 파일 오류');}
 }
 const latestQuote=new Map<string,Quote>();
 for(const q of quotes?.items||[]){if(q.market==='J'&&validCode(q.code)&&q.price>0)latestQuote.set(q.code,q);}
 const visible=items.filter(x=>filter==='ALL'||x.source===filter);
 const pct=(x:BasketItem)=>{
  const pr=performance[perfId(x)];const price=pr?.quote_day&&pr.quote_day>x.day&&pr.quote_day>=(pr.recent_day||'')
   ?pr.quote_price:pr?.recent_day&&pr.recent_day>x.day?pr.recent_close:null;
  return pctChange(price,x.baseline)??baselineReturn(x,latestQuote.get(x.code));
 };
 const summary=(kind:'MANUAL'|'AI')=>{
  const list=items.filter(x=>x.source===kind&&pct(x)!==null);
  const days=new Set(list.map(x=>x.day));
  return {n:list.length,avg:list.length&&days.size===1?list.reduce((s,x)=>s+(pct(x)??0),0)/list.length:null,
   comparable:days.size<=1};
 };
 const manual=summary('MANUAL'),machine=summary('AI');
 const comparable=manual.n>0&&machine.n>0&&manual.comparable&&machine.comparable&&
   new Set(items.filter(x=>pct(x)!==null).map(x=>x.day)).size===1;
  return <section className="panel blue-basket r152-basket-compact" id="blue-basket" aria-labelledby="blue-basket-h">
   <header className="r152-basket-head">
     <div><h2 id="blue-basket-h"><ShoppingBasket size={18}/> AI 스마트 장바구니 <small>R1.5.4</small></h2>
       <p>검색 결과의 장바구니 아이콘으로 직접 담고, 이곳에서 AI 후보와 비교합니다.</p></div>
     <button type="button" className="r152-ai-generate" disabled={aiBusy} onClick={()=>void generateAi()}>
       {aiBusy?<RefreshCw size={17}/>:<Bot size={17}/>}{aiBusy?'AI 분석 중…':'AI 후보 만들기'}
     </button>
   </header>
   <div className="r152-basket-kpis" aria-label="장바구니 현황">
     <div><span>내 선택</span><strong>{items.filter(x=>x.source==='MANUAL').length}</strong></div>
     <div><span>AI 선택</span><strong>{items.filter(x=>x.source==='AI').length}</strong></div>
     <div><span>성과 차이</span><strong>{comparable?((machine.avg??0)-(manual.avg??0)>0?'+':'')+((machine.avg??0)-(manual.avg??0)).toFixed(2)+'%p':'—'}</strong></div>
   </div>
   {ai?.status==='READY'&&<details className="r152-ai-candidates" open={showAi} onToggle={e=>setShowAi(e.currentTarget.open)}>
     <summary><span>AI 관찰 후보 <strong>{(ai.items||[]).length}종목</strong></span><small>{ai.asof} · {ai.cached?'저장된 분석':'새 분석'}</small></summary>
     <div className="basket-ai-results"><small>Gemini 검토 결과 · {ai.model}</small>
       {!(ai.items||[]).length&&<p className="basket-muted">AI가 이번 거래일의 후보를 보류했습니다.</p>}
       {(ai.items||[]).map(p=><article key={p.code}><div><b>{p.name} ({p.code})</b>
         <span>기준 종가 {cash(p.close_price)}원</span></div><p>{p.reason||'관찰 근거 추가 확인 필요'}</p>
         <small>반대 시나리오: {p.risk||'미기재'}</small><small>다음 확인: {p.watch||'미기재'}</small>
         <button type="button" disabled={items.some(x=>x.id===`AI:${p.code}:${p.day}`)} onClick={()=>add(p,'AI')}>
           {items.some(x=>x.id===`AI:${p.code}:${p.day}`)?'AI 관찰함에 담김':'AI 관찰함에 담기'}</button>
       </article>)}
     </div>
   </details>}
   {ai&&ai.status!=='READY'&&ai.status!=='NOT_CACHED'&&ai.status!=='PENDING'&&<p className="basket-muted">{ai.message||'최근 확정 일봉 데이터가 없습니다.'}</p>}
  {error&&<p className="basket-alert" role="alert"><AlertCircle size={15}/>{error}</p>}
  {message&&<p className="basket-feedback" role="status">{message}</p>}
   {performanceError&&<p className="basket-alert" role="status">시세 수집 연결: {performanceError}</p>}
   {items.length>0&&<p className="r153-performance-status" role="status">
    <RefreshCw size={12}/> 장바구니 등록 직후 수집 요청 · 서버 분당 최대 3종목 처리 · 화면 확인 30초
    {performanceChecked&&<span> · 마지막 화면 확인 {new Date(performanceChecked).toLocaleTimeString('ko-KR')}</span>}
   </p>}
  <div className="basket-tabs" role="group" aria-label="장바구니 분류">{([['ALL','전체'],['MANUAL','내 선택'],['AI','AI 선택']] as const).map(([key,title])=><button
    key={key} type="button" aria-pressed={filter===key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{title}</button>)}</div>
  {!visible.length?<div className="basket-empty">아직 담긴 종목이 없습니다. 검색 결과에서 담기 아이콘을 누르거나 AI 후보를 생성하세요.</div>:
   <div className="basket-list">{visible.map(it=>{const q=latestQuote.get(it.code),growth=pct(it);
     const pr=performance[perfId(it)];
     const signalChips=discoveredSignals(it.signals,pr?.signal_names);
     const quoteIsLater=!!(pr?.quote_day&&pr.quote_day>it.day&&pr.quote_day>=(pr.recent_day||''));
     const recent=quoteIsLater?pr?.quote_price:pr?.recent_day&&pr.recent_day>it.day?pr?.recent_close:null;
     const recentDay=quoteIsLater?pr?.quote_day:pr?.recent_day;
     const baselineOnly=pr?.status==='WAITING_NEXT_SESSION'&&!recent&&!(q&&q.trade_date_kst>it.day);
     const intradayHigh=pr?.quote_day&&pr.quote_day>it.day?pr.quote_high:null;
     const dailyHigh=pr?.highest_price||null;
     const maxHigh=intradayHigh&&(!dailyHigh||intradayHigh>dailyHigh)?intradayHigh:dailyHigh;
     const maxHighDay=maxHigh===intradayHigh?pr?.quote_day:pr?.highest_day;
     const pending=!pr||['QUEUED','NOT_REGISTERED','HISTORY_PARTIAL'].includes(pr.status);
     const state=pr?statusText(pr.status):'등록 확인 중';
    return <article className="basket-record" key={it.id}>
     <div className="basket-record-head"><div><span className={`basket-src ${it.source==='AI'?'ai':''}`}>{it.source==='AI'?'AI 선택':'직접 선택'}</span>
       <strong>{it.name}</strong> <small>{it.code}</small></div>
       <button type="button" className="basket-delete" title="장바구니에서 제거" aria-label={`${it.name} 제거`}
       onClick={()=>setItems(old=>old.filter(x=>x.id!==it.id))}><Trash2 size={16}/></button></div>
     <div className="r154-origin-strip">
       <div className="r154-discovery-price"><span>발견가</span><strong>{cash(it.baseline)}원</strong><small>{it.day} · 확정 종가</small></div>
       <div className="r154-discovery-signals"><span>발견 당시 기술 신호</span>
         <div>{signalChips.length?signalChips.slice(0,5).map(t=><span className="r154-signal-chip" key={t}>{t}</span>):
           <small className="r154-no-signal">원본 신호 확인 불가</small>}
           {signalChips.length>5&&<small className="r154-more-signals">+{signalChips.length-5}</small>}</div>
       </div>
     </div>
     <div className="basket-record-stats r153-price-grid">
       <div><span>검색 이후 최고가</span><b>{maxHigh?`${cash(maxHigh)}원`:'—'}</b>
         <small>{maxHigh?`${pctText(pctChange(maxHigh,it.baseline))} · ${maxHighDay||''}${maxHigh===intradayHigh?' (장중 관측)':''}`:pending?'수집 중':'이후 거래 없음 / 미확인'}</small></div>
       <div><span>최근 확인가</span><b>{recent?`${cash(recent)}원`:q&&q.trade_date_kst>it.day?`${cash(q.price)}원`:baselineOnly?`${cash(it.baseline)}원`:'—'}</b>
         <small>{recentDay||((q&&q.trade_date_kst>it.day)?q.trade_date_kst:baselineOnly?it.day:'확인 대기')}{quoteIsLater?' · 장중 관측':recent?' · 확정 종가':q&&q.trade_date_kst>it.day?' · 기존 KIS 저장 시세':baselineOnly?' · 검색일 기준가':''}</small></div>
       <div><span>기준가 대비</span><b className={growth==null?'':growth>=0?'basket-rise':'basket-fall'}>{pctText(growth)}</b>
         <small>{maxHigh&&recent?`최고가 대비 ${pctText(pctChange(recent,maxHigh))}`:state}</small></div>
     </div>
     <div className="r153-row-state" title={pr?.checked_at||''}>{state}{pr?.checked_at&&` · 최종 확인 ${new Date(pr.checked_at).toLocaleString('ko-KR')}`}</div>
     <details className="r152-record-more"><summary>메모 · 관찰 근거</summary>
       {it.source==='AI'&&<p className="basket-insight">AI 관찰 근거: {it.reason||'미기재'} · 위험: {it.risk||'미기재'}</p>}
       <label className="basket-memo">관찰 메모<input value={it.memo} maxLength={240} placeholder="추세선·거래량·다음 확인 항목" onChange={e=>setItems(old=>old.map(x=>x.id===it.id?{...x,memo:e.target.value}:x))}/></label>
     </details>
    </article>})}</div>}
  <p className="basket-foot">R1.5.3 검색일 다음 거래일부터의 KIS 원주가 일봉 고가를 사용합니다. 액면분할·합병에 따른 가격 보정은 하지 않아 수익률 왜곡 가능성이 있습니다. 수집 토큰 상태·장외시간에 따라 2분 안에 값이 표시되지 않을 수 있습니다. 장중 확인가는 확정 종가와 다릅니다. 연구 전용 · 등록 기준은 실제 체결가가 아닌 과거 확정 종가입니다. 성과는 후속 KRX 수집 스냅샷이 있을 때만 참고 비교하며, 최신 체결 확인·수수료·세금·배당·수정주가를 반영하지 않습니다. AI 후보는 검증된 투자 우위가 아닙니다. 장바구니는 현재 브라우저에만 저장됩니다.</p>
   <details className="r152-data-management"><summary>데이터 관리 · 기기 변경 시 백업</summary>
     <div className="basket-actions"><button type="button" onClick={saveBackup}><Download size={15}/> 백업 저장</button>
       <label className="basket-import"><Upload size={15}/> 백업 가져오기<input type="file" accept=".json,application/json" onChange={e=>{void importBackup(e.target.files?.[0]);e.target.value='';}}/></label>
     </div>
   </details>
 </section>;
}

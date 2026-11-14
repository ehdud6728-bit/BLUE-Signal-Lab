/** BLUE R1.5.0 — local-first AI observation basket.
 * No brokerage orders, no synthetic entries or invented real-time prices.
 * Stored in this browser only until user exports/imports a backup.
 */
import {useEffect,useRef,useState} from 'react';
import {Bot,Download,Upload,Trash2,RefreshCw,AlertCircle,ShoppingBasket,Bookmark,BookmarkCheck,ChevronDown} from 'lucide-react';
import {groupBasketRecords} from './basket-grouping';
import './r1595-group-price.css';
import './smart-basket.css';
import './r158-long-watch.css';
import {comparisonKey,fetchCompared,sourceName,type PriceCompare} from './price-compare';
import StopLossRow from './StopLossRow';
import type {StopMethod} from './stop-loss';
import BasketSupplyRecordRow from './BasketSupplyRecordRow';
import {readSupplyAtDiscovery,supplyFromSearchExtras,validSupplyRecord,type BasketSupplyRecord} from './basket-supply-record';

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
   .filter(s=>/^[A-Za-z0-9_\-]{2,48}$/.test(s)).map(s=>s.replace(/^(?:BLUE|BB)(?=\d)/i,'B')))];
};
const statusText=(s:string)=>({QUEUED:'등록 완료 · 수집 대기',NOT_REGISTERED:'수집 요청 전',
  HISTORY_PARTIAL:'과거 가격 확인 중',WAITING_TOKEN:'KIS 토큰 확인 필요',
  PROVIDER_RETRY:'시세 조회 재시도 예정',WAITING_NEXT_SESSION:'다음 거래일 대기',
  READY:'가격 확인 완료',UNVERIFIED_EOD:'검증된 종가 정보 없음',
  CAPACITY_LIMIT:'수집 대기열 한도 도달'} as Record<string,string>)[s]||'수집 상태 확인 중';
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
// R158_LONGTERM: separate storage quotas; this is cleanup protection, not cloud backup.
const STORE='blue_r15_basket_v1';
const MAX_REGULAR=100, MAX_PROTECTED=20;
type SearchRow={code:string;name:string|null;day:string;close_price:number|null;signals:string[];extras?:Record<string,unknown>};
type AiPick={code:string;name:string;day:string;close_price:number;signals:string[];reason:string;risk:string;watch:string;source:'AI'};
type AiResult={status:string;asof?:string;items?:AiPick[];generated_at?:string;model?:string;cached?:boolean;message?:string;error?:string};
type BasketItem={id:string;source:'MANUAL'|'AI';code:string;name:string;day:string;baseline:number;
  added_at:string;signals:string[];memo:string;reason?:string;risk?:string;watch?:string;
  protected?:boolean;protected_at?:string;
  patternUp10d?:number;patternN10d?:number;patternLabel10d?:string;patternDays10d?:string[];
  stopMethod?:StopMethod; supplyRecord?:BasketSupplyRecord; supplyMemo?:string};
type Quote={code:string;market:string;trade_date_kst:string;price:number;received_at_utc:string;exchange_tick_time_verified?:boolean};
type Quotes={status:string;items:Quote[];age_minutes?:number|null;latest_received_at_utc?:string|null};
const cash=(v:number|null|undefined)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ko-KR'):'—';
const validDay=(s:unknown)=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'));
const validCode=(s:unknown)=>typeof s==='string'&&/^\d{6}$/.test(s);
function keepQuotas(list:BasketItem[]):BasketItem[]{
 const seen=new Set<string>();let regular=0,locked=0;
 return list.filter(x=>{
  if(seen.has(x.id))return false;
  if(x.protected===true){if(locked>=MAX_PROTECTED)return false;locked++;}
  else {if(regular>=MAX_REGULAR)return false;regular++;}
  seen.add(x.id);return true;
 });
}
function readItems():BasketItem[]{
 try {const json=localStorage.getItem(STORE);if(!json)return [];const arr=JSON.parse(json);
  return Array.isArray(arr)?keepQuotas(arr.filter(validItem)):[];
 } catch{return [];}
}
function validItem(x:any):x is BasketItem{
 return x&&typeof x==='object'&&validCode(x.code)&&validDay(x.day)&&
  (x.source==='MANUAL'||x.source==='AI')&&Number.isFinite(x.baseline)&&x.baseline>0&&
  typeof x.id==='string'&&x.id===`${x.source}:${x.code}:${x.day}`&&
  (x.protected===undefined||typeof x.protected==='boolean')&&
  (x.protected_at===undefined||typeof x.protected_at==='string')&&
   (x.stopMethod===undefined||(['SUPPORT','ATR','MA20','TRAILING'] as string[]).includes(x.stopMethod))&&
   (x.patternUp10d===undefined||(typeof x.patternUp10d==='number'&&Number.isFinite(x.patternUp10d)&&x.patternUp10d>=0&&x.patternUp10d<=100))&&
   (x.patternN10d===undefined||(Number.isInteger(x.patternN10d)&&x.patternN10d>=1&&x.patternN10d<=100000))&&
   (x.patternLabel10d===undefined||(typeof x.patternLabel10d==='string'&&x.patternLabel10d.length<=150))&&
   (x.patternDays10d===undefined||(Array.isArray(x.patternDays10d)&&x.patternDays10d.length<=12&&
    x.patternDays10d.every((d:unknown)=>typeof d==='string'&&validDay(d)&&d<=x.day)))&&
   (x.supplyRecord===undefined||(validSupplyRecord(x.supplyRecord)&&x.supplyRecord.asof===x.day))&&
   (x.supplyMemo===undefined||(typeof x.supplyMemo==='string'&&x.supplyMemo.length<=400));
}
// R1591: freeze only provenance-backed research evidence from an actual search/D1 row.
function patternEvidence(data:SearchRow|AiPick):Pick<BasketItem,'patternUp10d'|'patternN10d'|'patternLabel10d'|'patternDays10d'>|Record<string,never>{
 const x='extras' in data?data.extras:undefined;
 const n=Number(x?.r159_pattern_n_10d),p=Number(x?.r159_pattern_up_10d);
 if(!Number.isInteger(n)||n<1||n>100000||!Number.isFinite(p)||p<0||p>100)return {};
 const rawLabel=x?.r159_pattern_label_10d;const label=typeof rawLabel==='string'?rawLabel.slice(0,150):'';
 let days:string[]|undefined;
 try{const raw=x?.r159_pattern_signal_days_10d_json;
  const parsed=typeof raw==='string'?JSON.parse(raw):raw;
  if(Array.isArray(parsed))days=parsed.filter((d):d is string=>validDay(d)&&d<=data.day).slice(-12);
 }catch{/* Old research snapshots did not contain occurrence dates. */}
 return {patternUp10d:p,patternN10d:n,patternLabel10d:label,...(days?{patternDays10d:days}:{})};
}
const hotPattern=(x:BasketItem,threshold:number|null,minSamples:number)=>threshold!==null&&
 typeof x.patternUp10d==='number'&&x.patternUp10d>=threshold&&
 typeof x.patternN10d==='number'&&x.patternN10d>=minSamples;
function baselineReturn(item:BasketItem,quote:Quote|undefined):number|null{
 if(!quote||!Number.isFinite(quote.price)||quote.price<=0||quote.trade_date_kst<=item.day)return null;
 return (quote.price/item.baseline-1)*100;
}
// R151_QUICK_ADD: controlled one-tap requests from the search results list.
export default function SmartBasket({quickAddRequest,onItemsChange,active=true,refreshKey=0,patternHighlightMin=70,patternSampleMin=8}: {
 quickAddRequest?:{serial:number;item:SearchRow}|null;
 onItemsChange?:(ids:string[])=>void;
 active?:boolean;
 refreshKey?:number;
 patternHighlightMin?:number|null;
 patternSampleMin?:number;
}){
 const [items,setItems]=useState<BasketItem[]>(readItems);
 const [supplyBusy,setSupplyBusy]=useState<string[]>([]);
 const supplyLoading=useRef<Set<string>>(new Set());
 const isHot=(x:BasketItem)=>hotPattern(x,patternHighlightMin,patternSampleMin);
 const evidenceAttempted=useRef<Set<string>>(new Set());
 const [filter,setFilter]=useState<'ALL'|'MANUAL'|'AI'|'PROTECTED'>('ALL');
 const [cleanupDays,setCleanupDays]=useState(60);
 const [lastRemoved,setLastRemoved]=useState<BasketItem[]>([]);
 // R157_BASKET_FILTERS: local display filters; persisted basket order/data never changed.
 const [rank,setRank]=useState<'RECENT'|'GAIN_TOP'|'LOSS_TOP'>('RECENT');
 const [groupSimilar,setGroupSimilar]=useState(true);
 const [expandedCodes,setExpandedCodes]=useState<string[]>([]);
 const [dayFilter,setDayFilter]=useState('ALL');
 const [query,setQuery]=useState('');
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
 // R1593: mirror shared, read-only D1 price records; preserve existing Watch queue.
 const [r1593Prices,setR1593Prices]=useState<Record<string,PriceCompare>>({});
 const [r1593Error,setR1593Error]=useState('');
 useEffect(()=>{
  if(!active||!idsKey)return;const ctrl=new AbortController();let loading=false;
  const load=async()=>{if(loading||document.visibilityState==='hidden')return;loading=true;
   try{const result=await fetchCompared(items,ctrl.signal,partial=>{if(!ctrl.signal.aborted)setR1593Prices(prev=>({...prev,...partial}));});if(!ctrl.signal.aborted){setR1593Prices(prev=>({...prev,...result}));setR1593Error('');}}
   catch(e){if(!ctrl.signal.aborted)setR1593Error(e instanceof Error?e.message:'최근 시세 확인 실패');}
   finally{loading=false;}
  };
  void load();const timer=window.setInterval(()=>{void load();},30000);
  const wake=()=>{if(document.visibilityState==='visible')void load();};
  document.addEventListener('visibilitychange',wake);
  return ()=>{ctrl.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',wake);};
 },[active,idsKey,refreshKey]);
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
 },[active,idsKey,refreshKey]);
 // R1.5.10.4: sample-floor changes must refresh verified basket evidence.
 // The API only reads D1 chart evidence, never performs a market/KIS request.
 useEffect(()=>{evidenceAttempted.current.clear();},[patternSampleMin]);
 useEffect(()=>{
  if(!active)return;let disposed=false;let cursor=0;
  const pending=[...new Map(items.map((x):[string,BasketItem]=>[perfId(x),x])).values()]
    .filter(x=>!evidenceAttempted.current.has(perfId(x)));
  if(!pending.length)return;
  const worker=async()=>{while(!disposed){
   const it=pending[cursor++];if(!it)return;const key=perfId(it);evidenceAttempted.current.add(key);
   try{const u=new URL(API+'/api/search');u.searchParams.set('mode','single');
    u.searchParams.set('date',it.day);u.searchParams.set('code',it.code);u.searchParams.set('limit','1');
    u.searchParams.set('min_pattern_n',String(patternSampleMin));
    const r=await fetch(u.toString(),{credentials:'include',cache:'no-store'});if(!r.ok)continue;
    const d=await r.json() as {items?:SearchRow[]};
    const found=d.items?.find(x=>x.code===it.code&&x.day===it.day);if(!found||disposed)continue;
    const snapshot=patternEvidence(found);if(!('patternN10d' in snapshot))continue;
    setItems(old=>old.map(x=>perfId(x)===key?{...x,...snapshot}:x));
   }catch{/* Historical evidence is optional. Never invent it on network errors. */}
  }};
  void Promise.all([worker(),worker(),worker()]);
  return()=>{disposed=true};
 },[active,idsKey,patternSampleMin]);
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
 },[refreshKey]);
 // As-of snapshot is captured once on adding. A successful record is never silently replaced.
 async function captureSupply(id:string,code:string,day:string,baseline:number){
  if(supplyLoading.current.has(id))return;
  supplyLoading.current.add(id);setSupplyBusy(list=>list.includes(id)?list:[...list,id]);
  try{
   const snapshot=await readSupplyAtDiscovery(code,day,baseline);
   if(snapshot)setItems(old=>old.map(it=>it.id===id&&it.supplyRecord?.status!=='READY'?{...it,supplyRecord:snapshot}:it));
  }catch{/* Chart unavailable, Access blocked or data missing: preserve search-time fallback. */}
  finally{supplyLoading.current.delete(id);setSupplyBusy(list=>list.filter(x=>x!==id));}
 }
 function add(data:SearchRow|AiPick,source:'MANUAL'|'AI'){
  if(!validCode(data.code)||!validDay(data.day)||!Number.isFinite(data.close_price)||!data.close_price||data.close_price<=0){
   setError('확정 종가와 거래일이 있는 종목만 담을 수 있습니다.');return;
  }
  const id=`${source}:${data.code}:${data.day}`;
  if(items.some(it=>it.id===id)){setMessage('이미 담긴 종목입니다.');return;}
  if(items.filter(x=>!x.protected).length>=MAX_REGULAR){setError('일반 관찰함은 100건까지 가능합니다. 오래 보려는 종목은 장기 관찰로 보호하세요.');return;}
  const p=source==='AI'?data as AiPick:null;
  const initialSupply=source==='MANUAL'?supplyFromSearchExtras((data as SearchRow).extras,data.day):undefined;
  setItems(prev=>[{id,source,code:data.code,name:data.name||data.code,day:data.day,
    baseline:data.close_price as number,added_at:new Date().toISOString(),signals:data.signals||[],memo:'',
    reason:p?.reason,risk:p?.risk,watch:p?.watch,...patternEvidence(data),
    ...(initialSupply?{supplyRecord:initialSupply}:{}),supplyMemo:''},...prev]);
  void captureSupply(id,data.code,data.day,data.close_price as number);
  setError('');setMessage(`${data.name||data.code} 관찰함에 추가했습니다.`);
 }
 async function generateAi(){if(aiBusy)return;setAiBusy(true);setError('');setMessage('');
  try{const r=await fetch(API+'/api/basket/ai',{method:'POST',credentials:'include',
   headers:{'Content-Type':'text/plain;charset=UTF-8'},body:'{}',cache:'no-store'});
   const d=await r.json() as AiResult;
   if(!r.ok)throw Error(`${d.message||'AI 후보 생성 실패'}${d.error?' ('+d.error+')':''} · HTTP ${r.status}`);
    setAi(d);
    if(d.status==='READY'){
     // R157_AI_AUTO_ADD: only server-verified picks, never invent a basket item.
     const picked=(Array.isArray(d.items)?d.items:[]).filter(p=>validCode(p.code)&&validDay(p.day)&&
       Number.isFinite(p.close_price)&&p.close_price>0).slice(0,6);
     const already=new Set(items.map(x=>x.id));
     const unique=picked.filter(p=>!already.has(`AI:${p.code}:${p.day}`));
     setItems(old=>{
      const existing=new Set(old.map(x=>x.id));
      const room=Math.max(0,MAX_REGULAR-old.filter(x=>!x.protected).length);
      const additions=unique.filter(p=>!existing.has(`AI:${p.code}:${p.day}`)).slice(0,room).map(p=>({
       id:`AI:${p.code}:${p.day}`,source:'AI' as const,code:p.code,name:p.name||p.code,
       day:p.day,baseline:p.close_price,added_at:new Date().toISOString(),signals:p.signals||[],
       memo:'',reason:p.reason,risk:p.risk,watch:p.watch,supplyMemo:''
      }));
      return additions.length?[...additions,...old]:old;
     });
     const capacity=Math.max(0,MAX_REGULAR-items.filter(x=>!x.protected).length);
     for(const p of unique.slice(0,capacity)){void captureSupply(`AI:${p.code}:${p.day}`,p.code,p.day,p.close_price);}
     setShowAi(false);setFilter('AI');setDayFilter('ALL');setRank('RECENT');setQuery('');
     setMessage(picked.length?`AI 후보 ${picked.length}종목 확인 · 신규 ${Math.min(unique.length,Math.max(0,MAX_REGULAR-items.filter(x=>!x.protected).length))}종목 자동 등록 · 기존 후보는 중복 제외`:
       'AI가 이번 기준일의 관찰 후보를 보류했습니다.');
    }
    if(d.status==='PENDING')setMessage('다른 요청에서 분석 중입니다. 잠시 뒤 화면을 다시 열어 주세요.');
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
 async function importBackup(file:File|undefined){if(!file)return;if(file.size>900000){setError('백업 파일은 900KB 이하만 가능합니다.');return;}
  try{const obj=JSON.parse(await file.text());if(obj.version!==1||!Array.isArray(obj.items))throw Error('지원하지 않는 파일입니다.');
   if(obj.items.length>MAX_REGULAR+MAX_PROTECTED||obj.items.some((x:unknown)=>!validItem(x)))throw Error('관찰함 데이터 형식이 맞지 않습니다.');
   const all=new Map(items.map(x=>[x.id,x]));
   for(const x of obj.items as BasketItem[]){
     const original=all.get(x.id);
     // Never clear an existing long-term protection through an older backup.
     all.set(x.id,original?.protected&&!x.protected?{...x,protected:true,protected_at:original.protected_at}:x);
   }
   const merged=[...all.values()];
   if(merged.filter(x=>x.protected).length>MAX_PROTECTED||merged.filter(x=>!x.protected).length>MAX_REGULAR)
     throw Error('백업 병합 후 한도를 초과합니다. 일반 100건·장기 관찰 20건 이내로 정리한 뒤 다시 시도하세요.');
   setItems(merged);setLastRemoved([]);setError('');setMessage('백업을 가져왔습니다. 기존 장기 관찰 보호 설정은 유지했습니다.');
  }catch(e){setError(e instanceof Error?e.message:'백업 파일 오류');}
 }
 const normalCount=items.filter(x=>!x.protected).length;
 const lockedCount=items.length-normalCount;
 // Expiration is based on the verified discovery day, never the last quote timestamp.
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const ageDays=(day:string)=>Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000);
 const expired=items.filter(x=>!x.protected&&ageDays(x.day)>=cleanupDays);
 function toggleProtection(id:string){
  const target=items.find(x=>x.id===id);if(!target)return;
  if(!target.protected&&lockedCount>=MAX_PROTECTED){setError('장기 관찰은 최대 20건입니다. 다른 종목의 보호를 먼저 해제하세요.');return;}
  if(target.protected&&normalCount>=MAX_REGULAR){setError('일반 관찰함 100건이 가득 찼습니다. 보호 해제 전에 일반 종목을 정리하세요.');return;}
  setItems(old=>old.map(x=>x.id===id?{...x,protected:!target.protected,
    protected_at:target.protected?undefined:new Date().toISOString()}:x));
  setError('');setMessage(target.protected?`${target.name} 장기 관찰 보호 해제`:`${target.name} 장기 관찰 보호 · 오래된 종목 정리에서 제외`);
 }
 function cleanupOld(){
  if(!expired.length)return;
  if(!window.confirm(`발견일 기준 ${cleanupDays}일 이상 지난 일반 종목 ${expired.length}건을 삭제합니다.\n장기 관찰 ${lockedCount}건은 삭제되지 않습니다.\n삭제 전 JSON 백업을 내려받고, 이 화면에서 되돌리기도 가능합니다. 계속할까요?`))return;
  saveBackup();
  const ids=new Set(expired.map(x=>x.id));
  setLastRemoved(expired);setItems(old=>old.filter(x=>x.protected||!ids.has(x.id)));
  setMessage(`일반 관찰 ${expired.length}건 정리 완료 · 장기 관찰 ${lockedCount}건 유지 · 백업 파일 저장`);setError('');
 }
 function undoCleanup(){
  const existing=new Set(items.map(x=>x.id));
  const restore=lastRemoved.filter(x=>!existing.has(x.id));
  if(normalCount+restore.length>MAX_REGULAR){setError('일반 관찰 100건 한도 때문에 되돌릴 수 없습니다.');return;}
  setItems(old=>[...restore,...old]);setLastRemoved([]);setError('');setMessage(`${restore.length}건 되돌렸습니다.`);
 }
 const latestQuote=new Map<string,Quote>();
 for(const q of quotes?.items||[]){if(q.market==='J'&&validCode(q.code)&&q.price>0)latestQuote.set(q.code,q);}
 // R157_FILTER_SOURCE: keep source/date/name filtering independent of saved records.
 const availableDays=[...new Set(items.map(x=>x.day))].sort((a,b)=>b.localeCompare(a));
 const normalizedQuery=query.trim().toLocaleLowerCase('ko-KR');
 const scoped=items.filter(x=>(filter==='ALL'||(filter==='PROTECTED'?x.protected===true:x.source===filter))&&
   (dayFilter==='ALL'||x.day===dayFilter)&&
   (!normalizedQuery||x.code.includes(normalizedQuery)||x.name.toLocaleLowerCase('ko-KR').includes(normalizedQuery)));
 const pct=(x:BasketItem)=>{
  const verified=r1593Prices[comparisonKey(x)];
  if(verified?.latest_day&&verified.latest_day>x.day&&verified.latest_price)
    return pctChange(verified.latest_price,x.baseline);
  const pr=performance[perfId(x)];const price=pr?.quote_day&&pr.quote_day>x.day&&pr.quote_day>=(pr.recent_day||'')
   ?pr.quote_price:pr?.recent_day&&pr.recent_day>x.day?pr.recent_close:null;
  return pctChange(price,x.baseline)??baselineReturn(x,latestQuote.get(x.code));
 };
  const visible=rank==='RECENT'?scoped:
    scoped.filter(x=>{const v=pct(x);return v!==null&&(rank==='GAIN_TOP'?v>0:v<0);})
     .sort((a,b)=>{
      const left=pct(a)??0,right=pct(b)??0;
      return (rank==='GAIN_TOP'?right-left:left-right)||a.day.localeCompare(b.day)||a.code.localeCompare(b.code);
     }).slice(0,10);
  const summary=(kind:'MANUAL'|'AI')=>{
  const list=items.filter(x=>x.source===kind&&pct(x)!==null);
  const days=new Set(list.map(x=>x.day));
  return {n:list.length,avg:list.length&&days.size===1?list.reduce((s,x)=>s+(pct(x)??0),0)/list.length:null,
   comparable:days.size<=1};
 };
 const displayGroups=groupBasketRecords(visible,groupSimilar);
 const manual=summary('MANUAL'),machine=summary('AI');
 const comparable=manual.n>0&&machine.n>0&&manual.comparable&&machine.comparable&&
   new Set(items.filter(x=>pct(x)!==null).map(x=>x.day)).size===1;
  return <section className="panel blue-basket r152-basket-compact" id="blue-basket" aria-labelledby="blue-basket-h">
   <header className="r152-basket-head">
     <div><h2 id="blue-basket-h"><ShoppingBasket size={18}/> AI 스마트 장바구니 <small>R1.5.9.1</small></h2>
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
   <div className="r158-capacity" role="status"><span>일반 <strong>{normalCount}/{MAX_REGULAR}</strong></span><span>장기 관찰 <strong>{lockedCount}/{MAX_PROTECTED}</strong></span><small>장기 관찰은 일반 한도와 별도 · 자동 정리 제외</small></div>
   {ai?.status==='READY'&&<details className="r152-ai-candidates" open={showAi} onToggle={e=>setShowAi(e.currentTarget.open)}>
     <summary><span>AI 관찰 후보 <strong>{(ai.items||[]).length}종목</strong></span><small>{ai.asof} · {ai.cached?'저장된 분석':'새 분석'}</small></summary>
     <div className="basket-ai-results"><small>Gemini 검토 결과 · {ai.model}</small>
       {!(ai.items||[]).length&&<p className="basket-muted">AI가 이번 거래일의 후보를 보류했습니다.</p>}
       {(ai.items||[]).map(p=><article key={p.code}><div><b>{p.name} ({p.code})</b>
         <span>기준 종가 {cash(p.close_price)}원</span></div><p>{p.reason||'관찰 근거 추가 확인 필요'}</p>
         <small>반대 시나리오: {p.risk||'미기재'}</small><small>다음 확인: {p.watch||'미기재'}</small>
          <small className="r157-auto-picked">{items.some(x=>x.id===`AI:${p.code}:${p.day}`)?'자동 등록됨':'AI 후보 생성 버튼으로 자동 등록'}</small>
       </article>)}
     </div>
   </details>}
   {ai&&ai.status!=='READY'&&ai.status!=='NOT_CACHED'&&ai.status!=='PENDING'&&<p className="basket-muted">{ai.message||'최근 확정 일봉 데이터가 없습니다.'}</p>}
  {error&&<p className="basket-alert" role="alert"><AlertCircle size={15}/>{error}</p>}
  {message&&<p className="basket-feedback" role="status">{message}</p>}
   {performanceError&&<p className="basket-alert" role="status">시세 수집 연결: {performanceError}</p>}
   {r1593Error&&<p className="r1593-comparison-status" role="status">D1 저장 시세 비교: {r1593Error}</p>}
   {items.length>0&&<p className="r153-performance-status" role="status">
    <RefreshCw size={12}/> 장바구니 등록 직후 수집 요청 · 서버 분당 최대 3종목 처리 · 화면 확인 30초
    {performanceChecked&&<span> · 마지막 화면 확인 {new Date(performanceChecked).toLocaleTimeString('ko-KR')}</span>}
   </p>}
  <div className="basket-tabs" role="group" aria-label="장바구니 분류">{([['ALL','전체'],['MANUAL','내 선택'],['AI','AI 선택'],['PROTECTED','장기 관찰']] as const).map(([key,title])=><button
    key={key} type="button" aria-pressed={filter===key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{title}</button>)}</div>
   <div className="r157-basket-filters" aria-label="장바구니 정렬과 검색">
     <div className="r157-rank-pills" role="group" aria-label="수익률 필터">
      {([['RECENT','최신 등록'],['GAIN_TOP','상승 TOP 10'],['LOSS_TOP','하락 TOP 10']] as const).map(([key,label])=><button
       key={key} type="button" className={rank===key?'active':''} aria-pressed={rank===key} onClick={()=>setRank(key)}>{label}</button>)}
     </div>
     <div className="r157-filter-controls">
      <label>발견일 <select aria-label="발견 날짜" value={dayFilter} onChange={e=>setDayFilter(e.target.value)}>
       <option value="ALL">전체 날짜</option>{availableDays.map(day=><option key={day} value={day}>{day}</option>)}
      </select></label>
      <input type="search" aria-label="종목명 또는 종목코드 검색" value={query} onChange={e=>setQuery(e.target.value)} placeholder="종목명 · 코드 검색"/>
     </div>
     <p className="r157-filter-count">{visible.length}개 발견 기록 · {new Set(visible.map(x=>x.code)).size}종목{rank!=='RECENT'?' · 확인된 후속 수익률 기준':''} · 일반 {normalCount} · 장기 {lockedCount}건</p>
     <div className="r1595-display-controls"><span>같은 종목의 날짜별 발견가·수익률은 별도 보존</span>
       <div className="r1595-view-modes" role="group" aria-label="장바구니 동일 종목 묶음 방식">
         <button type="button" aria-pressed={groupSimilar} onClick={()=>setGroupSimilar(true)}>종목별 묶기</button>
         <button type="button" aria-pressed={!groupSimilar} onClick={()=>setGroupSimilar(false)}>개별 기록</button>
       </div>
     </div>
     <details className="r158-cleanup">
      <summary>오래된 일반 종목 정리 <span>{expired.length}건 대상</span></summary>
      <div className="r158-cleanup-controls"><label>발견일 기준
        <select aria-label="오래된 종목 기준일" value={cleanupDays} onChange={e=>setCleanupDays(Number(e.target.value))}>
         {[30,60,90,180].map(n=><option key={n} value={n}>{n}일 이상</option>)}
        </select></label>
       <button type="button" disabled={!expired.length} onClick={cleanupOld}>{expired.length}건 정리하기</button>
       {!!lastRemoved.length&&<button type="button" className="r158-undo" onClick={undoCleanup}>{lastRemoved.length}건 되돌리기</button>}
      </div>
      <small>장기 관찰은 제외됩니다. 삭제 전 JSON 백업을 저장하고 확인 후 정리합니다. 이 브라우저에서만 보호됩니다. 서버 가격 수집 기록은 정리 즉시 삭제되지 않으며, 마지막 등록 이후 최대 7일간 활성으로 남을 수 있습니다.</small>
     </details>
   </div>
   {!visible.length?<div className="basket-empty">{items.length?'선택한 조건에 해당하는 종목이 없습니다. 필터를 바꿔 주세요.':'아직 담긴 종목이 없습니다. 검색 결과에서 담거나 AI 후보 만들기를 눌러 주세요.'}</div>:
   <div className="basket-list">{displayGroups.map(group=><section key={group.key}
     className={'r1595-symbol-group'+(group.records.length>1&&groupSimilar?' is-multiple':'')}>
     {groupSimilar&&group.records.length>1&&<button type="button"
       className={'r1595-group-header'+(group.records.some(isHot)?' hot':'')}
       aria-expanded={expandedCodes.includes(group.code)}
       onClick={()=>setExpandedCodes(prev=>prev.includes(group.code)?prev.filter(c=>c!==group.code):[...prev,group.code])}>
       <span><strong>{group.name} ({group.code}) · {group.records.length}개 발견 기록</strong>
         <small>{group.records.map(it=>it.day).join(' · ')} · 펼쳐서 개별 수익률 확인</small></span>
       <ChevronDown size={17}/></button>}
     {(!groupSimilar||group.records.length===1||expandedCodes.includes(group.code))&&
       <div className="r1595-group-records">{group.records.map(it=>{const q=latestQuote.get(it.code),growth=pct(it);
     const pr=performance[perfId(it)];
     const signalChips=discoveredSignals(it.signals,pr?.signal_names);
     const quoteIsLater=!!(pr?.quote_day&&pr.quote_day>it.day&&pr.quote_day>=(pr.recent_day||''));
     const recent=quoteIsLater?pr?.quote_price:pr?.recent_day&&pr.recent_day>it.day?pr?.recent_close:null;
     const recentDay=quoteIsLater?pr?.quote_day:pr?.recent_day;
     const intradayHigh=pr?.quote_day&&pr.quote_day>it.day?pr.quote_high:null;
     const dailyHigh=pr?.highest_price||null;
     const comp=r1593Prices[comparisonKey(it)];
     const compareRecent=comp?.latest_day&&comp.latest_day>it.day&&comp.latest_price?comp.latest_price:null;
     const shownRecent=compareRecent??recent??(q&&q.trade_date_kst>it.day?q.price:null);
     const shownRecentDay=compareRecent?comp?.latest_day:recent?recentDay:q&&q.trade_date_kst>it.day?q.trade_date_kst:null;
     const shownSource=compareRecent?sourceName(comp?.latest_source):recent?'기존 KIS 수집기':'KIS 저장 시세';
     const highs=[
       ...(intradayHigh?[{price:intradayHigh,day:pr?.quote_day||'',source:'장중 관측'}]:[]),
       ...(dailyHigh?[{price:dailyHigh,day:pr?.highest_day||'',source:'KIS 일봉'}]:[]),
       ...(comp?.period_high?[{price:comp.period_high,day:comp.period_high_day||'',source:comp.high_complete?'수집 기간':'부분 관측'}]:[])
     ];
     const highest=highs.sort((a,b)=>b.price-a.price)[0];
     const maxHigh=highest?.price??null,maxHighDay=highest?.day||null;
     const pending=!pr||['QUEUED','NOT_REGISTERED','HISTORY_PARTIAL'].includes(pr.status);
     const state=pr?statusText(pr.status):'등록 확인 중';
    return <article className={"basket-record"+(isHot(it)?" r1591-basket-tomato":"")} key={it.id}>
     <div className="basket-record-head"><div><span className={`basket-src ${it.source==='AI'?'ai':''}`}>{it.source==='AI'?'AI 선택':'직접 선택'}</span>
       <strong>{it.name}</strong> <small>{it.code}</small>{it.protected&&<span className="r158-locked">장기 관찰</span>}</div>
       <div className="r158-record-actions">
        <button type="button" className={'r158-protect '+(it.protected?'active':'')} aria-pressed={it.protected===true}
          title={it.protected?'장기 관찰 보호 해제':'장기 관찰로 보호'} aria-label={`${it.name} ${it.protected?'보호 해제':'장기 관찰 등록'}`}
          onClick={()=>toggleProtection(it.id)}>{it.protected?<BookmarkCheck size={17}/>:<Bookmark size={17}/>}</button>
        <button type="button" className="basket-delete" title={it.protected?'장기 관찰 보호 해제 후 삭제 가능':'장바구니에서 제거'}
          disabled={it.protected===true} aria-label={`${it.name} 제거`}
          onClick={()=>setItems(old=>old.filter(x=>x.protected||x.id!==it.id))}><Trash2 size={16}/></button>
       </div></div>
      {isHot(it)&&<div className="r1591-basket-evidence" title={it.patternLabel10d||'실제 과거 일봉 패턴 검증'}>
       과거 10일 상승 {it.patternUp10d!.toFixed(1)}% · 표본 {it.patternN10d}건 · 탐색적 결과
      </div>}
      {isHot(it)&&it.patternLabel10d?.trim()&&<div className="r15106-basket-pattern" title={it.patternLabel10d}>
        일치 기술 패턴: {it.patternLabel10d}
      </div>}
      {isHot(it)&&typeof it.patternN10d==='number'&&it.patternN10d<8&&
        <div className="r15106-small-sample">소표본 · 신뢰도 낮음 (미래 상승 확률 아님)</div>}
      {Array.isArray(it.patternDays10d)&&it.patternDays10d.length>0&&
       <div className="r1599-pattern-dates" title={it.patternDays10d.join(' · ')}>
         과거 신호일 {it.patternDays10d.slice(-3).join(' · ')}{it.patternDays10d.length>3?' 외':''}
       </div>}
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
         <small>{maxHigh?`${pctText(pctChange(maxHigh,it.baseline))} · ${maxHighDay||''} · ${highest?.source||'저장 시세'}${comp?.high_coverage_to?' · '+comp.high_coverage_to+'까지 확인':''}`:pending?'수집 중':'기간 고가 미확인'}</small></div>
       <div><span>최근 확인가</span><b>{shownRecent?`${cash(shownRecent)}원`:'—'}</b>
         <small>{shownRecentDay?`${shownRecentDay} · ${shownSource}`:'후속 시세 미수집'} · 실시간 체결가 아님</small></div>
       <div><span>기준가 대비</span><b className={growth==null?'':growth>=0?'basket-rise':'basket-fall'}>{pctText(growth)}</b>
         <small>{maxHigh&&recent?`최고가 대비 ${pctText(pctChange(recent,maxHigh))}`:state}</small></div>
     </div>
     <StopLossRow active={active} code={it.code} day={it.day} baseline={it.baseline}
       signals={signalChips} highestObserved={maxHigh} highestDay={maxHighDay}
       selectedMethod={it.stopMethod} refreshKey={refreshKey}
       onSelectMethod={(method:StopMethod)=>setItems(old=>old.map(x=>x.id===it.id?{...x,stopMethod:method}:x))}/>
     <BasketSupplyRecordRow record={it.supplyRecord} day={it.day} baseline={it.baseline}
       note={it.supplyMemo||''} loading={supplyBusy.includes(it.id)}
       onFetch={()=>void captureSupply(it.id,it.code,it.day,it.baseline)}
       onNoteChange={value=>setItems(old=>old.map(x=>x.id===it.id?{...x,supplyMemo:value}:x))}/>
     <div className="r153-row-state" title={pr?.checked_at||''}>{state}{pr?.checked_at&&` · 최종 확인 ${new Date(pr.checked_at).toLocaleString('ko-KR')}`}</div>
     <details className="r152-record-more"><summary>메모 · 관찰 근거</summary>
       {it.source==='AI'&&<p className="basket-insight">AI 관찰 근거: {it.reason||'미기재'} · 위험: {it.risk||'미기재'}</p>}
       <label className="basket-memo">관찰 메모<input value={it.memo} maxLength={240} placeholder="추세선·거래량·다음 확인 항목" onChange={e=>setItems(old=>old.map(x=>x.id===it.id?{...x,memo:e.target.value}:x))}/></label>
     </details>
    </article>})}</div>}</section>)}</div>}
  <p className="basket-foot">장기 관찰 보호는 이 브라우저에서의 목록 정리·삭제 방지 기능입니다. 캐시 삭제·기기 변경까지 보장하지 않으므로 JSON 백업을 보관하세요. R1.5.3 검색일 다음 거래일부터의 KIS 원주가 일봉 고가를 사용합니다. 액면분할·합병에 따른 가격 보정은 하지 않아 수익률 왜곡 가능성이 있습니다. 수집 토큰 상태·장외시간에 따라 2분 안에 값이 표시되지 않을 수 있습니다. 장중 확인가는 확정 종가와 다릅니다. 연구 전용 · 등록 기준은 실제 체결가가 아닌 과거 확정 종가입니다. 성과는 후속 KRX 수집 스냅샷이 있을 때만 참고 비교하며, 최신 체결 확인·수수료·세금·배당·수정주가를 반영하지 않습니다. AI 후보는 검증된 투자 우위가 아닙니다. 장바구니는 현재 브라우저에만 저장됩니다.</p>
   <details className="r152-data-management"><summary>데이터 관리 · 기기 변경 시 백업</summary>
     <div className="basket-actions"><button type="button" onClick={saveBackup}><Download size={15}/> 백업 저장</button>
       <label className="basket-import"><Upload size={15}/> 백업 가져오기<input type="file" accept=".json,application/json" onChange={e=>{void importBackup(e.target.files?.[0]);e.target.value='';}}/></label>
     </div>
   </details>
 </section>;
}

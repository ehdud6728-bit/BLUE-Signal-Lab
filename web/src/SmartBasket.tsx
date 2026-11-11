/** BLUE R1.5.0 — local-first AI observation basket.
 * No brokerage orders, no synthetic entries or invented real-time prices.
 * Stored in this browser only until user exports/imports a backup.
 */
import {useEffect,useState} from 'react';
import {Bot,Download,Upload,Trash2,RefreshCw,AlertCircle,ShoppingBasket} from 'lucide-react';
import './smart-basket.css';

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
export default function SmartBasket({quickAddRequest,onItemsChange}: {
 quickAddRequest?:{serial:number;item:SearchRow}|null;
 onItemsChange?:(ids:string[])=>void;
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
   if(!r.ok)throw Error(d.message||d.error||`AI API 오류 ${r.status}`);
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
 const pct=(x:BasketItem)=>baselineReturn(x,latestQuote.get(x.code));
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
     <div><h2 id="blue-basket-h"><ShoppingBasket size={18}/> AI 스마트 장바구니 <small>R1.5.2</small></h2>
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
  <div className="basket-tabs" role="group" aria-label="장바구니 분류">{([['ALL','전체'],['MANUAL','내 선택'],['AI','AI 선택']] as const).map(([key,title])=><button
    key={key} type="button" aria-pressed={filter===key} className={filter===key?'active':''} onClick={()=>setFilter(key)}>{title}</button>)}</div>
  {!visible.length?<div className="basket-empty">아직 담긴 종목이 없습니다. 검색 결과에서 담기 아이콘을 누르거나 AI 후보를 생성하세요.</div>:
   <div className="basket-list">{visible.map(it=>{const q=latestQuote.get(it.code),growth=pct(it);
    return <article className="basket-record" key={it.id}>
     <div className="basket-record-head"><div><span className={`basket-src ${it.source==='AI'?'ai':''}`}>{it.source==='AI'?'AI 선택':'직접 선택'}</span>
       <strong>{it.name}</strong> <small>{it.code}</small></div>
       <button type="button" className="basket-delete" title="장바구니에서 제거" aria-label={`${it.name} 제거`}
       onClick={()=>setItems(old=>old.filter(x=>x.id!==it.id))}><Trash2 size={16}/></button></div>
     <div className="basket-record-stats"><div><span>기준일·확정종가</span><b>{it.day} · {cash(it.baseline)}원</b></div>
       <div><span>KRX 후속 참고 시세</span><b>{q&&q.trade_date_kst>it.day?`${cash(q.price)}원 · ${q.trade_date_kst}`:'—'}</b></div>
       <div><span>기준 종가 대비</span><b className={growth==null?'':growth>=0?'basket-rise':'basket-fall'}>
         {growth==null?'비교 불가':`${growth>0?'+':''}${growth.toFixed(2)}%`}</b></div></div>
     <details className="r152-record-more"><summary>메모 · 관찰 근거</summary>
       {it.source==='AI'&&<p className="basket-insight">AI 관찰 근거: {it.reason||'미기재'} · 위험: {it.risk||'미기재'}</p>}
       <label className="basket-memo">관찰 메모<input value={it.memo} maxLength={240} placeholder="추세선·거래량·다음 확인 항목" onChange={e=>setItems(old=>old.map(x=>x.id===it.id?{...x,memo:e.target.value}:x))}/></label>
     </details>
    </article>})}</div>}
  <p className="basket-foot">연구 전용 · 등록 기준은 실제 체결가가 아닌 과거 확정 종가입니다. 성과는 후속 KRX 수집 스냅샷이 있을 때만 참고 비교하며, 최신 체결 확인·수수료·세금·배당·수정주가를 반영하지 않습니다. AI 후보는 검증된 투자 우위가 아닙니다. 장바구니는 현재 브라우저에만 저장됩니다.</p>
   <details className="r152-data-management"><summary>데이터 관리 · 기기 변경 시 백업</summary>
     <div className="basket-actions"><button type="button" onClick={saveBackup}><Download size={15}/> 백업 저장</button>
       <label className="basket-import"><Upload size={15}/> 백업 가져오기<input type="file" accept=".json,application/json" onChange={e=>{void importBackup(e.target.files?.[0]);e.target.value='';}}/></label>
     </div>
   </details>
 </section>;
}

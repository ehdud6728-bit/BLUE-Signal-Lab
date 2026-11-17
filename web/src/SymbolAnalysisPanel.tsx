import {useEffect,useState} from 'react';
import StockChart from './StockChart';
import './symbol-analysis.css';

const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
type Diagnosis={code:string;name?:string;asof:string;matched:boolean;selected_signals:string;reason:string;
 quality_status?:string;large_historical_gap_review?:boolean;non_adjusted_history?:boolean;
 open?:number|null;high?:number|null;low?:number|null;close?:number|null;
 ma20?:number|null;ma40?:number|null;ma112?:number|null;ma224?:number|null;
 env20_lower_20pct?:number|null;amount_krw?:number|null;
 research_features?:{prior_45_day_high?:number|null;prior_55_day_high?:number|null;
  amount_ratio_prior20?:number|null;close_position_in_day_range?:number|null};
 signal_predicates?:Record<string,boolean>;additional_predicates?:Record<string,boolean|null>};
type Result={status:string;message?:string;diagnosis?:Diagnosis;quality_status?:string;
 chart?:{bars:unknown[]}|null;stored_at?:string;source?:string};
type SymbolMatch={code:string;name:string;market:string};
type Catalog={status:string;results?:SymbolMatch[];message?:string};
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
export default function SymbolAnalysisPanel({defaultDate}:{defaultDate:string}){
 const [term,setTerm]=useState('225190');const [code,setCode]=useState('225190');
 const [chosen,setChosen]=useState(false);const [name,setName]=useState('');
 const [matches,setMatches]=useState<SymbolMatch[]>([]);
 const [catalogMessage,setCatalogMessage]=useState('');
 const [day,setDay]=useState(defaultDate);
 const [result,setResult]=useState<Result|null>(null);const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 useEffect(()=>{setDay(defaultDate);setResult(null);},[defaultDate]);
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
    setCatalogMessage(data.status==='CATALOG_NOT_READY'?'종목명 목록 준비 중 · 종목코드로는 조회할 수 있습니다.':'');
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
  setMatches([]);setResult(null);setNotice('');setCatalogMessage('');
 };
 const valid=/^[0-9A-Z]{6}$/.test(code.toUpperCase())&&/^20\d{2}-\d{2}-\d{2}$/.test(day);
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
   const r=await fetch(API+'/api/analysis/request',{method:'POST',credentials:'include',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code.trim().toUpperCase(),asof:day})});
   const data=await r.json() as Result&{error?:string};
   if(!r.ok)throw Error(data.message||data.error||`분석 요청 실패 ${r.status}`);
   setNotice(data.status==='READY'?'이미 분석 기록이 있습니다. 조회해 주세요.':
    '분석 요청이 접수됐습니다. GitHub 분석·D1 저장 후 다시 조회해 주세요.');
  }catch(e){setNotice(e instanceof Error?e.message:'분석을 요청할 수 없습니다.');}
  finally{setBusy(false);}
 }
 const d=result?.diagnosis,quality=result?.quality_status;
 const displayName=(d?.name||name||'').trim();
 const fullName=displayName?`${displayName} (${d?.code||code})`:(d?.code||code);
 const predicates={...(d?.signal_predicates||{}),...(d?.additional_predicates||{})};
 return <section className="symbol-analysis-panel" aria-label="종목 정밀분석">
   <div className="symbol-analysis-intro"><h2>🔎 종목 정밀분석</h2><small>전체 종목명·코드 검색 · 과거 기준일 선택</small></div>
   <p className="symbol-analysis-hint">종목명 또는 코드로 찾을 수 있습니다. 먼저 저장된 분석을 조회하고, 기록이 없을 때 분석을 요청하세요.</p>
   <div className="symbol-analysis-controls">
    <div className="symbol-analysis-search"><label htmlFor="symbol-search-input">종목명 · 종목코드</label>
     <input id="symbol-search-input" type="search" autoComplete="off" value={term}
      onChange={e=>{const t=e.target.value.slice(0,60);setTerm(t);setChosen(false);setCode(/^[0-9a-zA-Z]{6}$/.test(t.trim())?t.trim().toUpperCase():'');setName('');setResult(null);setNotice('');}}
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
    <button type="button" className="outline" disabled={!valid||busy} onClick={()=>{void requestAnalysis();}}>분석 요청</button>
   </div>
   {notice&&<p role="status" className="symbol-analysis-message">{notice}</p>}
   {result&&result.status!=='READY'&&<p className="symbol-analysis-warning" role="status">{result.message||'분석 자료를 확인하지 못했습니다. 관리자에게 저장 상태를 문의해 주세요.'}</p>}
   {d&&<>
    <div className="symbol-analysis-head">
     <div><strong>{fullName} · {d.asof}</strong><span>{d.matched?'검색 신호 적중':'검색 미적중'} · {d.reason}</span></div>
     <strong>{price(d.close)}</strong>
    </div>
    {quality==='CORPORATE_ACTION_REVIEW_REQUIRED'&&<p className="symbol-analysis-warning" role="alert">주식병합·분할 등 과거 가격 단절 검토가 필요합니다. 신호와 장기 이동평균은 미확정이며 과거 성과 통계를 숨겼습니다.</p>}
    {quality!=='CORPORATE_ACTION_REVIEW_REQUIRED'&&<p className="symbol-analysis-hint">미수정 일봉 기반 탐색적 분석입니다. 실제 매매 근거로 확정되지 않았습니다.</p>}
    <div className="symbol-analysis-facts">
     <span>시가 {price(d.open)}</span><span>고가 {price(d.high)}</span><span>저가 {price(d.low)}</span>
     <span>MA20 {price(d.ma20)}</span><span>ENV20 하단 {price(d.env20_lower_20pct)}</span>
     <span>MA112 {price(d.ma112)}</span><span>MA224 {price(d.ma224)}</span>
     <span>거래대금 {typeof d.amount_krw==='number'?(d.amount_krw/1e8).toFixed(1)+'억원':'미계산'}</span>
    </div>
    <details className="symbol-analysis-conditions" open><summary>조건별 판정과 누락 이유</summary>
      <div>{Object.entries(predicates).map(([key,value])=><div key={key}><span>{labels[key]||key}</span>
       <strong className={value===true?'yes':value===false?'no':'unknown'}>{value===true?'충족':value===false?'미충족':'자료 부족'}</strong></div>)}</div>
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

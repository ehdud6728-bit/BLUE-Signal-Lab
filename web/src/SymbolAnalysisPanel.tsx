import {useEffect,useState} from 'react';
import StockChart from './StockChart';
import './symbol-analysis.css';

const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
type Diagnosis={code:string;asof:string;matched:boolean;selected_signals:string;reason:string;
 quality_status?:string;large_historical_gap_review?:boolean;non_adjusted_history?:boolean;
 open?:number|null;high?:number|null;low?:number|null;close?:number|null;
 ma20?:number|null;ma40?:number|null;ma112?:number|null;ma224?:number|null;
 env20_lower_20pct?:number|null;amount_krw?:number|null;
 research_features?:{prior_45_day_high?:number|null;prior_55_day_high?:number|null;
  amount_ratio_prior20?:number|null;close_position_in_day_range?:number|null};
 signal_predicates?:Record<string,boolean>;additional_predicates?:Record<string,boolean|null>};
type Result={status:string;message?:string;diagnosis?:Diagnosis;quality_status?:string;
 chart?:{bars:unknown[]}|null;stored_at?:string;source?:string};
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
 const [code,setCode]=useState('225190');const [day,setDay]=useState(defaultDate);
 const [result,setResult]=useState<Result|null>(null);const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState('');
 useEffect(()=>{setDay(defaultDate);setResult(null);},[defaultDate]);
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
 const predicates={...(d?.signal_predicates||{}),...(d?.additional_predicates||{})};
 return <section className="symbol-analysis-panel" aria-label="종목 정밀분석">
  <details>
   <summary><span>🔎 종목 정밀분석</span><small>검색 미적중 종목도 분석 · 기준일 직접 선택</small></summary>
   <p className="symbol-analysis-hint">검색 결과에 없는 종목도 코드와 과거 날짜로 분석할 수 있습니다. 먼저 저장 기록을 확인하고, 없으면 분석을 요청하세요.</p>
   <div className="symbol-analysis-controls">
    <label>종목코드<input inputMode="text" maxLength={6} value={code} onChange={e=>{setCode(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g,''));setResult(null);}} placeholder="225190"/></label>
    <label>분석 기준일<input type="date" value={day} onChange={e=>{setDay(e.target.value);setResult(null);}}/></label>
    <button type="button" disabled={!valid||busy} onClick={()=>{void lookup();}}>{busy?'확인 중…':'분석 조회'}</button>
    <button type="button" className="outline" disabled={!valid||busy} onClick={()=>{void requestAnalysis();}}>분석 요청</button>
   </div>
   {notice&&<p role="status" className="symbol-analysis-message">{notice}</p>}
   {result&&result.status!=='READY'&&<p className="symbol-analysis-warning" role="status">{result.message||'분석 자료를 확인하지 못했습니다. 관리자에게 저장 상태를 문의해 주세요.'}</p>}
   {d&&<>
    <div className="symbol-analysis-head">
     <div><strong>{d.code} · {d.asof}</strong><span>{d.matched?'검색 신호 적중':'검색 미적중'} · {d.reason}</span></div>
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
    {result?.chart&&<StockChart key={d.code+':'+d.asof} analysisMode code={d.code} day={d.asof} name={d.code}/>} 
    {!result?.chart&&<p className="symbol-analysis-warning">기준일 일봉이 없어 차트는 생성되지 않았습니다. 다른 날짜의 가격으로 대신하지 않습니다.</p>}
    <p className="symbol-analysis-hint">자료 원천: {result?.source||'미확인'} · 저장 {result?.stored_at||'시간 미확인'} · 기준일 이후 가격은 신호 판정에 사용하지 않습니다.</p>
   </>}
  </details>
 </section>;
}

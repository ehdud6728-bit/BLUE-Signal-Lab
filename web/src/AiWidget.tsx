import {useEffect,useState} from 'react';
import {Bot,ClipboardCopy,ExternalLink,FileCheck2,LoaderCircle,AlertCircle,Newspaper,RefreshCw} from 'lucide-react';
import './ai.css';

const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
type Source={title:string;url:string};
type Report={status:'READY'|'PENDING'|'NOT_CACHED'|'FAILED';report?:string;sources?:Source[];generated_at?:string;cached?:boolean;message?:string;error?:string};
export type AiStock={code:string;name:string|null;day:string;signals:string[];close_price:number|null;supply_distance_pct:number|null;extras:Record<string,unknown>};
type Props={kind:'market'|'stock';date:string;stock?:AiStock|null;observed?:number|null;matched?:number|null;events?:number|null;searchMatched?:AiStock[]};
const smallFields=[
  'rsi','rsi_signal','rsi_gc','rsi_last_gc','slow_14_3_3_k','slow_14_3_3_d','slow_14_3_3_gc',
  'slow_12_5_5_k','slow_12_5_5_d','slow_12_5_5_gc','slow_20_12_12_k','slow_20_12_12_d',
  'slow_20_12_12_gc','macd_12_26_9','macd_signal_9','macd_gc','macd_last_gc',
  'supply_strength_grade','supply_strength_relative_pct','supply_reference_price','valid_line_candidates_json'
];
function manualPrompt({kind,date,stock,observed,matched,events,searchMatched}:Props):string{
  const pre=`BLUE Signal Lab 분석 자료 (${date} 일봉 종가 기준)\n이 데이터는 실시간 시세가 아니며, 투자 권유가 아닌 연구용입니다.\n기준일 이후 정보를 과거 시황에 섞지 마세요. 뉴스나 공시는 출처·날짜를 확인해 주세요.\n검증된 유효선이 아닌 돌파선 후보, 실제 체결가 매물대가 아닌 일봉 매물대 추정치입니다.\n\n`;
  if(kind==='market'){
    const list=(searchMatched||[]).slice(0,100).map(x=>`${x.name||'종목명 없음'}(${x.code}):${x.signals.join(',')}`).join('\n');
    return pre+`[BLUE 검색 현황]\n관측 종목: ${observed??'미조회'}\n신호 종목: ${matched??'미조회'}\n신호 발생: ${events??'미조회'}\n[현재 검색 페이지 일부 종목, 전체 신호 종목 수와 다를 수 있음]\n${list||'검색 결과 없음'}\n이 수치는 코스피·코스닥 지수/수급/상승 종목 수가 아닙니다. 실제 지수, 외국인·기관 수급, 주요 업종 및 경제 뉴스를 검증해 시황을 설명해 주세요.`;
  }
  const selected:Record<string,unknown>={};
  for(const k of smallFields){const v=stock?.extras?.[k];if(v!==undefined&&v!==null&&v!=='')selected[k]=v;}
  return pre+`[종목: ${stock?.name||'종목명 미등록'} (${stock?.code})]\n종가: ${stock?.close_price??'미계산'}원\nBLUE 신호: ${(stock?.signals||[]).join(', ')}\n상단 매물대 거리 추정: ${stock?.supply_distance_pct??'미계산'}%\n추가 지표: ${JSON.stringify(selected)}\n\n위 계산값의 의미, 동시 발생 신호, 관련 당일 이전 공시·뉴스, 위험과 추가 확인 사항을 구분해 설명해 주세요.`;
}
async function copyPrompt(s:string):Promise<boolean>{
  try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(s);return true;}}catch{/* attempt fallback */}
  const node=document.createElement('textarea');node.value=s;node.style.position='fixed';node.style.opacity='0';
  document.body.appendChild(node);node.focus();node.select();
  const ok=document.execCommand('copy');document.body.removeChild(node);return ok;
}
export default function AiWidget(props:Props){
  const {kind,date,stock}=props;
  const [report,setReport]=useState<Report|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [manualNotice,setManualNotice]=useState('');
  const valid=kind==='market'||Boolean(stock?.code);
  const endpoint=new URL(API+'/api/ai/report');endpoint.searchParams.set('kind',kind);endpoint.searchParams.set('date',date);
  if(kind==='stock'&&stock)endpoint.searchParams.set('code',stock.code);
  const cacheUrl=endpoint.toString();
  useEffect(()=>{
    let active=true;
    const load=async()=>{
      try{const r=await fetch(cacheUrl,{credentials:'include',cache:'no-store'});if(!r.ok)return;
        const d=await r.json() as Report;
        if(active&&d.status==='READY')setReport(d);
      }catch{/* cached report is optional */}
    };
    if(valid)void load();
    return()=>{active=false;};
  },[cacheUrl,valid]);
  useEffect(()=>{
    if(report?.status!=='PENDING')return;
    let active=true;let count=0;
    const timer=window.setInterval(async()=>{
      if(count++>40){window.clearInterval(timer);if(active)setError('분석 상태 확인 시간이 지났습니다. 나중에 다시 확인해 주세요.');return;}
      try{const r=await fetch(cacheUrl,{credentials:'include',cache:'no-store'});
        if(!r.ok)return;const d=await r.json() as Report;
        if(active&&d.status==='READY'){setReport(d);setError('');window.clearInterval(timer);}
      }catch{/* transient connection issue */}
    },6000);
    return()=>{active=false;window.clearInterval(timer);};
  },[report?.status,cacheUrl]);
  async function generate(){
    if(!valid||busy)return;
    setBusy(true);setError('');
    try{
      const r=await fetch(API+(kind==='market'?'/api/ai/market':'/api/ai/stock'),{
        method:'POST',credentials:'include',headers:{'Content-Type':'text/plain;charset=UTF-8'},
        body:JSON.stringify({date,...(kind==='stock'?{code:stock?.code}:{})})
      });
      let d:Report;try{d=await r.json() as Report;}catch{throw new Error(`AI 응답을 읽지 못했습니다 (${r.status})`);}
      if(!r.ok)throw new Error(d.message||d.error||`AI API 오류 (${r.status})`);
      setReport(d);
    }catch(e){setError(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);}
  }
  function openExternal(to:'gemini'|'chatgpt'){
    // Both actions originate from one user gesture. The destination cannot receive pasted content automatically.
    const message=manualPrompt(props);
    const cp=copyPrompt(message);
    const target=to==='gemini'?'https://gemini.google.com/app':'https://chatgpt.com/';
    window.open(target,'_blank','noopener,noreferrer');
    void cp.then(ok=>setManualNotice(ok?'질문 자료를 복사했습니다. 열린 AI 대화창에 붙여넣어 주세요.':
      '복사를 허용하지 않은 브라우저입니다. 주소를 다시 열거나 복사 권한을 허용해 주세요.'));
  }
  return <section className={'ai-panel '+(kind==='stock'?'ai-stock':'ai-market')}>
    <div className="ai-heading"><div className="ai-title"><Bot size={19}/><div><strong>{kind==='market'?'BLUE AI · 시황 브리핑':'BLUE AI · 종목 분석'}</strong><small>{date} 종가 기준 · Gemini 무료 API (설정 필요)</small></div></div><span className="ai-mode">RESEARCH</span></div>
    <p className="ai-description">{kind==='market'?'검색기 통계와 출처가 확인된 뉴스를 연결해 시장 상황을 설명합니다.':'현재 저장된 기술지표, BLUE 신호, 매물대 추정값과 확인된 관련 뉴스를 함께 살펴봅니다.'}</p>
    <button className="ai-primary" type="button" disabled={busy||!valid||report?.status==='PENDING'} onClick={()=>{void generate();}}>
      {busy?<LoaderCircle size={16} className="ai-spin"/>:<Newspaper size={16}/>}{busy?'Gemini 분석 중…':report?.status==='READY'?'저장된 분석 확인':kind==='market'?'Gemini 시황 분석':'Gemini 종목 분석'}
    </button>
    {report?.status==='PENDING'&&<div className="ai-note"><RefreshCw size={16}/> 다른 기기에서 분석 중입니다. 완료되면 결과가 표시됩니다.</div>}
    {error&&<div className="ai-error" role="alert"><AlertCircle size={16}/>{error}</div>}
    {report?.status==='READY'&&<div className="ai-report">
      <div className="ai-report-header"><FileCheck2 size={16}/><b>{report.cached?'D1 저장된 분석':'새로 생성한 분석'}</b><span>{report.generated_at?new Date(report.generated_at).toLocaleString('ko-KR'):''}</span></div>
      <div className="ai-report-body">{report.report}</div>
      {(report.sources||[]).length>0?<div className="ai-sources"><strong>AI가 검색한 참고 출처 (원문·날짜 재확인)</strong>
        {(report.sources||[]).map((s,i)=><a key={i} href={s.url} rel="noopener noreferrer" target="_blank">{s.title} <ExternalLink size={12}/></a>)}
      </div>:<p className="ai-warning">Google 검색 참고 출처가 확인되지 않았습니다. 뉴스·시황 관련 사실은 독립적으로 검증해 주세요.</p>}
    </div>}
    <div className="ai-alternatives"><span>직접 질문하기 (자료 복사 후 새 탭에서 붙여넣기)</span>
      <div><button type="button" onClick={()=>openExternal('gemini')}><ClipboardCopy size={15}/> Gemini에 질문 <ExternalLink size={12}/></button>
        <button type="button" onClick={()=>openExternal('chatgpt')}><ClipboardCopy size={15}/> ChatGPT에 질문 <ExternalLink size={12}/></button></div>
      {manualNotice&&<p className="ai-note" role="status">{manualNotice}</p>}
    </div>
    <p className="ai-foot">AI 분석은 현재가가 아니며, 원본 뉴스의 내용·공시일·가격 데이터의 시점을 반드시 확인하세요. 무료 API 사용량 및 데이터 처리 조건이 적용됩니다.</p>
  </section>;
}

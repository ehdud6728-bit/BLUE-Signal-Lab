import {useEffect,useRef,useState} from 'react';
type Ref={id:string;label:string;detail:string};
type Part={text:string;refs:string[]};
type Scenario={condition:string;response:string;invalidation:string;refs:string[]};
type Report={summary:Part;risks:Part;rotation:Part;watch:Part;scenarios:{rise:Scenario;range:Scenario;fall:Scenario}};
type Snapshot={status?:string;error?:string;model?:string;cached?:boolean;generated_at?:string;dates?:Record<string,string|null>;refs?:Ref[];limitations?:string[];report?:Report;daily_limit?:number;gemini_key_configured?:boolean};
const messages:Record<string,string>={ACCESS_REQUIRED:'Cloudflare Access 로그인 필요',ORIGIN_DENIED:'허용된 웹앱 주소에서 실행해 주세요.',GEMINI_KEY_MISSING:'Gemini API 키가 Worker에 등록되지 않았습니다.',GEMINI_AUTH:'Gemini API 권한을 확인해 주세요.',MODEL_NOT_AVAILABLE:'등록된 Gemini 모델의 사용 가능 여부를 확인해 주세요.',GEMINI_BAD_REQUEST:'Gemini 요청 형식 또는 모델 설정을 확인해 주세요.',QUOTA:'Gemini 제공사 호출 한도에 도달했습니다.',DAILY_LIMIT:'오늘 종합 시황 AI 호출 한도에 도달했습니다.',AI_REPORT_INVALID:'AI 답변 형식이나 근거 ID 검증 실패. 미검증 답변은 표시하지 않습니다.',AI_STORAGE_UNAVAILABLE:'Turso AI 저장소 조회 또는 쓰기 실패.',MARKET_EVIDENCE_MISSING:'검증된 시장 자료가 없어 분석할 수 없습니다.',REQUEST_FAILED:'AI 요청 실패. 잠시 뒤 다시 시도해 주세요.',GEMINI_UNAVAILABLE:'Gemini 응답 실패'};
const fmt=(s:string)=>{try{return new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(s));}catch{return s;}};
function Evidence({ids,refs}:{ids:string[];refs:Ref[]}){
 return <details><summary>판단 근거 {ids.length}개</summary>{ids.map(id=>{const v=refs.find(r=>r.id===id);return v?<p key={id}><strong>{id} · {v.label}</strong><br/><small>{v.detail}</small></p>:null;})}</details>;
}
export default function MarketAiBriefing({api,revision=0}:{api:string;revision?:number}){
 const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const current=useRef<AbortController|null>(null);
 async function load(method:'GET'|'POST'){
  current.current?.abort();const ctrl=new AbortController();current.current=ctrl;setBusy(true);setError('');
  try{
   const res=await fetch(api+'/api/research/market-ai',{method,credentials:'include',cache:'no-store',signal:ctrl.signal});
   const value:Snapshot=await res.json();
   if(ctrl.signal.aborted)return;
   setData(value);
   if(!res.ok)setError(messages[value.error||'']||'시장 AI 조회 또는 생성에 실패했습니다.');
  }catch{if(!ctrl.signal.aborted){setData(null);setError('AI 서버 연결에 실패했습니다. 로그인 및 네트워크를 확인해 주세요.');}}
  finally{if(!ctrl.signal.aborted)setBusy(false);}
 }
 useEffect(()=>{void load('GET');return()=>current.current?.abort();},[api,revision]);
 const refs=data?.refs||[],report=data?.report,dates=data?.dates;
 const replaceIds=(v:string)=>v.replace(/\b(?:[MFTS]_(?:KOSPI|KOSDAQ)(?:_\d+)?|G_(?:DJI|NDX|SPX|SOX|VIX)|C_(?:KOSPI|KOSDAQ)(?:_\d+(?:_[LF]\d+)?)?)\b/g,id=>refs.find(r=>r.id===id)?.label??id);
 const part=(label:string,p:Part)=><div className="blue-research-card"><strong>{label}</strong><p style={{whiteSpace:'pre-wrap'}}>{replaceIds(p.text)}</p><Evidence ids={p.refs} refs={refs}/></div>;
 return <section className="blue-research-card">
 <div className="blue-pattern-heading"><strong>BLUE AI 종합 시황 · 대응 전망</strong><button type="button" disabled={busy} onClick={()=>void load('GET')}>저장 분석 확인</button></div>
 <small>Gemini 생성형 분석 · Turso 자료 기반 · 하루 최대 {data?.daily_limit??5}회 신규 분석 · 같은 근거는 재사용</small>
 <p>시장 방향, 외국인·기관 수급, VIX 및 해외 일봉, 개선 업종과 대장주·후발주 후보를 연결해 설명합니다. 종목명과 코드는 외부 AI에 보내지 않고 화면에서만 연결합니다.</p>
 {dates&&<details><summary>자료별 기준일</summary><p>국내 시황 수집 {dates.market_observed_at?fmt(dates.market_observed_at):'미확인'} · 실제 시세일 미확인</p><p>국내 업종 지수 수집 {dates.trend_observed_at?fmt(dates.trend_observed_at):'미확인'} · 해외 지수 수집 {dates.global_observed_at?fmt(dates.global_observed_at):'미확인'}</p><p>후보 일봉 기준 {dates.candidate_day??'미확인'} · 마스터 수집 {dates.master_receipt_day??'미확인'}</p></details>}
 <button type="button" disabled={busy||data?.status==='READY'||data?.status==='PENDING'||data?.gemini_key_configured===false} onClick={()=>void load('POST')}>{busy?'처리 중…':data?.status==='READY'?'동일 근거 분석 저장됨':data?.status==='PENDING'?'분석 진행 중':'AI 종합 분석 생성'}</button>
 {data?.status==='PENDING'&&!busy&&<p>다른 요청이 분석 중입니다. 저장 분석 확인 버튼으로 결과를 조회해 주세요.</p>}
 {data?.gemini_key_configured===false&&!report&&<p>Gemini API 키 설정이 필요합니다.</p>}
 {error&&<p role="alert">{error}</p>}
 {report&&data?.status==='READY'&&<>
 <small>{data.cached?'저장된 분석':'신규 생성'} · {data.generated_at?fmt(data.generated_at):''} · {data.model}</small>
 {part('시장 종합 판단',report.summary)}
 {part('시장 위험 및 반대 증거',report.risks)}
 {part('순환매 · 대장주·후발주 해석',report.rotation)}
 <strong>향후 조건별 시나리오</strong>
 {([['rise','반등·상승'],['range','횡보·바닥 확인'],['fall','재하락']] as const).map(([key,label])=>{const s=report.scenarios[key];return <div className="blue-research-card" key={key}><strong>{label}</strong><p>확인 조건: {replaceIds(s.condition)}</p><p>대응 관점: {replaceIds(s.response)}</p><p>무효화 조건: {replaceIds(s.invalidation)}</p><Evidence ids={s.refs} refs={refs}/></div>;})}
 {part('다음 관찰 포인트',report.watch)}
 </>}
 {data?.limitations&&<details><summary>분석 한계 · 데이터 출처</summary>{data.limitations.map((v,i)=><p key={i}>{v}</p>)}</details>}
 <p className="blue-note">AI 설명은 검증된 원자료 그 자체가 아니며 해석 오류가 있을 수 있습니다. 미래 수익률·상승 확률 또는 자동 매매 신호가 아닙니다. VIX 선물 및 뉴스·경제 일정은 미연동입니다.</p>
 </section>;
}

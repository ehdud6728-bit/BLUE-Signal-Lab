import {useEffect,useRef,useState} from 'react';
type Ref={id:string;label:string;detail:string};
type Part={text:string;refs:string[]};
type Scenario={condition:string;response:string;invalidation:string;refs:string[]};
type Report={summary:Part;risks:Part;rotation:Part;watch:Part;scenarios:{rise:Scenario;range:Scenario;fall:Scenario}};
type MacroEvent={id:string;name:string;kind:string;reference_period:string;scheduled_et:string;scheduled_utc:string;source_url:string;meeting_et?:string;status:string};
type Macro={status:string;reviewed_day:string;review_required_after:string;update_mode:string;events:MacroEvent[];vix_futures:{status:string;source_url:string;terms_url:string}};
type Snapshot={quality?:{domestic_quote_day:string;domestic_receipt:string;breadth:string;flow_3_observations:string;us_core:string;us_core_day:string|null;domestic_trends:string;trend_day:string|null;candidates:string;decision_basis:string};macro?:Macro;status?:string;error?:string;model?:string;cached?:boolean;generated_at?:string;dates?:Record<string,string|null>;refs?:Ref[];limitations?:string[];report?:Report;daily_limit?:number;gemini_key_configured?:boolean};
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
 const refs=data?.refs||[],report=data?.report,dates=data?.dates,macro=data?.macro;
 const replaceIds=(v:string)=>v.replace(/\b(?:[MFTS]_(?:KOSPI|KOSDAQ)(?:_\d+)?|G_(?:DJI|NDX|SPX|SOX|VIX)|E_[A-Z_]+|C_(?:KOSPI|KOSDAQ)(?:_\d+(?:_[LF]\d+)?)?)\b/g,id=>refs.find(r=>r.id===id)?.label??id);
 const part=(label:string,p:Part)=><div className="blue-research-card"><strong>{label}</strong><p style={{whiteSpace:'pre-wrap'}}>{replaceIds(p.text)}</p><Evidence ids={p.refs} refs={refs}/></div>;
 return <section className="blue-research-card">
 <div className="blue-pattern-heading"><strong>BLUE AI 종합 시황 · 대응 전망</strong><button type="button" disabled={busy} onClick={()=>void load('GET')}>저장 분석 확인</button></div>
 <small>Gemini 생성형 분석 · Turso 자료 기반 · 하루 최대 {data?.daily_limit??5}회 신규 분석 · 같은 근거는 재사용</small>
 <p>시장 방향, 외국인·기관 수급, VIX 및 해외 일봉, 개선 업종과 대장주·후발주 후보를 연결해 설명합니다. 생성 버튼을 누르면 가공된 시장·기술신호 요약을 Gemini에 전송합니다. 종목명과 코드는 보내지 않고 화면에서만 연결합니다.</p>
 {data?.quality&&<div className="blue-research-card">
 <strong>판단 근거 상태 · 조건부 전망</strong>
 <p className="blue-note">국내 실제 거래일 미확인 · 오늘 실시간 시황으로 단정하지 않습니다.</p>
 <p>시장 폭: {data.quality.breadth==='BOTH_MARKETS'?'양 시장 수치 확보':'일부 누락 또는 미확인'}<br/>
 수급: {data.quality.flow_3_observations==='BOTH_MARKETS'?'양 시장 외국인·기관 최근 3관측일 방향 확보':'최근 3관측일 방향 일부 누락'}<br/>
 해외 핵심 지수: {data.quality.us_core==='SAME_DATED_OBSERVATIONS'?'동일 기준일 '+data.quality.us_core_day:'기준일 불일치 또는 누락'}<br/>
 업종 추세: {data.quality.domestic_trends==='SAME_DATED_OBSERVATIONS'?'동일 기준일 '+data.quality.trend_day:'기준일 불일치 또는 누락'}<br/>
 후보 자료: {data.quality.candidates==='ALIGNED'?'현재 추세 세대와 일치':'누락 또는 이전 세대'}</p>
 <small>자료 확보 여부는 상승 확률 또는 투자 신뢰도 점수가 아닙니다.</small>
 </div>}
 {macro&&<div className="blue-research-card">
 <strong>주요 경제 일정 · 한국시간</strong>
 <p><small>공식 일정 확인일 {macro.reviewed_day} · 자동 갱신 아님 · 발표 예정이며 변경될 수 있습니다.</small></p>
 {macro.status==='REVIEW_REQUIRED'&&<p className="blue-note">일정 재검토 필요 · 아래는 마지막 확인 일정이며 AI 분석에서는 제외합니다.</p>}
 {macro.events.length===0?<p>확인된 향후 일정 없음 · 공식 달력 재확인 필요</p>:macro.events.map(e=><div key={e.id} className="blue-research-card">
 <strong>{e.name}</strong><p>{fmt(e.scheduled_utc)} KST · 발표 예정</p>
 <small>미국 동부 {e.scheduled_et.slice(0,16).replace('T',' ')}{e.meeting_et?' · 회의 '+e.meeting_et:''} · 대상 {e.reference_period}</small>
 <p><a href={e.source_url} target="_blank" rel="noopener noreferrer">공식 일정 확인</a></p>
 </div>)}
 <small>다음 재검토 기준 {macro.review_required_after} · 실제 발표 내용과 시장 예상치는 미연동입니다.</small>
 </div>}
 {macro&&<div className="blue-research-card"><strong>VIX 선물 구조 · 사용권 확인 필요</strong>
 <p>현물 VIX와 별개입니다. 월물 근월 F1·차월 F2의 동일일 정산가격이 확인된 경우 F2 − F1을 비교합니다. 양수는 콘탱고, 음수는 백워데이션이며 그 자체로 시장 반등을 보장하지 않습니다.</p>
 <p>현재: F1/F2 미확인 · 방향 판정 보류</p>
 <a href={macro.vix_futures.source_url} target="_blank" rel="noopener noreferrer">Cboe 공식 일별 정산가격</a> · <a href={macro.vix_futures.terms_url} target="_blank" rel="noopener noreferrer">이용 조건</a>
 </div>}
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
 <p className="blue-note">AI 설명은 검증된 원자료 그 자체가 아니며 해석 오류가 있을 수 있습니다. 미래 수익률·상승 확률 또는 자동 매매 신호가 아닙니다. VIX 선물·뉴스·경제 발표 결과는 미연동입니다.</p>
 </section>;
}

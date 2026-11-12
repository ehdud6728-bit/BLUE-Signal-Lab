import {useEffect,useMemo,useState} from 'react';
import {Activity,Clock3,RefreshCw,AlertTriangle} from 'lucide-react';
import './live-market.css';

type Quote={
 code:string;name:string;market:string;market_label:string;phase:string;
 received_at_utc:string;trade_date_kst:string;price:number;open:number;
 high:number;low:number;accumulated_volume:number;
 change_from_eod_pct:number|null;change_from_prev_close_pct?:number|null;day_range_position_pct:number|null;
 eod_asof:string|null;eod_close:number|null;eod_signals:string;
 reported_trade_day_matches_today?:boolean|null;
 exchange_tick_time_verified:boolean;
 tracking_started_at_utc?:string|null;tracking_start_source?:string|null;
};
type Payload={status:string;items:Quote[];trade_date_kst?:string;
 latest_received_at_utc?:string|null;age_minutes?:number|null;note?:string;schema?:string};
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
const money=(x:number|null|undefined)=>typeof x==='number'&&Number.isFinite(x)?x.toLocaleString('ko-KR'):'—';
const timeKST=(s:string|null|undefined)=>{if(!s)return '—';const d=new Date(s);
 return Number.isNaN(d.valueOf())?'—':new Intl.DateTimeFormat('ko-KR',{
 timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);};
// R154_CLARITY: provenance-based reason, never an AI recommendation or ranking.
const signalLabels=(raw:string|null|undefined)=>[...new Set((raw||'').split(',')
 .map(s=>s.trim()).filter(s=>/^[A-Za-z0-9_\-]{2,48}$/.test(s))
 .map(s=>s.replace(/^(?:BLUE|BB)(?=\d)/i,'B')))];
const firstDate=(stamp:string|null|undefined)=>{
 if(!stamp)return '기록 없음';
 const d=new Date(stamp);if(!Number.isFinite(d.valueOf()))return '기록 없음';
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
};
// R157_MOBILE_PRICE: label the source of each change; old snapshots only have signal-day change.
const performance=(q:Quote)=>typeof q.change_from_prev_close_pct==='number'&&Number.isFinite(q.change_from_prev_close_pct)
 ?{value:q.change_from_prev_close_pct,label:'전일 종가 대비'}
 :{value:q.change_from_eod_pct,label:'신호일 종가 대비'};
const percent=(n:number|null)=>n===null?'—':`${n>0?'+':''}${n.toFixed(2)}%`;
const trend=(n:number|null)=>n===null?'':n>0?'blue-live-up':n<0?'blue-live-down':'';
const phaseName:Record<string,string>={NXT_PRE:'프리마켓',NXT_MAIN:'메인마켓',
 NXT_AFTER:'애프터마켓',KRX_REGULAR:'정규장',KRX_AFTER:'애프터마켓',
 LEGACY_R14_UNVERIFIED:'이전 수집',UNKNOWN_PHASE:'시장 구간 미확인'};

// R152_TRACKING_ACTIVE: suspended polling while the tracking tab is inactive.
export default function LiveMarket({active=true,refreshKey=0}: {active?:boolean;refreshKey?:number}){
 const [payload,setPayload]=useState<Payload|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [checked,setChecked]=useState('');
 const [filter,setFilter]=useState<'ALL'|'J'|'NX'>('ALL');
 useEffect(()=>{
   const controller=new AbortController();let inFlight=false;
   const poll=async()=>{
     if(!active||inFlight||document.visibilityState==='hidden')return;
     inFlight=true;setBusy(true);
     try{
       const r=await fetch(API+'/api/live/quotes',{credentials:'include',cache:'no-store',signal:controller.signal});
       if(!r.ok)throw new Error(r.status===401?'Cloudflare Access 로그인이 필요합니다.':`API 오류 ${r.status}`);
       const data=await r.json() as Payload;
       if(!controller.signal.aborted){setPayload(data);setChecked(new Date().toISOString());setError('');}
     }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'API 연결 실패');}
     finally{inFlight=false;if(!controller.signal.aborted)setBusy(false);}
   };
   void poll();const timer=window.setInterval(()=>{void poll();},30000);
   const visible=()=>{if(document.visibilityState==='visible')void poll();};
   document.addEventListener('visibilitychange',visible);
   return()=>{controller.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[active,refreshKey]);
 const items=useMemo(()=>((payload?.items||[]).filter(q=>filter==='ALL'||q.market===filter)),[payload,filter]);
 const status=payload?.status||'CONNECTING';
 const fresh=!error&&status==='RECENT_SNAPSHOT';
 return <section className="panel blue-live" aria-labelledby="blue-live-heading">
  <div className="blue-live-head">
    <div><h2 id="blue-live-heading"><Activity size={19}/> KIS KRX·NXT 종목 추적 <small>R1.5.7 UI</small></h2>
    <p>08:00~20:00 KST · 거래소별 운영 구간에 5분 간격 수집 시도 · 휴장·지연 가능</p></div>
    <span className={'blue-live-indicator '+(fresh?'blue-live-fresh':'')}>
      {error?'연결 오류':fresh?'최근 수집':status==='CONNECTING'?'연결 중':
       status==='WAITING_FOR_QUOTES'||status==='NOT_CONFIGURED'?'수집 대기':
       '장외·과거·지연 데이터'}</span>
  </div>
  <p className="r154-auto-selection-note">자동 추적 후보는 최근 검증된 검색 결과에서 종목코드 순으로 최대 12개 선정됩니다. 수익률 또는 AI 추천 순위가 아닙니다.</p>
  <div className="blue-live-summary">
   <span><Clock3 size={14}/> 마지막 KIS 응답 <strong>{timeKST(payload?.latest_received_at_utc)}</strong></span>
   <span>조회 <strong>{items.length}시장별 시세</strong></span>
   <span><RefreshCw size={14}/> 화면 확인 30초 · {timeKST(checked)}{busy?' · 조회 중':''}</span>
  </div>
  <div style={{display:'flex',gap:7,margin:'10px 0 13px'}} role="group" aria-label="거래시장 필터">
   {([['ALL','전체'],['J','KRX'],['NX','NXT']] as const).map(([key,label])=><button
    type="button" key={key} onClick={()=>setFilter(key)} aria-pressed={filter===key}
    style={{border:'1px solid #c6d5ec',background:filter===key?'#285fdd':'#fff',
      color:filter===key?'white':'#365276',borderRadius:9,padding:'8px 13px',fontWeight:700}}>{label}</button>)}
  </div>
  {error&&<p className="blue-live-note blue-live-warning"><AlertTriangle size={15}/>{error}</p>}
  {!items.length&&<p className="blue-live-note">{status==='NOT_CONFIGURED'? 'R1.4.1 시세 저장소 준비 전입니다.':
   '선택한 시장에서 저장된 시세가 없습니다. 대상 종목이 거래되지 않거나 수집이 아직 시작되지 않았을 수 있습니다.'}</p>}
  {!!items.length&&<div className="blue-live-tablewrap"><table className="blue-live-table">
   <thead><tr><th>종목·시장</th><th>마지막 조회가</th><th>가격 변화</th><th>누적 거래량</th><th>조회 시각</th></tr></thead>
   <tbody>{items.map(q=><tr key={q.market+'-'+q.code}>
    <td><strong>{q.name||q.code}</strong><small>{q.code} · {q.market_label} {phaseName[q.phase]||q.phase}</small>
      <small className="r154-track-dates">추적 최초 확인 {firstDate(q.tracking_started_at_utc)}{q.tracking_start_source==='RETAINED_HISTORY'?' (보관 기록 기준)':''}</small>
      <small className="r154-track-dates">신호 기준일 {q.eod_asof||'미확인'} · 거래일 {q.reported_trade_day_matches_today===true?'일치':q.reported_trade_day_matches_today===false?'불일치':'미확인'}</small>
      <small className="r154-track-perspective">관찰 근거: {signalLabels(q.eod_signals).length?
        `${signalLabels(q.eod_signals).slice(0,4).join(' · ')} 기술 신호 발생`:'이전 검색 기록 기반 · 개별 신호 확인 불가'}</small>
      <small className="r154-track-perspective">관찰 관점: 신호 이후 가격·변동 및 추세 유지 확인</small></td>
    <td className="blue-live-number">{money(q.price)}</td>
    <td className={'blue-live-number '+trend(performance(q).value)}>
      {percent(performance(q).value)}<small>{performance(q).label}</small></td>
    <td className="blue-live-number">{money(q.accumulated_volume)}</td>
    <td className="blue-live-number">{timeKST(q.received_at_utc)}</td>
   </tr>)}</tbody>
  </table></div>}
  {!!items.length&&<div className="r157-live-cards" aria-label="종목 추적 모바일 카드">
   {items.map(q=><article className="r157-track-card" key={q.market+'-'+q.code}>
    <div className="r157-track-main">
     <div className="r157-track-identity"><strong>{q.name||q.code}</strong>
      <small>{q.code} · {q.market_label} {phaseName[q.phase]||q.phase}</small></div>
     <div className="r157-track-price"><strong>{money(q.price)}원</strong>
      <b className={trend(performance(q).value)}>{percent(performance(q).value)}</b>
      <small>{performance(q).label}</small></div>
    </div>
    <div className="r157-track-meta">신호일 {q.eod_asof||'미확인'} · 추적 최초 확인 {firstDate(q.tracking_started_at_utc)}
      {q.tracking_start_source==='RETAINED_HISTORY'?' (보관 기록 기준)':''}</div>
    <details className="r157-track-details"><summary>신호·추적 관점 보기</summary>
     <p>관찰 근거: {signalLabels(q.eod_signals).length?signalLabels(q.eod_signals).slice(0,6).join(' · '):'원본 신호 확인 불가'}</p>
     <p>관찰 관점: 신호 이후 가격·변동 및 추세 유지 확인</p>
     <p>거래일 {q.reported_trade_day_matches_today===true?'일치':q.reported_trade_day_matches_today===false?'불일치':'미확인'} · 누적 거래량 {money(q.accumulated_volume)} · 수집 {timeKST(q.received_at_utc)}</p>
    </details>
   </article>)}
  </div>}
  <p className="blue-live-disclaimer"><AlertTriangle size={14}/>
    연구 전용 · KRX/NXT 시세와 거래량은 시장별 별개이며 합산하지 않습니다.
    마지막 API 응답 시각은 실제 거래소 체결 시각이 아닙니다. 호가·예상체결가·초 단위 WebSocket은 별도입니다.</p>
 </section>;
}

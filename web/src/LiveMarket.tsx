import {useEffect,useMemo,useState} from 'react';
import {Activity,Clock3,RefreshCw,AlertTriangle} from 'lucide-react';
import './live-market.css';

type Quote={
 code:string;name:string;market:string;market_label:string;phase:string;
 received_at_utc:string;trade_date_kst:string;price:number;open:number;
 high:number;low:number;accumulated_volume:number;
 change_from_eod_pct:number|null;day_range_position_pct:number|null;
 eod_asof:string|null;eod_close:number|null;eod_signals:string;
 reported_trade_day_matches_today?:boolean|null;
 exchange_tick_time_verified:boolean;
};
type Payload={status:string;items:Quote[];trade_date_kst?:string;
 latest_received_at_utc?:string|null;age_minutes?:number|null;note?:string;schema?:string};
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
const money=(x:number|null|undefined)=>typeof x==='number'&&Number.isFinite(x)?x.toLocaleString('ko-KR'):'—';
const timeKST=(s:string|null|undefined)=>{if(!s)return '—';const d=new Date(s);
 return Number.isNaN(d.valueOf())?'—':new Intl.DateTimeFormat('ko-KR',{
 timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);};
const phaseName:Record<string,string>={NXT_PRE:'프리마켓',NXT_MAIN:'메인마켓',
 NXT_AFTER:'애프터마켓',KRX_REGULAR:'정규장',KRX_AFTER:'애프터마켓',
 LEGACY_R14_UNVERIFIED:'이전 수집',UNKNOWN_PHASE:'시장 구간 미확인'};

// R152_TRACKING_ACTIVE: suspended polling while the tracking tab is inactive.
export default function LiveMarket({active=true}: {active?:boolean}){
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
 },[active]);
 const items=useMemo(()=>((payload?.items||[]).filter(q=>filter==='ALL'||q.market===filter)),[payload,filter]);
 const status=payload?.status||'CONNECTING';
 const fresh=!error&&status==='RECENT_SNAPSHOT';
 return <section className="panel blue-live" aria-labelledby="blue-live-heading">
  <div className="blue-live-head">
    <div><h2 id="blue-live-heading"><Activity size={19}/> KIS KRX·NXT 종목 추적 <small>R1.4.1</small></h2>
    <p>08:00~20:00 KST · 거래소별 운영 구간에 5분 간격 수집 시도 · 휴장·지연 가능</p></div>
    <span className={'blue-live-indicator '+(fresh?'blue-live-fresh':'')}>
      {error?'연결 오류':fresh?'최근 수집':status==='CONNECTING'?'연결 중':
       status==='WAITING_FOR_QUOTES'||status==='NOT_CONFIGURED'?'수집 대기':
       '장외·과거·지연 데이터'}</span>
  </div>
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
   <thead><tr><th>종목·시장</th><th>마지막 조회가</th><th>전일 종가 대비</th><th>누적 거래량</th><th>조회 시각</th></tr></thead>
   <tbody>{items.map(q=><tr key={q.market+'-'+q.code}>
    <td><strong>{q.name||q.code}</strong><small>{q.code} · {q.market_label} {phaseName[q.phase]||q.phase}</small>
      <small>거래일 {q.reported_trade_day_matches_today===true?'일치':q.reported_trade_day_matches_today===false?'불일치':'미확인'}</small></td>
    <td className="blue-live-number">{money(q.price)}</td>
    <td className={'blue-live-number '+(q.change_from_eod_pct==null?'':q.change_from_eod_pct>0?'blue-live-up':q.change_from_eod_pct<0?'blue-live-down':'')}>
      {q.change_from_eod_pct==null?'—':`${q.change_from_eod_pct>0?'+':''}${q.change_from_eod_pct.toFixed(2)}%`}</td>
    <td className="blue-live-number">{money(q.accumulated_volume)}</td>
    <td className="blue-live-number">{timeKST(q.received_at_utc)}</td>
   </tr>)}</tbody>
  </table></div>}
  <p className="blue-live-disclaimer"><AlertTriangle size={14}/>
    연구 전용 · KRX/NXT 시세와 거래량은 시장별 별개이며 합산하지 않습니다.
    마지막 API 응답 시각은 실제 거래소 체결 시각이 아닙니다. 호가·예상체결가·초 단위 WebSocket은 별도입니다.</p>
 </section>;
}

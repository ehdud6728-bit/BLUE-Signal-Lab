import {useEffect,useState} from 'react';
import {Activity,Clock3,RefreshCw,AlertTriangle} from 'lucide-react';
import './live-market.css';

type Quote={code:string;name:string;received_at_utc:string;trade_date_kst:string;price:number;open:number;high:number;low:number;accumulated_volume:number;change_from_eod_pct:number|null;day_range_position_pct:number|null;eod_asof:string|null;eod_close:number|null;eod_signals:string};
type Payload={status:string;items:Quote[];trade_date_kst?:string;latest_received_at_utc?:string|null;age_minutes?:number|null;note?:string};
const API=(import.meta.env.VITE_API_BASE || 'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
const format=(n:number|null|undefined)=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('ko-KR'):'—';
const readable=(s:string|null|undefined)=>{if(!s)return '—';const d=new Date(s);return Number.isNaN(d.valueOf())?'—':new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d);};

export default function LiveMarket(){
  const [payload,setPayload]=useState<Payload|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [checked,setChecked]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    let busy=false;
    const poll=async()=>{
      if(busy||document.visibilityState==='hidden')return;
      busy=true;setLoading(true);
      try{
        const r=await fetch(API+'/api/live/quotes',{credentials:'include',cache:'no-store',signal:controller.signal});
        if(!r.ok)throw new Error(r.status===401?'Cloudflare Access 로그인이 필요합니다.':`API 오류 ${r.status}`);
        const json=await r.json() as Payload;
        if(!controller.signal.aborted){setPayload(json);setError('');setChecked(new Date().toISOString());}
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'API 연결 실패');}
      finally{busy=false;if(!controller.signal.aborted)setLoading(false);}
    };
    void poll();
    const timer=window.setInterval(()=>{void poll();},30_000);
    const visible=()=>{if(document.visibilityState==='visible')void poll();};
    document.addEventListener('visibilitychange',visible);
    return()=>{controller.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
  },[]);
  const status=payload?.status||'CONNECTING';
  const fresh=!error && status==='RECENT_SNAPSHOT';
  const list=payload?.items||[];
  return <section className="panel blue-live" aria-labelledby="blue-live-heading">
    <div className="blue-live-head">
      <div><h2 id="blue-live-heading"><Activity size={19}/> KIS 장중 종목 추적 <small>R1.4</small></h2>
        <p>KRX 확정 일봉 후보 · 13:00~15:25 KST · REST 약 5분 간격 수집(지연 가능)</p></div>
      <span className={'blue-live-indicator '+(fresh?'blue-live-fresh':'')}>
        {error?'연결 오류':fresh?'최근 수집':status==='CONNECTING'?'연결 중':status==='WAITING_FOR_QUOTES'||status==='NOT_CONFIGURED'?'수집 대기':'과거·지연 데이터'}
      </span>
    </div>
    <div className="blue-live-summary">
      <span><Clock3 size={14}/> 마지막 KIS 응답 <strong>{readable(payload?.latest_received_at_utc)}</strong></span>
      <span>조회 대상 <strong>{list.length}종목</strong></span>
      <span><RefreshCw size={14}/> 화면 자동 확인 30초 · 마지막 확인 {readable(checked)} {loading?'· 확인 중':''}</span>
    </div>
    {error&&<p className="blue-live-note blue-live-warning"><AlertTriangle size={15}/> {error} · 기존 시세를 최신값으로 간주하지 않습니다.</p>}
    {!list.length&&<p className="blue-live-note">{status==='NOT_CONFIGURED'?'R1.4 서버 수집기가 아직 설치되지 않았습니다.':'아직 저장된 KIS 시세가 없습니다. 수집 실행 후 자동으로 표시됩니다.'}</p>}
    {!!list.length&&<div className="blue-live-tablewrap"><table className="blue-live-table">
      <thead><tr><th>종목</th><th>최종 조회가</th><th>전일 확정 종가 대비</th><th>누적 거래량</th><th>당일 범위</th></tr></thead>
      <tbody>{list.map(q=><tr key={q.code}>
        <td><strong>{q.name||q.code}</strong><small>{q.code} · EOD {q.eod_asof||'미확인'}</small></td>
        <td className="blue-live-number">{format(q.price)}</td>
        <td className={'blue-live-number '+(q.change_from_eod_pct==null?'':q.change_from_eod_pct>0?'blue-live-up':q.change_from_eod_pct<0?'blue-live-down':'')}>{q.change_from_eod_pct==null?'—':`${q.change_from_eod_pct>0?'+':''}${q.change_from_eod_pct.toFixed(2)}%`}</td>
        <td className="blue-live-number">{format(q.accumulated_volume)}</td>
        <td className="blue-live-number">{q.day_range_position_pct==null?'—':`${q.day_range_position_pct.toFixed(0)}%`}</td>
      </tr>)}</tbody>
    </table></div>}
    <p className="blue-live-disclaimer"><AlertTriangle size={14}/> 주문 기능 없음 · 조회 시각과 거래소 체결 시각은 다릅니다. KIS 분 단위 스냅샷으로 초 단위 실시간 스트리밍이 아닙니다. 시장 휴장·갱신 지연 시 과거 데이터로 표시됩니다.</p>
  </section>;
}

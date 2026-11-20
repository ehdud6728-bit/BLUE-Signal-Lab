import {useCallback,useEffect,useState} from 'react';
import {Clock3,RefreshCw} from 'lucide-react';
import './turso-provisional-today.css';

type Quote={code:string;name:string;price:number;open:number;high:number;low:number;
  volume:number;observed_at_utc:string;source:string;date_basis:string};
type Snapshot={storage:string;data_status:string;day:string;complete_market:boolean;
  pattern_analysis:boolean;reference_day:string|null;reference_market_count:number|null;
  observed_count:number;total:number;latest_observed_utc:string|null;items:Quote[]};
function kst(utc:string|null){if(!utc)return '미확인';
  const d=new Date(utc);return Number.isFinite(d.getTime())?
    new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',hour12:false}).format(d):'미확인';}
const won=(v:number)=>v.toLocaleString('ko-KR');

/** A separate quote-only card; provisional rows must never become pattern matches. */
export default function TursoProvisionalToday({api,day,query=''}:{api:string;day:string;query?:string}){
  const [state,setState]=useState<Snapshot|null>(null);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [revision,setRevision]=useState(0);
  const refresh=useCallback(()=>setRevision(v=>v+1),[]);
  useEffect(()=>{
    const controller=new AbortController();
    let active=true;
    const read=async()=>{
      setLoading(true);setError('');
      try{
        const url=new URL(api+'/api/research/provisional');
        url.searchParams.set('date',day);url.searchParams.set('limit','50');
        if(query)url.searchParams.set('q',query);
        const response=await fetch(url.toString(),{credentials:'include',cache:'no-store',
          signal:controller.signal});
        if(!response.ok)throw Error('잠정 시세 저장소를 조회할 수 없습니다.');
        const data=await response.json() as Snapshot;
        if(data.storage!=='TURSO'||data.day!==day||data.pattern_analysis!==false||
          data.complete_market!==false||!Array.isArray(data.items))
          throw Error('잠정 시세 응답을 확인할 수 없습니다.');
        if(active)setState(data);
      }catch(e){if(active&&!controller.signal.aborted){setState(null);
        setError(e instanceof Error?e.message:'잠정 시세 조회 실패');}}
      finally{if(active)setLoading(false);}
    };
    void read();
    // Only re-read already stored Turso data. Never invoke KIS or start a scan.
    const timer=window.setInterval(()=>{
      if(document.visibilityState==='visible')void read();
    },60000);
    return()=>{active=false;controller.abort();window.clearInterval(timer);};
  },[api,day,query,revision]);
  return <section className="blue-provisional" aria-label="KIS 당일 잠정 시세">
    <div className="blue-provisional-head">
      <div><h3><Clock3 size={17}/> KIS 당일 잠정 시세</h3>
        <p>확정 패턴 검색과 별도 · 실제 수집된 종목만 표시</p></div>
      <button type="button" onClick={refresh} disabled={loading} aria-label="잠정 시세 새로고침">
        <RefreshCw size={16}/>{loading?'조회 중':'새로고침'}</button>
    </div>
    {error?<p role="alert">{error}</p>:<>
      <p className="blue-provisional-info" role="status">
        {state?`수집 ${won(state.observed_count)}종목 / 전일 기준 ${state.reference_market_count===null?'미확인':won(state.reference_market_count)}종목 · 최근 수신 ${kst(state.latest_observed_utc)}`:'저장된 잠정 시세 확인 중…'}
      </p>
      {state?.observed_count===0&&<p>아직 수집된 당일 잠정 시세가 없습니다. KIS 수집기는 별도 설정이 활성화된 경우에만 순차 저장합니다.</p>}
      {state&&state.total>0&&<>
        <div className="blue-provisional-list">
          {state.items.map(q=><div className="blue-provisional-row" key={q.code}>
            <div><strong>{q.name||q.code}</strong> <span>{q.code}</span>
              <small>시가 {won(q.open)} · 고가 {won(q.high)} · 저가 {won(q.low)}</small></div>
            <div className="blue-provisional-price"><strong>{won(q.price)}원</strong>
              <small>{kst(q.observed_at_utc)}</small></div>
          </div>)}
        </div>
        {state.total>state.items.length&&<p>조건에 맞는 {won(state.total)}종목 중 최근 수신 {state.items.length}종목을 표시합니다.</p>}
      </>}
      {state&&state.total===0&&state.observed_count>0&&<p>현재 수집된 종목 중 검색어와 일치하는 종목이 없습니다.</p>}
    </>}
    <p className="blue-provisional-warning">일부 종목의 KIS 관측값이며 실시간 전체시장·오늘 발생한 기술 패턴·확정 종가가 아닙니다. 수집 시각이 오래된 종목도 포함될 수 있습니다. 장 마감 후 KRX 분석 완료 시 확정 검색 결과로 전환됩니다.</p>
  </section>;
}

import {useEffect,useState} from 'react';
import {AlertCircle,Database,RefreshCw,Search} from 'lucide-react';
import './turso-eod-recovery.css';

export type TursoDay={day:string;rows:number;source:string};
type PriceRow={day:string;code:string;name:string;market:string;open:number;high:number;
  low:number;close:number;volume:string;amount_krw:string;source:string;name_asof_day?:string|null};
type SearchResult={storage:string;data_status:string;day:string;q:string;page:number;limit:number;
  total:number;items:PriceRow[]};

const price=(n:number)=>n.toLocaleString('ko-KR');
const whole=(n:string)=>{
  try{return BigInt(n).toLocaleString('ko-KR');}catch{return '—';}
};
const eok=(n:string)=>{
  try{
    const v=BigInt(n),unit=100_000_000n;
    return `${(v/unit).toLocaleString('ko-KR')}.${String((v%unit)/10_000_000n)}억`;
  }catch{return '—';}
};

export default function TursoEodRecovery({api,dates,onUnavailable}:{api:string;dates:TursoDay[];
  onUnavailable:(message:string)=>void}){
  const [day,setDay]=useState(dates[0]?.day||'');
  const [q,setQ]=useState('');
  const [appliedQ,setAppliedQ]=useState('');
  const [page,setPage]=useState(1);
  const [result,setResult]=useState<SearchResult|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const chosen=dates.find(x=>x.day===day);
  useEffect(()=>{if(!dates.some(d=>d.day===day))setDay(dates[0]?.day||'');},[dates,day]);
  useEffect(()=>{
    if(!day)return;
    const controller=new AbortController();
    setBusy(true);setError('');setResult(null);
    const u=new URL(api+'/api/eod/search');
    u.searchParams.set('day',day);u.searchParams.set('page',String(page));
    u.searchParams.set('limit','50');if(appliedQ)u.searchParams.set('q',appliedQ);
    void fetch(u.toString(),{signal:controller.signal,cache:'no-store',credentials:'include'})
      .then(async response=>{
        if(!response.ok){
          if(response.status>=500||response.status===401||response.status===403)
            throw Error('TURSO_UNAVAILABLE');
          throw Error(`일봉 조회 오류 (${response.status})`);
        }
        const body=await response.json() as SearchResult;
        if(body.storage!=='TURSO'||body.day!==day||!Array.isArray(body.items))
          throw Error('TURSO_UNAVAILABLE');
        if(!controller.signal.aborted)setResult(body);
      })
      .catch(err=>{
        if(controller.signal.aborted)return;
        if(err instanceof Error&&err.message==='TURSO_UNAVAILABLE'||
          err instanceof TypeError)onUnavailable('Turso 일봉 조회가 중단되어 D1 보조 DB로 전환합니다.');
        else setError(err instanceof Error?err.message:'확정 일봉 조회 실패');
      })
      .finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return ()=>controller.abort();
  },[api,day,appliedQ,page,onUnavailable]);

  return <section className="turso-eod-recovery" aria-label="Turso 확정 일봉 조회">
    <div className="turso-eod-title"><div><h2><Database size={20}/> Turso 확정 일봉 조회</h2>
      <p>검증된 KRX 원본 일봉 · 장중 현재가가 아닙니다.</p></div>
      <span className="turso-eod-source">주 DB · Turso</span>
    </div>
    <div className="turso-eod-notice" role="note"><AlertCircle size={19}/><div>
      <strong>일봉 전용 복구 모드</strong>
      <p>기술 신호·112/224일선·과거 패턴 승률은 아직 Turso에서 계산하지 않습니다.
        장바구니의 발견일 이후 확정 일봉 가격은 Turso를 우선 사용하지만, KIS 관찰·정밀분석·종목 추적·AI 시황 등은 아직 D1에 의존하여 제한 중일 수 있습니다.
        Turso가 연결되지 않으면 기존 D1 검색 화면으로 자동 전환합니다.</p>
    </div></div>
    <form className="turso-eod-form" onSubmit={e=>{e.preventDefault();setPage(1);setAppliedQ(q.trim());}}>
      <label>검증된 거래일
        <select value={day} onChange={e=>{setDay(e.target.value);setPage(1);}}>
          {dates.map(d=><option key={d.day} value={d.day}>{d.day} · {price(d.rows)}종목</option>)}
        </select>
      </label>
      <label>종목코드 또는 종목명
        <input value={q} maxLength={50} placeholder="예: 삼성전자 / 005930" onChange={e=>setQ(e.target.value)}/>
      </label>
      <button type="submit" disabled={busy}><Search size={17}/> 검색</button>
    </form>
    <div className="turso-eod-meta"><strong>{day}</strong><span>전체 저장 {chosen?price(chosen.rows):'—'}종목</span>
      <span>검색 결과 {result?price(result.total):'—'}종목</span>
      {busy&&<span role="status"><RefreshCw size={14}/> 조회 중</span>}
    </div>
    {error&&<p className="turso-eod-error" role="alert">{error}</p>}
    {result?.data_status==='NOT_VERIFIED'&&<p className="turso-eod-error" role="status">이 날짜의 원본 검증이 완료되지 않았습니다.</p>}
    {result&&result.data_status==='VERIFIED_EOD_ONLY'&&<>
      <div className="turso-eod-list">
        {result.items.map(item=><div className="turso-eod-row" key={item.code}>
          <div className="turso-eod-stock"><div><b>{item.name||'종목명 미등록'}</b> <span>{item.code}</span></div>
            <small>{item.market} · {item.day}</small></div>
          <div className="turso-eod-close"><b>{price(item.close)}원</b><small>확정 종가</small></div>
          <div className="turso-eod-ohlc"><span>시가 {price(item.open)}</span><span>고가 {price(item.high)}</span>
            <span>저가 {price(item.low)}</span><span>거래량 {whole(item.volume)}</span></div>
          <div className="turso-eod-amount">거래대금 <b>{eok(item.amount_krw)}원</b></div>
        </div>)}
        {!result.items.length&&<p className="turso-eod-empty">선택한 날짜와 검색어에 해당하는 종목이 없습니다.</p>}
      </div>
      {result.total>50&&<div className="turso-eod-pagination">
        <button type="button" disabled={page<=1||busy} onClick={()=>setPage(p=>p-1)}>이전</button>
        <span>{page} / {Math.ceil(result.total/50)} 페이지</span>
        <button type="button" disabled={page>=Math.ceil(result.total/50)||busy} onClick={()=>setPage(p=>p+1)}>다음</button>
      </div>}
    </>}
    <p className="turso-eod-caption">가격·거래대금: KRX 거래일 검증 일봉. 종목명: 별도 검증 디렉터리의 기준일 이름으로, 과거 상호 변경은 반영되지 않을 수 있습니다. 종목명이 없는 경우 임의로 만들지 않습니다.</p>
  </section>;
}

import {Clock3,RefreshCw} from 'lucide-react';
import './turso-provisional-today.css';

type Item={code:string;name:string;price:number;signals:string[];observed_at_utc:string;
  turnover_available:boolean;traded_amount_krw:number|null;provisional:true;pattern_confirmed:false};
export type ProvisionalSnapshot={storage:string;day:string;data_status:string;pattern_confirmed:false;complete_market:false;
  page:number;limit:number;total:number;matched_count:number;observed_count:number;eligible_count:number;
  turnover_available_count:number;reference_day:string|null;scan_asof_utc:string|null;latest_observed_utc:string|null;items:Item[]};
const won=(n:number)=>n.toLocaleString('ko-KR');
const kst=(s:string|null)=>s?new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s)):'미확인';
export default function TursoProvisionalPatterns({state,loading,onPage,showSignal}:{state:ProvisionalSnapshot;loading:boolean;onPage:(page:number)=>void;showSignal:(s:string)=>string}){
  const page=state.page;
  const ready=state?.data_status==='KIS_PROVISIONAL_PATTERNS';
  return <section className="blue-provisional" aria-label="KIS 당일 잠정 기술패턴">
    <div className="blue-provisional-head">
      <div><h3><Clock3 size={17}/> KIS 당일 잠정 기술패턴</h3>
        <p>R1.1 계산 결과 · 확정 일봉 및 과거 검증 통계와 별도</p></div>
      <button type="button" onClick={()=>onPage(1)} disabled={loading}><RefreshCw size={16}/>{loading?'조회 중':'새로고침'}</button>
    </div>
    {loading&&<p role="status">저장 완료된 당일 패턴 확인 중…</p>}
    {ready&&state&&<>
      <p className="blue-provisional-info">수집 {won(state.observed_count)} · 분석 {won(state.eligible_count)} · 검출 {won(state.matched_count)}종목 · 실제 거래대금 확보 {won(state.turnover_available_count)}종목</p>
      <p className="blue-provisional-info">분석 기준 {state.reference_day} · 계산 {kst(state.scan_asof_utc)} · 최근 수신 {kst(state.latest_observed_utc)}</p>
      <p className="blue-provisional-info">종목명·코드 · 기술패턴 · GC · 이동평균 · 거래대금 조건 적용</p>
      <div className="blue-provisional-list">
        {state.items.map(r=><div className="blue-provisional-row" key={r.code}>
          <div><strong>{r.name}</strong> <span>{r.code}</span>
            <small className="blue-provisional-observations">{r.signals.map(showSignal).join(' · ')}</small>
            <small>거래대금 {r.turnover_available&&r.traded_amount_krw!==null?(r.traded_amount_krw/100000000).toLocaleString('ko-KR',{maximumFractionDigits:2})+'억원':'미확보'}</small></div>
          <div className="blue-provisional-price"><strong>{won(r.price)}원</strong><small>{kst(r.observed_at_utc)} 관측</small></div>
        </div>)}
      </div>
      {state.total===0&&<p>일치하는 잠정 패턴이 없습니다.</p>}
      <div className="blue-provisional-head">
        <button type="button" disabled={page<=1||loading} onClick={()=>onPage(page-1)}>이전</button>
        <span>{page} / {Math.max(1,Math.ceil(state.total/state.limit))} · {won(state.total)}종목</span>
        <button type="button" disabled={loading||page*state.limit>=state.total} onClick={()=>onPage(page+1)}>다음</button>
      </div>
    </>}
    <p className="blue-provisional-warning">미확정 KIS 관측값을 사용한 기술패턴입니다. 전체시장 수집 또는 확정 종가가 아니며, 과거 상승 확률이나 추천 신호를 보장하지 않습니다.</p>
  </section>;
}

// Audited snapshot: Actions 45310116345 / artifact 14883270755.
// Descriptive observations, not forecasts. Never attach a candle subgroup
// to a stock without verified matching OHLC.
export default function RecentPatternReference({day,signals,matched=false}:{day:string;signals:string[];matched?:boolean}){
 if(day<'2026-11-23'||!signals.includes('ENV20_LOWER_TOUCH'))return null;
 return <div className="r15106-search-pattern-evidence" role="note">
  {matched&&<div className="r-research-gold-label">★ 단기 연구 후보 · 캔들 조건 일치 (독립 검증 전)</div>}
  <strong>최근 단기패턴 · 탐색적 연구</strong>
  <small>2026-11-23 기준 · 검증 일봉 28일 / 신호일 24일</small>
  <small>ENV20 하단: 2일 상승 관측 51.47% (919건) · 3일 52.33% (900건) · 5일 50.69% (870건)</small>
  <small>3일 중앙 수익률 +0.49% · 신호 발생일 21일</small>
  <small>별도 세부 연구: 일반 양봉 + 종가 중간 조건의 3일 상승 관측 87.23% (94건 / 11일), 중앙 +9.05%. {matched?'현재 종목의 검색일 캔들 조건 일치.':'현재 종목의 캔들 조건 미확인 또는 불일치.'}</small>
  {matched&&<details onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <summary>매수 시점·익절·손절 연구 상세보기</summary>
    <small>동일 보유기간 3거래일 · 동일 표본 94건 / 11일</small>
    <small>진입 시점 | 상승 관측률 | 중앙 수익률</small>
    <small>신호일 종가 | 87.23% | +9.05%</small>
    <small>다음 거래일 시가 | 84.04% | +8.41%</small>
    <small>다음 거래일 종가 | 86.17% | +7.23%</small>
    <small>두 번째 거래일 종가 | 68.09% | +2.31%</small>
    <strong>익절·손절 조건 비교 (3거래일)</strong>
    <small>진입 | 익절 / 손절 | 평균 수익률 범위 | 목표 우선 도달 건수</small>
    <small>신호일 종가 | +10% / -5% | +5.07~5.23% | 44/94</small>
    <small>다음 날 시가 | +10% / -5% | +6.16~6.32% | 62/94</small>
    <small>다음 날 종가 | +10% / -5% | +6.00~6.32% | 57/94</small>
    <small>다음 날 종가 | +7% / -5% | +4.82~5.08% | 71/94</small>
    <small>다음 날 종가 | +5% / -3% | +3.86~4.12% | 77/94</small>
    <small>동일 일봉 내 목표·손절 순서 불명은 수익률 범위로 표시. 갭은 시가 체결 가정. 비용 미반영. 신호일 종가 진입은 종가 확정 후 체결을 보장하지 않는 가정입니다.</small>
  </details>}
  <small>고정 연구 스냅샷 · 독립 검증 및 기업행동 조정 미완료 · 미래 상승 확률 아님</small>
 </div>;
}

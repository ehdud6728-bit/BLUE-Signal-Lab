// Audited snapshot: Actions 45310116345 / artifact 14883270755.
// Descriptive observations, not forecasts. Never attach a candle subgroup
// to a stock without verified matching OHLC.
export default function RecentPatternReference({day,signals}:{day:string;signals:string[]}){
 if(day<'2026-11-23'||!signals.includes('ENV20_LOWER_TOUCH'))return null;
 return <div className="r15106-search-pattern-evidence" role="note">
  <strong>최근 단기패턴 · 탐색적 연구</strong>
  <small>2026-11-23 기준 · 검증 일봉 28일 / 신호일 24일</small>
  <small>ENV20 하단: 2일 상승 관측 51.47% (919건) · 3일 52.33% (900건) · 5일 50.69% (870건)</small>
  <small>3일 중앙 수익률 +0.49% · 신호 발생일 21일</small>
  <small>별도 세부 연구: 일반 양봉 + 종가 중간 조건의 3일 상승 관측 87.23% (94건 / 11일), 중앙 +9.05%. 현재 종목의 캔들 조건 일치 여부는 미확인.</small>
  <small>고정 연구 스냅샷 · 독립 검증 및 기업행동 조정 미완료 · 미래 상승 확률 아님</small>
 </div>;
}

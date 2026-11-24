import {MARKET_BRIEF} from './market-brief-data';
import './adaptive-research.css';
type Row={day:string;scope:string;universe:number;matched1:number;matched5:number;up1_pct:number|null;up5_pct:number|null;down1_pct:number|null;down5_pct:number|null};
const fmt=(v:number|null|undefined)=>v==null?'미확인':v.toFixed(1)+'%';
const regimes:Record<string,[string,string,string]>={BROAD_STRENGTH:['시장 전반 강세','1일과 5감사일 상승 종목 비율이 모두 60% 이상입니다.','강세 확산 유지 여부와 종목별 과열·매물대를 확인합니다.'],BROAD_WEAKNESS:['시장 전반 약세','1일과 5감사일 상승 종목 비율이 모두 40% 이하입니다.','반등 신호만으로 추세 회복을 단정하지 않고 하락 확산 완화 여부를 확인합니다.'],MIXED:['시장 혼조','단기와 누적 상승 확산이 강세 또는 약세 기준을 동시에 충족하지 않습니다.','상승 종목 비율의 회복 또는 추가 악화를 구분해 관찰합니다.'],UNKNOWN:['판단 보류','비교 가능한 종목 자료가 부족합니다.','데이터 확보 후 다시 판단합니다.']};
export default function MarketBrief(){
 const d=MARKET_BRIEF as {asof:string;audited_sessions:number;regime:string;history:Row[]}|null;
 if(!d)return <p className="blue-note">시장 브리핑 연구 게시 대기 중입니다.</p>;
 const [label,reason,response]=regimes[d.regime]??regimes.UNKNOWN;
 const latest=d.history.filter(r=>r.day===d.asof);
 const hist=d.history.filter(r=>r.scope==='ALL');
 return <section className="blue-research r15106-search-pattern-evidence"><strong>BLUE 시장 브리핑 · 규칙 기반</strong><small>{d.asof} 확정 일봉 기준 · 실시간 아님</small><div className="blue-research-card"><strong>{label}</strong><p>{reason}</p><p>{response}</p></div>
 {latest.map(r=><div className="blue-research-card" key={r.scope}><strong>{r.scope==='ALL'?'전체 시장':r.scope}</strong><div className="blue-metrics"><div className="blue-metric"><small>1감사일 상승</small><b>{fmt(r.up1_pct)}</b></div><div className="blue-metric"><small>5감사일 상승</small><b>{fmt(r.up5_pct)}</b></div><div className="blue-metric"><small>1감사일 하락</small><b>{fmt(r.down1_pct)}</b></div></div><small>비교 종목 {r.matched1}/{r.universe} · 5일 {r.matched5}/{r.universe}</small></div>)}
 <strong>최근 시장 확산 변화</strong><svg width="100%" viewBox="0 0 320 115" role="img" aria-label="최근 전체 시장 상승 종목 비율"><line x1="8" y1="55" x2="312" y2="55" stroke="#999" strokeDasharray="3 3"/>{hist.map((r,i)=>r.up1_pct==null?null:<rect key={r.day} x={8+i*304/Math.max(hist.length,1)} y={105-r.up1_pct} width={Math.max(2,304/Math.max(hist.length,1)-3)} height={r.up1_pct} fill={r.up1_pct>=50?'#c84b42':'#3869b5'}/>)}</svg><small>{hist[0]?.day} ~ {d.asof} · 50% 기준선 · 1감사일 상승 비율</small>
 <div className="blue-research-card"><strong>업종·테마 순환매</strong><p>검증된 날짜별 업종 소속 자료 미연결. 코스피·코스닥 구분은 업종 순환매가 아닙니다.</p><small>업종별 거래대금 비중·상대 강도·상승 확산·대장주 분석은 소속 자료 확보 후 제공합니다.</small></div>
 <div className="blue-research-card"><strong>글로벌 시장·수급</strong><p>VIX, 미국 지수, 환율, 금리, 외국인·기관 순매수 자료 미연결. 확인되지 않은 전망은 표시하지 않습니다.</p></div><small>공식 지수 수익률이 아닌 감사된 종목의 상승 비율입니다. 거래일 연속성 및 기업행사 검증 전이며 미래 예측이 아닙니다.</small></section>;
}

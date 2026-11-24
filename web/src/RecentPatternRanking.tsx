import {useState} from 'react';
import {RECENT_ASOF,RECENT_ROWS,RECENT_SESSIONS,RECENT_RECOMMENDATIONS} from './recent-pattern-data';
export default function RecentPatternRanking(){
 const [h,setH]=useState(3);
 const [sort,setSort]=useState('up');
 const rows=Object.entries(RECENT_ROWS).flatMap(([name,rs])=>rs.filter(r=>r[0]===h).map(r=>({name,r}))).sort((a,b)=>b.r[sort==='median'?5:sort==='mean'?4:sort==='sample'?1:3]-a.r[sort==='median'?5:sort==='mean'?4:sort==='sample'?1:3]||a.name.localeCompare(b.name));
 return <details className="r15106-search-pattern-evidence">
 <summary>최근 기술패턴 순위 · {Object.keys(RECENT_ROWS).length}개</summary>
 <small>{RECENT_ASOF} 기준 · 검증 일봉 {RECENT_SESSIONS}일 · 탐색적 연구</small>
 <div style={{display:'flex',flexWrap:'wrap',gap:6}}>{[1,2,3,5,10,20].map(n=><button type="button" key={n} aria-pressed={h===n} onClick={()=>setH(n)} style={{fontWeight:h===n?700:400}}>{n}일</button>)}</div>
 <label>정렬 <select value={sort} onChange={e=>setSort(e.target.value)}><option value="up">상승 관측률</option><option value="median">중앙 수익률</option><option value="mean">평균 수익률</option><option value="sample">표본 수</option></select></label>
 {rows.map(({name,r},i)=><div key={name} style={{padding:'8px 0',borderBottom:'1px solid #8884'}}><strong>{i+1}. {name}</strong><small>상승 {r[3].toFixed(2)}% · 중앙 {r[5].toFixed(2)}% · 평균 {r[4].toFixed(2)}%</small><small>표본 {r[1]}건 / 신호일 {r[2]}일</small></div>)}
 <details><summary>단기 추천 조건</summary>{(RECENT_RECOMMENDATIONS as Array<{group:string;pattern:string;horizon_trading_days:number;tier:string;positive_return_probability_pct:number;sample_count:number;median_return_pct:number}>).filter(r=>r.tier==='SHORT_RECOMMENDATION'&&r.horizon_trading_days===h).map(r=><div key={r.group+'|'+r.pattern+'|'+r.horizon_trading_days}><strong>{r.pattern}</strong><small>상승 {r.positive_return_probability_pct}% · 중앙 {r.median_return_pct}% · 표본 {r.sample_count}건</small></div>)}<small>추천은 표본 내 관측 기준이며 종목 일치 검증과 별개입니다.</small></details>
 <small>과거 관측 결과이며 미래 확률이 아닙니다. 기업행동 조정 및 독립 검증 미완료. 기간별 표본이 다릅니다.</small>
 </details>;
}

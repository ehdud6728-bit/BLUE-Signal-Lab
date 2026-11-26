import {useMemo,useState} from 'react';
import {ForwardMarketResearch} from './ForwardResearch';
import PrivateResearchCases from './PrivateResearchCases';
import {RECENT_ASOF,RECENT_ROWS,RECENT_SESSIONS,RECENT_RECOMMENDATIONS} from './recent-pattern-data';
import {PROFITABILITY_DATA} from './research-profitability-data';
import {patternLabel} from './research-pattern-label';
import {currentHighReturn} from './HighReturnProfiles';
import {currentCombined} from './CombinedPatternResearch';
import './research-center.css';
export type ResearchTab='center'|'market'|'overview'|'ranking'|'recommend'|'radar'|'profit'|'highreturn'|'combined';
type ProfitRow={calculation_audit?:string;group:string;pattern:string;horizon:number;n:number;dates:number;stocks:number;up_pct:number;mean_pct:number;median_pct:number;min_pct:number;mean_gain_pct:number|null;mean_loss_pct:number|null;payoff_ratio:number|null;profit_factor:number|null;worst_5pct_mean_pct:number;tail_count:number;target_5_pct:number;target_10_pct:number;target_20_pct:number;win_count:number;loss_count:number;flat_count:number};
type ProfitData={asof:string;sessions:number;rows:ProfitRow[];audit?:{source_sha256:string;report_sha256:string;checked:number;unsupported:number;failed:number;scope:string}|null};
const periods=[1,2,3,5,10,20];
const signed=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?'—':(v>0?'+':'')+v.toFixed(2)+'%';
const pct=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?'—':v.toFixed(1)+'%';
const ratio=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?'—':v.toFixed(2);
const tone=(v:number|null|undefined)=>v==null?'':v>0?'rc-up':v<0?'rc-down':'';
const groupLabels:Record<string,string>={rankings:'기본',candle_rankings:'캔들',detail_rankings:'복합',turnover_rankings:'거래대금',market_rankings:'시장'};
function currentProfit():ProfitData|null{
 const d=PROFITABILITY_DATA as ProfitData|null;
 return d&&d.asof===RECENT_ASOF&&d.sessions===RECENT_SESSIONS&&Array.isArray(d.rows)?d:null;
}
function Periods({value,onChange}:{value:number;onChange:(n:number)=>void}){
 return <div className="rc-periods" aria-label="관측 기간">{periods.map(n=><button type="button" key={n} aria-pressed={value===n} onClick={()=>onChange(n)}>{n}일</button>)}</div>;
}
export function ResearchProfitability(){
 const [h,setH]=useState(3),[sort,setSort]=useState<'mean_pct'|'payoff_ratio'|'profit_factor'|'target_10_pct'|'target_20_pct'|'worst_5pct_mean_pct'>('mean_pct');
 const [scope,setScope]=useState('all'),[low,setLow]=useState(false),[limit,setLimit]=useState(12);
 const data=currentProfit();
 const rows=useMemo(()=>[...(data?.rows??[])].filter(r=>r.horizon===h&&(scope==='all'||r.group===scope)&&(!low||r.up_pct<70)).sort((a,b)=>(b[sort]??-Infinity)-(a[sort]??-Infinity)||b.n-a.n||a.pattern.localeCompare(b.pattern)),[data,h,scope,low,sort]);
 return <section className="rc-section">
 <h2>수익성 · 손실 방어</h2><small>신호일 종가 대비 D+N일 종가 관측 · 비용 미반영 · 독립 검증 전</small>
 {!data?<div className="rc-note" role="status">손익비 연구 결과 게시 대기 중입니다. 같은 기준일의 감사된 연구가 게시되면 표시됩니다. 미확인 수치를 추정하지 않습니다.</div>:<>
 <Periods value={h} onChange={v=>{setH(v);setLimit(12);}}/>
 <div className="rc-filter"><label>연구 종류<select value={scope} onChange={e=>{setScope(e.target.value);setLimit(12);}}><option value="all">전체</option>{Object.entries(groupLabels).map(([k,v])=><option value={k} key={k}>{v}</option>)}</select></label><label>정렬<select value={sort} onChange={e=>{setSort(e.target.value as typeof sort);setLimit(12);}}>{([['mean_pct','평균 수익률'],['payoff_ratio','손익비'],['profit_factor','Profit Factor'],['target_10_pct','+10% 종가 도달률'],['target_20_pct','+20% 종가 도달률'],['worst_5pct_mean_pct','하위 5% 평균 방어']] as const).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label></div>
 <label className="rc-check"><input type="checkbox" checked={low} onChange={e=>{setLow(e.target.checked);setLimit(12);}}/> 상승 관측률 70% 미만만 보기</label>
 <small>{data.asof} 기준 · {rows.length}개 조건 · 각 표본 30건·5일·10종목 이상</small>
 <details className="rc-note"><summary>수익성 계산 검증 범위</summary>{data.audit?<p>별도 계산 일치 {data.audit.checked}건 · 범위 외 {data.audit.unsupported}건 · 불일치 {data.audit.failed}건 (게시 전 전체 연구 행 기준)<br/>원천 SHA-256: {data.audit.source_sha256}<br/>보고서 SHA-256: {data.audit.report_sha256}</p>:<p>독립 계산 결과 미게시</p>}<small>기본·캔들·양봉 몸통 및 종가 위치만 재계산합니다. 같은 저장 자료를 이용한 검증이며 외부 원천·기업행동·거래일·체결 검증과는 별개입니다.</small></details>
 {rows.length===0&&<p>선택 조건에 해당하는 자료가 없습니다.</p>}
 {rows.slice(0,limit).map(r=><article className="rc-profit-row" key={r.group+'|'+r.pattern+'|'+r.horizon}>
 <strong>{patternLabel(r.pattern)}</strong><small>{groupLabels[r.group]} · {r.n}건 / {r.dates}일 / {r.stocks}종목</small>
 <div className="rc-metrics"><div><span>평균 수익률</span><b className={tone(r.mean_pct)}>{signed(r.mean_pct)}</b></div><div><span>상승 관측률</span><b>{pct(r.up_pct)}</b></div><div><span>손익비</span><b>{ratio(r.payoff_ratio)}</b></div></div>
 <div className="rc-metrics"><div><span>+10% 도달</span><b>{pct(r.target_10_pct)}</b></div><div><span>Profit Factor</span><b>{ratio(r.profit_factor)}</b></div><div><span>하위 5% 평균</span><b className={tone(r.worst_5pct_mean_pct)}>{signed(r.worst_5pct_mean_pct)}</b></div></div>
 <small>계산 검증: {r.calculation_audit==='RECOMPUTED_MATCH'?'별도 재계산 일치':'독립 재계산 미확인'}</small><details><summary>상세 손익·위험 보기</summary><dl className="rc-detail"><dt>평균 이익 (상승 사례)</dt><dd>{signed(r.mean_gain_pct)}</dd><dt>평균 손실 (하락 사례)</dt><dd>{signed(r.mean_loss_pct)}</dd><dt>중앙 수익률</dt><dd>{signed(r.median_pct)}</dd><dt>최악의 종가 수익률</dt><dd>{signed(r.min_pct)}</dd><dt>하위 5% 표본</dt><dd>{r.tail_count}건</dd><dt>+5% / +20% 종가 도달</dt><dd>{pct(r.target_5_pct)} / {pct(r.target_20_pct)}</dd><dt>상승 / 하락 / 보합</dt><dd>{r.win_count} / {r.loss_count} / {r.flat_count}</dd></dl></details>
 </article>)}
 {rows.length>limit&&<button type="button" className="rc-action" onClick={()=>setLimit(v=>v+12)}>12개 더 보기</button>}
 </>}
 <div className="rc-note">손익비는 평균 이익 ÷ 평균 손실 절댓값, Profit Factor는 총 양의 수익 ÷ 총 음의 수익 절댓값입니다. 상승·하락 사례가 없는 경우 일부 비율은 —로 표시합니다. 같은 종목·날짜가 중복될 수 있고, 거래일 연속성·기업행동·체결·비용 검증이 끝나지 않았습니다. 익절·손절 최초 도달 연구와 실제 계좌 수익은 별개입니다.</div>
 </section>;
}
export default function ResearchCenter({onNavigate}:{onNavigate:(tab:ResearchTab)=>void}){
 const [h,setH]=useState(3),[metric,setMetric]=useState<'up'|'median'|'mean'>('up'),[all,setAll]=useState(false);
 const recommendations=RECENT_RECOMMENDATIONS.filter(r=>r.tier==='SHORT_RECOMMENDATION'&&r.horizon_trading_days===h).sort((a,b)=>b.positive_return_probability_pct-a.positive_return_probability_pct||b.sample_count-a.sample_count);
 const unique=recommendations.filter((r,i)=>recommendations.findIndex(x=>x.pattern===r.pattern)===i);
 const best=unique[0];
 const profit=currentProfit();
 const high=currentHighReturn();
 const ranked=useMemo(()=>Object.entries(RECENT_ROWS).sort((a,b)=>(b[1].find(r=>r[0]===h)?.[3]??-Infinity)-(a[1].find(r=>r[0]===h)?.[3]??-Infinity)||a[0].localeCompare(b[0])),[h]);
 const i=metric==='up'?3:metric==='mean'?4:5;
 return <section className="rc-center">
 <header className="rc-title"><div><h2>BLUE 통합 연구센터</h2><small>{RECENT_ASOF} 기준 · 최근 {RECENT_SESSIONS}개 감사 관측일 범위</small></div><span>연구용</span></header>
 <div className="rc-note">기술패턴 성과는 신호일 종가 기준 과거 관측이며 미래 상승 확률이 아닙니다. 기간별 표본이 다르고 독립 검증 전입니다.</div>
 <ForwardMarketResearch/>
 <PrivateResearchCases/>
 <Periods value={h} onChange={setH}/>
 <section className="rc-section"><div className="rc-heading"><h3>핵심 상승 관찰 조건</h3><button type="button" className="rc-link" onClick={()=>onNavigate('recommend')}>전체 보기 ›</button></div>
 {best?<><strong className="rc-best">{patternLabel(best.pattern)}</strong><div className="rc-metrics"><div><span>상승 관측률</span><b className="rc-up">{pct(best.positive_return_probability_pct)}</b></div><div><span>중앙 수익률</span><b className={tone(best.median_return_pct)}>{signed(best.median_return_pct)}</b></div><div><span>표본</span><b>{best.sample_count}건</b></div></div><small>{best.distinct_signal_dates}개 신호일 · {best.distinct_stocks}종목 · 최악 종가 수익률 {signed(best.min_return_pct)}</small></>:<p>이 기간에 게시된 단기 추천 조건이 없습니다.</p>}
 <div className="rc-list">{unique.slice(1,3).map(r=><div key={r.pattern}><strong>{patternLabel(r.pattern)}</strong><b>{pct(r.positive_return_probability_pct)}</b><small>중앙 {signed(r.median_return_pct)} · {r.sample_count}건</small></div>)}</div>
 </section>
 <section className="rc-section"><div className="rc-heading"><h3>기간별 성과 히트맵</h3><button type="button" className="rc-link" onClick={()=>onNavigate('ranking')}>상세 순위 ›</button></div>
 <div className="rc-toggle">{([['up','상승 관측률'],['median','중앙 수익률'],['mean','평균 수익률']] as const).map(([v,l])=><button key={v} type="button" aria-pressed={metric===v} onClick={()=>setMetric(v)}>{l}</button>)}</div>
 <div className="rc-table-scroll"><table className="rc-heat"><thead><tr><th scope="col">패턴</th>{periods.map(n=><th key={n} scope="col">{n}일</th>)}</tr></thead><tbody>{ranked.slice(0,all?ranked.length:6).map(([name,values])=><tr key={name}><th scope="row">{patternLabel(name)}</th>{periods.map(n=>{const r=values.find(x=>x[0]===n);const v=r?.[i];const adequate=!!r&&r[1]>=30&&r[2]>=5;const level=v==null||!adequate?'rc-missing':metric==='up'?v>=70?'rc-hot':v>=55?'rc-warm':v>=45?'rc-neutral':v>=30?'rc-cool':'rc-cold':v>=5?'rc-hot':v>0?'rc-warm':v===0?'rc-neutral':v>=-5?'rc-cool':'rc-cold';return <td key={n} className={level} title={r?String(r[1])+'건 · '+r[2]+'일'+(!adequate?' · 표본 부족':''):'관측 없음'}>{v==null?'—':v.toFixed(1)}{r&&!adequate?'*':''}</td>;})}</tr>)}</tbody></table></div>
 <small>단위 % · 행은 선택한 {h}일 상승 관측률 순 · * 표본 30건 또는 신호일 5일 미만 (회색) · 종목 수 미검증</small>
 {ranked.length>6&&<button type="button" className="rc-action" onClick={()=>setAll(v=>!v)}>{all?'접기':'전체 '+ranked.length+'개 비교'}</button>}
 </section>
 <section className="rc-section"><div className="rc-heading"><h3>수익성 · 고수익 특성</h3><button type="button" className="rc-link" onClick={()=>onNavigate('profit')}>손익비 연구 ›</button></div>
 {profit?<><small>동일 기준일 수익성 자료 · 70% 미만 조건 포함</small>{[...profit.rows].filter(r=>r.horizon===h&&r.up_pct<70&&r.mean_pct>0).sort((a,b)=>b.mean_pct-a.mean_pct).slice(0,2).map(r=><div key={r.group+r.pattern} className="rc-profit-row"><strong>{patternLabel(r.pattern)}</strong><small>평균 {signed(r.mean_pct)} · 손익비 {ratio(r.payoff_ratio)} · 상승 {pct(r.up_pct)} · {r.n}건</small></div>)}</>:<p>손익비·극단 손실 연구 결과 게시 대기</p>}
 <div className="rc-heading"><small>{high?`고수익 특성 ${high.published_rows.toLocaleString()}건 게시 / 전체 ${high.source_rows.toLocaleString()}건`:"고수익 특성 집계 게시 대기"}</small><button type="button" className="rc-link" onClick={()=>onNavigate('highreturn')}>특성 비교 ›</button></div>
 </section>
 <section className="rc-section"><div className="rc-heading"><h3>복합 조건 연구</h3><button type="button" className="rc-link" onClick={()=>onNavigate('combined')}>동시 조건 비교 ›</button></div><small>{currentCombined()?'동일 기준일 집계 연결 · 저장 지표 탐색 연구':'동일 기준일 복합 연구 집계 게시 대기'}</small></section>
 <div className="rc-nav-grid">{([['market','시황·순환매','대장주·후발주 / AI 대응'],['radar','시장 변화·이력','상승·하락 방향성 / 신규 조건'],['overview','연구 관리','데이터 확보 / 익절·손절'],['profit','수익성 연구','손익비 / 큰 손실']] as const).map(([tab,title,desc])=><button key={tab} type="button" onClick={()=>onNavigate(tab)}><strong>{title} ›</strong><small>{desc}</small></button>)}</div>
 </section>;
}

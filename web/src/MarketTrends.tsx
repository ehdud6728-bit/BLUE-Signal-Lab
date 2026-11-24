import {useEffect,useState} from 'react';
type IndexSummary={day:string;close:number;previous_day:string;change_pct:number;change5_pct:number|null;sessions:number};
type Trend={day:string;matched_sessions:number;rs5:number;rs10:number;rs20:number;momentum:number;quadrant:string};
type Sector={code:string;name:string;status:string;reason:string|null;trend:Trend|null};
type Market={market:string;benchmark:IndexSummary|null;universe:number;attempted:number;rows:Sector[]};
type Snapshot={global_receipt_day?:string;global_status?:string;status:string;receipt_day:string;category_receipt_day:string;domestic_cutoff:string;overseas_cutoff:string;stale_receipt:boolean;markets:Market[];global:{symbol:string;name:string;status:string;summary:IndexSummary|null}[]};
const label:Record<string,string>={LEADING:'주도',IMPROVING:'개선',WEAKENING:'약화',LAGGING:'소외',NEUTRAL:'경계'};
const color:Record<string,string>={LEADING:'#15835a',IMPROVING:'#3977c5',WEAKENING:'#ad801e',LAGGING:'#c74b4b',NEUTRAL:'#8793a0'};
const fmt=(v:number|null,unit='%')=>v===null?'미확인':(v>0?'+':'')+v.toFixed(2)+unit;
export default function MarketTrends({api}:{api:string}){
 const [data,setData]=useState<Snapshot|null>(null),[err,setErr]=useState(''),[scope,setScope]=useState('KOSPI'),[quadrant,setQuadrant]=useState('ALL'),[all,setAll]=useState(false),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
 useEffect(()=>{const ctrl=new AbortController();setBusy(true);setErr('');fetch(api+'/api/research/market-trends',{credentials:'include',cache:'no-store',signal:ctrl.signal}).then(r=>{if(!r.ok)throw Error('과거 시장 자료 조회 실패');return r.json();}).then(d=>{if(!ctrl.signal.aborted)setData(d);}).catch(e=>{if(!ctrl.signal.aborted){setErr(e.message);setData(null);}}).finally(()=>{if(!ctrl.signal.aborted)setBusy(false);});return()=>ctrl.abort();},[api,refresh]);
 const m=data?.markets?.find(x=>x.market===scope);
 const available=(m?.rows||[]).filter((x):x is Sector&{trend:Trend}=>x.trend!==null);
 const selected=available.filter(x=>quadrant==='ALL'||x.trend.quadrant===quadrant).sort((a,b)=>b.trend.momentum-a.trend.momentum||b.trend.rs10-a.trend.rs10);
 const scaleX=Math.max(1,...available.map(x=>Math.abs(x.trend.rs10))),scaleY=Math.max(1,...available.map(x=>Math.abs(x.trend.momentum)));
 const [focus,setFocus]=useState('');
 const active=available.find(x=>x.code===focus);
 return <section className="blue-research-card">
 <div className="blue-pattern-heading"><strong>미국 증시 · 업종 순환 방향</strong><button disabled={busy} onClick={()=>setRefresh(x=>x+1)}>새로고침</button></div>
 {busy&&<p>과거 지수 자료 조회 중…</p>}{err&&<p role="alert">{err}</p>}
 {!busy&&!err&&data?.status!=='READY'&&<p className="blue-note">아직 기간별 지수 분석 자료가 없습니다. 시장 추세 수집 Actions를 실행해 주세요.</p>}
 {data?.status==='READY'&&<>
 <small>수집일 {data.receipt_day} · {data.stale_receipt?'이전 수집 자료 · ':''}현재 현지 날짜 제외 · 정규장 실시간 아님</small>
 <small>해외 지수 별도 수집일 {data.global_receipt_day??data.receipt_day}{data.global_status==='SEPARATE_UNAVAILABLE'?' · 별도 자료 검증 실패, 기존 자료만 표시':''}</small>
 {data.global.map(g=><div className="blue-research-card" key={g.symbol}><strong>{g.name}</strong>{g.summary?<><div className="blue-metrics"><div className="blue-metric"><small>지수</small><b>{g.summary.close.toLocaleString('ko-KR')}</b></div><div className="blue-metric"><small>직전 관측 대비</small><b>{fmt(g.summary.change_pct)}</b></div><div className="blue-metric"><small>5관측일</small><b>{fmt(g.summary.change5_pct)}</b></div></div><small>미국 거래일 {g.summary.day} · KIS 일봉</small></>:<p>미확인 · API 조회 권한/코드/응답 확인 필요</p>}</div>)}
 <p className="blue-note">VIX는 현물 지수입니다. 선물 근월·차월 구조, 주요 경제 일정은 아직 연결되지 않았습니다. 해외 지수 날짜가 서로 다를 경우 같은 날로 해석하지 않습니다.</p>
 <strong>업종 순환 사분면 (RRG 원리 참고)</strong>
 <p>가로축: 최근 10개 기준일 구간의 시장 대비 상대성과. 세로축: 그 상대성과의 5개 기준일 전 대비 변화. 같은 시장의 동일 날짜 26개 일봉이 필요합니다. 정식 RRG 산식이나 미래 순환매 확률이 아닙니다.</p>
 <div className="blue-periods">{['KOSPI','KOSDAQ'].map(v=><button key={v} aria-pressed={scope===v} onClick={()=>{setScope(v);setFocus('');setAll(false);}}>{v}</button>)}</div>
 <small>기준일 {m?.benchmark?.day??'미확인'} · 분석 가능 {available.length}/{m?.universe??0}개 · 업종 목록 기준 {data.category_receipt_day}</small>
 <svg viewBox="0 0 320 230" role="img" aria-label="업종 상대성과와 변화 사분면" style={{width:'100%',maxHeight:300}}>
 <rect x="16" y="16" width="144" height="92" rx="4" fill={color.IMPROVING} opacity=".10"/><rect x="160" y="16" width="144" height="92" rx="4" fill={color.LEADING} opacity=".10"/>
 <rect x="16" y="108" width="144" height="92" rx="4" fill={color.LAGGING} opacity=".10"/><rect x="160" y="108" width="144" height="92" rx="4" fill={color.WEAKENING} opacity=".10"/>
 <path d="M160 16V200 M16 108H304" stroke="currentColor" opacity=".4" strokeDasharray="4 3"/>
 {[[35,32,'개선',color.IMPROVING],[270,32,'주도',color.LEADING],[35,192,'소외',color.LAGGING],[270,192,'약화',color.WEAKENING]].map(([x,y,t,c])=><text key={String(t)} x={Number(x)} y={Number(y)} textAnchor="middle" fontSize="11" fill={String(c)}>{t}</text>)}
 {available.map(s=><circle key={s.code} cx={160+s.trend.rs10/scaleX*130} cy={108-s.trend.momentum/scaleY*78} r={focus===s.code?6:3} fill={color[s.trend.quadrant]} opacity={quadrant==='ALL'||quadrant===s.trend.quadrant?0.9:0.18}><title>{s.name} · {fmt(s.trend.rs10)} · {fmt(s.trend.momentum,'%p')}</title></circle>)}
 <text x="160" y="220" textAnchor="middle" fill="currentColor" fontSize="10">10일 상대성과 →</text>
 </svg>
 {active&&<p><strong>{active.name}</strong> · {label[active.trend.quadrant]} · {fmt(active.trend.rs10)} / {fmt(active.trend.momentum,'%p')}</p>}
 <div className="blue-periods">{['ALL','LEADING','IMPROVING','WEAKENING','LAGGING','NEUTRAL'].map(q=><button key={q} aria-pressed={quadrant===q} onClick={()=>{setQuadrant(q);setFocus('');setAll(false);}}>{q==='ALL'?'전체':label[q]} {q==='ALL'?available.length:available.filter(s=>s.trend.quadrant===q).length}</button>)}</div>
 {selected.slice(0,all?100:12).map(s=><div className="blue-research-card" key={s.code}><button type="button" onClick={()=>setFocus(s.code)}><strong>{s.name} · {label[s.trend.quadrant]}</strong></button><div className="blue-metrics"><div className="blue-metric"><small>5일 상대</small><b>{fmt(s.trend.rs5)}</b></div><div className="blue-metric"><small>10일 상대</small><b>{fmt(s.trend.rs10)}</b></div><div className="blue-metric"><small>20일 상대</small><b>{fmt(s.trend.rs20)}</b></div></div><small>10일 상대성과 변화 {fmt(s.trend.momentum,'%p')} · {s.trend.day}</small></div>)}
 {selected.length>12&&<button onClick={()=>setAll(x=>!x)}>{all?'12개만 보기':'전체 보기'}</button>}
 {m&&m.universe>available.length&&<details><summary>이력 부족/미확인 {m.universe-available.length}개</summary>{m.rows.filter(x=>!x.trend).map(x=><p key={x.code}>{x.name} · {x.reason??'미확인'}</p>)}</details>}
 <p className="blue-note">사분면은 과거 상대성과의 관찰 분류입니다. 업종 구성·테마 및 대장주·후발주, 순환 예측 성과는 아직 검증하지 않았습니다.</p>
 </>}
 </section>;
}

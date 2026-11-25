import {useEffect,useState} from 'react';
type Stock={code:string;name:string;close:number;r5:number;r10:number;amount:number;amount_ratio:number|null;signals:string[]|null};
type Group={krx_scope?:string;krx_code?:string;identity_basis?:string;membership_source?:string;membership_reason?:string|null;code:string;name:string;rs10:number;momentum:number;entry:string;members:number;matched:number;eligible:number;leaders:Stock[];followers:Stock[]};
type Market={market:string;improving:number;analyzed:number;master_members:number;matched_members:number;groups:Group[]};
type Snapshot={mapping_status?:string;latest_trend_day?:string;reference_basis?:string;status:string;receipt_day:string;master_receipt_day:string;trend_receipt_day:string;day:string;reference5:string;reference10:string;signal_status:string;sector_limit:number;stale_receipt:boolean;trend_superseded:boolean;markets:Market[]};
const fmt=(v:number)=> (v>0?'+':'')+v.toFixed(2)+'%';
const entry=(x:string)=>x==='NEW_ENTRY'?'신규 개선 진입':x==='CONTINUING'?'개선 유지':'개선 관측 · 직전 상태 미확인';
function Stocks({title,rows}:{title:string;rows:Stock[]}){
 return <div><strong>{title} ({rows.length})</strong>{rows.length===0?<p>조건을 충족한 후보 없음</p>:rows.map(s=><div className="blue-research-card" key={s.code}>
 <strong>{s.name} <small>{s.code}</small></strong><small> · {s.close.toLocaleString('ko-KR')}원</small>
 <div className="blue-metrics"><div className="blue-metric"><small>5일 수익률</small><b>{fmt(s.r5)}</b></div><div className="blue-metric"><small>10일 수익률</small><b>{fmt(s.r10)}</b></div><div className="blue-metric"><small>거래대금</small><b>{(s.amount/100000000).toFixed(1)}억</b></div></div>
 <p>직전 5관측일 평균 대비 {s.amount_ratio===null?'미확인':s.amount_ratio.toFixed(2)+'배'}</p>
 <small>{s.signals===null?'기술패턴 미검증':s.signals.length?'동일 기준일 BLUE 신호: '+s.signals.join(' · '):'동일 기준일 BLUE 신호 없음'}</small>
 </div>)}</div>;
}
export default function RotationLeaders({api}:{api:string}){
 const [data,setData]=useState<Snapshot|null>(null),[err,setErr]=useState(''),[scope,setScope]=useState('KOSPI'),[busy,setBusy]=useState(false),[rev,setRev]=useState(0),[entryOnly,setEntryOnly]=useState(false);
 useEffect(()=>{const c=new AbortController();setBusy(true);setErr('');fetch(api+'/api/research/rotation-leaders',{credentials:'include',cache:'no-store',signal:c.signal}).then(r=>{if(!r.ok)throw Error('후보 자료 조회 실패');return r.json();}).then(d=>{if(!c.signal.aborted)setData(d);}).catch(e=>{if(!c.signal.aborted){setErr(e.message);setData(null);}}).finally(()=>{if(!c.signal.aborted)setBusy(false);});return()=>c.abort();},[api,rev]);
 const m=data?.markets?.find(m=>m.market===scope);
 const groups=(m?.groups||[]).filter(g=>!entryOnly||g.entry==='NEW_ENTRY');
 return <section className="blue-research-card">
 <div className="blue-pattern-heading"><strong>개선 업종 · 대장주와 후발주 관찰</strong><button disabled={busy} onClick={()=>setRev(x=>x+1)}>새로고침</button></div>
 {busy&&<p>저장 자료 조회 중…</p>}{err&&<p role="alert">{err}</p>}
 {!busy&&!err&&data?.status!=='READY'&&<p>아직 후보 자료가 없습니다. BLUE Rotation Leaders Capture를 실행해 주세요.</p>}
 {data?.status==='READY'&&<>
 {data.latest_trend_day&&data.latest_trend_day!==data.day&&<p className="blue-note">최신 업종 기준일 {data.latest_trend_day}의 일봉 검증 미완료 · 동일 날짜로 확인된 이전 후보 {data.day} 표시</p>}
 <small>{data.reference_basis==='EXACT_BENCHMARK_DATES'?'시장 지수 관측일과 일치':'감사된 일봉 날짜 기준 · 전체 거래일 연속성 미검증'} · </small>
 <small>일봉 기준 {data.day} · 마스터 수집 {data.master_receipt_day} · 현재 분류를 과거 구성으로 간주하지 않음</small>
 {(data.stale_receipt||data.trend_superseded)&&<p className="blue-note">이전 후보 자료입니다. 최신 후보로 간주하지 말고 새 수집을 실행해 주세요.</p>}
 <p>대장주는 10관측일 +3% 이상 및 5관측일 상승, 거래대금 5억 이상인 종목 중 10일 수익률 상위 3개입니다. 후발주는 10관측일 -3~+3%, 5관측일 0% 초과~3%, 당일 거래대금 5억 이상·직전 5관측일 평균 1.2배 이상이며 대장주보다 덜 오른 종목입니다.</p>
 <div className="blue-periods">{['KOSPI','KOSDAQ'].map(v=><button key={v} aria-pressed={scope===v} onClick={()=>setScope(v)}>{v}</button>)}</div>
 <label><input type="checkbox" checked={entryOnly} onChange={e=>setEntryOnly(e.target.checked)}/> 신규 개선 진입만 보기</label>
 <p>개선 업종 {m?.improving??0}개 · 세부 후보 분석 {m?.analyzed??0}개 (시장별 최대 {data.sector_limit}개) · 마스터와 일봉 일치 {m?.matched_members??0}/{m?.master_members??0}</p>
 {data.mapping_status==='PARTIAL'&&<p className="blue-note">일부 업종만 구성 종목 확인 완료 · 매핑 미확인 업종은 후보를 생성하지 않습니다.</p>}
 <small>기술패턴 {data.signal_status==='AUDITED'?'동일 기준일 감사 통과':'미확인'} · 조건은 탐색용이며 미래 상승률은 검증하지 않았습니다.</small>
 {!groups.length&&<p>표시할 업종이 없습니다. 직전 사분면 자료가 없으면 신규 진입으로 분류하지 않습니다.</p>}
 {groups.map(g=><details key={g.code} className="blue-research-card"><summary><strong>{g.name}</strong> · {entry(g.entry)} · 대장 {g.leaders.length} / 후발 {g.followers.length}</summary>
 <p>시장 상대성과 {fmt(g.rs10)} · 변화 {g.momentum.toFixed(2)}%p · 일봉 일치 {g.matched}/{g.members}개 · 유동성/가격 조건 {g.eligible}개</p>
 {g.membership_source&&<small>구성 근거: {g.membership_source==='KIS_MASTER_CODE'?'KIS 업종 코드':g.membership_source==='KIS_MASTER_FLAG'?'KIS 지수 구성 플래그':g.membership_source==='KRX_INDEX_CONSTITUENTS'?'KRX 기준일 구성 조회 · 현재 정상 종목만':'미확인'}</small>}
 {g.krx_scope&&<p><small>지수 계열 {g.krx_scope} · KRX 코드 {g.krx_code} · {g.identity_basis==='CROSS_EXACT_NAME_AND_RELATIVE_HISTORY'?'동일 명칭 및 26관측일 상대성과 교차검증':'동일 시장 지수명 확인'}</small></p>}
 {g.members===0?<p>해당 업종 구성 종목 미확인 ({g.membership_reason??'NO_MASTER_MEMBERS'}) · 종목을 추정하지 않습니다.</p>:<><Stocks title="대장주 관찰 후보" rows={g.leaders}/><Stocks title="초기 회복 후발주 관찰 후보" rows={g.followers}/></>}
 </details>)}
 <p className="blue-note">대장·후발 후보는 가격·거래대금 기준 관찰 분류이며 거래대금은 순매수와 다릅니다. 기업행동, 구성 변경 이력, 실제 매매 성과 및 테마 분류는 검증 전입니다.</p>
 </>}
 </section>;
}

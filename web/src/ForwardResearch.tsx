import {useEffect,useState} from 'react';
import {patternLabel} from './research-pattern-label';
import './forward-research.css';
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
const pct=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?(v>0?'+':'')+v.toFixed(2)+'%':'—';
const num=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ko-KR'):'—';
const state:Record<string,string>={DOWN_CONFIRMED:'하락 확인',UP_CONFIRMED:'상승 확인',RECOVERY_WATCH:'회복 관찰',WEAKENING_WATCH:'약화 관찰',MIXED_OR_DIVERGENT:'혼조',UNKNOWN:'미확인'};
const why:Record<string,string>={TARGET:'목표 도달',STOP_TOUCH:'손절 접촉',STOP_GAP:'갭 손절',TIME_CLOSE:'기간 종료'};
function useForward(query:string,active:boolean){
 const [data,setData]=useState<any>(null),[status,setStatus]=useState(''),[rev,setRev]=useState(0);
 useEffect(()=>{setData(null);setStatus('');if(!active)return;const c=new AbortController();setStatus('조회 중');
 fetch(API+'/api/research/forward-view'+query,{credentials:'include',cache:'no-store',signal:c.signal}).then(async r=>{if(!r.ok)throw Error(String(r.status));return r.json()}).then(x=>{if(!c.signal.aborted){setData(x);setStatus('')}}).catch(e=>{if(!c.signal.aborted)setStatus(e.message==='401'?'로그인 필요':'성과 조회 실패 · 재시도 가능')});return()=>c.abort()},[query,active,rev]);
 return {data,status,reload:()=>setRev(v=>v+1)};
}
export function ForwardMarketResearch({compact=false}:{compact?:boolean}){
 const [open,setOpen]=useState(false);const {data,status,reload}=useForward('',open);const r=data?.report;
 return <details className="fwd-panel" onToggle={e=>setOpen(e.currentTarget.open)}><summary>적응형 시장 · 전진 성과</summary>
 {open&&<><button type="button" onClick={reload}>새로고침</button>{status&&<p role="status">{status}</p>}
 {!status&&data?.status==='NOT_AVAILABLE'&&<p>게시된 감사 보고서가 없습니다. 연구 실행 후 게시 필요.</p>}
 {r&&<><small>{r.asof} 기준 · 현재 시세 아님 · 게시 {r.generated_at??data.generated_at}</small>
 {r.market.map((m:any)=><section key={m.market}><strong>{m.market} · {state[m.state]??m.state}</strong>
 <div className="fwd-scroll"><table><thead><tr><th>기간</th><th>상승 비율</th><th>종목 중앙 변화</th></tr></thead><tbody>{m.breadth.map((b:any)=><tr key={b.horizon}><td>{b.horizon}일</td><td>{pct(b.up_pct)}</td><td>{pct(b.median_stock_change_pct)}</td></tr>)}</tbody></table></div>
 <small>신호 빈도: {m.frequency.status==='OBSERVED'?'이전 5일 대비 최근 5일':'연속 감사 신호 자료 부족'}</small>
 {!compact&&m.frequency.rows.slice(0,8).map((x:any)=><p key={x.pattern}>{patternLabel(x.pattern)} · {pct(x.prior_rate_pct)} → {pct(x.recent_rate_pct)} (빈도, 수익률 아님)</p>)}</section>)}
 <p>관찰 스냅샷 {num(r.snapshot_count)}개 · 관찰 대기 {num(r.outcome_status?.PENDING??0)}건 · 확정 집계 {num(r.archive?.total)}개</p>
 <p>순환매 기록 {num(r.rotation?.receipt_count)}일 · 성숙 {num(r.rotation?.outcome_status?.OBSERVED??0)}건 · 대기 {num(r.rotation?.outcome_status?.PENDING??0)}건</p>
 {!compact&&<><strong>관찰기간별 최고가 기회</strong><div className="fwd-scroll"><table><thead><tr><th>기간</th><th>관측</th><th>최고가 평균</th><th>+3% 도달</th><th>+5% 도달</th></tr></thead><tbody>{r.opportunity.map((x:any)=><tr key={x.horizon}><td>{x.horizon}일</td><td>{num(x.sample_count)}</td><td>{pct(x.peak_high_pct?.mean)}</td><td>{pct(x.target_high_reach?.['3']?.hit_pct)}</td><td>{pct(x.target_high_reach?.['5']?.hit_pct)}</td></tr>)}</tbody></table></div>
 <strong>확정 집계 · 가상 전량 익절 비교</strong>{!r.archive?.sealed_recent?.length?<p>성숙하여 저장된 집계 없음</p>:r.archive.sealed_recent.map((x:any)=><section key={x.source_day+'|'+x.horizon}><small>{x.source_day} · {x.horizon}일 · {x.coverage==='PARTIAL_SYMBOL_PATHS'?'일부 종목 누락':'경로 확인'}</small>{['SIGNAL_LOW','ATR14_SMA_1_5'].map(m=>{const z=x.exit_summary?.methods?.[m];return <p key={m}>{m==='SIGNAL_LOW'?'신호봉 저가':'ATR 1.5'} · {num(z?.available)}건 · +3% {pct(z?.targets?.['3']?.mean_pct)} / +5% {pct(z?.targets?.['5']?.mean_pct)}</p>})}</section>)}</>}
 <small>원본 관찰 기준 · 가격 도달은 실제 체결 아님 · 비용 미반영 · AI 판단의 정확도 평가와 별개</small></>}
 </>}
 </details>
}
export function ForwardSymbolResearch({code,day}:{code:string;day:string}){
 const [open,setOpen]=useState(false);const query='?'+new URLSearchParams({code,day}).toString();const {data,status,reload}=useForward(query,open);
 return <details className="fwd-panel fwd-symbol" onToggle={e=>setOpen(e.currentTarget.open)} onClick={e=>e.stopPropagation()}><summary>발견일 전진 성과 · 익절 비교</summary>
 {open&&<><small>{day} · {code} · 포착 이후 첫 시가 기준 (발견가/실제 계좌 수익과 다름)</small><button type="button" onClick={reload}>조회 갱신</button>{status&&<p role="status">{status}</p>}
 {!status&&data&&data.status!=='OK'&&<p>동일 날짜·종목의 확정 저장 자료 없음 (미포착·미도래·미저장 가능). 다른 날짜로 대체하지 않습니다.</p>}
 {data?.rows?.map((r:any)=><section key={r.horizon}><strong>{r.horizon}일 · {r.status==='OBSERVED'?'관측 완료':'경로 누락'}</strong><small>{r.entry_day} → {r.maturity_day} · {r.coverage==='PARTIAL_SYMBOL_PATHS'?'일부 종목 누락 집계':'경로 확인'}</small>
 {r.status==='OBSERVED'&&<><p>최고 {pct(r.opportunity?.high)} · 최저 {pct(r.opportunity?.low)} · 종가 {pct(r.opportunity?.close)}</p><p>+3% 최초 {r.opportunity?.target_days?.['3']??'미도달'} / +5% 최초 {r.opportunity?.target_days?.['5']??'미도달'} (관측일 순번)</p>
 {['SIGNAL_LOW','ATR14_SMA_1_5'].map(m=>{const z=r.exits?.[m];return <p key={m}>{m==='SIGNAL_LOW'?'신호봉 저가':'ATR 1.5'}: {z?.status==='READY'?['3','5'].map(t=>{const x=z.targets?.[t];return '+'+t+'% '+pct(x?.return_pct)+' ('+(why[x?.reason]??'미확인')+(x?.ambiguous?' · 순서 불명':'')+')'}).join(' / '):'손절 기준 미확인'}</p>})}</>}</section>)}
 <small>시뮬레이션 · 동일 일봉 양쪽 접촉 시 손절 우선 · 실제 체결 및 비용 미검증</small></>}
 </details>
}

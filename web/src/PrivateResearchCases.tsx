import {useEffect,useState} from 'react';
import {RECENT_ASOF} from './recent-pattern-data';
import './research-center.css';
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
type Stats={n:number;dates:number;stocks:number;up_pct:number|null;mean_pct:number|null;median_pct:number|null;payoff?:number|null;pf?:number|null;tail?:number|null;profile?:{payoff_ratio:number|null;profit_factor:number|null;worst_5pct_mean_pct:number}|null};
type Band={band:string;all:Stats;train:Stats;holdout:Stats};
type Horizon={complete:number;pending:number;missing:number;stats:Record<string,{all:Stats;train:Stats;holdout:Stats;research_status:string}>;bands:Record<string,Band[]>};
type Outcome={status:string;end_day:string|null;entry_day:string|null;entry_open:number|null;end_close:number|null;next_open_return:number|null;signal_close_return:number|null};
type Case={code:string;name:string|null;day:string;market:string;ohlc:{open:number;high:number;low:number;close:number};indicators:Record<string,number|string|boolean|null>;rsi_audit:{status:string;rsi?:number;signal?:number;prior_rsi?:number;prior_signal?:number;observations?:number};outcomes:Record<string,Outcome>};
type Data={status:string;asof:string;snapshot:string;source_sha256:string;factors_sha256:string;audit_sessions:number;signal_audit_sessions:number;quality:Record<string,number>;base:string;group:string;total:number;page:number;page_count:number;horizons:Record<string,Horizon>;rows:Case[]};
const fmt=(v:unknown,n=2)=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(n):'—';
const pct=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?(v>0?'+':'')+v.toFixed(2)+'%':'—';
const price=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v.toLocaleString('ko-KR')+'원':'—';
const tone=(v:unknown)=>typeof v==='number'?v>0?'rc-up':v<0?'rc-down':'':'';
const yes=(x:unknown)=>x===true?'일치 / 발생':x===false?'불일치 / 미발생':'미확인';
const auditLabel:Record<string,string>={INSUFFICIENT_AUDITED_HISTORY:'감사 일봉 120봉 미확보',STORED_VALUES_MISSING:'저장 값 미확인',APPROX_MATCH:'별도 계산 근사 일치',APPROX_DIFFERENCE:'별도 계산 차이',APPROX_BOUNDARY_UNCERTAIN:'교차 경계 판단 보류'};
const featureLabels:Record<string,string>={RSI:'발생 RSI',DELTA3:'3봉 RSI 변화',DELTA5:'5봉 RSI 변화',GAP:'RSI−시그널',PRIOR5_MIN:'직전 5봉 RSI 최저'};
const bandLabel=(x:string)=>({LT30:'30 미만','30_40':'30~40 미만','40_50':'40~50 미만','50_60':'50~60 미만','60_70':'60~70 미만',GE70:'70 이상',LE0:'0 이하','0_5':'0 초과~5 미만',GE5:'5 이상','0_2':'0 초과~2 미만',GE2:'2 이상',GE40:'40 이상',UNKNOWN:'미확인'} as Record<string,string>)[x]??x;
const state=(s:string)=>s==='COMPLETE'?'완료':s==='PENDING'?'미도래':'가격 경로 누락';
function StatsLine({s}:{s:Stats}){
 return <div className="rc-metrics"><div><span>표본</span><b>{s.n}건</b></div><div><span>평균 수익</span><b className={tone(s.mean_pct)}>{pct(s.mean_pct)}</b></div><div><span>상승 관측</span><b>{fmt(s.up_pct)}{s.up_pct===null?'':'%'}</b></div></div>;
}
function CaseCard({r,h,basis}:{r:Case;h:number;basis:string}){
 const x=r.outcomes[String(h)],i=r.indicators,ret=basis==='NEXT_OPEN'?x.next_open_return:x.signal_close_return;
 return <article className="rc-profit-row"><div className="rc-heading"><strong>{r.name||'종목명 미확인'} ({r.code})</strong><b className={tone(ret)}>{pct(ret)}</b></div><small>{r.day} · {r.market} · {state(x.status)}</small><div className="rc-metrics"><div><span>전봉 RSI</span><b>{fmt(i.prior_rsi)}</b></div><div><span>발생 RSI</span><b>{fmt(i.rsi_value,5)}</b></div><div><span>시그널선</span><b>{fmt(i.rsi_signal,5)}</b></div></div><small>GC {yes(i.rsi_gc)} · 역배열 {yes(i.ma_down)} · 직전 시그널 {fmt(i.prior_rsi_signal)} · RSI 차이 {fmt(i.rsi_gap)}</small>
 <details><summary>가격 및 지표 검증 근거</summary><dl className="rc-detail"><dt>신호일 시가 / 고가</dt><dd>{price(r.ohlc.open)} / {price(r.ohlc.high)}</dd><dt>신호일 저가 / 종가</dt><dd>{price(r.ohlc.low)} / {price(r.ohlc.close)}</dd><dt>다음 시가 ({x.entry_day??'—'})</dt><dd>{price(x.entry_open)}</dd><dt>종료 종가 ({x.end_day??'—'})</dt><dd>{price(x.end_close)}</dd><dt>다음 시가 수익률</dt><dd>{pct(x.next_open_return)}</dd><dt>신호 종가 수익률</dt><dd>{pct(x.signal_close_return)}</dd><dt>MA20 / 40 / 60</dt><dd>{fmt(i.ma20)} / {fmt(i.ma40)} / {fmt(i.ma60)}</dd><dt>3봉 / 5봉 RSI 변화</dt><dd>{fmt(i.rsi_delta3)} / {fmt(i.rsi_delta5)}</dd><dt>직전 5봉 RSI 최저</dt><dd>{fmt(i.rsi_prior5_min)}</dd><dt>거래대금 20봉 비율</dt><dd>{fmt(i.amount_ratio20)}배</dd><dt>당일 저장값 ↔ 차트</dt><dd>{yes(i.rsi_value_chart_consistent)}</dd><dt>교차값 일관성</dt><dd>{yes(i.rsi_cross_value_consistent)}</dd><dt>보관 차트 MA 일관성</dt><dd>{yes(i.ma_chart_consistent)}</dd><dt>감사 일봉 RSI 계산</dt><dd>{auditLabel[r.rsi_audit.status]??'미확인'}</dd>{r.rsi_audit.rsi!=null&&<><dt>재계산 RSI / 시그널</dt><dd>{fmt(r.rsi_audit.rsi,5)} / {fmt(r.rsi_audit.signal,5)}</dd><dt>재계산 관측일</dt><dd>{r.rsi_audit.observations}</dd></>}</dl><small>원본 저장 행 SHA-256: {i.record_sha256}</small><small>직전 RSI와 3·5봉 변화는 보관 차트 값(두 자리 반올림)을 이용합니다. 체결 수익이 아닙니다.</small></details></article>;
}
export default function PrivateResearchCases(){
 const [open,setOpen]=useState(false),[base,setBase]=useState('ENV20'),[group,setGroup]=useState('JOINT'),[page,setPage]=useState(0),[h,setH]=useState(3),[basis,setBasis]=useState('NEXT_OPEN'),[feature,setFeature]=useState('RSI'),[rev,setRev]=useState(0);
 const [snapshot,setSnapshot]=useState(''),[data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 // Snapshot is passed only for subsequent pages. The first page always reads
 // current head for the exact research date. A changed head is never mixed.
 useEffect(()=>{if(!open)return;const ctrl=new AbortController();setLoading(true);setError('');setData(null);
  const params=new URLSearchParams({asof:RECENT_ASOF,base,group,page:String(page)});if(page>0)params.set('snapshot',snapshot);
  fetch(API+'/api/research/private-combined-cases?'+params,{credentials:'include',cache:'no-store',signal:ctrl.signal}).then(async r=>{if(r.status===401)throw Error('Cloudflare Access 로그인이 필요합니다.');if(r.status===409)throw Error('연구 자료가 변경되었습니다. 첫 페이지로 다시 조회하세요.');if(!r.ok)throw Error('사례 자료 조회 실패 · API 배포 및 저장 상태 확인');return r.json();}).then((d:Data)=>{if(ctrl.signal.aborted)return;setData(d);if(page===0&&d.status==='READY')setSnapshot(d.snapshot);}).catch(e=>{if(!ctrl.signal.aborted)setError(e.message);}).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
  return()=>ctrl.abort();
 },[open,base,group,page,rev]); // snapshot belongs to the loaded first page; changing it alone must not refetch.
 const selected=data?.status==='READY'&&data.base===base&&data.group===group&&data.page===page?data:null;
 const result=selected?.horizons[String(h)],stats=result?.stats[basis]?.all;
 const bands=result?.bands[feature]??[];
 return <section className="rc-section"><details open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary><strong>개별 연구 사례 · RSI 세부 검증</strong><small>실제 종목·발생 날짜·진입 및 종료 가격·RSI 구간 비교</small></summary>
 {open&&<>
 <p className="rc-note">시장 전체 복합 연구의 실제 표본을 동일 조건으로 재구성한 자료입니다. {RECENT_ASOF} 기준, 인증된 화면 전용. 과거 관측 수익률이며 투자 추천이 아닙니다.</p>
 <div className="rc-filter"><label>패턴<select value={base} onChange={e=>{setBase(e.target.value);setPage(0);}}><option value="ENV20">엔벨20 중심선</option><option value="ENV20_LOWER_TOUCH">엔벨20 하단</option></select></label><label>조건<select value={group} onChange={e=>{setGroup(e.target.value);setPage(0);}}><option value="JOINT">장대양봉 + RSI GC + 역배열</option><option value="LONG_BULL_RSI_GC">장대양봉 + RSI GC (역배열 무관)</option><option value="LONG_BULL_NOT_JOINT">장대양봉 · 동시 미충족</option></select></label><label>진입 기준<select value={basis} onChange={e=>setBasis(e.target.value)}><option value="NEXT_OPEN">다음 시가</option><option value="SIGNAL_CLOSE">신호 종가</option></select></label></div>
 <div className="rc-periods">{[1,3,5,10,20].map(n=><button type="button" key={n} aria-pressed={h===n} onClick={()=>setH(n)}>{n}일</button>)}</div>
 <button type="button" className="rc-action" disabled={loading} onClick={()=>{setPage(0);setRev(v=>v+1);}}>첫 페이지 새로고침</button>
 {loading&&<p>사례 조회 중…</p>}{error&&<p role="alert">{error}</p>}
 {data?.status==='NOT_CAPTURED'&&<p>이 기준일의 검증 사례가 아직 저장되지 않았습니다. 사례 검증 Actions 실행 후 조회하세요.</p>}
 {selected&&result&&stats&&<>
 <small>감사 일봉 {selected.audit_sessions}일 · 신호 감사 {selected.signal_audit_sessions}일 · 전체 {selected.total}건 (완료 {result.complete} / 미도래 {result.pending} / 누락 {result.missing})</small><StatsLine s={stats}/>
 <small>중앙 {pct(stats.median_pct)} · 손익비 {fmt(stats.profile?.payoff_ratio)} · PF {fmt(stats.profile?.profit_factor)} · 하위 5% {pct(stats.profile?.worst_5pct_mean_pct)}</small>
 <small>개별 가격과 집계 재계산 일치 · 독립 RSI 원본 검증과 거래일·수정주가·비용 검증은 별개</small>
 {group!=='LONG_BULL_NOT_JOINT'&&<details open={undefined}><summary>RSI 구간별 성과 · 다음 시가 기준</summary><label>특징<select value={feature} onChange={e=>setFeature(e.target.value)}>{Object.entries(featureLabels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><p className="rc-note">사전에 고정한 구간입니다. 미확인 포함. 소표본과 후속 구간이 부족한 경우 유리한 조건으로 단정하지 않습니다.</p>{bands.map(b=><div className="rc-profit-row" key={b.band}><strong>{bandLabel(b.band)}</strong><StatsLine s={b.all}/><small>중앙 {pct(b.all.median_pct)} · 손익비 {fmt(b.all.payoff)} · PF {fmt(b.all.pf)} · 하위 5% {pct(b.all.tail)}</small><small>발굴 {b.train.n}건 / {pct(b.train.mean_pct)} · 후속 {b.holdout.n}건 / {pct(b.holdout.mean_pct)} · {b.all.n<30||b.all.dates<5||b.all.stocks<10?'표본 부족':'탐색적 관측'}</small></div>)}</details>}
 <h3>실제 사례 목록</h3><small>최신 신호일 순 · 성공·실패·미도래·누락 모두 포함 · 20건씩 조회</small>{selected.rows.map(r=><CaseCard key={r.day+'/'+r.code} r={r} h={h} basis={basis}/>)}
 <div className="rc-periods"><button type="button" disabled={page===0||loading} onClick={()=>setPage(v=>v-1)}>이전</button><small>{selected.page_count?page+1:0} / {selected.page_count}</small><button type="button" disabled={loading||page+1>=selected.page_count} onClick={()=>setPage(v=>v+1)}>다음</button></div>
 <details><summary>검증 원천 및 제한</summary><p>저장 지표 확인 {selected.quality.known_factor_stock_days??0} 종목·일. RSI 감사 일봉 부족 {selected.quality.rsi_audit_insufficient_audited_history??0}건 · 근사 일치 {selected.quality.rsi_audit_approx_match??0}건 · 근사 차이 {selected.quality.rsi_audit_approx_difference??0}건. 120개 이상 동일 종목 감사 관측일의 초기값 근사 재계산이며 거래일 완전성 및 외부 원천은 미확인입니다.</p><small>원천: {selected.source_sha256}<br/>지표: {selected.factors_sha256}<br/>검증 스냅샷: {selected.snapshot}</small></details>
 </>}
 </>}
 </details></section>;
}

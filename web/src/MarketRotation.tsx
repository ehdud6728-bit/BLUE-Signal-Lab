import {useEffect,useState} from 'react';
import MarketTrends from './MarketTrends';
import RotationLeaders from './RotationLeaders';
import {flowWindow} from './market-briefing';
type Sector={code:string;name:string;change_pct:number;relative_pct:number;turnover_share_pct:number|null;relative_delta_pp:number|null;share_delta_pp:number|null};
type Flow={day:string;foreign:string|null;institution:string|null;individual:string|null};
type Market={sector_coverage?:{received:number;accepted:number;summary_rows:number;excluded_rows:number;status:string};market:string;index:number;change_pct:number;up:number|null;down:number|null;flat:number|null;breadth_pct:number|null;sectors:Sector[];flow_status:string;flows:Flow[]};
type Snapshot={status:string;receipt_day:string;observed_at_utc:string;comparison_receipt_day:string|null;capture_days:number;state:string;markets:Market[]};
const fmt=(x:number|null,unit='%')=>x===null?'미확인':(x>0?'+':'')+x.toFixed(2)+unit;
const flow=(x:string|null)=>x==='BUY'?'순매수':x==='SELL'?'순매도':x==='FLAT'?'보합':'미확인';
const clock=(s:string)=>new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',dateStyle:'short',timeStyle:'short'}).format(new Date(s));
export default function MarketRotation({api}:{api:string}){
 const [data,setData]=useState<Snapshot|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[rev,setRev]=useState(0),[scope,setScope]=useState('KOSPI'),[sort,setSort]=useState('relative'),[all,setAll]=useState(false);
 useEffect(()=>{const ctrl=new AbortController();setLoading(true);setError('');fetch(api+'/api/research/market-rotation',{credentials:'include',cache:'no-store',signal:ctrl.signal}).then(r=>{if(!r.ok)throw Error('시장 자료 조회 실패');return r.json();}).then(d=>{if(!ctrl.signal.aborted)setData(d);}).catch(e=>{if(!ctrl.signal.aborted){setError(e.message);setData(null);}}).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});return()=>ctrl.abort();},[api,rev]);
 const ready=data?.status==='READY';
 const market=data?.markets?.find(m=>m.market===scope);
 const metric=(s:Sector)=>sort==='share'?s.turnover_share_pct:sort==='change'?s.relative_delta_pp:sort==='shareChange'?s.share_delta_pp:s.relative_pct;
 const sectors=[...(market?.sectors||[])].sort((a,b)=>(metric(b)??-Infinity)-(metric(a)??-Infinity)||a.code.localeCompare(b.code));
 const state=data?.state==='BROAD_ADVANCE_OBSERVED'?'두 시장 동반 상승 관측':data?.state==='BROAD_DECLINE_OBSERVED'?'두 시장 동반 하락 관측':data?.state==='STALE_RECEIPT'?'이전 수집 자료 · 현재 판단 보류':'혼조 또는 근거 부족';
 return <div className="blue-research">
 <div className="blue-pattern-heading"><strong>시장 브리핑 · 업종 순환매</strong><button type="button" disabled={loading} onClick={()=>setRev(x=>x+1)}>새로고침</button></div>
 {loading&&<p>저장된 시장 자료 조회 중…</p>}{error&&<p role="alert">{error}</p>}
 {!loading&&!error&&!ready&&<p className="blue-note">아직 KIS 시장 자료가 저장되지 않았습니다. 시장 수집 Actions를 실행해 주세요. 임의 수치를 표시하지 않습니다.</p>}
 {ready&&data&&<>
 <small>KIS 수집 시작 {clock(data.observed_at_utc)} · 시세 자체의 거래일/공표시각 미확인</small>
 <div className="blue-note"><strong>{state}</strong><p>규칙 기반 시황 초안입니다. 실제 지수·상승 종목 비율·수급 방향을 사용하며 생성형 AI 전망이나 미래 확률은 아닙니다.</p></div>
 {data.markets.map(m=><div className="blue-research-card" key={m.market}><strong>{m.market}</strong><div className="blue-metrics"><div className="blue-metric"><small>지수</small><b>{m.index.toLocaleString('ko-KR')}</b></div><div className="blue-metric"><small>전일 대비</small><b>{fmt(m.change_pct)}</b></div><div className="blue-metric"><small>상승 종목 비율</small><b>{m.breadth_pct===null?'미확인':m.breadth_pct.toFixed(1)+'%'}</b></div></div><p>상승 {m.up??'—'} · 하락 {m.down??'—'} · 보합 {m.flat??'—'}</p><small>투자자 일별 방향 · 금액 단위 검증 전</small>{[3,5,10].map(n=>{const f=flowWindow(m.flows,'foreign',n),i=flowWindow(m.flows,'institution',n);return <p key={n}>최근 {n}관측일 · 외국인 매수 {f.buy}/매도 {f.sell} · 기관 매수 {i.buy}/매도 {i.sell}{!f.complete||!i.complete?' · 일부 미확인':''}</p>})}{m.flows.length?m.flows.slice(0,5).map(f=><p key={f.day}>{f.day} · 외국인 {flow(f.foreign)} · 기관 {flow(f.institution)} · 개인 {flow(f.individual)}</p>):<p>수급 미확인</p>}</div>)}
 <div className="blue-research-card"><strong>향후 시나리오 및 대응 체크포인트</strong><p>반등 지속: 지수 상승과 상승 종목 확산, 주도 업종 강세 및 외국인 수급 개선이 함께 확인될 때 지속 여부를 검토합니다. 폭 축소·수급 반전은 반대 증거입니다.</p><p>횡보·바닥 확인: 지수와 시장 폭이 엇갈리거나 주도 업종이 반복 교체되면 추가 확인을 우선합니다. 직전 저점 이탈은 무효화 조건입니다.</p><p>재하락: 지수 하락과 하락 종목 확산, 외국인 순매도가 함께 이어지는지 확인합니다. 관찰 강화·위험 노출 축소 여부를 검토할 수 있습니다. 지수·폭 회복은 반대 증거입니다.</p><small>해외 지수·VIX는 아래의 별도 일봉 분석을 참고합니다. VIX 선물 구조 및 주요 경제 일정은 아직 미연동입니다.</small></div>
 <MarketTrends api={api} domestic={data.markets} domesticStale={data.state==='STALE_RECEIPT'}/>
 <RotationLeaders api={api}/>
 <strong>업종 상대강도 레이더</strong><p>시장 대비 등락률 차이(%p)와 KIS가 제공하는 거래대금 비중입니다. 비중은 순매수 금액이 아니며 업종 분류가 중복될 수 있습니다.</p>
 <div className="blue-periods">{['KOSPI','KOSDAQ'].map(m=><button type="button" key={m} aria-pressed={scope===m} onClick={()=>{setScope(m);setAll(false);}}>{m}</button>)}</div>
 {market?.sector_coverage&&<p className="blue-note">업종 응답 {market.sector_coverage.received}행 · 유효 {market.sector_coverage.accepted} · 시장 요약 제외 {market.sector_coverage.summary_rows} · 오류 제외 {market.sector_coverage.excluded_rows}{market.sector_coverage.status==='PARTIAL'?' · 일부 업종만 비교':''}</p>}
 <label>정렬 <select value={sort} onChange={e=>setSort(e.target.value)}><option value="relative">시장 대비 강도</option><option value="share">거래대금 비중</option><option value="change">직전 수집 대비 강도 변화</option><option value="shareChange">직전 수집 대비 비중 변화</option></select></label>
 <small>{data.comparison_receipt_day?'직전 수집일 '+data.comparison_receipt_day+' 비교 · 거래일 동일성 미검증':'비교할 이전 수집 자료 없음'} · 확보 수집일 {data.capture_days}일(최근 최대 6일)</small>
 {sectors.slice(0,all?100:10).map(s=><div className="blue-research-card" key={s.code}><strong>{s.name} <small>{s.code}</small></strong><div className="blue-metrics"><div className="blue-metric"><small>등락률</small><b>{fmt(s.change_pct)}</b></div><div className="blue-metric"><small>시장 대비</small><b>{fmt(s.relative_pct,'%p')}</b></div><div className="blue-metric"><small>거래대금 비중</small><b>{s.turnover_share_pct===null?'미확인':s.turnover_share_pct.toFixed(2)+'%'}</b></div></div><p>강도 변화 {fmt(s.relative_delta_pp,'%p')} · 비중 변화 {fmt(s.share_delta_pp,'%p')}</p></div>)}
 {sectors.length>10&&<button type="button" onClick={()=>setAll(x=>!x)}>{all?'상위 10개만':'전체 업종 보기'}</button>}
 <p className="blue-note">대장주·후발주 관찰은 위의 별도 분석을 참고합니다. 테마 분류, 선후행 및 순환매 성공률은 미검증입니다. 현재 상대강도 순위는 관찰 자료로만 활용합니다.</p>
 </>}
 </div>;
}

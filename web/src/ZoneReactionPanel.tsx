import {useState} from 'react';
import './zone-reaction-panel.css';

type Result='BREAKOUT'|'PULLBACK'|'UNDECIDED';
type OutcomeCounts=Record<Result,number>;
type Rates=Record<Result,number|null>;
type Case={date:string;grade:string;zone_low:number;zone_high:number;entry_close:number;result:Result;result_day:string};
type Horizon={n:number;counts:OutcomeCounts;rates_pct:Rates;sample_status:'EXPLORATORY_FREQUENCY'|'INSUFFICIENT_SAMPLE';breakout_wilson95_pct:number[]|null;pullback_wilson95_pct:number[]|null;recent_holdout?:{n:number;counts:OutcomeCounts}|null;cases?:Case[]};
type Cohort={label:string;horizons:Record<'5'|'10',Horizon>};
export type ZoneReactionStats={version:string;asof:string;status:string;
  current:{close:number;zone_low:number;zone_high:number;grade:string;distance_to_lower_pct:number;near:boolean}|null;
  criteria:{min_rate_sample:number;approach_from_lower_pct:number;breakout_above_upper_pct:number;pullback_below_entry_pct:number;breakout_confirm_closes:number;dedup_sessions:number};
  cohorts:{same_grade?:Cohort;all?:Cohort};limitations:string[];events_seen?:number};
const outcomes:[Result,string,string][]=[
  ['BREAKOUT','돌파 안착','#237f73'],['PULLBACK','저항·눌림','#bc7058'],['UNDECIDED','방향 미정','#8490a2']
];
const money=(v:number)=>Math.round(v).toLocaleString('ko-KR')+'원';
const fmt=(v:number)=>v.toLocaleString('ko-KR',{maximumFractionDigits:1});
export default function ZoneReactionPanel({data}:{data:ZoneReactionStats|null}){
  const [horizon,setHorizon]=useState<'5'|'10'>('5');
  const [cohort,setCohort]=useState<'same_grade'|'all'>('same_grade');
  const sameActive=Boolean(data?.current);
  const activeCohort=sameActive?cohort:'all';
  const selected=data?.cohorts?.[activeCohort]?.horizons?.[horizon];
  return <section className="blue-reaction-panel" aria-label="매물대 돌파 및 눌림 과거 사례 검증">
    <div className="blue-reaction-head">
      <div><h4>매물대 돌파·눌림 과거 검증</h4><small>과거 같은 종목의 확정 일봉 · 미래 확률 예측 아님</small></div>
      <span className="blue-reaction-tag">연구 단계</span>
    </div>
    {!data&&<p className="blue-reaction-info">이 날짜의 저장된 분석에는 매물대 반응 통계가 없습니다. R1.5.10.11로 해당 날짜의 일봉을 재분석·저장해야 표시됩니다.</p>}
    {data&&<>
      <div className="blue-reaction-current">
        {data.current?<>
          <div><span>현재 상단 매물대 구간</span><b>{money(data.current.zone_low)}~{money(data.current.zone_high)}</b></div>
          <div><span>거래량 밀집</span><b>{data.current.grade} · {data.current.near?'접근 범위':'접근 범위 밖'}</b></div>
        </>:<p>현재 날짜에 확인 가능한 상단 매물대가 없습니다. 결과를 매매 신호로 해석하지 마세요.</p>}
      </div>
      <div className="blue-reaction-controls">
        <div role="group" aria-label="관찰 기간">
          {(['5','10'] as const).map(x=><button type="button" key={x} className={horizon===x?'selected':''}
            aria-pressed={horizon===x} onClick={()=>setHorizon(x)}>{x}거래일</button>)}
        </div>
        <div role="group" aria-label="비교 집단">
          <button type="button" aria-pressed={activeCohort==='same_grade'} className={activeCohort==='same_grade'?'selected':''}
            disabled={!sameActive} onClick={()=>setCohort('same_grade')}>같은 강중약</button>
          <button type="button" aria-pressed={activeCohort==='all'} className={activeCohort==='all'?'selected':''}
            onClick={()=>setCohort('all')}>전체 사례</button>
        </div>
      </div>
      {selected?<>
        <p className="blue-reaction-sample">비교 가능한 확정 사례 <strong>{selected.n}건</strong> · {selected.sample_status==='INSUFFICIENT_SAMPLE'?'표본 부족: 비율 미표시':'과거 관측 빈도(탐색적)'}</p>
        <div className="blue-reaction-metrics">
          {outcomes.map(([key,label,color])=>{
            const pct=selected.rates_pct[key];
            return <div className="blue-reaction-metric" key={key}>
              <div className="blue-reaction-metric-head"><span style={{color}}>{label}</span><b>{pct===null||pct===undefined?'검증 부족':fmt(pct)+'%'}</b></div>
              <div className="blue-reaction-track"><span style={{width:`${pct===null||pct===undefined?0:pct}%`,background:color}}/></div>
              <small>{selected.counts[key]}건 / {selected.n}건</small>
            </div>;
          })}
        </div>
        {selected.n>=data.criteria.min_rate_sample&&<p className="blue-reaction-interval">
          돌파 비율 95% Wilson 구간: {selected.breakout_wilson95_pct?.map(fmt).join('~')}% ·
          눌림 비율 95% Wilson 구간: {selected.pullback_wilson95_pct?.map(fmt).join('~')}%
        </p>}
        {selected.recent_holdout&&<p className="blue-reaction-interval">최근 시기 분리 사례 {selected.recent_holdout.n}건 · 돌파 {selected.recent_holdout.counts.BREAKOUT} / 눌림 {selected.recent_holdout.counts.PULLBACK} / 미정 {selected.recent_holdout.counts.UNDECIDED}건 (독립 검증 아님)</p>}
        {selected.cases&&selected.cases.length>0&&<details className="blue-reaction-cases">
          <summary>실제 과거 사례 날짜 보기 ({selected.cases.length}건)</summary>
          <div className="blue-reaction-case-table"><table><thead><tr><th>접근일</th><th>밀집</th><th>관측 결과</th><th>판정일</th></tr></thead>
            <tbody>{selected.cases.map(c=><tr key={c.date}><td>{c.date}</td><td>{c.grade}</td><td>{c.result==='BREAKOUT'?'돌파 안착':c.result==='PULLBACK'?'눌림':'미정'}</td><td>{c.result_day}</td></tr>)}</tbody></table></div>
        </details>}
      </>:<p className="blue-reaction-info">이 비교 집단의 저장된 이력이 없습니다.</p>}
      <p className="blue-reaction-method">판정: 과거 접근일마다 그 이전 120일봉으로 추정한 상단 매물대에 3% 이내 접근 → 이후 {horizon}거래일 동안 상단 +0.5%를 종가로 2일 연속 유지하면 돌파, 접근 당시 종가 대비 -3% 종가 하락을 먼저 기록하면 눌림, 아니면 미정. 사례 간 11거래일 간격을 두었습니다.</p>
      <p className="blue-reaction-warning">이 비율은 미래 돌파 확률이 아닙니다. 일봉 고가~저가에 거래량을 균등 분배한 추정치이고, 실제 잔여 매도 물량·시장상황·기업행동을 반영하지 않습니다. 과거 통계가 좋아도 돌파를 보장하지 않습니다.</p>
    </>}
  </section>;
}

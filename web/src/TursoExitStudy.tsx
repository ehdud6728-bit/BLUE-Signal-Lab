import {useEffect,useState} from 'react';
import {BarChart3,AlertCircle} from 'lucide-react';
import './turso-exit-study.css';

type Stats={status:string;n?:number;median_net_return_pct?:number;mean_holding_sessions?:number;
  take_count?:number;stop_count?:number;time_count?:number};
type Policy={pattern:string;policy:string;mature_count:number;
  training:Stats;holdout:Stats;eligible_for_research_watchlist:boolean};
type Window={sessions:number;archive_complete:boolean;start_day:string|null;
  candidate_policies:number;exploratory_examples?:Policy[];
  research_only_best_policies:Policy[];watchlist_allowed:boolean};
type PathPattern={pattern:string;n:number;median_max_gain_pct:number;median_max_loss_pct:number;
  low_first_count:number;high_first_count:number;same_session_unresolved_count:number};
type PathWindow={holding_sessions:number;audited_date_count_sufficient:boolean;
  mature_signal_stock_days:number;pending_recent:number;excluded_missing_price_path:number;
  pattern_count_with_3_or_more:number;patterns:PathPattern[];
  same_session_order_knowable:false;investment_recommendation_enabled:false};
type Report={schema:'BLUE_TURSO_PATTERN_EXIT_REPORT_V1';asof_day:string;
  eod_audited_days:number;research_audited_days:number;signal_stock_days:number;
  short_and_long_windows:Window[];observed_path_windows?:PathWindow[];
  investment_recommendation_enabled:false;note:string};
type Response={storage:'TURSO';status:'NOT_PUBLISHED'|'EXPLORATORY_ONLY';
  report:Report|null;note:string};

export default function TursoExitStudy({api,active}:{api:string;active:boolean}){
  const [data,setData]=useState<Response|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!active)return;
    const ctrl=new AbortController();setBusy(true);setError('');setData(null);
    void fetch(api+'/api/research/exit-study',{credentials:'include',cache:'no-store',signal:ctrl.signal})
      .then(async result=>{
        if(!result.ok)throw Error(`청산 연구 조회 실패 (HTTP ${result.status})`);
        const json=await result.json() as Response;
        if(json.storage!=='TURSO'||!['NOT_PUBLISHED','EXPLORATORY_ONLY'].includes(json.status)||
          (json.report!==null&&(json.report?.investment_recommendation_enabled!==false||
            !Array.isArray(json.report?.short_and_long_windows))))
          throw Error('청산 연구 데이터 검증 실패');
        if(!ctrl.signal.aborted)setData(json);
      }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'조회 오류');})
      .finally(()=>{if(!ctrl.signal.aborted)setBusy(false);});
    return()=>ctrl.abort();
  },[api,active]);
  const report=data?.report;
  return <section className="turso-exit-study" aria-label="패턴 익절 손절 기간별 연구">
    <div className="turso-exit-head"><BarChart3 size={18}/><div>
      <h3>패턴 성과·익절·손절 연구</h3>
      <p>5·10·20·60일 변화와 120·250·500일 장기 비교 · 검증된 사례만</p>
    </div></div>
    {busy&&<p role="status">저장된 청산 연구 결과를 조회하고 있습니다…</p>}
    {error&&<p role="alert" className="turso-exit-error"><AlertCircle size={14}/>{error}</p>}
    {data?.status==='NOT_PUBLISHED'&&<p className="turso-exit-empty">
      연구 결과가 아직 게시되지 않았습니다. 과거 확정 일봉과 신호를 확보한 뒤
      익절·손절 결과를 계산·검증합니다. 현재는 추천을 제공하지 않습니다.</p>}
    {report&&<>
      <p className="turso-exit-summary">기준일 <strong>{report.asof_day}</strong>
        {' · '}일봉 감사 <strong>{report.eod_audited_days}일</strong>
        {' · '}신호 연구 <strong>{report.research_audited_days}일</strong></p>
      <div className="turso-exit-windows">
        {report.short_and_long_windows.map(w=><div className="turso-exit-window" key={w.sessions}>
          <strong>{w.sessions}거래일</strong>
          <span>{w.archive_complete?'원장 날짜 수 확보':'연구 날짜 부족'}</span>
          <small>{w.research_only_best_policies.length>0?
            `학습표본 기준 정책 ${w.research_only_best_policies.length}개 · 독립검증 전`:
            '검증된 익절·손절 정책 없음'}</small>
        </div>)}
      </div>
      <div className="turso-path-title">
        <strong>패턴별 D+5·10·20·60거래일 최고·최저 관측</strong>
        <small>신호일 다음 거래일 시가 기준 · 고가/저가의 실제 체결 수익 아님</small>
      </div>
      {!report.observed_path_windows?.length?<p className="turso-exit-empty">현재 게시된 연구에는 기간별 최고·최저 관측 결과가 없습니다. 새 연구 보고서를 게시해야 표시됩니다.</p>:
       <div className="turso-path-grid">{report.observed_path_windows.map(w=><article key={w.holding_sessions} className="turso-path-card">
         <strong>D+{w.holding_sessions}거래일</strong>
         <small>관측 완료 {w.mature_signal_stock_days}건 · 최근 미성숙 {w.pending_recent}건 · 가격 경로 누락 {w.excluded_missing_price_path}건</small>
         {!w.patterns.length?<p>표본 3건 이상인 패턴이 없습니다.</p>:<details>
          <summary>패턴별 상승·하락 폭 {w.pattern_count_with_3_or_more}종류 보기</summary>
          {w.patterns.map(p=><div key={p.pattern} className="turso-path-pattern">
            <b>{p.pattern.replace(/^BB/,'BLUE')} · {p.n}건</b>
            <span>중앙 최고 <strong className="turso-path-rise">+{p.median_max_gain_pct.toFixed(2)}%</strong>
             {' · '}중앙 최저 <strong className="turso-path-fall">{p.median_max_loss_pct.toFixed(2)}%</strong></span>
            <small>저가 먼저 {p.low_first_count} · 고가 먼저 {p.high_first_count} · 동일일 선후 불명 {p.same_session_unresolved_count}</small>
          </div>)}
         </details>}
       </article>)}</div>}
      <p className="turso-exit-caveat">최고가·최저가의 날짜가 다르면 날짜 순서만 비교합니다. 같은 거래일의 두 가격은 일봉만으로 선후 관계를 알 수 없습니다. 수집 중단·기업행동 미검증 자료는 결과에서 제외하거나 탐색 자료로 표시합니다.</p>
      {report.short_and_long_windows.filter(w=>(w.exploratory_examples?.length||0)>0)
        .slice(0,2).map(w=><div key={w.sessions} className="turso-exit-example">
          <strong>{w.sessions}일 탐색 사례 · 출현 건수순 (수익률 순위 아님)</strong>
          {(w.exploratory_examples||[]).slice(0,3).map(p=><p key={`${p.pattern}:${p.policy}`}>
            {p.pattern.replace(/^BB/,'BLUE')} · {p.policy} · 성숙 {p.mature_count}건
            {' · '}익절·손절 비교 표본 (독립 검증 미완료)
          </p>)}
        </div>)}
      <p className="turso-exit-warning">{report.note}</p>
    </>}
    <p className="turso-exit-caveat">이 화면은 검증 절차가 진행 중인 연구입니다.
      수익 가능성·승률 예측·매수 추천·확정 목표가를 생성하지 않습니다.</p>
  </section>;
}

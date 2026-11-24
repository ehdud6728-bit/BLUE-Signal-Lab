import MarketBrief from './MarketBrief';
import {useEffect,useState} from 'react';
import {Database,ShieldCheck,Activity,AlertCircle} from 'lucide-react';
import TursoPatternPulse from './TursoPatternPulse';
import TursoExitStudy from './TursoExitStudy';
import './turso-ai-readiness.css';

type AuditCount={audited_days:number;first_day:string|null;last_day:string|null;declared_rows:number};
type Coverage={storage:'TURSO';status:'AUDIT_COUNTS_ONLY';eod:AuditCount;research:AuditCount;
  readiness:'INSUFFICIENT_FOR_RECENT_EXIT_RESEARCH'|'GAP_AND_OUTCOME_VALIDATION_REQUIRED';
  goals:{rolling_windows:number[];eod_audited_days_min:number;research_audited_days_min:number;
    history_target_days:number};note:string};

export default function TursoAiReadiness({api,active}:{api:string;active:boolean}){
  const [coverage,setCoverage]=useState<Coverage|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!active)return;
    const ctrl=new AbortController();setBusy(true);setError('');
    void fetch(api+'/api/research/coverage',{credentials:'include',cache:'no-store',signal:ctrl.signal})
      .then(async response=>{
        if(!response.ok)throw Error(`Turso 연구 이력 조회 실패 (HTTP ${response.status})`);
        const result=await response.json() as Coverage;
        if(result.storage!=='TURSO'||result.status!=='AUDIT_COUNTS_ONLY'||
          !Number.isSafeInteger(result.eod?.audited_days)||
          !Number.isSafeInteger(result.research?.audited_days))throw Error('연구 이력 응답 검증 실패');
        if(!ctrl.signal.aborted)setCoverage(result);
      }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'조회 오류');})
      .finally(()=>{if(!ctrl.signal.aborted)setBusy(false);});
    return()=>ctrl.abort();
  },[api,active]);
  const eod=coverage?.eod,research=coverage?.research;
  return <section className="turso-ai-readiness" aria-label="Turso 기반 AI 연구 준비 상태">
    <div className="turso-ai-ready-head"><Activity size={20}/>
      <div><h2>최근 패턴 AI 분석·관찰 후보</h2>
        <p>검증된 역사적 데이터가 충분히 쌓이기 전에는 AI 추천을 강제로 생성하지 않습니다.</p></div>
    </div>
    <MarketBrief/>
    {busy&&<p role="status">Turso 감사 원장의 저장 기간을 확인하고 있습니다…</p>}
    {error&&<p className="turso-ai-readiness-error" role="alert"><AlertCircle size={15}/>{error}</p>}
    {coverage&&<>
      <div className="turso-ai-metrics">
        <div><Database size={17}/><span>일봉 감사 원장 등록일</span><strong>{eod?.audited_days.toLocaleString('ko-KR')}일</strong>
          <small>{eod?.first_day||'—'} ~ {eod?.last_day||'—'}</small></div>
        <div><ShieldCheck size={17}/><span>패턴 연구 원장 등록일</span><strong>{research?.audited_days.toLocaleString('ko-KR')}일</strong>
          <small>{research?.first_day||'—'} ~ {research?.last_day||'—'}</small></div>
      </div>
      <p className="turso-ai-sufficiency" role="status">
        {coverage.readiness==='INSUFFICIENT_FOR_RECENT_EXIT_RESEARCH'?
          '초단기 5·10일 변화 관찰과 장기 성과 검증은 구분합니다. 익절·손절 추천을 확정할 만큼의 장기·성숙 표본은 아직 부족합니다.':
          '일별 감사 건수의 1차 기준을 충족했습니다. 누락 거래일·미완성 후속 성과·표본 편향을 검증해야 합니다.'}
      </p>
      <p className="turso-ai-coverage-note">{coverage.note}</p>
    </>}
    <TursoPatternPulse api={api} active={active}/>
    <TursoExitStudy api={api} active={active}/>
    <h3>다음 분석 범위</h3>
    <ol className="turso-ai-next">
      <li>과거 1~2년 전체 종목 확정 일봉을 누락·원천·기업행동 기준으로 검증</li>
      <li>초단기 5·10일, 단기 20·60일과 장기 120·250·500일 패턴 효과 비교</li>
      <li>다음 거래일 시가 진입, 익절·손절·최대 보유기간 중 첫 도달 검증</li>
      <li>최근 발생 신호와 이미 성과가 확정된 사례를 분리하고, 시장·업종 국면 및 비용을 검증한 뒤 AI 관찰 후보 제공</li>
    </ol>
    <p className="turso-ai-coverage-note">시장 브리핑은 감사된 일봉의 규칙 기반 관측이며, 추천 점수·예상 수익·미래 시장 확률을 생성하지 않습니다. D1의 기존 AI 결과를 대신 가져오지 않습니다.</p>
  </section>;
}

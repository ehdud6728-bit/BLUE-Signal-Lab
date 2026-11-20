import {useEffect,useState} from 'react';
import {Activity,AlertCircle} from 'lucide-react';
import './turso-pattern-pulse.css';

type Day={day:string;matched:number;observed:number;events:number};
type Pattern={name:string;recent_occurrences:number;recent_per_1000_stock_days:number;
  previous_occurrences:number|null;previous_per_1000_stock_days:number|null;
  relative_change_pct:number|null};
type Pulse={storage:'TURSO';status:'AUDITED_PATTERN_ACTIVITY'|
    'PARTIAL_PATTERN_ACTIVITY'|'NO_AUDITED_RESEARCH';
  recent_days:Day[];prior_days:Day[];patterns:Pattern[];
  baseline_complete:boolean;outcomes_verified:false;session_continuity_verified?:false;note:string};

export default function TursoPatternPulse({api,active}:{api:string;active:boolean}){
  const [data,setData]=useState<Pulse|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!active)return;
    const ctrl=new AbortController();setBusy(true);setError('');setData(null);
    void fetch(api+'/api/research/pulse',{credentials:'include',cache:'no-store',signal:ctrl.signal})
      .then(async res=>{
        if(!res.ok)throw Error(`패턴 출현 이력 조회 실패 (HTTP ${res.status})`);
        const payload=await res.json() as Pulse;
        if(payload.storage!=='TURSO'||!Array.isArray(payload.recent_days)||
          !Array.isArray(payload.patterns)||payload.outcomes_verified!==false||
          !['AUDITED_PATTERN_ACTIVITY','PARTIAL_PATTERN_ACTIVITY','NO_AUDITED_RESEARCH']
            .includes(payload.status))throw Error('패턴 출현 응답 검증 실패');
        if(!ctrl.signal.aborted)setData(payload);
      }).catch(e=>{if(!ctrl.signal.aborted)setError(e instanceof Error?e.message:'조회 오류');})
      .finally(()=>{if(!ctrl.signal.aborted)setBusy(false);});
    return()=>ctrl.abort();
  },[api,active]);
  const matched=data?.recent_days.reduce((sum,d)=>sum+d.matched,0)||0;
  return <section className="turso-pattern-pulse" aria-label="최근 다섯 연구일 패턴 출현 현황">
    <div className="turso-pulse-head"><Activity size={18}/>
      <div><h3>최근 패턴 발생 현황</h3>
        <p>최근 감사된 연구일 최대 5일 기준 · 매매 성과가 아닌 출현 빈도</p></div>
    </div>
    {busy&&<p role="status">최근 패턴 원장을 확인하고 있습니다…</p>}
    {error&&<p role="alert" className="turso-pulse-error"><AlertCircle size={15}/>{error}</p>}
    {data&&<>
      <p className="turso-pulse-summary">연구일 <strong>{data.recent_days.length}/5일</strong>
        {' · '}패턴 일치 종목·일 <strong>{matched.toLocaleString('ko-KR')}건</strong>
        {' · '}기준일 <strong>{data.recent_days[0]?.day||'—'}</strong></p>
      {data.patterns.length>0?<ol className="turso-pulse-ranking">
        {data.patterns.slice(0,10).map(p=><li key={p.name}>
          <span className="turso-pulse-pattern">{p.name.replace(/^BB/,'BLUE')}</span>
          <span className="turso-pulse-count"><strong>{p.recent_occurrences.toLocaleString('ko-KR')}회</strong>
            <small>전체 관찰 1,000종목·일당 {p.recent_per_1000_stock_days.toFixed(1)}회</small></span>
          {data.baseline_complete&&<span className="turso-pulse-prior">
            이전 감사 연구일 5개 {p.previous_occurrences??0}회
            {p.relative_change_pct!==null&&` · 빈도 변화 ${p.relative_change_pct>0?'+':''}${p.relative_change_pct.toFixed(1)}%`}
          </span>}
        </li>)}</ol>:<p>아직 저장된 패턴 출현 사례가 없습니다.</p>}
      {!data.baseline_complete&&<p className="turso-pulse-warning">
        이전 감사 연구일 5개가 확보되지 않아 증가·감소 추세를 판단하지 않습니다.</p>}
      <p className="turso-pulse-note">{data.note}</p>
    </>}
  </section>;
}

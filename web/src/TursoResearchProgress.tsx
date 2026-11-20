import {useEffect,useState} from 'react';
import {AlertCircle,CheckCircle2,Clock3,ExternalLink,RefreshCw} from 'lucide-react';
import {formatTursoElapsed,TURSO_PROGRESS_STEPS,tursoStepState,
  type TursoProgressStage} from './turso-research-progress';
import './turso-research-progress.css';

type Props={day:string;stage:TursoProgressStage;info:string;actionsUrl:string;
  startedAt:number;finishedAt:number;onViewResults:()=>void};

export default function TursoResearchProgress({day,stage,info,actionsUrl,startedAt,
  finishedAt,onViewResults}:Props){
  const [clock,setClock]=useState(Date.now());
  const running=stage!=='READY'&&stage!=='FAILED';
  useEffect(()=>{
    if(!running||!startedAt)return;
    setClock(Date.now());
    const timer=window.setInterval(()=>setClock(Date.now()),1000);
    return()=>window.clearInterval(timer);
  },[running,startedAt]);
  const elapsed=startedAt>0?Math.max(0,Math.floor(((finishedAt||clock)-startedAt)/1000)):null;
  const title=stage==='READY'?'패턴 분석 완료':stage==='FAILED'?'분석 요청·진행 실패':'패턴 분석 진행 중';
  const stageName=stage==='EOD'?'KRX 일봉을 수집·검증하고 있습니다.':
    stage==='RESEARCH'?'전체시장 패턴을 분석하고 있습니다.':
    stage==='SAVING'?'분석 결과를 Turso에 저장하고 있습니다.':
    stage==='VERIFYING'?'저장된 데이터의 완료 여부를 확인하고 있습니다.':
    stage==='QUEUED'?'GitHub 작업 시작을 기다리는 중입니다.':
    stage==='RUNNING'?'GitHub 작업 실행 중 · 세부 단계 확인 중입니다.':
    stage==='REQUESTED'?'분석 요청 접수 상태를 확인하고 있습니다.':' ';
  return <section className={'turso-progress-card '+(stage==='FAILED'?'turso-progress-error':stage==='READY'?'turso-progress-done':'')}
    aria-label={`${day} 분석 진행 상태`}>
    <div className="turso-progress-head">
      {stage==='READY'?<CheckCircle2 size={21}/>:stage==='FAILED'?<AlertCircle size={21}/>:<RefreshCw size={21} className="r1581-pending"/>}
      <div role="status" aria-live="polite">
        <strong>{day} · {title}</strong>
        <span>{stageName.trim()||info}</span>
      </div>
      {elapsed!==null&&<div className="turso-progress-time" aria-live="off"><Clock3 size={13}/>
        <span>{formatTursoElapsed(elapsed)}</span></div>}
    </div>
    <ol className="turso-progress-steps" aria-label="확인된 분석 단계">
      {TURSO_PROGRESS_STEPS.map((step,index)=>{
        const state=tursoStepState(stage,index);
        return <li key={step} className={'turso-progress-step is-'+state}>
          <span className="turso-progress-dot" aria-hidden="true">{state==='done'?'✓':index+1}</span>
          <span>{step}</span>
        </li>;
      })}
    </ol>
    <p className="turso-progress-info">{info||'15초마다 실행 결과를 확인합니다.'}</p>
    <div className="turso-progress-footer">
      <small>{running?'15초마다 자동 확인 · 보통 수 분 소요 · 화면을 닫아도 서버 작업은 계속됩니다.':
        stage==='READY'?'저장된 결과를 검색에 반영합니다.':'검색 버튼을 눌러 다시 요청할 수 있습니다.'}</small>
      {actionsUrl&&<a href={actionsUrl} target="_blank" rel="noopener noreferrer">
        실행 기록 <ExternalLink size={13}/></a>}
      {stage==='READY'&&<button type="button" onClick={onViewResults}>결과 다시 보기</button>}
    </div>
  </section>;
}

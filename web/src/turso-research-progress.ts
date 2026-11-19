export type TursoProgressStage = 'REQUESTED'|'QUEUED'|'RUNNING'|'EOD'|
  'RESEARCH'|'SAVING'|'VERIFYING'|'READY'|'FAILED';

export const TURSO_PROGRESS_STEPS=[
  '분석 요청', '일봉 수집·검증', '시장 패턴 분석', 'Turso 저장·확인',
] as const;

// Status is advanced only by server-reported GitHub steps, not by an
// estimated percentage or a clock-based assumption.
export function tursoStepState(stage:TursoProgressStage,index:number):'done'|'active'|'waiting'{
  if(stage==='READY')return 'done';
  if(stage==='FAILED')return 'waiting';
  if(index===0)return 'done';
  const active=stage==='EOD'?1:stage==='RESEARCH'?2:
    stage==='SAVING'||stage==='VERIFYING'?3:0;
  return index<active?'done':index===active?'active':'waiting';
}

export function formatTursoElapsed(seconds:number){
  if(!Number.isFinite(seconds)||seconds<0)return '확인 중';
  const value=Math.floor(seconds);
  const hours=Math.floor(value/3600),minutes=Math.floor(value%3600/60),secs=value%60;
  return hours>0?`${hours}시간 ${String(minutes).padStart(2,'0')}분`:
    `${minutes}분 ${String(secs).padStart(2,'0')}초`;
}

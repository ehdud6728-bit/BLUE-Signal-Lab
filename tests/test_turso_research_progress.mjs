import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatTursoElapsed,tursoStepState,TURSO_PROGRESS_STEPS}
  from '../web/src/turso-research-progress.ts';

test('progress step states only advance when the server confirms a phase',()=>{
  assert.equal(TURSO_PROGRESS_STEPS.length,4);
  for(const stage of ['REQUESTED','QUEUED','RUNNING']){
    assert.deepEqual([0,1,2,3].map(index=>tursoStepState(stage,index)),
      ['done','waiting','waiting','waiting']);
  }
  assert.deepEqual([0,1,2,3].map(index=>tursoStepState('EOD',index)),
    ['done','active','waiting','waiting']);
  assert.deepEqual([0,1,2,3].map(index=>tursoStepState('RESEARCH',index)),
    ['done','done','active','waiting']);
  assert.deepEqual([0,1,2,3].map(index=>tursoStepState('SAVING',index)),
    ['done','done','done','active']);
  assert.deepEqual([0,1,2,3].map(index=>tursoStepState('VERIFYING',index)),
    ['done','done','done','active']);
  assert.deepEqual([0,1,2,3].map(index=>tursoStepState('READY',index)),
    ['done','done','done','done']);
  assert.deepEqual([0,1,2,3].map(index=>tursoStepState('FAILED',index)),
    ['waiting','waiting','waiting','waiting']);
});

test('elapsed time shows wall-clock duration without inventing percentages',()=>{
  assert.equal(formatTursoElapsed(249),'4분 09초');
  assert.equal(formatTursoElapsed(0),'0분 00초');
  assert.equal(formatTursoElapsed(3661),'1시간 01분');
  assert.equal(formatTursoElapsed(-1),'확인 중');
});

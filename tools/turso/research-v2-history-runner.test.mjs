import test from 'node:test';
import assert from 'node:assert/strict';
import {runTargetedHistory} from './research-v2-history-runner.mjs';

const env={TURSO_DATABASE_URL:'libsql://example.test',TURSO_AUTH_TOKEN:'fake',
  KIS_APP_KEY:'redacted',KIS_APP_SECRET:'redacted'};
const args=['--plan=tmp/plan.json','--anchor-eod-dir=tmp/first/eod','--out=tmp/out'];

test('read-only token lookup, no token issuance or logs, Python receives only process env',async()=>{
  let selects=0;let childToken='';let closed=0;
  const result=await runTargetedHistory(env,args,{
    createClient:()=>({close(){closed++}}),
    cachedToken:async(client)=>{selects++;return {token:'already-issued'};},
    runPython:async(childEnv)=>{childToken=childEnv.BLUE_RESEARCH_KIS_TOKEN;},
  });
  assert.equal(selects,1);
  assert.equal(closed,1);
  assert.equal(childToken,'already-issued');
  assert.equal(result.db_writes,0);
  assert.equal(result.token_logged,false);
});

test('missing cached KIS token does not mint tokenP; primary KRX still allowed',async()=>{
  let childToken='not-empty';
  await runTargetedHistory(env,args,{
    createClient:()=>({close(){}}),
    cachedToken:async()=>({status:'EXPIRED',token:null}),
    runPython:async(childEnv)=>{childToken=childEnv.BLUE_RESEARCH_KIS_TOKEN;},
  });
  assert.equal(childToken,'');
});

test('rejects arbitrary arguments before connecting',async()=>{
  await assert.rejects(runTargetedHistory(env,['--mode=apply','--anchor-eod-dir=tmp/first/eod','--out=tmp'],{
    createClient:()=>{throw Error('MUST_NOT_CONNECT');},
  }),/TARGETED_HISTORY_ARGUMENTS_INVALID/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {auditQuoteParity} from './quote-parity-audit.mjs';

const now=new Date('2026-11-19T07:00:00.000Z');
const record=(code='005930')=>({trade_date:'2026-11-19',market:'J',code,
  received_at_utc:'2026-11-19T06:51:11.341Z',price:70000,volume:103,phase:'KRX_REGULAR'});
const client=(rows)=>({execute:async q=>{
  assert.match(q.sql,/^SELECT trade_date,market,code,received_at_utc/);
  assert.match(q.sql,/LIMIT \?/);
  assert.deepEqual(q.args,['2026-11-19',6]);
  return {rows};
}});
const env={CONFIRM_D1_READ:'blue-d1-bounded-read',
  CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'fake-cloudflare-token'};
const remote=(rows)=>async(url,opts)=>{
  assert.match(url,/\/d1\/database\/[^/]+\/query$/);
  const body=JSON.parse(opts.body);
  assert.match(body.sql,/^SELECT /);
  assert.equal(body.params.length,4);
  assert.equal(body.params[2],'005930');
  assert.ok(!body.sql.includes('ciphertext'));
  return {ok:true,json:async()=>({success:true,result:[{success:true,results:rows}]})};
};

test('default preview reads Turso only, never touches Cloudflare D1',async()=>{
  const result=await auditQuoteParity(client([record()]),{},
    {now,day:'2026-11-19',fetchFn:()=>{throw Error('D1 not authorized');}});
  assert.deepEqual(result,{day_kst:'2026-11-19',sampled:1,status:'TURSO_SAMPLE_READY'});
});

test('bounded exact match counts identical quote history from both databases',async()=>{
  const result=await auditQuoteParity(client([record()]),env,{
    mode:'compare_small',day:'2026-11-19',now,databaseId:'fake-db',fetchFn:remote([record()])
  });
  assert.deepEqual(result,{day_kst:'2026-11-19',sampled:1,matched:1,
    d1_missing:0,value_mismatch:0,status:'PARITY_MATCHED'});
});

test('missing or different D1 data is reported, not overwritten or hidden',async()=>{
  for(const [rows,status,missing,mismatched] of [
    [[], 'PARITY_GAP',1,0],
    [[{...record(),price:71000}],'PARITY_GAP',0,1]
  ]){
    const result=await auditQuoteParity(client([record()]),env,{
      mode:'compare_small',day:'2026-11-19',now,databaseId:'fake-db',fetchFn:remote(rows)
    });
    assert.equal(result.status,status);
    assert.equal(result.d1_missing,missing);
    assert.equal(result.value_mismatch,mismatched);
  }
});

test('D1 reads need explicit confirmation and remote outage fails closed',async()=>{
  const params={mode:'compare_small',day:'2026-11-19',now,databaseId:'fake-db'};
  assert.equal((await auditQuoteParity(client([record()]),{},
    {...params,fetchFn:()=>{throw Error('Not called');}})).status,'D1_READ_NOT_APPROVED');
  assert.equal((await auditQuoteParity(client([record()]),env,
    {...params,fetchFn:async()=>({ok:false})})).status,'D1_UNAVAILABLE');
});

test('invalid/future dates and corrupted payloads are rejected before D1 query',async()=>{
  await assert.rejects(()=>auditQuoteParity(client([record()]),{},
    {now,day:'2026-11-20'}),/BAD_DAY/);
  await assert.rejects(()=>auditQuoteParity(client([{...record(),code:'BAD!'}]),{},
    {now,day:'2026-11-19'}),/INVALID_ROW/);
});

test('missing Turso history is never presented as parity success',async()=>{
  const result=await auditQuoteParity(client([]),env,
    {mode:'compare_small',day:'2026-11-19',now});
  assert.equal(result.status,'NO_TURSO_SAMPLE');
});

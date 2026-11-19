import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditWorkerSettings,summarizeWorkerSettings} from './collector-runtime-settings-audit.mjs';

const accountId='0123456789abcdef0123456789abcdef';
const secret='NEVER_EXPOSE_THIS_SECRET';
const payload=(bindings)=>({success:true,result:{bindings}});
const fetchMock=(result,spy)=>async(url,options)=>{
  spy.push({url,options});
  return {ok:true,status:200,json:async()=>result};
};

test('audits only the fixed worker settings endpoint using GET and token header',async()=>{
  const calls=[];
  const result=await auditWorkerSettings({accountId,apiToken:secret,
    fetchFn:fetchMock(payload([{name:'TURSO_MIRROR_ENABLED',type:'plain_text',text:'true'}]),calls)});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/blue-market-collector/settings`);
  assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[0].options.headers.authorization,`Bearer ${secret}`);
  assert.equal(result.flags.TURSO_MIRROR_ENABLED,'TRUE');
  assert.equal(result.mirror_off_deploy_risk,'POTENTIAL_EXISTING_MIRROR_INTERRUPTION');
});

test('secret_text presence is not treated as true/false and no secret contents escape',()=>{
  const b=[
    {name:'TURSO_MIRROR_ENABLED',type:'secret_text',text:secret},
    {name:'TURSO_PROVISIONAL_QUOTES_ENABLED',type:'plain_text',text:'false'},
    {name:'TURSO_PROVISIONAL_PILOT_UNTIL_UTC',type:'secret_text',text:secret},
    {name:'KIS_APP_SECRET',type:'secret_text',text:secret},
    {name:'TURSO_DATABASE_URL',type:'plain_text',text:secret},
  ];
  const result=summarizeWorkerSettings(payload(b));
  assert.equal(result.flags.TURSO_MIRROR_ENABLED,'SECRET_PRESENT_VALUE_UNKNOWN');
  assert.equal(result.flags.TURSO_PROVISIONAL_QUOTES_ENABLED,'FALSE');
  assert.equal(result.pilot.TURSO_PROVISIONAL_PILOT_UNTIL_UTC,'SECRET_PRESENT_EXPIRY_UNKNOWN');
  assert.equal(result.mirror_off_deploy_risk,'MIRROR_RUNTIME_UNVERIFIED');
  const safe=JSON.stringify(result);
  assert.ok(!safe.includes(secret));
  assert.ok(!safe.includes('KIS_APP_SECRET'));
  assert.ok(!safe.includes('TURSO_DATABASE_URL'));
});

test('missing flags are absent, and inconsistent or duplicate values are never assumed false',()=>{
  const a=summarizeWorkerSettings(payload([]));
  assert.equal(a.flags.TURSO_MIRROR_ENABLED,'ABSENT');
  assert.equal(a.mirror_off_deploy_risk,'MIRROR_RUNTIME_UNVERIFIED');
  const b=summarizeWorkerSettings(payload([
    {name:'TURSO_MIRROR_ENABLED',type:'plain_text',text:'yes'},
    {name:'TURSO_PROVISIONAL_PAUSED',type:'plain_text',text:'false'},
  ]));
  assert.equal(b.flags.TURSO_MIRROR_ENABLED,'UNKNOWN_VALUE');
  assert.equal(b.flags.TURSO_PROVISIONAL_PAUSED,'FALSE');
  const c=summarizeWorkerSettings(payload([
    {name:'TURSO_MIRROR_ENABLED',type:'plain_text',text:'true'},
    {name:'TURSO_MIRROR_ENABLED',type:'plain_text',text:'false'},
  ]));
  assert.equal(c.flags.TURSO_MIRROR_ENABLED,'UNKNOWN_DUPLICATE');
});

test('invalid bindings response fails closed without printing the response',()=>{
  for(const invalid of [null,{},payload(null),{success:false,result:{bindings:[]}}])
    assert.throws(()=>summarizeWorkerSettings(invalid),/UNVERIFIABLE_BINDINGS/);
});

test('HTTP failures report only whitelisted reason codes and never retry with writes',async()=>{
  for(const [status,reason] of [[401,'AUTH_REJECTED'],[403,'PERMISSION_DENIED'],
    [404,'WORKER_NOT_FOUND'],[500,'HTTP_FAILED']]){
    const calls=[];
    await assert.rejects(()=>auditWorkerSettings({accountId,apiToken:secret,
      fetchFn:async(url,options)=>{calls.push(options.method);return {ok:false,status};}}),
    new RegExp(reason));
    assert.deepEqual(calls,['GET']);
  }
});

test('invalid account credentials do not call Cloudflare, and network error is sanitized',async()=>{
  let called=false;
  await assert.rejects(()=>auditWorkerSettings({accountId:'invalid',apiToken:secret,
    fetchFn:async()=>{called=true;}}),/CONFIG_MISSING/);
  assert.equal(called,false);
  await assert.rejects(()=>auditWorkerSettings({accountId,apiToken:secret,
    fetchFn:async()=>{throw Error(secret);}}),/AUDIT_UNREACHABLE/);
});

test('manual audit workflow cannot deploy, mutate Worker secrets, issue tokenP or query databases',()=>{
  const workflow=readFileSync(new URL('../../.github/workflows/blue_collector_runtime_settings_audit.yml',import.meta.url),'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/\bschedule:|wrangler\s+(?:deploy|secret)|tokenP|D1_DATABASE_ID|TURSO_DATABASE_URL/);
  assert.match(workflow,/node --test tools\/turso\/collector-runtime-settings-audit.test.mjs/);
  assert.match(workflow,/node tools\/turso\/collector-runtime-settings-audit.mjs/);
});

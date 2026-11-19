import test from 'node:test';
import assert from 'node:assert/strict';
import {createD1Backup} from './d1-token-backup.mjs';
import {decryptKisToken} from './kis-token-steward.mjs';

const env={CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'test-not-real'};
const ISSUED={token:'simulated-shared-token',expiresAt:'2026-11-20T00:10:00.000Z',
  savedAt:'2026-11-19T00:10:00.000Z',key:'fake-key',secret:'fake-secret'};
function fakeCloudflare({initial=null,unavailable=false}={}){
  const calls=[];let stored=initial;
  return {calls,get stored(){return stored;},async fetch(_url,opts){
    const {sql,params}=JSON.parse(opts.body);
    calls.push({sql,params});
    if(unavailable)throw Error('network down');
    let rows=[];
    if(sql.includes('INSERT INTO blue_kis_token_vault_v1')){
      if(!stored||stored.saved_at_utc<=params[3]&&stored.expires_at_utc<=params[2])
        stored={scope:params[0],ciphertext:params[1],expires_at_utc:params[2],saved_at_utc:params[3]};
    }else if(sql.includes('SELECT ciphertext')){
      if(stored)rows=[stored];
    }
    return {ok:true,async json(){return {success:true,result:[{success:true,results:rows}]};}};
  }};
}
test('D1 backup mirrors encrypted token with readback, never logs plaintext or requests tokenP',async()=>{
  const cf=fakeCloudflare();
  const backup=createD1Backup(env,{fetchFn:cf.fetch,dbId:'e'.repeat(36)});
  assert.equal((await backup.mirror(ISSUED)).status,'D1_BACKUP_VERIFIED');
  assert.notEqual(cf.stored.ciphertext,ISSUED.token);
  assert.equal(decryptKisToken(cf.stored.ciphertext,ISSUED.key,ISSUED.secret),ISSUED.token);
  assert.deepEqual(cf.calls.map(v=>v.sql.includes('SELECT ciphertext')?'READ':
    v.sql.includes('INSERT INTO')?'WRITE':'CREATE'),['CREATE','WRITE','READ']);
  const inspected=await backup.inspect({key:ISSUED.key,secret:ISSUED.secret,
    now:new Date(ISSUED.savedAt)});
  assert.equal(inspected.status,'VALID');
  assert.equal(inspected.token,ISSUED.token);
});
test('a newer D1 token can never be replaced by a stale Turso token',async()=>{
  const original={scope:'scope',ciphertext:'encrypted-newer-token',
    saved_at_utc:'2026-11-20T00:10:00.000Z',expires_at_utc:'2026-11-21T00:10:00.000Z'};
  const cf=fakeCloudflare({initial:original});
  await assert.rejects(()=>createD1Backup(env,{fetchFn:cf.fetch,dbId:'e'.repeat(36)}).mirror(ISSUED),
    /D1_BACKUP_CONFLICT/);
  assert.deepEqual(cf.stored,original);
});
test('D1 outage raises only a sanitized failure; no token gets reissued',async()=>{
  const cf=fakeCloudflare({unavailable:true});
  await assert.rejects(()=>createD1Backup(env,{fetchFn:cf.fetch,dbId:'e'.repeat(36)}).mirror(ISSUED),
    /D1_BACKUP_UNAVAILABLE/);
  assert.equal(cf.calls.length,1);
});
test('early D1 audit is read-only and accepts a saved issuance older than 24h',async()=>{
  const now=new Date('2026-11-19T05:00:00.000Z');
  const pauseAt='2026-11-19T02:23:04.174Z';
  const saved={saved_at_utc:'2026-11-17T07:20:08.600Z',
    expires_at_utc:'2026-11-18T07:20:08.000Z'};
  const issuer={last_attempt_at_utc:'2026-11-17T07:20:07.205Z',
    last_success_at_utc:'2026-11-17T07:20:08.100Z',status:'SAVED',
    last_attempt_day_kst:'2026-11-17'};
  const calls=[];
  const fetchFn=async (_url,opts)=>{
    const {sql}=JSON.parse(opts.body);calls.push(sql);
    const rows=sql.includes('blue_kis_token_issuance_r1597')?[issuer]:[saved];
    return {ok:true,async json(){return {success:true,result:[{success:true,results:rows}]};}};
  };
  const backup=createD1Backup(env,{fetchFn,dbId:'e'.repeat(36)});
  assert.equal((await backup.auditIssuer({key:ISSUED.key,now,pauseAt})).status,
    'EARLY_D1_ISSUER_VERIFIED');
  assert.equal(calls.length,2);
  assert.ok(calls.every(q=>q.trimStart().startsWith('SELECT ')&&
    !q.includes('ciphertext')&&!q.includes('access_token')&&!q.includes('appsecret')));
  issuer.status='ISSUE_FAILED';
  assert.equal((await backup.auditIssuer({key:ISSUED.key,now,pauseAt})).status,
    'EARLY_D1_AUDIT_UNVERIFIED');
  issuer.status='SAVED';
  issuer.last_attempt_at_utc='2026-11-19T02:30:00.000Z';
  assert.equal((await backup.auditIssuer({key:ISSUED.key,now,pauseAt})).status,
    'EARLY_D1_AUDIT_UNVERIFIED');
});
test('early audit refuses a recent provider issuance even when D1 pause is recent',async()=>{
  const now=new Date('2026-11-19T05:00:00.000Z');
  const pauseAt='2026-11-19T04:00:00.000Z';
  const saved={saved_at_utc:'2026-11-18T12:00:08.600Z',
    expires_at_utc:'2026-11-19T12:00:08.000Z'};
  const issuer={last_attempt_at_utc:'2026-11-18T12:00:07.205Z',
    last_success_at_utc:'2026-11-18T12:00:08.100Z',status:'SAVED'};
  const fetchFn=async (_url,opts)=>{
    const {sql}=JSON.parse(opts.body);
    return {ok:true,async json(){return {success:true,result:[{success:true,
      results:[sql.includes('blue_kis_token_issuance_r1597')?issuer:saved]}]};}};
  };
  const backup=createD1Backup(env,{fetchFn,dbId:'e'.repeat(36)});
  assert.equal((await backup.auditIssuer({key:ISSUED.key,now,pauseAt})).status,
    'EARLY_D1_AUDIT_WAIT_24H_LAST_ISSUE');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createClient} from '@libsql/client';
import {cutoverReady,encryptKisToken,scopeFor,steward} from './kis-token-steward.mjs';
import {decryptVault} from '../../collector/src/core.mjs';

globalThis.crypto ??= webcrypto;
const NOW=new Date('2026-11-19T00:10:00.000Z');
const base={
  KIS_APP_KEY:'example-key',KIS_APP_SECRET:'example-secret',
  BLUE_KIS_TOKEN_AUTO_PAUSED:'true',
  BLUE_KIS_TURSO_CUTOVER_APPROVED:'true',
  BLUE_KIS_D1_DISABLED_AT_UTC:'2026-11-17T23:00:00.000Z'
};
function client(row){
  const statements=[],returned={rows:row?[row]:[]};
  return {statements,async execute(q){
    const sql=typeof q==='string'?q:q.sql;
    statements.push(sql);
    if(sql.startsWith('SELECT expires_at_utc,saved_at_utc'))return returned;
    if(sql.includes('RETURNING last_attempt_at_utc'))return {rows:[{last_attempt_at_utc:NOW.toISOString()}]};
    return {rows:[]};
  }};
}
test('D1 issuer must be paused and cutover must have 24h buffer',()=>{
  assert.equal(cutoverReady({},NOW),'LEGACY_ISSUER_NOT_PAUSED_OR_CUTOVER_NOT_APPROVED');
  assert.equal(cutoverReady({...base,BLUE_KIS_D1_DISABLED_AT_UTC:'2026-11-18T12:00:00.000Z'},NOW),
    'WAIT_24H_SINCE_LEGACY_ISSUER_PAUSED');
  assert.equal(cutoverReady(base,NOW),'READY');
});
test('encrypted KIS token is readable with existing AES-GCM Worker vault decryptor',async()=>{
  const token='sample-not-a-real-token';
  assert.match(scopeFor(base.KIS_APP_KEY),/^KIS_PROD_READONLY_V1_[a-f\d]{20}$/);
  const encrypted=encryptKisToken(token,base.KIS_APP_KEY,base.KIS_APP_SECRET);
  assert.ok(!encrypted.includes(token));
  assert.equal(await decryptVault(encrypted,base.KIS_APP_KEY,base.KIS_APP_SECRET),token);
  await assert.rejects(decryptVault(encrypted,base.KIS_APP_KEY,'wrong-key'),/TOKEN_DECRYPT_FAILED/);
});
test('check never issues token, creates only metadata tables',async()=>{
  const c=client();
  const result=await steward(c,base,NOW,{mode:'check',issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
  assert.equal(result.status,'TOKEN_MISSING');
  assert.ok(c.statements.every(s=>!s.includes('INSERT INTO blue_turso_kis_issuance_v1')));
});
test('pre-cutover issue is safely blocked before any reservation or KIS call',async()=>{
  const c=client(),gated={...base,BLUE_KIS_TURSO_CUTOVER_APPROVED:'false'};
  const result=await steward(c,gated,NOW,{mode:'issue',issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
  assert.equal(result.status,'LEGACY_ISSUER_NOT_PAUSED_OR_CUTOVER_NOT_APPROVED');
  assert.ok(c.statements.every(s=>!s.includes('RETURNING last_attempt_at_utc')));
});
test('valid saved token is reused; no tokenP issuance even if cutover is approved',async()=>{
  const c=client({saved_at_utc:'2026-11-18T00:00:00.000Z',expires_at_utc:'2026-11-20T00:00:00.000Z'});
  const result=await steward(c,base,NOW,{mode:'issue',issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
  assert.equal(result.status,'TOKEN_VALID');
});

test('metadata check distinguishes missing, expired and soon-to-expire tokens',async()=>{
  const expired=client({saved_at_utc:'2026-11-17T00:10:00.000Z',expires_at_utc:'2026-11-18T00:10:00.000Z'});
  assert.equal((await steward(expired,base,NOW,{mode:'check'})).status,'TOKEN_EXPIRED');
  const soon=client({saved_at_utc:'2026-11-18T23:40:00.000Z',expires_at_utc:'2026-11-19T00:40:00.000Z'});
  assert.equal((await steward(soon,base,NOW,{mode:'check'})).status,'TOKEN_EXPIRES_SOON');
});

test('06:00 renewal window never bypasses the 24h saved-token guard',async()=>{
  const c=client({saved_at_utc:'2026-11-18T00:20:00.000Z',expires_at_utc:'2026-11-19T00:20:00.000Z'});
  const result=await steward(c,base,NOW,{mode:'issue',issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
  assert.equal(result.status,'TOKEN_VALID_RENEWAL_WAIT_24H');
});

test('one provider failure retries only after 30m, never a third time',async()=>{
  const db=createClient({url:'file::memory:'});
  let calls=0;
  const issuer=async()=>{calls++;throw Error('simulated provider outage');};
  try{
    const first=await steward(db,base,NOW,{mode:'issue',issuer});
    assert.equal(first.status,'ISSUE_FAILED_RETRY_AFTER_30M');
    const early=await steward(db,base,new Date(NOW.getTime()+20*60_000),{mode:'issue',issuer});
    assert.equal(early.status,'ALREADY_ATTEMPTED_KST_DAY_OR_24H');
    const second=await steward(db,base,new Date(NOW.getTime()+31*60_000),{mode:'issue',issuer});
    assert.equal(second.status,'ISSUE_FAILED_FINAL');
    const final=await steward(db,base,new Date(NOW.getTime()+61*60_000),{mode:'issue',issuer});
    assert.equal(final.status,'ALREADY_ATTEMPTED_KST_DAY_OR_24H');
    assert.equal(calls,2);
  }finally{db.close();}
});

test('a saved token is not reissued on the 06:00 check',async()=>{
  const c=client({saved_at_utc:'2026-11-18T00:10:00.000Z',expires_at_utc:'2026-11-20T00:10:00.000Z'});
  const result=await steward(c,base,NOW,{mode:'issue',issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
  assert.equal(result.status,'TOKEN_VALID');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createClient} from '@libsql/client';
import {cutoverReady,encryptKisToken,decryptKisToken,scopeFor,steward} from './kis-token-steward.mjs';
import {decryptVault} from '../../collector/src/core.mjs';

globalThis.crypto ??= webcrypto;
const NOW=new Date('2026-11-19T00:10:00.000Z');
const base={
  KIS_APP_KEY:'example-key',KIS_APP_SECRET:'example-secret',
  BLUE_KIS_TOKEN_AUTO_PAUSED:'true',
  BLUE_KIS_TURSO_CUTOVER_APPROVED:'true',
  BLUE_KIS_DUAL_VAULT_ENABLED:'true',
  BLUE_KIS_D1_DISABLED_AT_UTC:'2026-11-17T23:00:00.000Z'
};
const standby={mirror:async()=>({status:'D1_BACKUP_VERIFIED'}),inspect:async()=>({status:'MISSING'})};
function client(row){
  const statements=[],returned={rows:row?[row]:[]};
  return {statements,async execute(q){
    const sql=typeof q==='string'?q:q.sql;
    statements.push(sql);
    if(sql.startsWith('SELECT expires_at_utc,saved_at_utc'))return returned;
    if(sql.startsWith('SELECT ciphertext,expires_at_utc,saved_at_utc'))return {rows:row?[{...row,ciphertext:encryptKisToken('cached-test-token',base.KIS_APP_KEY,base.KIS_APP_SECRET)}]:[]};
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
test('early cutover remains blocked by default; explicit approval requires another live D1 audit',()=>{
  const paused={...base,BLUE_KIS_D1_DISABLED_AT_UTC:'2026-11-19T00:00:00.000Z'};
  assert.equal(cutoverReady(paused,NOW),'WAIT_24H_SINCE_LEGACY_ISSUER_PAUSED');
  assert.equal(cutoverReady({...paused,BLUE_KIS_EARLY_CUTOVER_APPROVED:'true'},NOW),
    'EARLY_D1_AUDIT_REQUIRED');
});
test('encrypted KIS token is readable with existing AES-GCM Worker vault decryptor',async()=>{
  const token='sample-not-a-real-token';
  assert.match(scopeFor(base.KIS_APP_KEY),/^KIS_PROD_READONLY_V1_[a-f\d]{20}$/);
  const encrypted=encryptKisToken(token,base.KIS_APP_KEY,base.KIS_APP_SECRET);
  assert.ok(!encrypted.includes(token));
  assert.equal(await decryptVault(encrypted,base.KIS_APP_KEY,base.KIS_APP_SECRET),token);
  assert.equal(decryptKisToken(encrypted,base.KIS_APP_KEY,base.KIS_APP_SECRET),token);
  assert.throws(()=>decryptKisToken(encrypted,base.KIS_APP_KEY,'bad-secret'),/KIS_TOKEN_DECRYPT_FAILED/);
  await assert.rejects(decryptVault(encrypted,base.KIS_APP_KEY,'wrong-key'),/TOKEN_DECRYPT_FAILED/);
});
test('check uses SELECT only and never issues tokens or creates metadata tables',async()=>{
  const c=client();
  const result=await steward(c,base,NOW,{mode:'check',issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
  assert.equal(result.status,'TOKEN_MISSING');
  assert.equal(c.statements.length,1);
  assert.ok(c.statements.every(s=>s.startsWith('SELECT ')));
});
test('check on an uninitialized Turso vault fails closed and creates no tables',async()=>{
  const db=createClient({url:'file::memory:'});
  try{
    const result=await steward(db,base,NOW,{mode:'check',issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
    assert.equal(result.status,'TOKEN_VAULT_READ_UNAVAILABLE');
    const tables=await db.execute("SELECT name FROM sqlite_master WHERE name LIKE 'blue_turso_kis_%'");
    assert.deepEqual(tables.rows,[]);
  }finally{db.close();}
});
test('pre-cutover issue is safely blocked before any reservation or KIS call',async()=>{
  const c=client(),gated={...base,BLUE_KIS_TURSO_CUTOVER_APPROVED:'false'};
  const result=await steward(c,gated,NOW,{mode:'issue',backup:standby,issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
  assert.equal(result.status,'LEGACY_ISSUER_NOT_PAUSED_OR_CUTOVER_NOT_APPROVED');
  assert.ok(c.statements.every(s=>!s.includes('RETURNING last_attempt_at_utc')));
});
test('valid saved token is reused; no tokenP issuance even if cutover is approved',async()=>{
  const c=client({saved_at_utc:'2026-11-18T00:00:00.000Z',expires_at_utc:'2026-11-20T00:00:00.000Z'});
  const result=await steward(c,base,NOW,{mode:'issue',backup:standby,issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
  assert.equal(result.status,'D1_BACKUP_VERIFIED');
});

test('metadata check distinguishes missing, expired and soon-to-expire tokens',async()=>{
  const expired=client({saved_at_utc:'2026-11-17T00:10:00.000Z',expires_at_utc:'2026-11-18T00:10:00.000Z'});
  assert.equal((await steward(expired,base,NOW,{mode:'check'})).status,'TOKEN_EXPIRED');
  const soon=client({saved_at_utc:'2026-11-18T23:40:00.000Z',expires_at_utc:'2026-11-19T00:40:00.000Z'});
  assert.equal((await steward(soon,base,NOW,{mode:'check'})).status,'TOKEN_EXPIRES_SOON');
});

test('06:00 renewal window never bypasses the 24h saved-token guard',async()=>{
  const c=client({saved_at_utc:'2026-11-18T00:20:00.000Z',expires_at_utc:'2026-11-19T00:20:00.000Z'});
  const result=await steward(c,base,NOW,{mode:'issue',backup:standby,issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
  assert.equal(result.status,'D1_BACKUP_VERIFIED');
});

test('one provider failure retries only after 30m, never a third time',async()=>{
  const db=createClient({url:'file::memory:'});
  let calls=0;
  const issuer=async()=>{calls++;throw Error('simulated provider outage');};
  try{
    const first=await steward(db,base,NOW,{mode:'issue',backup:standby,issuer});
    assert.equal(first.status,'ISSUE_FAILED_RETRY_AFTER_30M');
    const early=await steward(db,base,new Date(NOW.getTime()+20*60_000),{mode:'issue',backup:standby,issuer});
    assert.equal(early.status,'ALREADY_ATTEMPTED_KST_DAY_OR_24H');
    const second=await steward(db,base,new Date(NOW.getTime()+31*60_000),{mode:'issue',backup:standby,issuer});
    assert.equal(second.status,'ISSUE_FAILED_FINAL');
    const final=await steward(db,base,new Date(NOW.getTime()+61*60_000),{mode:'issue',backup:standby,issuer});
    assert.equal(final.status,'ALREADY_ATTEMPTED_KST_DAY_OR_24H');
    assert.equal(calls,2);
  }finally{db.close();}
});

test('a saved token is not reissued on the 06:00 check',async()=>{
  const c=client({saved_at_utc:'2026-11-18T00:10:00.000Z',expires_at_utc:'2026-11-20T00:10:00.000Z'});
  const result=await steward(c,base,NOW,{mode:'issue',backup:standby,issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
  assert.equal(result.status,'D1_BACKUP_VERIFIED');
});
test('without the D1 standby configuration no KIS issuance is possible',async()=>{
  const db=createClient({url:'file::memory:'});
  try{
    const state=await steward(db,base,NOW,{mode:'issue',issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
    assert.equal(state.status,'D1_BACKUP_NOT_CONFIGURED');
    const flag=await steward(db,{...base,BLUE_KIS_DUAL_VAULT_ENABLED:'false'},NOW,
      {mode:'issue',backup:standby,issuer:async()=>{throw Error('UNEXPECTED_TOKENP');}});
    assert.equal(flag.status,'D1_BACKUP_NOT_CONFIGURED');
  }finally{db.close();}
});
test('a single issued token is stored in Turso and mirrored to D1 with matching expiry',async()=>{
  const db=createClient({url:'file::memory:'});
  const replicated=[];let calls=0;
  try{
    const first=await steward(db,base,NOW,{mode:'issue',backup:{...standby,mirror:async payload=>{
      replicated.push(payload);
    }},issuer:async()=>{calls++;return {token:'fake-provider-token',expires:NOW.getTime()+86400000};}});
    assert.equal(first.status,'TOKEN_SAVED_DUAL');
    assert.equal(calls,1);
    assert.equal(replicated.length,1);
    assert.equal(replicated[0].token,'fake-provider-token');
    assert.equal(replicated[0].savedAt,NOW.toISOString());
    assert.equal(replicated[0].expiresAt,first.expires_at_utc);
    const cached=await db.execute('SELECT ciphertext FROM blue_turso_kis_vault_v1');
    assert.equal(decryptKisToken(cached.rows[0].ciphertext,base.KIS_APP_KEY,base.KIS_APP_SECRET),'fake-provider-token');
    const second=await steward(db,base,new Date(NOW.getTime()+60_000),{
      mode:'issue',backup:standby,issuer:async()=>{throw Error('UNEXPECTED_REISSUE');}});
    assert.equal(second.status,'D1_BACKUP_VERIFIED');
  }finally{db.close();}
});
test('failed D1 storage retains the Turso token, and retry sync never calls tokenP',async()=>{
  const db=createClient({url:'file::memory:'});let issued=0,mirrored=0;
  try{
    const first=await steward(db,base,NOW,{mode:'issue',issuer:async()=>{
      issued++;return {token:'single-token',expires:NOW.getTime()+86400000};
    },backup:{...standby,mirror:async()=>{throw Error('simulated D1 quota failure');}}});
    assert.equal(first.status,'TOKEN_SAVED_BACKUP_PENDING');
    const recovered=await steward(db,base,new Date(NOW.getTime()+60_000),{mode:'issue',
      issuer:async()=>{issued++;throw Error('UNEXPECTED_REISSUE');},
      backup:{...standby,mirror:async value=>{mirrored++;assert.equal(value.token,'single-token');}}});
    assert.equal(recovered.status,'D1_BACKUP_VERIFIED');
    assert.equal(issued,1);assert.equal(mirrored,1);
  }finally{db.close();}
});
test('missing Turso primary recovers a live token from D1 without a second KIS issuance',async()=>{
  const db=createClient({url:'file::memory:'});
  let issued=0;
  try{
    const recovery=await steward(db,base,NOW,{mode:'issue',
      issuer:async()=>{issued++;throw Error('UNEXPECTED_REISSUE');},
      backup:{...standby,inspect:async()=>({status:'VALID',token:'standby-token',
        expiresAt:'2026-11-20T00:10:00.000Z',savedAt:'2026-11-19T00:00:00.000Z'})}});
    assert.equal(recovery.status,'TOKEN_RESTORED_FROM_D1');
    assert.equal(issued,0);
    const persisted=await db.execute('SELECT ciphertext FROM blue_turso_kis_vault_v1');
    assert.equal(decryptKisToken(persisted.rows[0].ciphertext,base.KIS_APP_KEY,base.KIS_APP_SECRET),
      'standby-token');
  }finally{db.close();}
});
test('missing primary with an unreachable or recently-issued D1 standby fails closed',async()=>{
  const db=createClient({url:'file::memory:'});
  const forbid=async()=>{throw Error('UNEXPECTED_REISSUE');};
  try{
    const down=await steward(db,base,NOW,{mode:'issue',issuer:forbid,
      backup:{...standby,inspect:async()=>{throw Error('D1 down');}}});
    assert.equal(down.status,'D1_BACKUP_INSPECTION_FAILED_NO_ISSUE');
    const fresh=await steward(db,base,NOW,{mode:'issue',issuer:forbid,
      backup:{...standby,inspect:async()=>({status:'EXPIRED',expiresAt:'2026-11-19T00:00:00.000Z',
        savedAt:'2026-11-18T18:00:00.000Z'})}});
    assert.equal(fresh.status,'WAIT_24H_FROM_BACKUP_SAVED');
  }finally{db.close();}
});
test('early cutover refuses to call KIS when D1 issuance audit is missing or unsafe',async()=>{
  const db=createClient({url:'file::memory:'});
  const early={...base,BLUE_KIS_D1_DISABLED_AT_UTC:'2026-11-19T00:00:00.000Z',
    BLUE_KIS_EARLY_CUTOVER_APPROVED:'true'};
  const issuer=async()=>{throw Error('UNEXPECTED_KIS_ISSUE');};
  try{
    const missing=await steward(db,early,NOW,{mode:'issue',backup:standby,issuer});
    assert.equal(missing.status,'EARLY_D1_AUDIT_UNAVAILABLE');
    const rejected=await steward(db,early,NOW,{mode:'issue',issuer,
      backup:{...standby,auditIssuer:async()=>({status:'EARLY_D1_AUDIT_WAIT_24H_LAST_ISSUE'})}});
    assert.equal(rejected.status,'EARLY_D1_AUDIT_BLOCKED');
  }finally{db.close();}
});
test('verified early cutover issues once into both vaults without skipping issuer reservation',async()=>{
  const db=createClient({url:'file::memory:'});
  const early={...base,BLUE_KIS_D1_DISABLED_AT_UTC:'2026-11-19T00:00:00.000Z',
    BLUE_KIS_EARLY_CUTOVER_APPROVED:'true'};
  let audited=0,issued=0,backedUp=0;
  try{
    const result=await steward(db,early,NOW,{mode:'issue',backup:{
      ...standby,
      auditIssuer:async()=>{audited++;return {status:'EARLY_D1_ISSUER_VERIFIED'};},
      mirror:async()=>{backedUp++;}
    },issuer:async()=>{issued++;return {token:'test-early-token',expires:NOW.getTime()+86400000};}});
    assert.equal(result.status,'TOKEN_SAVED_DUAL');
    assert.deepEqual([audited,issued,backedUp],[1,1,1]);
    const second=await steward(db,early,new Date(NOW.getTime()+60_000),{
      mode:'issue',backup:{...standby,auditIssuer:async()=>({status:'EARLY_D1_ISSUER_VERIFIED'})},
      issuer:async()=>{throw Error('UNEXPECTED_REISSUE');}});
    assert.equal(second.status,'D1_BACKUP_VERIFIED');
  }finally{db.close();}
});

test('healthy issuance ledger repairs a lost Worker standby, then makes no repeated writes',async()=>{
 const db=createClient({url:'file::memory:'});let calls=0,writes=0,current={status:'MISSING'};
 const issuer=async()=>{calls++;return {token:'reconcile-fixture',expires:NOW.getTime()+86400000};};
 const backup={inspect:async()=>current,mirror:async v=>{
   writes++;current={status:'VALID',token:v.token,expiresAt:v.expiresAt,savedAt:v.savedAt};
 }};
 try{
  assert.equal((await steward(db,base,NOW,{mode:'issue',issuer,backup})).status,'TOKEN_SAVED_DUAL');
  current={status:'MISSING'}; // D1 later loses its token while ledger says SAVED_DUAL.
  assert.equal((await steward(db,base,new Date(+NOW+60000),{mode:'issue',issuer,backup})).status,'D1_BACKUP_VERIFIED');
  assert.equal(calls,1);assert.equal(writes,2);
  assert.equal((await steward(db,base,new Date(+NOW+120000),{mode:'issue',issuer,backup})).status,'TOKEN_VALID');
  assert.equal(writes,2);assert.equal(calls,1);
  current={status:'UNAVAILABLE'};
  assert.equal((await steward(db,base,new Date(+NOW+180000),{mode:'issue',issuer,backup})).status,'D1_BACKUP_SYNC_FAILED');
  assert.equal(writes,2);assert.equal(calls,1);
 }finally{db.close();}
});

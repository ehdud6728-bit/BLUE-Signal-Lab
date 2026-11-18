import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTursoMirrorStatements,mirrorQuotesToTurso,tursoMirrorEnabled} from '../src/turso-mirror.mjs';

const sample=(received_at_utc='2026-11-18T01:05:01.000Z')=>({
  trade_date_kst:'2026-11-18',market:'J',code:'005930',received_at_utc,
  price:70000,accumulated_volume:100000,phase:'KRX_REGULAR',source:'KIS_REST_INQUIRE_PRICE'
});

test('mirror is opt-in and off for missing/default flag',()=>{
  assert.equal(tursoMirrorEnabled({}),false);
  assert.equal(tursoMirrorEnabled({TURSO_MIRROR_ENABLED:'false'}),false);
  assert.equal(tursoMirrorEnabled({TURSO_MIRROR_ENABLED:'true'}),true);
});

test('batch uses stable keys and prevents older quotes replacing newer ones',()=>{
  const statements=buildTursoMirrorStatements([sample()]);
  assert.equal(statements.length,2);
  assert.match(statements[0].sql,/ON CONFLICT\(trade_date,market,code\)/);
  assert.match(statements[0].sql,/excluded\.received_at_utc > blue_kis_live_quotes_r141\.received_at_utc/);
  assert.match(statements[1].sql,/INSERT OR IGNORE INTO blue_kis_live_history_r141/);
  assert.deepEqual(statements[1].args.slice(0,4),['2026-11-18','J','005930','2026-11-18T01:05:01.000Z']);
  assert.throws(()=>buildTursoMirrorStatements([sample(),sample()]),/DUPLICATE_KEY/);
  assert.throws(()=>buildTursoMirrorStatements([{...sample(),price:-1}]),/INVALID_QUOTE/);
});

test('mirror writes Turso batch in one transaction, not D1, and closes connection',async()=>{
  const calls=[];
  const env={TURSO_MIRROR_ENABLED:'true',TURSO_DATABASE_URL:'libsql://example.turso.io',TURSO_AUTH_TOKEN:'FAKE_TOKEN'};
  const result=await mirrorQuotesToTurso(env,[sample()],{createClientFn:()=>({
    async batch(statements,mode){calls.push({statements,mode});},
    close(){calls.push({closed:true});}
  })});
  assert.deepEqual(result,{status:'OK',saved:1});
  assert.equal(calls[0].mode,'write');
  assert.equal(calls[0].statements.length,2);
  assert.deepEqual(calls[1],{closed:true});
  assert.equal(calls.length,2);
});

test('disabled/missing-secrets never creates a connection',async()=>{
  const unexpected=()=>{throw Error('Should not connect');};
  assert.deepEqual(await mirrorQuotesToTurso({},[sample()],{createClientFn:unexpected}),{status:'DISABLED',saved:0});
  assert.deepEqual(await mirrorQuotesToTurso({TURSO_MIRROR_ENABLED:'true'},[sample()],{createClientFn:unexpected}),{status:'MISSING_SECRETS',saved:0});
});

test('Turso error closes the client but does not include credentials in messages',async()=>{
  let closed=false;
  const env={TURSO_MIRROR_ENABLED:'true',TURSO_DATABASE_URL:'libsql://example.turso.io',TURSO_AUTH_TOKEN:'SENSITIVE_FAKE'};
  await assert.rejects(()=>mirrorQuotesToTurso(env,[sample()],{createClientFn:()=>({
    async batch(){throw Error('NETWORK_FAULT');},close(){closed=true;}
  })}),/NETWORK_FAULT/);
  assert.equal(closed,true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {buildTursoMirrorStatements,mirrorQuotesToTurso,tursoMirrorEnabled,tursoMirrorMode} from '../src/turso-mirror.mjs';

const sample=(received_at_utc='2026-11-18T01:05:01.000Z')=>({
  trade_date_kst:'2026-11-18',market:'J',code:'005930',received_at_utc,
  price:70000,accumulated_volume:100000,phase:'KRX_REGULAR',source:'KIS_REST_INQUIRE_PRICE'
});

test('mirror is opt-in and off for missing/default flag',()=>{
  assert.equal(tursoMirrorEnabled({}),false);
  assert.equal(tursoMirrorEnabled({TURSO_MIRROR_ENABLED:'false'}),false);
  assert.equal(tursoMirrorEnabled({TURSO_MIRROR_ENABLED:'true'}),true);
  assert.equal(tursoMirrorEnabled({TURSO_MIRROR_ENABLED:'true',TURSO_MIRROR_PAUSED:'true'}),false);
  assert.equal(tursoMirrorMode({TURSO_MIRROR_ENABLED:'true',TURSO_MIRROR_PAUSED:'true'}),'OFF');
});

test('pilot only runs within its strict UTC expiry window, with full mode independent',()=>{
  const now=new Date('2026-11-18T01:00:00.000Z');
  const env=(deadline)=>({TURSO_MIRROR_ENABLED:'false',TURSO_MIRROR_PILOT_UNTIL_UTC:deadline});
  assert.equal(tursoMirrorMode(env('2026-11-18T01:15:00.000Z'),now),'PILOT');
  assert.equal(tursoMirrorEnabled(env('2026-11-18T01:15:00.000Z'),now),true);
  assert.equal(tursoMirrorMode(env('2026-11-18T01:30:00.000Z'),now),'PILOT');
  assert.equal(tursoMirrorMode(env('2026-11-18T01:30:00.001Z'),now),'OFF');
  assert.equal(tursoMirrorMode(env('2026-11-18T01:00:00.000Z'),now),'OFF');
  assert.equal(tursoMirrorMode(env('2026-11-18T00:59:59.999Z'),now),'OFF');
  assert.equal(tursoMirrorMode(env('2026-11-18T01:15:00Z'),now),'OFF');
  assert.equal(tursoMirrorMode(env('not-a-date'),now),'OFF');
  assert.equal(tursoMirrorMode({TURSO_MIRROR_ENABLED:'true'},now),'FULL');
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
  assert.deepEqual(result,{status:'OK',saved:1,mode:'FULL'});
  assert.equal(calls[0].mode,'write');
  assert.equal(calls[0].statements.length,2);
  assert.deepEqual(calls[1],{closed:true});
  assert.equal(calls.length,2);
});

test('pilot mirrors at most two quotes per completed D1 batch',async()=>{
  const calls=[];
  const now=new Date('2026-11-18T01:00:00.000Z');
  const env={
    TURSO_MIRROR_ENABLED:'false',
    TURSO_MIRROR_PILOT_UNTIL_UTC:'2026-11-18T01:15:00.000Z',
    TURSO_DATABASE_URL:'libsql://example.turso.io',
    TURSO_AUTH_TOKEN:'FAKE_TOKEN'
  };
  const quotes=[sample(),{...sample(),code:'000001'},{...sample(),code:'000002'}];
  const result=await mirrorQuotesToTurso(env,quotes,{
    now,
    createClientFn:()=>({
      async batch(statements,mode){calls.push({statements,mode});},
      close(){calls.push({closed:true});}
    })
  });
  assert.deepEqual(result,{status:'OK',saved:2,mode:'PILOT'});
  assert.equal(calls[0].statements.length,4);
  assert.deepEqual(calls[0].statements.filter(stmt=>/INSERT INTO blue_kis_live_quotes_r141/.test(stmt.sql)).map(stmt=>stmt.args[2]),['005930','000001']);
  assert.deepEqual(calls[1],{closed:true});
});

test('expired pilot cannot connect or mirror, even if collector had scheduled its hook',async()=>{
  const env={TURSO_MIRROR_ENABLED:'false',TURSO_MIRROR_PILOT_UNTIL_UTC:'2026-11-18T01:15:00.000Z'};
  const result=await mirrorQuotesToTurso(env,[sample()],{
    now:new Date('2026-11-18T01:15:00.001Z'),
    createClientFn:()=>{throw Error('Expired pilot must not connect');}
  });
  assert.deepEqual(result,{status:'DISABLED',saved:0});
});

test('disabled/missing-secrets never creates a connection',async()=>{
  const unexpected=()=>{throw Error('Should not connect');};
  assert.deepEqual(await mirrorQuotesToTurso({},[sample()],{createClientFn:unexpected}),{status:'DISABLED',saved:0});
  assert.deepEqual(await mirrorQuotesToTurso({TURSO_MIRROR_ENABLED:'true'},[sample()],{createClientFn:unexpected}),{status:'MISSING_SECRETS',saved:0});
  assert.deepEqual(await mirrorQuotesToTurso({TURSO_MIRROR_ENABLED:'true',TURSO_MIRROR_PAUSED:'true'},
    [sample()],{createClientFn:unexpected}),{status:'DISABLED',saved:0});
});

test('Turso error closes the client but does not include credentials in messages',async()=>{
  let closed=false;
  const env={TURSO_MIRROR_ENABLED:'true',TURSO_DATABASE_URL:'libsql://example.turso.io',TURSO_AUTH_TOKEN:'SENSITIVE_FAKE'};
  await assert.rejects(()=>mirrorQuotesToTurso(env,[sample()],{createClientFn:()=>({
    async batch(){throw Error('NETWORK_FAULT');},close(){closed=true;}
  })}),/NETWORK_FAULT/);
  assert.equal(closed,true);
});

test('Turso mirror preserves uppercase alphanumeric KRX codes and rejects malformed ones',()=>{
  for(const code of ['00088K','A12345']){
    const statements=buildTursoMirrorStatements([{...sample(),code}]);
    assert.equal(statements[0].args[2],code);
    assert.equal(statements[1].args[2],code);
  }
  for(const code of ['00088k','00-88K','12345','1234567']){
    assert.throws(()=>buildTursoMirrorStatements([{...sample(),code}]),/INVALID_QUOTE/);
  }
});

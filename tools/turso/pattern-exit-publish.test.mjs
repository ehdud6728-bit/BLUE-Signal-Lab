import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {publishExitReport} from './pattern-exit-publish.mjs';

const env={TURSO_DATABASE_URL:'libsql://unit.invalid',TURSO_AUTH_TOKEN:'test'};
const approved='blue-turso-exit-research-only';
const sourceSha='a'.repeat(64);
function report(){return {schema:'BLUE_TURSO_PATTERN_EXIT_REPORT_V1',storage:'TURSO',
  asof_day:'2026-11-19',eod_audited_days:9,research_audited_days:5,
  signal_stock_days:882,short_and_long_windows:[5,10,20,60,120,250,500]
    .map(sessions=>({sessions,archive_complete:false})),
  trading_calendar_verified:false,corporate_actions_verified:false,
  market_and_sector_benchmark_verified:false,
  investment_recommendation_enabled:false,candidate_stocks:[],note:'실제 연구 전'};}
function db(){const sqlite=new DatabaseSync(':memory:');const calls=[];
  const factory=()=>({async execute(command){const sql=typeof command==='string'?command:command.sql;
    const args=typeof command==='string'?[]:command.args;
    calls.push(sql);
    return {rows:sql.trim().startsWith('SELECT')?sqlite.prepare(sql).all(...args):
      (sqlite.prepare(sql).run(...args),[])};
  },close(){}});
  return {factory,calls,close:()=>sqlite.close()};
}

test('publication plan and absent approval never connect to Turso',async()=>{
  assert.deepEqual(await publishExitReport({mode:'plan'}),{status:'PLAN_ONLY',written:0});
  const fixture=db();
  await assert.rejects(()=>publishExitReport({raw:Buffer.from(JSON.stringify(report())),
    sourceSha,mode:'publish',confirm:'',env,clientFactory:fixture.factory}),
    /EXIT_REPORT_NOT_CONFIRMED/);
  assert.equal(fixture.calls.length,0);
  fixture.close();
});

test('explicit publication is immutable and retried without additional rows',async()=>{
  const fixture=db();const raw=Buffer.from(JSON.stringify(report()));
  const args={raw,sourceSha,mode:'publish',confirm:approved,env,clientFactory:fixture.factory};
  const first=await publishExitReport(args);
  assert.equal(first.status,'PUBLISHED');assert.equal(first.written,1);
  const second=await publishExitReport(args);
  assert.equal(second.written,0);
  await assert.rejects(()=>publishExitReport({...args,sourceSha:'b'.repeat(64)}),
    /EXIT_REPORT_IMMUTABLE_CONFLICT/);
  assert.equal(fixture.calls.filter(s=>s.startsWith('CREATE TABLE')).length,3);
  fixture.close();
});

test('unverified investable recommendations or fabricated model flags are refused',async()=>{
  for(const edit of [{investment_recommendation_enabled:true},
    {trading_calendar_verified:true},{candidate_stocks:[{code:'005930'}]}]){
    const bad={...report(),...edit};const fixture=db();
    await assert.rejects(()=>publishExitReport({raw:Buffer.from(JSON.stringify(bad)),sourceSha,
      mode:'publish',confirm:approved,env,clientFactory:fixture.factory}),
      /INVALID_EXIT_REPORT_OR_UNVERIFIED_ADVICE/);
    assert.equal(fixture.calls.length,0);
    fixture.close();
  }
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {InvalidTursoResearchRequest,validateResearchDay,
  requestTursoResearch,tursoResearchRequestStatus} from '../worker/src/turso-research-request.ts';

const env={TURSO_DATABASE_URL:'libsql://unit.invalid',TURSO_AUTH_TOKEN:'dummy',GITHUB_TOKEN:'dummy'};
const now=new Date('2026-11-20T07:30:00Z'),day='2026-11-19';
function mock(){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE blue_research_signal_audit_v1 (
    trade_day TEXT,row_count INT,source_payload_sha256 TEXT);
    CREATE TABLE blue_research_signals_v1 (
    trade_day TEXT,code TEXT,source_payload_sha256 TEXT);`);
  const calls=[];let closed=0,dispatches=0;
  const factory=()=>({
    async execute(query){
      const sql=typeof query==='string'?query:query.sql;
      const args=typeof query==='string'?[]:query.args;
      calls.push(sql);
      if(/^CREATE TABLE/i.test(sql.trim())){db.exec(sql);return {rows:[],rowsAffected:0};}
      const stmt=db.prepare(sql);
      if(/^(?:INSERT|UPDATE)/i.test(sql.trim())){
        const result=stmt.run(...args);return {rows:[],rowsAffected:result.changes};
      }
      return {rows:stmt.all(...args),rowsAffected:0};
    },close(){closed++;}
  });
  let run=null;let dispatchOK=true;
  const fetcher=async(url,options={})=>{
    if(options.method==='POST'){
      dispatches++;
      assert.match(url,/blue_turso_daily_verified_eod_auto.yml\/dispatches$/);
      const payload=JSON.parse(options.body);
      assert.deepEqual(payload.inputs,{trade_day:day,mode:'apply',
        confirm_write:'blue-turso-eod-research',include_indicators:'false'});
      assert.equal(payload.ref,'main');
      return new Response(null,{status:dispatchOK?204:502});
    }
    assert.match(url,/blue_turso_daily_verified_eod_auto.yml\/runs/);
    return new Response(JSON.stringify({workflow_runs:run?[run]:[]}),{status:200});
  };
  return {db,calls,factory,fetcher,
    get closed(){return closed;},get dispatches(){return dispatches;},
    get run(){return run;},set run(value){run=value;},set dispatchOK(value){dispatchOK=value;}};
}

test('rejects weekends, invalid dates and same-day before KRX close',()=>{
  assert.throws(()=>validateResearchDay('2026-11-21',now),InvalidTursoResearchRequest);
  assert.throws(()=>validateResearchDay('2026-11-31',now),InvalidTursoResearchRequest);
  assert.throws(()=>validateResearchDay('2026-11-20',new Date('2026-11-20T04:00:00Z')),
    /VERIFIED_KRX_EOD_NOT_READY/);
  assert.doesNotThrow(()=>validateResearchDay(day,now));
});

test('a missing Turso day dispatches exactly one approved GitHub workflow, no D1',async()=>{
  const db=mock(),opts={now,factory:db.factory,fetcher:db.fetcher};
  assert.deepEqual(await tursoResearchRequestStatus(env,day,opts),
    {status:'NOT_IMPORTED',day});
  assert.deepEqual(await requestTursoResearch(env,day,opts),
    {status:'PENDING',day,deduplicated:false});
  assert.deepEqual(await requestTursoResearch(env,day,opts),
    {status:'PENDING',day,deduplicated:true});
  assert.equal(db.dispatches,1);
  const pending=await tursoResearchRequestStatus(env,day,opts);
  assert.equal(pending.status,'PENDING');
  assert.ok(db.calls.every(x=>!x.includes(' D1 ')&&!x.includes('scan_requests')));
  assert.equal(db.closed,4);
  db.db.close();
});

test('verified audit and exact row count are READY even with zero matches',async()=>{
  const db=mock();db.db.prepare('INSERT INTO blue_research_signal_audit_v1 VALUES (?,?,?)')
    .run(day,0,'source');
  const opts={now,factory:db.factory,fetcher:db.fetcher};
  assert.deepEqual(await requestTursoResearch(env,day,opts),{status:'READY',day});
  assert.deepEqual(await tursoResearchRequestStatus(env,day,opts),{status:'READY',day});
  assert.equal(db.dispatches,0);
  db.db.close();
});

test('incomplete audited day refuses to dispatch or claim a completed result',async()=>{
  const db=mock();db.db.prepare('INSERT INTO blue_research_signal_audit_v1 VALUES (?,?,?)')
    .run(day,12,'source');
  await assert.rejects(()=>requestTursoResearch(env,day,{now,factory:db.factory,fetcher:db.fetcher}),
    /TURSO_RESEARCH_INCOMPLETE_AUDITED_DAY/);
  assert.equal(db.dispatches,0);db.db.close();
});

test('a failed GitHub dispatch is recorded and can be explicitly retried',async()=>{
  const db=mock(),opts={now,factory:db.factory,fetcher:db.fetcher};
  db.dispatchOK=false;
  await assert.rejects(()=>requestTursoResearch(env,day,opts),/GITHUB_DISPATCH_FAILED/);
  assert.equal((await tursoResearchRequestStatus(env,day,opts)).status,'FAILED');
  db.dispatchOK=true;
  assert.equal((await requestTursoResearch(env,day,opts)).status,'PENDING');
  assert.equal(db.dispatches,2);db.db.close();
});

test('GitHub failure shows a verified date-specific run link; stale requests expire',async()=>{
  const db=mock(),opts={now,factory:db.factory,fetcher:db.fetcher};
  await requestTursoResearch(env,day,opts);
  db.run={display_title:`BLUE Turso ${day} · apply`,created_at:now.toISOString(),
    status:'completed',conclusion:'failure',updated_at:now.toISOString(),
    html_url:'https://github.com/ehdud6728-bit/BLUE-Signal-Lab/actions/runs/12345'};
  const result=await tursoResearchRequestStatus(env,day,opts);
  assert.equal(result.status,'FAILED');
  assert.equal(result.actions_url,db.run.html_url);
  const later=new Date(now.getTime()+151*60000);
  assert.equal((await tursoResearchRequestStatus(env,day,{...opts,now:later})).status,'FAILED');
  db.db.close();
});

test('without GitHub token no Turso queue mutations are allowed',async()=>{
  const db=mock();
  await assert.rejects(()=>requestTursoResearch({...env,GITHUB_TOKEN:''},day,
    {now,factory:db.factory,fetcher:db.fetcher}),/GITHUB_DISPATCH_NOT_CONFIGURED/);
  assert.equal(db.calls.length,0);db.db.close();
});

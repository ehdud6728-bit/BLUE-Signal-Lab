import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDirectory,runDirectoryPilot} from './eod-directory-pilot.mjs';

const audit=()=>({asof:'2026-11-17',observed_stocks:2000,
  source_sha256_by_year:{'2026':'a'.repeat(64)},intraday_verified:false,
  same_day_eod:false,data_phase:'HISTORICAL_EOD',target_day_source:'FinanceData/marcap daily'});
const directory=()=>({asof:'2026-11-17',symbols:Array.from({length:1700},(_,i)=>({
  code:String(i).padStart(6,'0'),name:`TEST_${i}`,market:i%2?'KOSPI':'KOSDAQ'}))});

test('dry_run validates a complete EOD directory and never opens Turso',async()=>{
  const r=await runDirectoryPilot({audit:audit(),directory:directory(),
    clientFactory:()=>{throw Error('SHOULD_NOT_CONNECT');}});
  assert.deepEqual(r,{status:'DRY_RUN',asof:'2026-11-17',source_symbols:1700,stored:0});
});

test('validate every symbol before sampling (including outside first 12)',()=>{
  const d=directory();d.symbols[1600].code=d.symbols[0].code;
  assert.throws(()=>prepareDirectory(audit(),d),/INVALID_EOD_SYMBOL_DIRECTORY/);
});

test('reject unverified date, incomplete audit, and unverified same-day source',()=>{
  const a=audit();a.asof='2026-11-18';
  assert.throws(()=>prepareDirectory(a,directory()),/UNVERIFIED_EOD_DIRECTORY/);
  const b=audit();b.intraday_verified=true;
  assert.throws(()=>prepareDirectory(b,directory()),/UNVERIFIED_EOD_DIRECTORY/);
  const c=audit();c.same_day_eod=true;c.data_phase='SAME_DAY_EOD_VERIFIED';
  assert.throws(()=>prepareDirectory(c,directory()),/UNVERIFIED_SAME_DAY_EOD/);
});

test('apply_12 writes at most 12 verified records, reads those keys, and closes',async()=>{
  let closed=0,createCalls=0,writes=0;const table=new Map();
  const clientFactory=()=>{
    createCalls++;
    return {
      async execute(query){
        if(typeof query==='string')return {rows:[]};
        assert.match(query.sql,/WHERE code IN/);
        return {rows:query.args.map(code=>table.get(code)).filter(Boolean)};
      },
      async batch(statements,mode){
        assert.equal(mode,'write');
        assert.equal(statements.length,12);
        for(const s of statements){
          const [code,name,market,asof_day]=s.args;
          table.set(code,{code,name,market,asof_day});writes++;
        }
      },
      close(){closed++;}
    };
  };
  const opts={audit:audit(),directory:directory(),mode:'apply_12',
    env:{TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'REDACTED'},clientFactory};
  const r=await runDirectoryPilot(opts);
  assert.deepEqual(r,{status:'OK',asof:'2026-11-17',source_symbols:1700,stored:12});
  assert.equal(createCalls,1);assert.equal(writes,12);assert.equal(closed,1);
});

test('apply_12 refuses absent credentials and unknown modes before DB access',async()=>{
  const opts={audit:audit(),directory:directory(),mode:'apply_12'};
  await assert.rejects(runDirectoryPilot({...opts,env:{}}),/TURSO_URL_MISSING_OR_INVALID/);
  await assert.rejects(runDirectoryPilot({...opts,mode:'full',env:{}}),/INVALID_PILOT_MODE/);
});

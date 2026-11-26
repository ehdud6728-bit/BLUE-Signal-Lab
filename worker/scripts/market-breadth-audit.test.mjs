import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {independentBreadth,compareBreadth,READ_SQL} from './market-breadth-audit.mjs';
import {readMarketEodBreadth} from '../src/turso-market-ai.ts';
const now=new Date('2026-11-26T04:00:00Z'),days=['2026-11-24','2026-11-25'],source='KRX_OPENAPI_EXACT_DAY_VERIFIED',hash='a'.repeat(64);
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE blue_eod_ingest_audit_v1(trade_day TEXT PRIMARY KEY,row_count INTEGER,source TEXT,day_sha256 TEXT);CREATE TABLE blue_eod_daily_v1(trade_day TEXT,code TEXT,market TEXT,close INTEGER,source TEXT,PRIMARY KEY(trade_day,code))');
 const a=db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES(?,?,?,?)'),s=db.prepare('INSERT INTO blue_eod_daily_v1 VALUES(?,?,?,?,?)');
 for(const [j,d] of days.entries()){
  a.run(d,1700,source,hash);
  for(let i=0;i<1700;i++){const k=j&&i===1699?1700:i;s.run(d,String(k).padStart(6,'0'),i<850?'KOSPI':'KOSDAQ',100+(j?i%3-1:0),source);}
 }
 return db;
}
test('independent raw-row comparison matches production SQL, with a new symbol and three directions',async()=>{
 const db=fixture();
 try{
  const x=independentBreadth(db.prepare(READ_SQL).all(),now);
  const env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'test'};
  const p=await readMarketEodBreadth(env,{now,factory:()=>({execute:async q=>({rows:db.prepare(q.sql).all(...q.args)}),close(){}})});
  compareBreadth(x,p);assert.equal(x.markets[0].unmatched,1);assert.equal(x.markets[1].matched,850);
  assert.ok(x.markets.every(m=>m.up>0&&m.down>0&&m.flat>0));
  assert.throws(()=>compareBreadth(x,{...p,prior_day:'2026-11-23'}),/DATE_CHANGED_RETRY/);
  assert.throws(()=>compareBreadth(x,{...p,markets:p.markets.map(m=>({...m,up:m.up+1}))}),/AGGREGATE_MISMATCH/);
 }finally{db.close();}
});
test('reject incomplete, duplicate, wrong-source and invalid-close rows',()=>{
 const db=fixture();
 try{
  const r=db.prepare(READ_SQL).all();
  assert.throws(()=>independentBreadth(r.slice(1),now),/COUNT_MISMATCH/);
  assert.throws(()=>independentBreadth([...r,r[0]],now),/BAD_ROW/);
  assert.throws(()=>independentBreadth([{...r[0],row_source:'OTHER'},...r.slice(1)],now),/BAD_ROW/);
  assert.throws(()=>independentBreadth([{...r[0],close:0},...r.slice(1)],now),/BAD_CLOSE/);
 }finally{db.close();}
});

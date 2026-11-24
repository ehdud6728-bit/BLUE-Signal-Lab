import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {tursoRotationLeaders} from '../worker/src/turso-rotation-leaders.ts';
test('verified leader candidate snapshot with missing signal provenance and source freshness',async()=>{
 const db=new DatabaseSync(':memory:');
 const env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'fake'};
 const now=new Date('2026-11-24T14:40:00Z'),receipt='2026-11-24',at='2026-11-24T14:30:00Z';
 const factory=()=>({async execute(cmd){assert.match(cmd.sql,/^SELECT\b/);return {rows:db.prepare(cmd.sql).all(...cmd.args)};},close(){}});
 const read=()=>tursoRotationLeaders(env,factory,now);
 try{
  assert.equal((await read()).status,'NOT_CAPTURED');
  db.exec('CREATE TABLE blue_rotation_leaders_v1(receipt_day TEXT PRIMARY KEY,observed_at_utc TEXT,payload_json TEXT,payload_sha256 TEXT); CREATE TABLE blue_market_trends_v1(receipt_day TEXT PRIMARY KEY,payload_sha256 TEXT)');
  const proof='a'.repeat(64);db.prepare('INSERT INTO blue_market_trends_v1 VALUES(?,?)').run(receipt,proof);
  const stock=(code,r5,r10)=>({code,name:code,close:1000,r5,r10,amount:600000000,amount_ratio:2,signals:null});
  const group={code:'0002',name:'시험 업종',rs10:-2,momentum:1,previous_quadrant:null,entry:'UNKNOWN',members:3,matched:3,eligible:3,leaders:[stock('000001',3,10)],followers:[stock('000002',2,1)]};
  const m=market=>({market,improving:1,analyzed:1,master_members:3,matched_members:3,groups:[group]});
  const s={schema:'BLUE_ROTATION_LEADERS_V1',receipt_day:receipt,observed_at_utc:at,master_receipt_day:receipt,master_observed_at_utc:'2026-11-24T14:29:00Z',master_hashes:{KOSPI:proof,KOSDAQ:proof},trend_receipt_day:receipt,trend_sha256:proof,day:'2026-11-23',reference5:'2026-11-16',reference10:'2026-11-09',signal_status:'MISSING',sector_limit:12,thresholds:{minimum_turnover_krw:500000000,leader_min_return10_pct:3,follower_return10_min_pct:-3,follower_return10_max_pct:3,follower_return5_max_pct:3,follower_min_turnover_ratio:1.2},markets:[m('KOSPI'),m('KOSDAQ')]};
  const save=()=>{const raw=JSON.stringify(s);db.prepare('INSERT OR REPLACE INTO blue_rotation_leaders_v1 VALUES(?,?,?,?)').run(receipt,at,raw,createHash('sha256').update(raw).digest('hex'));};
  save();const r=await read();assert.equal(r.status,'READY');assert.equal(r.trend_superseded,false);
  db.exec("UPDATE blue_market_trends_v1 SET payload_sha256='new'");assert.equal((await read()).trend_superseded,true);
  group.followers[0].r10=-15;save();await assert.rejects(read(),/LEADERS_STOCK_RULE_MISMATCH/);
 }finally{db.close();}
});

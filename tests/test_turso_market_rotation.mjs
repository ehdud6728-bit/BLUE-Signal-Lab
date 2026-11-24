import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {tursoMarketRotation} from '../worker/src/turso-market-rotation.ts';
test('market rotation reads only saved observations; does not invent date or missing data',async()=>{
 const db=new DatabaseSync(':memory:');
 const env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'fake'};
 const now=new Date('2026-11-24T08:00:00Z');
 const factory=()=>({async execute(cmd){assert.match(cmd.sql,/^SELECT\b/);return {rows:db.prepare(cmd.sql).all(...cmd.args)};},close(){}});
 const read=()=>tursoMarketRotation(env,factory,now);
 try{
  assert.equal((await read()).status,'NOT_CAPTURED');
  db.exec('CREATE TABLE blue_market_rotation_v1(receipt_day TEXT PRIMARY KEY,observed_at_utc TEXT,payload_json TEXT)');
  const insert=db.prepare('INSERT INTO blue_market_rotation_v1 VALUES(?,?,?)');
  const save=(day,delta,share)=>{
   const at=day+'T06:00:00Z';
   const m=market=>({market,index:2000,change_pct:1,up:60,down:30,flat:10,flow_status:'AVAILABLE',flows:[{day,foreign:'BUY',institution:'SELL',individual:null}],sectors:[{code:'0002',name:'테스트 업종',index:100,change_pct:1+delta,relative_pct:delta,turnover_share_pct:share}]});
   insert.run(day,at,JSON.stringify({schema:'BLUE_KIS_MARKET_V1',receipt_day:day,observed_at_utc:at,quote_trade_day:null,source:'KIS_CATEGORY_AND_DAILY_INVESTOR',markets:[m('KOSPI'),m('KOSDAQ')]}));
  };
  save('2026-11-23',0.5,null);
  assert.equal((await read()).state,'STALE_RECEIPT');
  save('2026-11-24',2,15);
  const result=await read();
  assert.equal(result.status,'READY');assert.equal(result.state,'BROAD_ADVANCE_OBSERVED');
  assert.equal(result.quote_trade_day,null);assert.equal(result.external.vix,null);
  assert.equal(result.markets[0].breadth_pct,60);
  assert.equal(result.markets[0].sectors[0].relative_delta_pp,1.5);
  assert.equal(result.markets[0].sectors[0].share_delta_pp,null);
  db.exec("UPDATE blue_market_rotation_v1 SET payload_json=json_set(payload_json,'$.quote_trade_day','2026-11-24') WHERE receipt_day='2026-11-24'");
  await assert.rejects(read(),/INVALID_MARKET_SNAPSHOT/);
 }finally{db.close();}
});

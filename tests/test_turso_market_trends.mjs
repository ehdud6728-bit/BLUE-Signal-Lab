import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {tursoMarketTrends} from '../worker/src/turso-market-trends.ts';
test('read-only exact dated rotation and hash, no synthetic global index',async()=>{
 const db=new DatabaseSync(':memory:');
 const env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'fake'};
 const now=new Date('2026-11-24T14:30:00Z');
 const factory=()=>({async execute(cmd){assert.match(cmd.sql,/^SELECT\b/);return {rows:db.prepare(cmd.sql).all(...cmd.args)};},close(){}});
 const read=()=>tursoMarketTrends(env,factory,now);
 try{
  assert.equal((await read()).status,'NOT_CAPTURED');
  db.exec('CREATE TABLE blue_market_trends_v1(receipt_day TEXT PRIMARY KEY,observed_at_utc TEXT,payload_json TEXT,payload_sha256 TEXT)');
  const receipt='2026-11-24',at='2026-11-24T14:00:00Z',cutoff='2026-11-23';
  const m=market=>({market,benchmark:{day:cutoff,previous_day:'2026-11-20',close:100,change_pct:1,change5_pct:2,sessions:26},benchmark_sessions:26,universe:1,attempted:1,rows:[{code:'0002',name:'시험',status:'AVAILABLE',reason:null,trend:{day:cutoff,matched_sessions:26,rs5:1,rs10:2,rs20:3,momentum:1,quadrant:'LEADING'}}]});
  const s={schema:'BLUE_ROTATION_TRENDS_V1',receipt_day:receipt,observed_at_utc:at,category_receipt_day:receipt,domestic_cutoff:cutoff,overseas_cutoff:cutoff,markets:[m('KOSPI'),m('KOSDAQ')],global:['.DJI','.NDX','.SPX','.SOX','.VIX'].map(symbol=>({symbol,name:symbol,status:'MISSING',reason:'HISTORY_UNAVAILABLE',summary:null}))};
  const raw=JSON.stringify(s),digest=createHash('sha256').update(raw).digest('hex');
  db.prepare('INSERT INTO blue_market_trends_v1 VALUES(?,?,?,?)').run(receipt,at,raw,digest);
  const result=await read();assert.equal(result.status,'READY');assert.equal(result.markets[0].rows[0].trend.quadrant,'LEADING');assert.equal(result.global[4].summary,null);
  db.exec('CREATE TABLE blue_global_trends_v1(receipt_day TEXT PRIMARY KEY,observed_at_utc TEXT,payload_json TEXT,payload_sha256 TEXT)');
  const g={schema:'BLUE_GLOBAL_TRENDS_V1',receipt_day:receipt,observed_at_utc:'2026-11-24T14:15:00Z',overseas_cutoff:cutoff,global:s.global.map(x=>x.symbol==='.VIX'?{...x,status:'AVAILABLE',reason:null,summary:{day:cutoff,previous_day:'2026-11-20',close:20,change_pct:1,change5_pct:null,sessions:2}}:x)};
  const gr=JSON.stringify(g);
  db.prepare('INSERT INTO blue_global_trends_v1 VALUES(?,?,?,?)').run(receipt,g.observed_at_utc,gr,createHash('sha256').update(gr).digest('hex'));
  const both=await read();assert.equal(both.global_status,'SEPARATE_VERIFIED');assert.equal(both.global[4].summary.close,20);assert.equal(both.markets[0].rows[0].trend.quadrant,'LEADING');
  db.exec("UPDATE blue_global_trends_v1 SET payload_sha256='bad'");
  const fallback=await read();assert.equal(fallback.global_status,'SEPARATE_UNAVAILABLE');assert.equal(fallback.global[4].summary,null);assert.equal(fallback.markets[0].rows[0].trend.quadrant,'LEADING');
  db.exec("UPDATE blue_market_trends_v1 SET payload_sha256='bad'");
  await assert.rejects(read(),/TREND_HASH_MISMATCH/);
 }finally{db.close();}
});

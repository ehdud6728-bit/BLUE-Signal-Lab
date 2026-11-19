import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {verifyIndicatorSnapshot,importIndicatorSnapshot} from './indicator-snapshot-import.mjs';

const day='2026-11-19',sha=x=>createHash('sha256').update(x).digest('hex');
const env={TURSO_DATABASE_URL:'libsql://unit.invalid',TURSO_AUTH_TOKEN:'dummy'};
const fixture=()=>{
  const records=Array.from({length:1700},(_,i)=>({
    trade_day:day,code:String(i).padStart(6,'0'),market:i<850?'KOSPI':'KOSDAQ',
    close_price:10000+i,history_bars:260,
    indicators:{rsi:55.5,ma20:9999},crosses:{rsi_gc:false},
    eligibility:'ELIGIBLE',signal_names:i===12?['BB20']:[],
  }));
  const payload=Buffer.from(records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const manifest={format:'BLUE_TURSO_ALL_MARKET_INDICATORS_V1',
    day,row_count:1700,matched_stocks:1,source:'KRX pykrx verified daily',
    payload_sha256:sha(payload),source_audit_sha256:'a'.repeat(64)};
  return {records,payload,manifest};
};
function mock(){
  const db=new DatabaseSync(':memory:');let closes=0;const calls=[];
  db.exec(`CREATE TABLE blue_eod_ingest_audit_v1(trade_day TEXT,row_count INT);
    CREATE TABLE blue_eod_daily_v1(trade_day TEXT,code TEXT,close INT);`);
  db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES (?,?)').run(day,1700);
  const put=db.prepare('INSERT INTO blue_eod_daily_v1 VALUES (?,?,?)');
  for(let i=0;i<1700;i++)put.run(day,String(i).padStart(6,'0'),10000+i);
  return {db,calls,get closes(){return closes;},factory:()=>({
    async execute(cmd){
      const sql=typeof cmd==='string'?cmd:cmd.sql;
      const args=typeof cmd==='string'?[]:cmd.args;
      calls.push(sql);
      if(/^\s*CREATE/i.test(sql)){db.exec(sql);return {rows:[]};}
      if(/^\s*INSERT/i.test(sql)){db.prepare(sql).run(...args);return {rows:[]};}
      return {rows:db.prepare(sql).all(...args)};
    },close(){closes++;}
  })};
}

test('dry-run checks every row and never connects to Turso',async()=>{
  const f=fixture();
  const out=await importIndicatorSnapshot({...f,mode:'dry_run',clientFactory:()=>{throw Error('called');}});
  assert.deepEqual(out,{status:'DRY_RUN',day,rows:1700,written:0});
});

test('only an intact complete full-market snapshot is accepted',()=>{
  const f=fixture();
  assert.equal(verifyIndicatorSnapshot(f.manifest,f.payload).length,1700);
  assert.throws(()=>verifyIndicatorSnapshot({...f.manifest,payload_sha256:'0'.repeat(64)},f.payload),
    /INDICATOR_PAYLOAD_HASH_MISMATCH/);
  assert.throws(()=>verifyIndicatorSnapshot({...f.manifest,row_count:1699},f.payload),
    /INVALID_INDICATOR_MANIFEST/);
  const changes=Buffer.from(f.payload.toString().replace('"rsi":55.5','"rsi":999'));
  assert.throws(()=>verifyIndicatorSnapshot(f.manifest,changes),/INDICATOR_PAYLOAD_HASH_MISMATCH/);
});

test('apply cross-checks every KRX price, saves immutable rows and reuses existing ones',async()=>{
  const f=fixture(),db=mock();
  const first=await importIndicatorSnapshot({...f,mode:'apply',env,clientFactory:db.factory});
  assert.equal(first.written,1700);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM blue_indicators_daily_v1').get().n,1700);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM blue_indicators_audit_v1').get().n,1);
  const second=await importIndicatorSnapshot({...f,mode:'apply',env,clientFactory:db.factory});
  assert.equal(second.status,'OK');
  assert.equal(second.written,0);
  assert.equal(db.closes,2);
  assert.ok(db.calls.every(q=>!q.includes(' D1 ')));
  db.db.close();
});

test('missing or mismatched verified EOD blocks every indicator write',async()=>{
  const f=fixture(),db=mock();
  db.db.prepare('UPDATE blue_eod_daily_v1 SET close=1 WHERE code=?').run('000012');
  await assert.rejects(()=>importIndicatorSnapshot({...f,mode:'apply',env,clientFactory:db.factory}),
    /TURSO_INDICATOR_EOD_UNIVERSE_OR_PRICE_MISMATCH/);
  assert.ok(!db.calls.some(q=>q.includes('CREATE TABLE IF NOT EXISTS')));
  db.db.close();
});

test('a previously stored conflicting record is never overwritten',async()=>{
  const f=fixture(),db=mock();
  await importIndicatorSnapshot({...f,mode:'apply',env,clientFactory:db.factory});
  db.db.prepare('UPDATE blue_indicators_daily_v1 SET record_json=? WHERE code=?')
    .run('{"corrupted":true}','000012');
  await assert.rejects(()=>importIndicatorSnapshot({...f,mode:'apply',env,clientFactory:db.factory}),
    /TURSO_INDICATOR_RECORD_CONFLICT/);
  db.db.close();
});

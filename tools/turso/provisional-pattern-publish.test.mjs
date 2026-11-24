import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createClient} from '@libsql/client';
import {validateSnapshot,publishSnapshot} from './provisional-pattern-publish.mjs';

const day='2026-11-24',reference='2026-11-23',now=new Date('2026-11-24T12:10:00Z');
function fixture(at='2026-11-24T11:55:00.000Z',scan='2026-11-24T12:00:00Z'){
  const quotes=[{code:'000660',amount:123456,close:100},{code:'005930',amount:null,close:200}]
    .map(v=>({...v,day,reference_day:reference,observed_at_utc:at,source:'KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL'}));
  const items=quotes.map(v=>({code:v.code,date:day,close:v.close,signals:'ENV20',market:'KOSPI',
    source:'KIS_PROVISIONAL',data_frequency:'PROVISIONAL_DAILY',provisional:true,pattern_confirmed:false,
    observed_at_utc:at,turnover_available:v.amount!==null,traded_amount_krw:v.amount,amount_ratio20:v.amount===null?null:1.5}));
  return {quotes,result:{day,status:'KIS_PROVISIONAL',pattern_confirmed:false,scan_asof_utc:scan,
    observed:2,accepted_quotes:2,excluded:0,excluded_reference:0,excluded_ohlcv:0,eligible:2,
    turnover_available_quotes:1,turnover_missing_quotes:1,items,
    quote_coverage:{reference,joined:2,eligible:2,missingAmount:1,turnoverAvailable:1},
    history_metadata:{reference,sessions:460,calendar_verified:false,baseline:'MARCAP'},
    audit:{asof:day,source_latest_date:day,observed_stocks:2,eligible_stocks:2,insufficient_history:0,suspicious_gap_excluded:0,matched_stocks:2,signal_events:2}}};
}
test('dry run validates without opening database, including real null turnover',async()=>{
  const data=fixture();
  const result=await publishSnapshot({...data,clientFactory:()=>{throw Error('DB forbidden')}});
  assert.equal(result.status,'DRY_RUN');assert.equal(result.rows,2);assert.equal(result.written,0);
  assert.equal(result.snapshot_id,validateSnapshot(data.result,data.quotes).id);
});
test('reject altered turnover, close, coverage, future observation and confirmed labels',()=>{
  for(const change of [
    d=>{d.result.items[1].traded_amount_krw=0;},
    d=>{d.result.items[0].traded_amount_krw=123457;},
    d=>{d.result.items[0].close=999;},
    d=>{d.result.items[0].pattern_confirmed=true;},
    d=>{d.result.audit.signal_events=3;},
    d=>{d.quotes[0].observed_at_utc='2026-11-24T12:01:00Z';},
    d=>{d.result.items[1].code='000660';},
  ]){
    const data=fixture();change(data);
    assert.throws(()=>validateSnapshot(data.result,data.quotes),/INVALID_PROVISIONAL_/);
  }
});
test('actual local SQLite: publish, replay, reject stale, replace with zero matches, skip EOD',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'blue-provisional-'));
  const url=pathToFileURL(join(dir,'test.db')).href;
  const db=createClient({url});
  try{
    await db.execute('CREATE TABLE blue_eod_ingest_audit_v1 (trade_day TEXT PRIMARY KEY,row_count INTEGER)');
    await db.execute('CREATE TABLE blue_eod_daily_v1 (trade_day TEXT,code TEXT)');
    await db.execute({sql:'INSERT INTO blue_eod_ingest_audit_v1 VALUES (?,1700)',args:[reference]});
    await db.execute({sql:"WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<1700) INSERT INTO blue_eod_daily_v1 SELECT ?,printf('%06d',n) FROM seq",args:[reference]});
    const publish=data=>publishSnapshot({...data,mode:'apply',now,env:{TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'test'},clientFactory:()=>createClient({url})});
    const first=await publish(fixture());
    assert.equal(first.status,'OK');assert.equal(first.rows,2);
    assert.equal((await publish(fixture())).snapshot_id,first.snapshot_id);
    const older=await publish(fixture('2026-11-24T11:54:00.000Z','2026-11-24T12:01:00Z'));
    assert.equal(older.status,'SKIPPED_STALE');
    const next=fixture('2026-11-24T11:56:00.000Z','2026-11-24T12:02:00Z');
    next.result.items=[];next.result.audit.matched_stocks=0;next.result.audit.signal_events=0;
    const zero=await publish(next);assert.equal(zero.status,'OK');assert.equal(zero.rows,0);
    const head=await db.execute('SELECT * FROM blue_provisional_pattern_head_v1');
    assert.equal(head.rows.length,1);assert.equal(head.rows[0].snapshot_id,zero.snapshot_id);assert.equal(Number(head.rows[0].row_count),0);
    const joined=await db.execute('SELECT r.code FROM blue_provisional_pattern_rows_v1 r JOIN blue_provisional_pattern_head_v1 h ON h.snapshot_id=r.snapshot_id');
    assert.equal(joined.rows.length,0);
    await db.execute({sql:'INSERT INTO blue_eod_ingest_audit_v1 VALUES (?,1700)',args:[day]});
    assert.equal((await publish(fixture('2026-11-24T11:57:00.000Z','2026-11-24T12:03:00Z'))).status,'SKIPPED_VERIFIED_EOD');
    assert.equal((await db.execute('SELECT snapshot_id FROM blue_provisional_pattern_head_v1')).rows[0].snapshot_id,zero.snapshot_id);
  }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

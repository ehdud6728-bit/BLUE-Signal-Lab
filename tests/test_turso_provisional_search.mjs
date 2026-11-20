import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {InvalidProvisionalQuery,provisionalCandleObservations,tursoProvisionalSearch}
  from '../worker/src/turso-provisional-search.ts';

const env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'dummy'};
const now=new Date('2026-11-20T00:30:00.000Z');
function fixture({table=true}={}){
  const db=new DatabaseSync(':memory:'),sql=[];
  db.exec(`CREATE TABLE blue_eod_ingest_audit_v1
    (trade_day TEXT PRIMARY KEY,row_count INTEGER);
    INSERT INTO blue_eod_ingest_audit_v1 VALUES('2026-11-19',2660);
    CREATE TABLE blue_eod_daily_v1(trade_day TEXT,code TEXT,high INTEGER,volume INTEGER);`);
  const eod=db.prepare('INSERT INTO blue_eod_daily_v1 VALUES(?,?,?,?)');
  eod.run('2026-11-19','005930',71500,50000);
  eod.run('2026-11-19','000660',210000,12000);
  for(let i=2;i<2660;i++)eod.run('2026-11-19',String(100000+i),100,1);
  if(table){
    db.exec(`CREATE TABLE blue_kis_provisional_daily_v1 (
      trade_day TEXT,code TEXT,market TEXT,name TEXT,open INTEGER,high INTEGER,
      low INTEGER,close INTEGER,volume INTEGER,reference_day TEXT,
      observed_at_utc TEXT,date_basis TEXT,source TEXT);`);
    const insert=db.prepare(`INSERT INTO blue_kis_provisional_daily_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run('2026-11-20','005930','J','삼성전자',71000,73000,70000,72500,123456,
      '2026-11-19','2026-11-20T00:29:00Z','COLLECTOR_KST_REGULAR_SESSION',
      'KIS_REST_INQUIRE_PRICE_PROVISIONAL');
    insert.run('2026-11-20','000660','J','SK하이닉스',200000,210000,198000,205000,9000,
      '2026-11-19','2026-11-20T00:28:00Z','KIS_REPORTED_TRADE_DATE',
      'KIS_REST_INQUIRE_PRICE_PROVISIONAL');
    // Different reference and non-KIS rows cannot masquerade as today's quote.
    insert.run('2026-11-20','123456','J','wrong-reference',10,12,9,11,100,
      '2026-11-18','2026-11-20T00:29:00Z','KIS_REPORTED_TRADE_DATE',
      'KIS_REST_INQUIRE_PRICE_PROVISIONAL');
    insert.run('2026-11-20','999999','J','wrong-source',10,12,9,11,100,
      '2026-11-19','2026-11-20T00:29:00Z','KIS_REPORTED_TRADE_DATE','UNVERIFIED');
  }
  const factory=()=>({async execute(command){
    const text=typeof command==='string'?command:command.sql;
    const args=typeof command==='string'?[]:command.args;
    sql.push(text);
    assert.match(text,/^\s*SELECT\b/i);
    return {rows:db.prepare(text).all(...args)};
  },close(){db.close();}});
  return {factory,sql};
}

test('same-day saved KIS prices are fast, read-only, and explicitly partial',async()=>{
  const f=fixture();
  const result=await tursoProvisionalSearch(env,new URLSearchParams({date:'2026-11-20'}),f.factory,now);
  assert.equal(result.data_status,'KIS_PARTIAL_PROVISIONAL');
  assert.equal(result.pattern_analysis,false);assert.equal(result.complete_market,false);
  assert.equal(result.reference_market_count,2660);assert.equal(result.observed_count,2);
  assert.equal(result.total,2);assert.equal(result.items.length,2);
  assert.equal(result.items[0].code,'005930');
  assert.equal(result.items[0].pattern_confirmed,false);
  assert.equal(result.observation_preview,true);
  assert.deepEqual(result.items[0].observations,
    ['UP_CANDLE','NEAR_HIGH','ABOVE_REFERENCE_HIGH','DOUBLE_REFERENCE_VOLUME']);
  assert.ok(f.sql.every(sql=>!/(?:INSERT|UPDATE|DELETE|D1|GITHUB_TOKEN|tokenP)/i.test(sql)));
});

test('name filter applies to the stored subset, without fabricating missing stocks',async()=>{
  const f=fixture();
  const result=await tursoProvisionalSearch(env,new URLSearchParams({date:'2026-11-20',q:'하이닉스'}),f.factory,now);
  assert.equal(result.observed_count,2);assert.equal(result.total,1);
  assert.equal(result.items[0].code,'000660');
});

test('uninitialized provisional storage is an honest zero-coverage result',async()=>{
  const f=fixture({table:false});
  const result=await tursoProvisionalSearch(env,new URLSearchParams({date:'2026-11-20'}),f.factory,now);
  assert.equal(result.observed_count,0);assert.equal(result.items.length,0);
  assert.equal(result.complete_market,false);
});

test('previous dates, invalid paging, and injected query text are rejected',async()=>{
  for(const p of [{date:'2026-11-19'},{date:'2026-11-20',limit:'51'},
    {date:'2026-11-20',q:'ab\ncd'}]){
    await assert.rejects(()=>tursoProvisionalSearch(env,new URLSearchParams(p),undefined,now),
      InvalidProvisionalQuery);
  }
});

test('candle previews exclude full BLUE signals and require an audited baseline',async()=>{
  assert.deepEqual(provisionalCandleObservations({open:9,high:10,low:8,price:9,volume:200},null),[]);
  const f=fixture();
  const db=f.factory();
  // Baseline completeness is checked before the provisional table is read.
  assert.ok((await tursoProvisionalSearch(env,
    new URLSearchParams({date:'2026-11-20'}),()=>db,now)).observation_preview);
});

test('API route and PWA label provisional data separately from verified research',()=>{
  const api=readFileSync(new URL('../worker/src/index.ts',import.meta.url),'utf8');
  const web=readFileSync(new URL('../web/src/main.tsx',import.meta.url),'utf8');
  const card=readFileSync(new URL('../web/src/TursoProvisionalToday.tsx',import.meta.url),'utf8');
  assert.match(api,/\/api\/research\/provisional/);
  assert.match(web,/queryDate===todayKST\(\)&&provisionalWindowKST\(\)/);
  assert.match(web,/TursoProvisionalToday/);
  assert.match(card,/KIS 미확정 관측값/);
});

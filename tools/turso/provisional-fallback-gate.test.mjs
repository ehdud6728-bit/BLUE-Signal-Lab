import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {checkKisFallback,fallbackGateLine} from './provisional-fallback-gate.mjs';

function fixture({prior=2,provisional=1,current=0}={}){
  const db=new DatabaseSync(':memory:'),queries=[];
  db.exec(`CREATE TABLE blue_eod_ingest_audit_v1(trade_day TEXT,row_count INTEGER);
    CREATE TABLE blue_eod_daily_v1(trade_day TEXT,code TEXT);
    CREATE TABLE blue_kis_provisional_daily_v1(trade_day TEXT,code TEXT,
      reference_day TEXT,market TEXT,source TEXT,date_basis TEXT,
      open INTEGER,high INTEGER,low INTEGER,close INTEGER,volume INTEGER);
    INSERT INTO blue_eod_ingest_audit_v1 VALUES('2026-11-19',1700);`);
  const eod=db.prepare('INSERT INTO blue_eod_daily_v1 VALUES(?,?)');
  for(let i=0;i<prior;i++)eod.run('2026-11-19',String(i));
  if(current){
    db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES(?,?)').run('2026-11-20',1700);
    for(let i=0;i<current;i++)eod.run('2026-11-20',String(i));
  }
  const insert=db.prepare(`INSERT INTO blue_kis_provisional_daily_v1 VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
  for(let i=0;i<provisional;i++)insert.run('2026-11-20',String(i),
    '2026-11-19','J','KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL',
    'KIS_REPORTED_TRADE_DATE',10,12,9,11,100);
  return {db,client:{async execute(q){queries.push(q.sql);
    assert.match(q.sql,/^\s*SELECT\b/i);
    return {rows:db.prepare(q.sql).all(...(q.args||[]))};}},queries};
}

test('KRX rejection audits only existing KIS subset; never presents it as EOD',async()=>{
  const f=fixture({prior:1700,provisional:2});
  const r=await checkKisFallback(f.client,'2026-11-20');
  assert.equal(r.status,'KIS_PARTIAL_PROVISIONAL');
  assert.equal(r.provisional_count,2);assert.equal(r.verified_count,0);
  assert.match(fallbackGateLine(r),/research_written=0 confirmed_eod_written=0/);
  assert.ok(f.queries.every(x=>/^\s*SELECT\b/i.test(x)));
  f.db.close();
});

test('missing or unverified KIS references do not make a false success',async()=>{
  for(const opts of [{prior:1699,provisional:1},{prior:1700,provisional:0}]){
    const f=fixture(opts);
    await assert.rejects(()=>checkKisFallback(f.client,'2026-11-20'),
      /INCOMPLETE_KIS_REFERENCE|KIS_PROVISIONAL_NOT_AVAILABLE/);
    f.db.close();
  }
});

test('existing audited KRX EOD cannot masquerade as a KIS fallback or completed research',async()=>{
  const f=fixture({prior:1700,current:1700});
  await assert.rejects(()=>checkKisFallback(f.client,'2026-11-20'),
    /EXISTING_EOD_RESEARCH_PENDING/);
  const before=f.queries.length;
  await assert.rejects(()=>checkKisFallback(f.client,'2026-11-20\n'),/INVALID_FALLBACK_DAY/);
  assert.equal(f.queries.length,before);
  f.db.close();
});

test('daily Actions skips EVERY confirmed EOD/research/indicator writer after KRX failure',()=>{
  const yaml=readFileSync(new URL('../../.github/workflows/blue_turso_daily_verified_eod_auto.yml',import.meta.url),'utf8');
  assert.match(yaml,/id: krx_fetch\n\s+continue-on-error: true/);
  assert.match(yaml,/On KRX failure collect exact-day KIS secondary observations \(apply only\)/);
  assert.match(yaml,/krx-kis-fallback-collect\.mjs --mode=apply --day="\$TRADE_DAY"/);
  assert.match(yaml,/if: \$\{\{ steps\.krx_fetch\.outcome == 'failure' && env\.MODE == 'apply' \}\}/);
  assert.match(yaml,/On KRX failure audit KIS provisional observations without confirming EOD/);
  assert.match(yaml,/provisional-fallback-gate\.mjs --day="\$TRADE_DAY"/);
  const steps=yaml.split(/(?=^      - name: )/m);
  const protectedNames=['Test strict idempotent Turso writer',
    'Validate manifest and daily source hashes without DB access',
    'Write verified KRX EOD into Turso only and audit read-back',
    'Scan full market patterns for the SAME verified KST date',
    'Save research only after Turso EOD audit and exact close match',
    'Apply full-market indicators only with explicit independent opt-in'];
  for(const name of protectedNames){
    const step=steps.find(s=>s.startsWith(`      - name: ${name}\n`));
    assert.ok(step,name);
    assert.match(step,/if: \$\{\{ steps\.krx_fetch\.outcome == 'success'/);
  }
});

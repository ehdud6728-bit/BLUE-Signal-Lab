import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {InvalidResearchQuery,tursoResearchDates,tursoResearchSearch,tursoResearchChart} from '../worker/src/turso-research.ts';

const env={TURSO_DATABASE_URL:'libsql://unit.invalid',TURSO_AUTH_TOKEN:'dummy'};
const day='2026-11-18';
function setup({partial=false,backendError=false}={}){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE blue_research_signal_audit_v1 (
    trade_day TEXT,row_count INT,observed_stocks INT,signal_events INT,source_payload_sha256 TEXT);
    CREATE TABLE blue_research_signals_v1 (
    trade_day TEXT,code TEXT,run_id TEXT,signal_names TEXT,close_price INT,
    row_sha256 TEXT,source_payload_sha256 TEXT,record_json TEXT);
    CREATE TABLE blue_eod_daily_v1 (trade_day TEXT,code TEXT,high INT,low INT);
    CREATE TABLE blue_eod_ingest_audit_v1 (trade_day TEXT,row_count INT);`);
  const make=(code,price,names,extras,up)=>JSON.stringify({trade_day:day,code,
    run_id:'blue_market_20261118',signal_names:names,close_price:price,
    supply_distance_pct:3.1,extras,chart:{version:'R10_CHART_V1',asof:day,bars:[{t:day,c:price}]},
    stats:{setups:[{label:'반등 패턴',horizons:{'10':{n:4,up_pct:up,
      median_return_pct:3,mean_return_pct:4,cases:[{signal_day:'2026-10-15'}]}}}]}});
  const rows=[
    ['005930',10000,'BB20,ENV20_LOWER_TOUCH',{
      name:'삼성전자',traded_amount_krw:'200000000000',rsi_gc:'true',
      ma20:'1000',ma40:'2000',ma60:'3000',ma112_cross:'true',amount_ratio20:'3.4'},75],
    ['000660',20000,'BB30',{
      name:'SK하이닉스',traded_amount_krw:'300000000000',amount_ratio20:'1.4'},40],
  ];
  db.prepare(`INSERT INTO blue_research_signal_audit_v1 VALUES (?,?,?,?,?)`)
    .run(day,2,2660,3,'abc');
  for(const [code,close,names,extras,up] of rows.slice(0,partial?1:2)){
    db.prepare(`INSERT INTO blue_research_signals_v1 VALUES (?,?,?,?,?,?,?,?)`)
      .run(day,code,'blue_market_20261118',names,close,'hash','abc',make(code,close,names,extras,up));
  }
  db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES (?,?)').run('2026-11-19',2660);
  db.prepare('INSERT INTO blue_eod_daily_v1 VALUES (?,?,?,?)').run('2026-11-19','005930',11100,9000);
  let closed=0;const calls=[];
  const factory=()=>({async execute(cmd){
    const sql=typeof cmd==='string'?cmd:cmd.sql,args=typeof cmd==='string'?[]:cmd.args;
    calls.push({sql,args});
    if(backendError)throw Error('Turso test offline');
    assert.match(sql,/^(?:WITH|SELECT)\b/i);
    return {rows:db.prepare(sql).all(...args)};
  },close(){closed++;db.close();}});
  return {factory,calls,get closed(){return closed;}};
}

test('dates are independently audited and require no D1',async()=>{
  const db=setup(),out=await tursoResearchDates(env,db.factory);
  assert.equal(out.latest,day);
  assert.equal(out.storage,'TURSO');
  assert.deepEqual(out.items[0],{day,matched_stocks:2,observed_stocks:2660,signal_events:3});
  assert.equal(db.closed,1);
  assert.equal(db.calls.length,1);
});

test('all filters are evaluated before paging with exact historical chart setups',async()=>{
  const db=setup();
  const p=new URLSearchParams({mode:'single',date:day,signals:'BB20',gc:'rsi',
    tech:'inverse,ma112',tech_logic:'all',q:'삼성',min_amount_eok:'100',
    only_pattern:'1',min_pattern_up:'70',min_pattern_n:'3',sort:'recent',limit:'1'});
  const out=await tursoResearchSearch(env,p,db.factory);
  assert.equal(out.total,1);
  assert.equal(out.items[0].name,'삼성전자');
  assert.equal(out.items[0].extras.r159_pattern_up_10d,75);
  assert.equal(out.items[0].extras.r159_pattern_n_10d,4);
  assert.equal(out.items[0].signals[0],'BB20');
  assert.equal(db.calls.length,4);
  assert.equal(db.calls.every(c=>!c.sql.includes('삼성')),true);
  assert.equal(db.closed,1);
});

test('sort can rank only later independently audited EOD prices, marked incomplete',async()=>{
  const db=setup();
  const out=await tursoResearchSearch(env,new URLSearchParams({date:day,sort:'highest_gain'}),db.factory);
  assert.equal(out.total,2);
  assert.equal(out.items[0].code,'005930');
  assert.equal(out.items[0].observed_high_pct,11.00000000000001);
  assert.equal(out.high_complete,false);
});

test('an incomplete audit day fails closed instead of showing partial stock universe',async()=>{
  const db=setup({partial:true});
  await assert.rejects(()=>tursoResearchSearch(env,new URLSearchParams({date:day}),db.factory),
    /TURSO_RESEARCH_INCOMPLETE_AUDITED_DAY/);
  assert.equal(db.closed,1);
});

test('chart is served from the exact Turso research snapshot, without a D1 lookup',async()=>{
  const db=setup();
  const out=await tursoResearchChart(env,new URLSearchParams({date:day,code:'005930'}),db.factory);
  assert.equal(out.status,'READY');
  assert.equal(out.chart?.asof,day);
  assert.equal(out.chart?.bars.at(-1)?.c,10000);
  assert.equal(out.stats?.setups[0].label,'반등 패턴');
  assert.equal(db.closed,1);
  assert.equal(db.calls.length,2);
  assert.ok(db.calls.every(c=>!c.sql.includes('chart_snapshots')));
});

test('chart refuses incomplete days and missing symbols rather than using later data',async()=>{
  const partial=setup({partial:true});
  await assert.rejects(()=>tursoResearchChart(env,new URLSearchParams({date:day,code:'005930'}),partial.factory),
    /TURSO_RESEARCH_INCOMPLETE_AUDITED_DAY/);
  const missing=setup();
  const out=await tursoResearchChart(env,new URLSearchParams({date:day,code:'999999'}),missing.factory);
  assert.equal(out.status,'NOT_AVAILABLE');
  assert.equal(missing.closed,1);
});

test('invalid queries, malformed source date, and injection never touch database',async()=>{
  const attempts=[{date:'2026-11-31'},{date:day,sort:'DROP TABLE'},
    {date:day,signals:'BAD'},{date:day,tech:'unlisted'},{date:day,page:'-1'},
    {date:day,min_pattern_n:'2'},{date:day,min_pattern_up:'88'},
    {date:day,run_id:'blue_market_20261118;--'}];
  const db=setup();
  for(const params of attempts){
    await assert.rejects(()=>tursoResearchSearch(env,new URLSearchParams(params),db.factory),InvalidResearchQuery);
  }
  assert.equal(db.calls.length,0);
  // Safe, parameterized LIKE escaping; even wildcards do not change query SQL.
  const escaped=await tursoResearchSearch(env,new URLSearchParams({date:day,q:"' OR 1=1 --%_"}),db.factory);
  assert.equal(escaped.total,0);
  assert.equal(db.calls.every(c=>!c.sql.includes('OR 1=1 --')),true);
});

test('missing secrets and Turso outage never trigger implicit D1 access',async()=>{
  const db=setup({backendError:true});
  await assert.rejects(()=>tursoResearchDates({...env,TURSO_AUTH_TOKEN:''},db.factory),
    /TURSO_RESEARCH_NOT_CONFIGURED/);
  assert.equal(db.calls.length,0);
  await assert.rejects(()=>tursoResearchDates(env,db.factory),/Turso test offline/);
  assert.equal(db.closed,1);
});

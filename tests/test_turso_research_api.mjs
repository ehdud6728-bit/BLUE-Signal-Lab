import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {InvalidResearchQuery,tursoResearchDates,tursoResearchSearch,tursoResearchChart,
  tursoResearchCoverage,tursoPatternPulse,tursoExitStudyReport} from '../worker/src/turso-research.ts';

const env={TURSO_DATABASE_URL:'libsql://unit.invalid',TURSO_AUTH_TOKEN:'dummy'};
const day='2026-11-18';
function setup({partial=false,backendError=false,wrongSource=false,additionalDays=false,
  publishedReport=false,unsafeReport=false,pathReport=false,invalidPath=false,recentCandles=false}={}){
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE blue_research_signal_audit_v1 (
    trade_day TEXT,row_count INT,observed_stocks INT,signal_events INT,source_payload_sha256 TEXT);
    CREATE TABLE blue_research_signals_v1 (
    trade_day TEXT,code TEXT,run_id TEXT,signal_names TEXT,close_price INT,
    row_sha256 TEXT,source_payload_sha256 TEXT,record_json TEXT);
    CREATE TABLE blue_eod_daily_v1 (trade_day TEXT,code TEXT,high INT,low INT,open INT,close INT);
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
      .run(day,code,'blue_market_20261118',names,close,'hash',wrongSource&&code==='000660'?'wrong':'abc',
        make(code,close,names,extras,up));
  }
  if(additionalDays){
    const dates=['2026-11-17','2026-11-16','2026-11-13','2026-11-12',
      '2026-11-11','2026-11-10','2026-11-09','2026-11-06','2026-11-05'];
    for(const [i,tradeDay] of dates.entries()){
      const recent=i<4,names=recent?'BB20,BB30':'BB30';
      db.prepare('INSERT INTO blue_research_signal_audit_v1 VALUES (?,?,?,?,?)')
        .run(tradeDay,2,2660,recent?4:3,'abc');
      db.prepare('INSERT INTO blue_research_signals_v1 VALUES (?,?,?,?,?,?,?,?)')
        .run(tradeDay,'005930','blue_market_test','BB20,ENV20_LOWER_TOUCH',10000,'hash','abc','{}');
      db.prepare('INSERT INTO blue_research_signals_v1 VALUES (?,?,?,?,?,?,?,?)')
        .run(tradeDay,'000660','blue_market_test',names,20000,'hash','abc','{}');
    }
  }
  db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES (?,?)').run('2026-11-19',2660);
  db.prepare('INSERT INTO blue_eod_daily_v1 (trade_day,code,high,low) VALUES (?,?,?,?)').run('2026-11-19','005930',11100,9000);
  if(recentCandles){
    const d='2026-11-24';
    const fixtures=[['000001',100,120,80,90,100],['000002',100,105,80,90,100],['000003',100,null,null,null,null],['000004',100,120,80,90,101]];
    db.prepare('INSERT INTO blue_research_signal_audit_v1 VALUES (?,?,?,?,?)').run(d,fixtures.length,2660,fixtures.length,'abc');
    db.prepare('INSERT INTO blue_eod_ingest_audit_v1 VALUES (?,?)').run(d,2660);
    for(const [code,price,h,l,o,c] of fixtures){
      const record=JSON.parse(make(code,price,'ENV20_LOWER_TOUCH',{recent_candle_match:'forged'},75));
      record.trade_day=d;record.chart.asof=d;
      db.prepare('INSERT INTO blue_research_signals_v1 VALUES (?,?,?,?,?,?,?,?)').run(d,code,'blue_market_20261124','ENV20_LOWER_TOUCH',price,'hash','abc',JSON.stringify(record));
      if(h!==null)db.prepare('INSERT INTO blue_eod_daily_v1 VALUES (?,?,?,?,?,?)').run(d,code,h,l,o,c);
    }
  }
  if(publishedReport){
    db.exec(`CREATE TABLE blue_pattern_exit_reports_v1 (
      asof_day TEXT,report_json TEXT,report_sha256 TEXT)`);
    const report={schema:'BLUE_TURSO_PATTERN_EXIT_REPORT_V1',storage:'TURSO',
      asof_day:'2026-11-19',eod_audited_days:9,research_audited_days:5,
      short_and_long_windows:[5,10,20,60,120,250,500].map(sessions=>({sessions})),
      trading_calendar_verified:false,corporate_actions_verified:false,
      market_and_sector_benchmark_verified:false,
      investment_recommendation_enabled:unsafeReport,candidate_stocks:[],
      ...(pathReport?{observed_path_windows:[5,10,20,60].map(holding_sessions=>({
        holding_sessions,mature_signal_stock_days:3,pending_recent:2,
        excluded_missing_price_path:0,investment_recommendation_enabled:false,
        same_session_order_knowable:false,
        patterns:[{pattern:'BB20',n:3,median_max_gain_pct:7,
          median_max_loss_pct:-3,low_first_count:1,high_first_count:1,
          same_session_unresolved_count:invalidPath?10:1}]}))}:{}),};
    db.prepare('INSERT INTO blue_pattern_exit_reports_v1 VALUES (?,?,?)')
      .run('2026-11-19',JSON.stringify(report),'a'.repeat(64));
  }
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

test('AI readiness is audit-ledger coverage only and does not invent history',async()=>{
  const db=setup(),out=await tursoResearchCoverage(env,db.factory);
  assert.equal(out.storage,'TURSO');
  assert.equal(out.status,'AUDIT_COUNTS_ONLY');
  assert.deepEqual(out.eod,{audited_days:1,first_day:'2026-11-19',
    last_day:'2026-11-19',declared_rows:2660});
  assert.equal(out.research.audited_days,1);
  assert.equal(out.readiness,'INSUFFICIENT_FOR_RECENT_EXIT_RESEARCH');
  assert.deepEqual(out.goals.rolling_windows,[5,10,20,60,120,250,500]);
  assert.equal(db.calls.length,2);
  assert.ok(db.calls.every(x=>!x.sql.includes('D1')&&!x.sql.includes('scan_requests')));
  assert.equal(db.closed,1);
});

test('recent five-day pulse reports audited pattern activity only, never profitability',async()=>{
  const db=setup(),out=await tursoPatternPulse(env,db.factory);
  assert.equal(out.storage,'TURSO');
  assert.equal(out.status,'PARTIAL_PATTERN_ACTIVITY');
  assert.equal(out.recent_days.length,1);
  assert.equal(out.prior_days.length,0);
  assert.equal(out.baseline_complete,false);
  assert.equal(out.outcomes_verified,false);
  assert.equal(out.patterns.length,3);
  assert.deepEqual(out.patterns.map(x=>x.name).sort(),['BB20','BB30','ENV20_LOWER_TOUCH']);
  assert.ok(out.patterns.every(x=>x.recent_occurrences===1&&x.relative_change_pct===null));
  assert.equal(db.calls.length,3);
  assert.ok(db.calls.every(x=>!x.sql.includes('ai_analysis_cache')));
  assert.equal(db.closed,1);
});

test('incomplete research rows are rejected before any pulse trend is returned',async()=>{
  const db=setup({partial:true});
  await assert.rejects(()=>tursoPatternPulse(env,db.factory),
    /TURSO_PULSE_INCOMPLETE_AUDITED_DAY/);
  assert.equal(db.closed,1);
});

test('five audited days compare to five previous audited days on normalized counts',async()=>{
  const db=setup({additionalDays:true}),out=await tursoPatternPulse(env,db.factory);
  assert.equal(out.status,'AUDITED_PATTERN_ACTIVITY');
  assert.equal(out.recent_days.length,5);
  assert.equal(out.prior_days.length,5);
  assert.equal(out.baseline_complete,true);
  assert.equal(out.session_continuity_verified,false);
  const bb20=out.patterns.find(p=>p.name==='BB20');
  assert.equal(bb20?.recent_occurrences,9);
  assert.equal(bb20?.previous_occurrences,5);
  assert.equal(bb20?.relative_change_pct,80);
  assert.equal(out.patterns[0].name,'BB20');
  assert.equal(db.calls.length,3);
  assert.equal(db.closed,1);
});

test('even with matching row counts a wrong audit source hash rejects the pulse',async()=>{
  const db=setup({wrongSource:true});
  await assert.rejects(()=>tursoPatternPulse(env,db.factory),
    /TURSO_PULSE_INCOMPLETE_AUDITED_DAY/);
  assert.equal(db.closed,1);
});

test('unpublished exit research has an honest, read-only Turso empty state',async()=>{
  const db=setup(),out=await tursoExitStudyReport(env,db.factory);
  assert.equal(out.status,'NOT_PUBLISHED');
  assert.equal(out.report,null);
  assert.equal(db.calls.length,1);
  assert.match(db.calls[0].sql,/sqlite_master/);
  assert.equal(db.closed,1);
});

test('published exploratory study is served without D1 and cannot contain active advice',async()=>{
  const db=setup({publishedReport:true}),out=await tursoExitStudyReport(env,db.factory);
  assert.equal(out.status,'EXPLORATORY_ONLY');
  assert.equal(out.report.asof_day,'2026-11-19');
  assert.equal(out.report.investment_recommendation_enabled,false);
  assert.equal(db.calls.length,2);
  assert.ok(db.calls.every(x=>!x.sql.includes('ai_analysis_cache')));
  assert.equal(db.closed,1);
  const unsafe=setup({publishedReport:true,unsafeReport:true});
  await assert.rejects(()=>tursoExitStudyReport(env,unsafe.factory),
    /INVALID_TURSO_EXIT_REPORT/);
  assert.equal(unsafe.closed,1);
});

test('old report remains readable; bounded new observed path report validates extrema ordering counts',async()=>{
 const okay=setup({publishedReport:true,pathReport:true});
 const out=await tursoExitStudyReport(env,okay.factory);
 assert.equal(out.report.observed_path_windows.length,4);
 assert.equal(out.report.observed_path_windows[0].patterns[0].low_first_count,1);
 assert.equal(okay.closed,1);
 const invalid=setup({publishedReport:true,pathReport:true,invalidPath:true});
 await assert.rejects(()=>tursoExitStudyReport(env,invalid.factory),/INVALID_TURSO_EXIT_REPORT/);
 assert.equal(invalid.closed,1);
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
  assert.equal(out.reason,'NO_SIGNAL_FOR_SYMBOL');
  assert.equal(missing.closed,1);
});

test('only an entirely unimported Turso research day allows D1 chart fallback',async()=>{
 const db=setup();
 const out=await tursoResearchChart(env,new URLSearchParams({date:'2026-11-17',code:'005930'}),db.factory);
 assert.equal(out.status,'NOT_AVAILABLE');
 assert.equal(out.reason,'DAY_NOT_IMPORTED');
 assert.equal(db.closed,1);
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

test('recent candle match requires exact audited OHLC, rejects missing and conflicting bars',async()=>{
 const db=setup({recentCandles:true});
 const out=await tursoResearchSearch(env,new URLSearchParams({date:'2026-11-24'}),db.factory);
 assert.equal(out.total,4);
 assert.deepEqual(out.items.filter(r=>r.extras.recent_candle_match).map(r=>r.code),['000001']);
 assert.equal(out.items.find(r=>r.code==='000001').extras.recent_candle_match,'ENV20_BULL_CLOSE_MID_20261123');
 assert.equal(db.closed,1);
});

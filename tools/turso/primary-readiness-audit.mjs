/** Bounded, read-only Turso coverage audit for the Turso-primary transition.
 * Does not query D1, decrypt KIS tokens, sample stock payloads, or write SQL.
 * A recent-date audit cannot prove complete historic migration or D1 parity.
 */
import {createClient} from '@libsql/client';

const MAX_DAYS=8;
const MAX_QUOTE_DAYS=3;
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const kstDay=now=>new Date(now.getTime()+9*3600_000).toISOString().slice(0,10);
const daysOld=(asof,day)=>Math.round((Date.parse(asof+'T00:00:00Z')-
  Date.parse(day+'T00:00:00Z'))/86400000);
export const D1_ONLY_DOMAINS=Object.freeze([
  {domain:'legacy_scan_history',tables:['runs','signals','daily_counts','chart_snapshots'],
    consumers:['past_pattern_search','historical_chart','ai_analysis']},
  {domain:'server_basket_watch',tables:['blue_basket_watch_r153'],
    consumers:['basket_progress','historical_high_backfill']},
  {domain:'ai_and_analysis_jobs',tables:['ai_analysis_cache','ai_daily_usage','blue_symbol_analysis_requests_v1'],
    consumers:['ai_report_cache','symbol_analysis_requests']},
  {domain:'legacy_quote_queue',tables:['blue_search_quote_priority_r1594','blue_symbol_live_requests_v1'],
    consumers:['d1_priority_collection','legacy_live_lookup']},
  {domain:'collector_state',tables:['blue_kis_first_seen_r154','blue_kis_collector_runs_r142'],
    consumers:['legacy_candidate_selection','legacy_audit']}
]);

const EOD_SQL=`SELECT a.trade_day,a.row_count AS expected,
  (SELECT COUNT(*) FROM blue_eod_daily_v1 e WHERE e.trade_day=a.trade_day) AS actual
  FROM blue_eod_ingest_audit_v1 a WHERE a.trade_day<=? AND a.row_count>=1700
  ORDER BY a.trade_day DESC LIMIT ?`;
const RESEARCH_SQL=`SELECT a.trade_day,a.row_count AS expected,
  (SELECT COUNT(*) FROM blue_research_signals_v1 s WHERE s.trade_day=a.trade_day
    AND s.source_payload_sha256=a.source_payload_sha256) AS actual
  FROM blue_research_signal_audit_v1 a
  JOIN blue_eod_ingest_audit_v1 e ON e.trade_day=a.trade_day AND e.row_count>=1700
  WHERE a.trade_day<=? AND a.row_count>0
  ORDER BY a.trade_day DESC LIMIT ?`;
const QUOTES_SQL=`SELECT trade_date AS trade_day,COUNT(*) AS n
  FROM blue_kis_live_quotes_r141 WHERE trade_date>=? AND trade_date<=?
  GROUP BY trade_date ORDER BY trade_date DESC LIMIT ?`;

function checkedCounts(rows,asof,min,max){
  if(!Array.isArray(rows)||rows.length>MAX_DAYS)throw Error('TURSO_AUDIT_UNBOUNDED');
  const seen=new Set();
  return rows.map(r=>{
    const day=String(r.trade_day),expected=Number(r.expected),actual=Number(r.actual);
    if(!DAY.test(day)||day>asof||seen.has(day)||!Number.isSafeInteger(expected)||
       expected<min||expected>max||!Number.isSafeInteger(actual)||actual<0||actual>max)
      throw Error('TURSO_AUDIT_INVALID_COUNTS');
    seen.add(day);
    return {day,expected,actual,matched:expected===actual};
  });
}

function quoteCounts(rows,asof){
  if(!Array.isArray(rows)||rows.length>MAX_QUOTE_DAYS)throw Error('TURSO_AUDIT_UNBOUNDED');
  const seen=new Set();
  return rows.map(r=>{
    const day=String(r.trade_day),count=Number(r.n);
    if(!DAY.test(day)||day>asof||seen.has(day)||!Number.isSafeInteger(count)||count<1||count>100000)
      throw Error('TURSO_AUDIT_INVALID_QUOTES');
    seen.add(day);
    return {day,symbols:count};
  });
}

export async function auditTursoPrimary(client,{mode='plan',now=new Date()}={}){
  if(!['plan','turso_recent'].includes(mode))throw Error('TURSO_AUDIT_BAD_MODE');
  const base={asof_kst:kstDay(now),d1_sql_queries:0,d1_history_verified:false,
    remaining_d1_domains:D1_ONLY_DOMAINS};
  if(mode==='plan')return {...base,status:'PLAN_ONLY',turso_sql_queries:0};
  if(!client?.execute)throw Error('TURSO_AUDIT_CLIENT_REQUIRED');
  const asof=base.asof_kst;
  const start=new Date(Date.parse(asof+'T00:00:00Z')-6*86400000).toISOString().slice(0,10);
  const eod=checkedCounts((await client.execute({sql:EOD_SQL,args:[asof,MAX_DAYS]})).rows,asof,1700,10000);
  const research=checkedCounts((await client.execute({sql:RESEARCH_SQL,args:[asof,MAX_DAYS]})).rows,asof,1,10000);
  const quotes=quoteCounts((await client.execute({sql:QUOTES_SQL,
    args:[start,asof,MAX_QUOTE_DAYS]})).rows,asof);
  const mismatch=[...eod,...research].some(r=>!r.matched);
  const eodAge=eod.length?Math.min(...eod.map(r=>daysOld(asof,r.day))):null;
  const researchAge=research.length?Math.min(...research.map(r=>daysOld(asof,r.day))):null;
  const status=!eod.length?'NO_VERIFIED_EOD':!research.length?'NO_VERIFIED_RESEARCH':
    mismatch?'AUDIT_COUNT_MISMATCH':eodAge>7||researchAge>7?'STALE_VERIFIED_DAYS':
    'RECENT_TURSO_COUNTS_MATCH';
  return {...base,status,
    turso_sql_queries:3,eod_days:eod,research_days:research,quote_days:quotes,
    latest_eod_age_days:eodAge,latest_research_age_days:researchAge,
    scope:'LAST_8_AUDITED_DAYS_AND_UP_TO_3_QUOTE_DAYS_IN_LAST_7_CALENDAR_DAYS',
    full_history_migrated:false,all_app_features_turso_independent:false};
}

async function main(){
  const mode=process.env.AUDIT_MODE||'plan';
  if(mode==='plan'){
    console.log('BLUE_TURSO_PRIMARY_AUDIT '+JSON.stringify(await auditTursoPrimary(null,{mode})));
    return;
  }
  const url=String(process.env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(process.env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(libsql|https):\/\//.test(url)||!authToken)throw Error('TURSO_AUDIT_CONFIG_MISSING');
  const client=createClient({url,authToken,intMode:'string'});
  try{
    const report=await auditTursoPrimary(client,{mode});
    console.log('BLUE_TURSO_PRIMARY_AUDIT '+JSON.stringify(report));
    if(report.status!=='RECENT_TURSO_COUNTS_MATCH')process.exitCode=1;
  }finally{client.close();}
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(()=>{console.error('BLUE_TURSO_PRIMARY_AUDIT_FAILED');process.exitCode=1;});
}

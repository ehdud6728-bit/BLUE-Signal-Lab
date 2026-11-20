/** Read-only horizon inventory for short and long AI pattern research.
 * Audit rows are evidence of a saved snapshot, NOT proof of consecutive KRX
 * sessions, matured outcomes, price adjustment, or profitable predictions.
 * No D1, KIS, AI, raw stock payloads, SQL writes, or orders.
 */
import {createClient} from '@libsql/client';

export const SHORT_HORIZONS=Object.freeze([5,10,20,60]);
export const LONG_HORIZONS=Object.freeze([120,250,500]);
const MAX_AUDIT_DAYS=520;
const READBACK_DAYS=8;
const HORIZON_CALENDAR_DAYS=760;
const TABLES=Object.freeze({
  eod:{audit:'blue_eod_ingest_audit_v1',data:'blue_eod_daily_v1',min:1700},
  research:{audit:'blue_research_signal_audit_v1',data:'blue_research_signals_v1',min:0},
  indicators:{audit:'blue_indicators_audit_v1',data:'blue_indicators_daily_v1',min:1700}
});

function kstDate(now){return new Date(now.getTime()+9*3600000).toISOString().slice(0,10);}
function validDate(day){return typeof day==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(day)&&
  !Number.isNaN(Date.parse(day+'T00:00:00Z'))&&
  new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;}
function count(value,min,max){const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('AI_HORIZON_AUDIT_INVALID_COUNT');
  return n;}
function parseRows(rows,kind,start,end){
  if(!Array.isArray(rows)||rows.length>MAX_AUDIT_DAYS)throw Error('AI_HORIZON_AUDIT_OVER_LIMIT');
  const result=[];let prev='9999-99-99';
  for(const r of rows){
    const day=String(r.trade_day),expected=count(r.row_count,TABLES[kind].min,10000);
    if(!validDate(day)||day<start||day>end||day>=prev)throw Error('AI_HORIZON_AUDIT_BAD_DAY');
    const observed=kind==='research'?count(r.observed_stocks,1700,10000):null;
    if(observed!==null&&expected>observed)throw Error('AI_HORIZON_AUDIT_BAD_RESEARCH');
    result.push({day,expected,...(observed===null?{}:{observed})});prev=day;
  }
  return result;
}
function weekdayCandidates(days){
  if(days.length<2)return {count:0,first_20:[],note:'휴장일을 제외하지 않은 평일 후보입니다.'};
  const set=new Set(days.map(r=>r.day));const newest=days[0].day,oldest=days.at(-1).day;
  const missing=[];
  for(let time=Date.parse(oldest+'T00:00:00Z');time<=Date.parse(newest+'T00:00:00Z');time+=86400000){
    const d=new Date(time),day=d.toISOString().slice(0,10);
    if(d.getUTCDay()!==0&&d.getUTCDay()!==6&&!set.has(day))missing.push(day);
  }
  return {count:missing.length,first_20:missing.slice(0,20),
    note:'KRX 휴장일·상장상태를 대조하지 않은 평일 누락 후보입니다. 확정 누락으로 판단하지 마세요.'};
}
function summary(rows){return {audited_days:rows.length,first_day:rows.at(-1)?.day||null,
  last_day:rows[0]?.day||null,declared_rows:rows.reduce((s,r)=>s+r.expected,0)};}
function horizons(eod,research,windows){
  const researchDays=new Set(research.map(r=>r.day));
  return windows.map(sessions=>{
    const observed=eod.slice(0,sessions);
    return {sessions,audited_eod_dates:observed.length,
      research_dates_on_eod:observed.filter(r=>researchDays.has(r.day)).length,
      start_day:observed.at(-1)?.day||null,end_day:observed[0]?.day||null,
      ledger_count_filled:observed.length===sessions,
      session_continuity_verified:false,outcome_maturity_verified:false};
  });
}
async function sampledReadback(client,kind,rows){
  const sample=rows.slice(0,READBACK_DAYS);
  if(sample.length===0)return [];
  const {data}=TABLES[kind];const placeholders=sample.map(()=>'?').join(',');
  const sql=kind==='research'?`SELECT s.trade_day,COUNT(*) AS actual
      FROM blue_research_signals_v1 s JOIN blue_research_signal_audit_v1 a
      ON a.trade_day=s.trade_day AND a.source_payload_sha256=s.source_payload_sha256
      WHERE s.trade_day IN (${placeholders}) GROUP BY s.trade_day`:
    kind==='indicators'?`SELECT s.trade_day,COUNT(*) AS actual
      FROM blue_indicators_daily_v1 s JOIN blue_indicators_audit_v1 a
      ON a.trade_day=s.trade_day AND a.source_payload_sha256=s.source_payload_sha256
      WHERE s.trade_day IN (${placeholders}) GROUP BY s.trade_day`:
    `SELECT trade_day,COUNT(*) AS actual FROM ${data}
      WHERE trade_day IN (${placeholders}) GROUP BY trade_day`;
  const result=await client.execute({sql,
    args:sample.map(x=>x.day)});
  const actual=new Map();
  for(const r of result.rows){
    const day=String(r.trade_day);
    if(!sample.some(x=>x.day===day)||actual.has(day))throw Error('AI_HORIZON_AUDIT_INVALID_READBACK');
    actual.set(day,count(r.actual,0,10000));
  }
  return sample.map(r=>({day:r.day,expected:r.expected,actual:actual.get(r.day)||0,
    matched:r.expected===(actual.get(r.day)||0)}));
}

export async function auditAiPatternHorizons(client,{mode='plan',now=new Date()}={}){
  if(!['plan','audit'].includes(mode)||!(now instanceof Date)||!Number.isFinite(now.getTime()))
    throw Error('AI_HORIZON_AUDIT_INVALID_MODE');
  const base={asof_kst:kstDate(now),storage:'TURSO',d1_sql_queries:0,
    short_horizons:[...SHORT_HORIZONS],long_horizons:[...LONG_HORIZONS]};
  if(mode==='plan')return {...base,status:'PLAN_ONLY',turso_sql_queries:0};
  if(!client?.execute)throw Error('AI_HORIZON_AUDIT_CLIENT_REQUIRED');
  const start=new Date(Date.parse(base.asof_kst+'T00:00:00Z')-
    HORIZON_CALENDAR_DAYS*86400000).toISOString().slice(0,10);
  const found=await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND
    name IN ('blue_eod_ingest_audit_v1','blue_eod_daily_v1',
      'blue_research_signal_audit_v1','blue_research_signals_v1',
      'blue_indicators_audit_v1','blue_indicators_daily_v1')`);
  const names=new Set(found.rows.map(r=>String(r.name)));
  const rows={},sample={};let queries=1;
  for(const [kind,table] of Object.entries(TABLES)){
    if(!names.has(table.audit)){rows[kind]=[];sample[kind]=[];continue;}
    const extra=kind==='research'?',observed_stocks':'';
    const result=await client.execute({sql:`SELECT trade_day,row_count${extra} FROM ${table.audit}
      WHERE trade_day BETWEEN ? AND ? ORDER BY trade_day DESC LIMIT ?`,
      args:[start,base.asof_kst,MAX_AUDIT_DAYS]});queries++;
    rows[kind]=parseRows(result.rows,kind,start,base.asof_kst);
    if(names.has(table.data)){
      sample[kind]=await sampledReadback(client,kind,rows[kind]);
      if(rows[kind].length)queries++;
    }else sample[kind]=rows[kind].slice(0,READBACK_DAYS).map(r=>({day:r.day,
      expected:r.expected,actual:null,matched:false}));
  }
  const eod=rows.eod,research=rows.research,indicators=rows.indicators;
  const eodDays=new Set(eod.map(r=>r.day));
  const mismatch=Object.values(sample).some(items=>items.some(r=>!r.matched));
  const short=horizons(eod,research,SHORT_HORIZONS),long=horizons(eod,research,LONG_HORIZONS);
  const status=!eod.length?'NO_EOD_AUDIT':mismatch?'SAMPLED_READBACK_MISMATCH':
    !short[0].ledger_count_filled||short[0].research_dates_on_eod<5?
      'SHORT_WINDOW_AUDIT_INSUFFICIENT':'FURTHER_OUTCOME_VALIDATION_REQUIRED';
  return {...base,status,turso_sql_queries:queries,calendar_scope_start:start,
    audit_table_presence:Object.fromEntries(Object.entries(TABLES).map(([kind,t])=>
      [kind,{audit:names.has(t.audit),data:names.has(t.data)}])),
    eod:summary(eod),research:summary(research),indicators:summary(indicators),
    short_term:short,long_term:long,
    research_without_eod:research.filter(r=>!eodDays.has(r.day)).length,
    research_observed_stocks_min:research.length?Math.min(...research.map(r=>r.observed)):null,
    research_observed_stocks_max:research.length?Math.max(...research.map(r=>r.observed)):null,
    possible_missing_weekdays:weekdayCandidates(eod),sampled_last_eight:sample,
    interpretation:'원장 등록일 수와 최근 최대 8일 실물 행수만 확인. 휴장일·연속 거래일·수정주가·미래 성과·시장 국면·독립검증을 증명하지 않으며 추천 불가.',
    no_trading_or_db_mutations:true};
}

async function main(){
  const mode=process.env.AUDIT_MODE||'plan';
  if(mode==='plan'){
    console.log('BLUE_AI_HORIZON_AUDIT '+JSON.stringify(await auditAiPatternHorizons(null,{mode})));
    return;
  }
  const url=String(process.env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(process.env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(libsql|https):\/\//.test(url)||!authToken)throw Error('AI_HORIZON_AUDIT_CONFIG_MISSING');
  const client=createClient({url,authToken,intMode:'string'});
  try{
    const report=await auditAiPatternHorizons(client,{mode});
    console.log('BLUE_AI_HORIZON_AUDIT '+JSON.stringify(report));
    if(['SAMPLED_READBACK_MISMATCH','NO_EOD_AUDIT'].includes(report.status))process.exitCode=1;
  }finally{client.close();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(()=>{console.error('BLUE_AI_HORIZON_AUDIT_FAILED');process.exitCode=1;});
}

/** Select unverified weekday candidates missing an EOD+signal audit.
 * Read-only: even apply mode only writes a selection file; the workflow owns
 * explicit authorization and invokes the existing immutable importers.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createClient} from '@libsql/client';
import {dirname} from 'node:path';

const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const HASH=/^[0-9a-f]{64}$/;
const TABLES={eodAudit:'blue_eod_ingest_audit_v1',signalAudit:'blue_research_signal_audit_v1',
  eod:'blue_eod_daily_v1',signal:'blue_research_signals_v1',
  kisProvisional:'blue_kis_provisional_daily_v1'};
const fail=code=>{throw Error(code);};
const integer=(v,min,max)=>v!==null&&v!==undefined&&v!==''&&
  Number.isSafeInteger(Number(v))&&Number(v)>=min&&Number(v)<=max;

export function validateHistorySessions(data){
  if(data?.format!=='BLUE_KRX_DAY_PROOF_CANDIDATES_V1'||
      data.source_proof!=='PENDING_KRX_EXACT_DAY'||!DAY.test(data.start)||
      !DAY.test(data.end)||data.start>data.end||
      !Array.isArray(data.sessions)||
      data.sessions.length<1||data.sessions.length>600)fail('MISSING_HISTORY_CALENDAR_INVALID');
  for(const date of [data.start,data.end]){
    const parsed=new Date(date+'T00:00:00Z');
    if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)
      fail('MISSING_HISTORY_CALENDAR_INVALID');
  }
  if((Date.parse(data.end)-Date.parse(data.start))/86400000>760)
    fail('MISSING_HISTORY_CALENDAR_INVALID');
  let prev='';
  for(const day of data.sessions){
    const parsed=new Date(day+'T00:00:00Z');
    if(!DAY.test(day)||day<=prev||day<data.start||day>data.end||
      Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==day||
      [0,6].includes(parsed.getUTCDay()))
      fail('MISSING_HISTORY_CALENDAR_INVALID');
    prev=day;
  }
  return data.sessions;
}

async function auditMap(client,table,start,end){
  const rows=(await client.execute({sql:`SELECT * FROM ${table} WHERE trade_day BETWEEN ? AND ? ORDER BY trade_day`,
    args:[start,end]})).rows;
  if(rows.length>600)fail('MISSING_HISTORY_AUDIT_TOO_LARGE');
  const found=new Map();
  for(const row of rows){
    const day=String(row.trade_day);
    if(!DAY.test(day)||found.has(day)||day<start||day>end)
      fail('MISSING_HISTORY_AUDIT_INVALID');
    found.set(day,row);
  }
  return found;
}

async function countDay(client,table,day){
  const result=await client.execute({sql:`SELECT COUNT(*) AS count FROM ${table} WHERE trade_day=?`,args:[day]});
  const n=Number(result.rows[0]?.count);
  if(!integer(n,0,10000))fail('MISSING_HISTORY_COUNT_INVALID');
  return n;
}

function auditIssues(ea,sa){
  const issues=[];
  if(ea){
    if(!integer(ea.row_count,1700,10000))issues.push('EOD_AUDIT_ROW_COUNT_INVALID');
    if(!HASH.test(String(ea.day_sha256)))issues.push('EOD_AUDIT_HASH_INVALID');
  }
  if(sa){
    if(!integer(sa.row_count,0,10000))issues.push('SIGNAL_AUDIT_ROW_COUNT_INVALID');
    if(!integer(sa.observed_stocks,1700,10000))issues.push('SIGNAL_OBSERVED_STOCKS_INVALID');
    if(integer(sa.row_count,0,10000)&&integer(sa.observed_stocks,1700,10000)&&
        Number(sa.row_count)>Number(sa.observed_stocks))issues.push('SIGNAL_ROWS_EXCEED_OBSERVED');
    if(!HASH.test(String(sa.source_payload_sha256)))issues.push('SIGNAL_PAYLOAD_HASH_INVALID');
    if(!HASH.test(String(sa.source_audit_sha256)))issues.push('SIGNAL_SOURCE_AUDIT_HASH_INVALID');
    if(!ea)issues.push('SIGNAL_AUDIT_WITHOUT_EOD_AUDIT');
    else if(integer(ea.row_count,1700,10000)&&integer(sa.observed_stocks,1700,10000)&&
      Number(sa.observed_stocks)!==Number(ea.row_count))
      issues.push('SIGNAL_OBSERVED_VS_EOD_COUNT_MISMATCH');
  }
  return issues;
}

async function provisionalEvidence(client,names,days,eod,signal){
  const present=names.has(TABLES.kisProvisional);
  const rows=new Map();
  if(present&&days.length){
    const placeholders=days.map(()=>'?').join(',');
    const result=await client.execute({sql:`SELECT trade_day, COUNT(*) AS rows,
      SUM(CASE WHEN source='KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL' THEN 1 ELSE 0 END)
      AS postclose_daily_rows FROM ${TABLES.kisProvisional}
      WHERE trade_day IN (${placeholders}) GROUP BY trade_day ORDER BY trade_day`,args:days});
    if(result.rows.length>days.length)fail('MISSING_HISTORY_PROVISIONAL_COUNT_INVALID');
    for(const row of result.rows){
      const day=String(row.trade_day);
      if(!days.includes(day)||rows.has(day)||!integer(row.rows,1,10000)||
        !integer(row.postclose_daily_rows,0,10000)||
        Number(row.postclose_daily_rows)>Number(row.rows))
        fail('MISSING_HISTORY_PROVISIONAL_COUNT_INVALID');
      rows.set(day,{rows:Number(row.rows),daily:Number(row.postclose_daily_rows)});
    }
  }
  return days.map(day=>{
    const provisional=rows.get(day),ea=eod.get(day),sa=signal.get(day);
    return {day,
      eod_audit:!ea?'MISSING':auditIssues(ea,null).length?'INVALID_METADATA':'PRESENT',
      signal_audit:!sa?'MISSING':auditIssues(null,sa).filter(x=>
        x!=='SIGNAL_AUDIT_WITHOUT_EOD_AUDIT').length?'INVALID_METADATA':'PRESENT',
      kis_provisional:!present?'TABLE_MISSING':provisional?'RECORDED_UNCONFIRMED':'NO_ROWS',
      kis_rows:provisional?.rows??0,
      kis_postclose_daily_rows:provisional?.daily??0,
      price_state:ea?(auditIssues(ea,null).length?'KRX_EOD_AUDIT_INVALID':
        'KRX_EOD_AUDIT_PRESENT'):provisional?
        'KIS_ONLY_NO_KRX_CONFIRMED_EOD':'NO_KRX_CONFIRMED_EOD'};
  });
}

export async function planMissingHistory(client,{calendar,batchSize=5,candidateLimit=batchSize}={}){
  const sessions=validateHistorySessions(calendar);
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>5||
    !Number.isInteger(candidateLimit)||candidateLimit<batchSize||candidateLimit>50||!client?.execute)
    fail('MISSING_HISTORY_ARGS_INVALID');
  const start=calendar.start,end=calendar.end;
  const named=await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND
    name IN ('blue_eod_ingest_audit_v1','blue_research_signal_audit_v1',
      'blue_eod_daily_v1','blue_research_signals_v1','blue_kis_provisional_daily_v1')`);
  const names=new Set(named.rows.map(r=>String(r.name)));
  // An audit without its underlying data table is a real inconsistency, never a completed day.
  for(const [audit,data] of [['eodAudit','eod'],['signalAudit','signal']]){
    if(names.has(TABLES[audit])&&!names.has(TABLES[data]))
      fail('MISSING_HISTORY_AUDIT_DATA_TABLE_MISSING');
  }
  const eod=names.has(TABLES.eodAudit)?await auditMap(client,TABLES.eodAudit,start,end):new Map();
  const signal=names.has(TABLES.signalAudit)?await auditMap(client,TABLES.signalAudit,start,end):new Map();
  const selected=[],blocked=[];
  let audited=0,missingAudits=0,queries=1+Number(names.has(TABLES.eodAudit))+Number(names.has(TABLES.signalAudit));
  for(const day of sessions){
    const ea=eod.get(day),sa=signal.get(day);
    const issues=auditIssues(ea,sa);
    if(issues.length){
      blocked.push({day,reason:'EXISTING_AUDIT_INCONSISTENT',details:issues});
      continue;
    }
    if(ea&&sa){audited++;continue;}
    missingAudits++;
    // Only a bounded number of candidates have their actual rows counted.
    // Already-audited, immutable days are not recomputed or overwritten.
    if(selected.length>=candidateLimit)continue;
    const haveEod=names.has(TABLES.eod)?await countDay(client,TABLES.eod,day):0;
    const haveSignal=names.has(TABLES.signal)?await countDay(client,TABLES.signal,day):0;
    queries+=Number(names.has(TABLES.eod))+Number(names.has(TABLES.signal));
    if((ea&&haveEod!==Number(ea.row_count))||(!ea&&haveEod>0)||
       (sa&&haveSignal!==Number(sa.row_count))||(!sa&&haveSignal>0)){
      blocked.push({day,reason:'PARTIAL_OR_MISMATCHED_UNAUDITED_ROWS',details:[
        ...(ea&&haveEod!==Number(ea.row_count)?['EOD_ROW_COUNT_MISMATCH']:[]),
        ...(!ea&&haveEod>0?['EOD_ROWS_WITHOUT_AUDIT']:[]),
        ...(sa&&haveSignal!==Number(sa.row_count)?['SIGNAL_ROW_COUNT_MISMATCH']:[]),
        ...(!sa&&haveSignal>0?['SIGNAL_ROWS_WITHOUT_AUDIT']:[]),
      ]});
      continue;
    }
    selected.push({day,eod:ea?'already_audited':'missing',
      signals:sa?'already_audited':'missing'});
  }
  // Read only the selected/blocked days. A two-year provisional table can be large;
  // do not scan the entire provisional history or claim unexamined dates have no KIS rows.
  const evidenceDays=[...new Set([...selected,...blocked].map(x=>x.day))].sort();
  const detailedDays=evidenceDays.slice(0,100);
  const sourceEvidence=await provisionalEvidence(client,names,detailedDays,eod,signal);
  queries+=Number(names.has(TABLES.kisProvisional)&&detailedDays.length>0);
  return {format:'BLUE_MISSING_HISTORY_PLAN_V1',start,end,
    weekday_candidates:sessions.length,already_audited:audited,
    missing_audit_sessions:missingAudits,selected,blocked,
    source_evidence:sourceEvidence,source_evidence_total_days:evidenceDays.length,
    source_evidence_truncated:evidenceDays.length>detailedDays.length,
    max_verified_days:batchSize,source_proof:'PENDING_KRX_EXACT_DAY',
    remaining_possible:Math.max(0,missingAudits-Math.min(batchSize,selected.length)),
    turso_select_queries:queries,d1_sql_queries:0,db_writes:0,
    note:'Weekdays are candidates, not proven sessions. Each day must pass exact KRX full-market EOD verification; unverified days are separately reported, never called holidays. Immutable audits are not replayed.'};
}

async function main(){
  const calendar=JSON.parse(await readFile(process.env.HISTORY_SESSIONS_FILE||'output/missing/sessions.json','utf8'));
  const batchSize=Number(process.env.HISTORY_BATCH||5);
  const candidateLimit=Number(process.env.HISTORY_CANDIDATE_LIMIT||batchSize);
  const url=String(process.env.TURSO_DATABASE_URL||'').trim(),
    authToken=String(process.env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(libsql|https):\/\//.test(url)||!authToken)
    fail('MISSING_HISTORY_TURSO_CONFIG_MISSING');
  const client=createClient({url,authToken,intMode:'string'});
  let plan;
  try{plan=await planMissingHistory(client,{calendar,batchSize,candidateLimit});}
  finally{client.close();}
  const path=process.env.HISTORY_PLAN_FILE||'output/missing/selection.json';
  await mkdir(dirname(path),{recursive:true});
  await writeFile(path,JSON.stringify(plan,null,2)+'\n');
  console.log('BLUE_MISSING_HISTORY_PLAN '+JSON.stringify(plan));
}

if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
  main().catch(err=>{
    const code=String(err?.message||'');
    console.error('BLUE_MISSING_HISTORY_PLAN_FAILED',
      code.startsWith('MISSING_HISTORY_')?code:'SANITIZED_RUNTIME_FAILURE');
    process.exitCode=1;
  });
}

/** Select the oldest KRX index sessions without a completed Turso EOD+signal audit.
 * Read-only: even apply mode only writes a selection file; the workflow owns
 * explicit authorization and invokes the existing immutable importers.
 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createClient} from '@libsql/client';
import {dirname} from 'node:path';

const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const HASH=/^[0-9a-f]{64}$/;
const TABLES={eodAudit:'blue_eod_ingest_audit_v1',signalAudit:'blue_research_signal_audit_v1',
  eod:'blue_eod_daily_v1',signal:'blue_research_signals_v1'};
const fail=code=>{throw Error(code);};
const integer=(v,min,max)=>v!==null&&v!==undefined&&v!==''&&
  Number.isSafeInteger(Number(v))&&Number(v)>=min&&Number(v)<=max;

export function validateHistorySessions(data){
  if(data?.format!=='BLUE_KRX_INDEX_SESSIONS_V1'||!DAY.test(data.start)||
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

export async function planMissingHistory(client,{calendar,batchSize=5}={}){
  const sessions=validateHistorySessions(calendar);
  if(!Number.isInteger(batchSize)||batchSize<1||batchSize>5||!client?.execute)
    fail('MISSING_HISTORY_ARGS_INVALID');
  const start=calendar.start,end=calendar.end;
  const named=await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND
    name IN ('blue_eod_ingest_audit_v1','blue_research_signal_audit_v1',
      'blue_eod_daily_v1','blue_research_signals_v1')`);
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
    const eodValid=!ea||(integer(ea.row_count,1700,10000)&&HASH.test(String(ea.day_sha256)));
    const signalValid=!sa||(integer(sa.row_count,0,10000)&&
      integer(sa.observed_stocks,1700,10000)&&
      Number(sa.row_count)<=Number(sa.observed_stocks)&&
      HASH.test(String(sa.source_payload_sha256))&&HASH.test(String(sa.source_audit_sha256)));
    if(!eodValid||!signalValid||(sa&&(!ea||Number(sa.observed_stocks)!==Number(ea.row_count)))){
      blocked.push({day,reason:'EXISTING_AUDIT_INCONSISTENT'});
      continue;
    }
    if(ea&&sa){audited++;continue;}
    missingAudits++;
    // Only a bounded number of candidates have their actual rows counted.
    // Already-audited, immutable days are not recomputed or overwritten.
    if(selected.length>=batchSize)continue;
    const haveEod=names.has(TABLES.eod)?await countDay(client,TABLES.eod,day):0;
    const haveSignal=names.has(TABLES.signal)?await countDay(client,TABLES.signal,day):0;
    queries+=Number(names.has(TABLES.eod))+Number(names.has(TABLES.signal));
    if((ea&&haveEod!==Number(ea.row_count))||(!ea&&haveEod>0)||
       (sa&&haveSignal!==Number(sa.row_count))||(!sa&&haveSignal>0)){
      blocked.push({day,reason:'PARTIAL_OR_MISMATCHED_UNAUDITED_ROWS'});
      continue;
    }
    selected.push({day,eod:ea?'already_audited':'missing',
      signals:sa?'already_audited':'missing'});
  }
  return {format:'BLUE_MISSING_HISTORY_PLAN_V1',start,end,
    exchange_sessions:sessions.length,already_audited:audited,
    missing_audit_sessions:missingAudits,selected,blocked,
    remaining_possible:Math.max(0,missingAudits-selected.length),
    turso_select_queries:queries,d1_sql_queries:0,db_writes:0,
    note:'Only KRX index sessions are candidates. Existing immutable audits are not replayed; partial/conflicting records require separate inspection.'};
}

async function main(){
  const calendar=JSON.parse(await readFile(process.env.HISTORY_SESSIONS_FILE||'output/missing/sessions.json','utf8'));
  const batchSize=Number(process.env.HISTORY_BATCH||5);
  const url=String(process.env.TURSO_DATABASE_URL||'').trim(),
    authToken=String(process.env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(libsql|https):\/\//.test(url)||!authToken)
    fail('MISSING_HISTORY_TURSO_CONFIG_MISSING');
  const client=createClient({url,authToken,intMode:'string'});
  let plan;
  try{plan=await planMissingHistory(client,{calendar,batchSize});}
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

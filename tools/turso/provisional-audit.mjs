/** Bounded Turso-only, read-only audit of one KST trading day.
 * No D1, KIS, token issuance, raw stock quotes, or mutations.
 */
import {createClient} from '@libsql/client/web';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const DAILY='KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL';
const REGULAR='KIS_REST_INQUIRE_PRICE_PROVISIONAL';
const REQUIRED=['blue_kis_provisional_daily_v1','blue_kis_live_quotes_r141',
  'blue_eod_daily_v1','blue_eod_ingest_audit_v1'];

function kstDay(now){
  return new Date(now.getTime()+9*3600_000).toISOString().slice(0,10);
}

export function auditDay(input,now=new Date()){
  const day=input||kstDay(now);
  if(!DAY.test(day)||Number.isNaN(Date.parse(day+'T00:00:00Z'))||
    new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day)
    throw Error('INVALID_AUDIT_DAY');
  const diff=(Date.parse(kstDay(now)+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400_000;
  if(!Number.isInteger(diff)||diff<0||diff>7)throw Error('AUDIT_DAY_OUT_OF_RANGE');
  return day;
}

function count(value){
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_AUDIT_AGGREGATE');
  return n;
}
function safeStamp(value){
  const stamp=String(value||'');
  return /^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(stamp)&&
    Number.isFinite(Date.parse(stamp))?stamp:'NONE';
}

export async function auditProvisional(client,day){
  const schema=await client.execute({sql:
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?,?)",
    args:REQUIRED});
  const tables=new Set(schema.rows.map(r=>String(r.name)));
  const missing=REQUIRED.filter(name=>!tables.has(name));
  const result={day_kst:day,rows:0,daily_rows:0,regular_rows:0,
    bad_source_or_basis:0,bad_ohlc:0,bad_volume:0,zero_volume:0,
    bad_reference:0,bad_observed_day:0,outside_session:0,duplicate_keys:0,
    newest_observation_utc:'NONE',latest_evidence_checked:0,
    latest_evidence_valid:0,latest_evidence_invalid:0,
    latest_evidence_unavailable:0,eod_audit_expected:0,eod_actual:0,
    eod_state:'NO_AUDIT',missing_tables:missing.length,status:'UNKNOWN'};

  if(tables.has('blue_eod_ingest_audit_v1')){
    const audit=await client.execute({sql:
      'SELECT row_count FROM blue_eod_ingest_audit_v1 WHERE trade_day=? LIMIT 1',args:[day]});
    if(audit.rows.length){
      result.eod_audit_expected=count(audit.rows[0].row_count);
      result.eod_state='AUDIT_ONLY';
    }
  }
  if(tables.has('blue_eod_daily_v1')){
    const eod=await client.execute({sql:
      'SELECT COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day=?',args:[day]});
    result.eod_actual=count(eod.rows[0].n);
  }
  if(result.eod_audit_expected>=1700&&tables.has('blue_eod_daily_v1')){
    result.eod_state=result.eod_actual===result.eod_audit_expected?
      'VERIFIED_EOD_ALREADY_AVAILABLE':'INCOMPLETE_EOD';
  }else if(result.eod_audit_expected>0){
    result.eod_state='UNVERIFIED_EOD_AUDIT';
  }
  if(!tables.has('blue_kis_provisional_daily_v1')){
    result.status='PROVISIONAL_TABLE_MISSING';
    return result;
  }

  // All scans are constrained to the explicit KST trade date. A day may
  // contain regular intraday snapshots and post-close daily observations.
  const summary=await client.execute({sql:`SELECT
      COUNT(*) AS rows,
      SUM(CASE WHEN source='${DAILY}' THEN 1 ELSE 0 END) AS daily_rows,
      SUM(CASE WHEN source='${REGULAR}' THEN 1 ELSE 0 END) AS regular_rows,
      SUM(CASE WHEN NOT ((source='${DAILY}' AND date_basis='KIS_REPORTED_TRADE_DATE')
        OR (source='${REGULAR}' AND date_basis IN
          ('KIS_REPORTED_TRADE_DATE','COLLECTOR_KST_REGULAR_SESSION')))
        THEN 1 ELSE 0 END) AS bad_source_or_basis,
      SUM(CASE WHEN open<=0 OR high<=0 OR low<=0 OR close<=0 OR
        low>high OR open<low OR open>high OR close<low OR close>high
        THEN 1 ELSE 0 END) AS bad_ohlc,
      SUM(CASE WHEN volume<0 THEN 1 ELSE 0 END) AS bad_volume,
      SUM(CASE WHEN volume=0 THEN 1 ELSE 0 END) AS zero_volume,
      SUM(CASE WHEN reference_day>=trade_day OR
        reference_day<date(trade_day,'-7 days') OR
        date(reference_day) IS NULL THEN 1 ELSE 0 END) AS bad_reference,
      SUM(CASE WHEN date(observed_at_utc,'+9 hours')<>trade_day OR
        date(observed_at_utc,'+9 hours') IS NULL THEN 1 ELSE 0 END) AS bad_observed_day,
      SUM(CASE WHEN
        (source='${DAILY}' AND
          (time(observed_at_utc,'+9 hours')<'15:20:00' OR
           time(observed_at_utc,'+9 hours')>='22:00:00')) OR
        (source='${REGULAR}' AND
          (time(observed_at_utc,'+9 hours')<'09:00:00' OR
           time(observed_at_utc,'+9 hours')>='15:20:00'))
        THEN 1 ELSE 0 END) AS outside_session,
      MAX(observed_at_utc) AS newest
    FROM blue_kis_provisional_daily_v1 WHERE trade_day=?`,args:[day]});
  const row=summary.rows[0];
  for(const key of ['rows','daily_rows','regular_rows','bad_source_or_basis',
    'bad_ohlc','bad_volume','zero_volume','bad_reference','bad_observed_day',
    'outside_session'])result[key]=count(row[key]??0);
  result.newest_observation_utc=safeStamp(row.newest);
  const duplicates=await client.execute({sql:`SELECT COUNT(*) AS n FROM (
      SELECT code FROM blue_kis_provisional_daily_v1 WHERE trade_day=?
      GROUP BY code HAVING COUNT(*)>1)`,args:[day]});
  result.duplicate_keys=count(duplicates.rows[0].n);

  if(result.daily_rows&&tables.has('blue_kis_live_quotes_r141')){
    // Latest quote is overwritten by newer observations: no current match
    // means NOT RE-VERIFIABLE, not proof the original KIS date was wrong.
    const evidence=await client.execute({sql:`SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN q.payload_json IS NOT NULL THEN 1 ELSE 0 END) AS checked,
        SUM(CASE WHEN q.payload_json IS NOT NULL AND
          CASE WHEN json_valid(q.payload_json) THEN
            json_extract(q.payload_json,'$.source')='KIS_REST_INQUIRE_DAILY_PRICE'
            AND json_extract(q.payload_json,'$.reported_trade_date')=replace(p.trade_day,'-','')
            AND json_extract(q.payload_json,'$.trade_date_kst')=p.trade_day
            AND json_extract(q.payload_json,'$.received_at_utc')=p.observed_at_utc
            AND json_extract(q.payload_json,'$.phase')='KRX_POST_CLOSE'
            AND json_extract(q.payload_json,'$.provisional_status')='IN_PROGRESS'
            AND json_extract(q.payload_json,'$.provisional_date_basis')='KIS_REPORTED_TRADE_DATE'
            AND json_extract(q.payload_json,'$.is_confirmed_daily')=0
          ELSE 0 END THEN 1 ELSE 0 END) AS valid
      FROM blue_kis_provisional_daily_v1 p
      LEFT JOIN blue_kis_live_quotes_r141 q
        ON q.trade_date=p.trade_day AND q.market=p.market AND q.code=p.code
          AND q.received_at_utc=p.observed_at_utc
      WHERE p.trade_day=? AND p.source='${DAILY}'`,args:[day]});
    result.latest_evidence_checked=count(evidence.rows[0].checked??0);
    result.latest_evidence_valid=count(evidence.rows[0].valid??0);
  }
  result.latest_evidence_invalid=result.latest_evidence_checked-result.latest_evidence_valid;
  result.latest_evidence_unavailable=result.daily_rows-result.latest_evidence_checked;
  const invalid=['bad_source_or_basis','bad_ohlc','bad_volume','bad_reference',
    'bad_observed_day','outside_session','duplicate_keys','latest_evidence_invalid']
    .some(key=>result[key]>0);
  result.status=missing.length?'INCOMPLETE_AUDIT_SCHEMA':
    !result.rows?'NO_PROVISIONAL_ROWS':invalid?'INVALID_PROVISIONAL_ROWS':
    !result.daily_rows?'REGULAR_ONLY':
    result.latest_evidence_unavailable?'PARTIAL_KIS_DATE_EVIDENCE':'OBSERVED_KIS_DATE_EVIDENCE';
  return result;
}

export function auditLine(report){
  return 'BLUE_TURSO_PROVISIONAL_AUDIT '+Object.entries(report)
    .map(([key,value])=>key+'='+value).join(' ');
}

async function main(){
  let client;
  try{
    const rawArg=process.argv.slice(2);
    if(rawArg.length>1||rawArg.some(arg=>!arg.startsWith('--day=')))throw Error('INVALID_AUDIT_ARGUMENT');
    const day=auditDay(rawArg[0]?.slice(6));
    const url=process.env.TURSO_DATABASE_URL?.trim()||'';
    const authToken=process.env.TURSO_AUTH_TOKEN?.trim()||'';
    if(!/^(libsql|https):\/\//.test(url)||!authToken)throw Error('TURSO_AUDIT_CONFIG_MISSING');
    client=createClient({url,authToken,intMode:'string'});
    const result=await auditProvisional(client,day);
    console.log(auditLine(result));
    console.log('BLUE_TURSO_PROVISIONAL_AUDIT_READ_ONLY: Day-bounded Turso SELECT only; no D1/KIS/stock details. Evidence may be overwritten by newer latest quotes.');
    if(['INVALID_PROVISIONAL_ROWS','PROVISIONAL_TABLE_MISSING','INCOMPLETE_AUDIT_SCHEMA']
      .includes(result.status))
      process.exitCode=1;
  }catch(err){
    const allowed=new Set(['INVALID_AUDIT_DAY','AUDIT_DAY_OUT_OF_RANGE',
      'INVALID_AUDIT_ARGUMENT','TURSO_AUDIT_CONFIG_MISSING']);
    console.error(allowed.has(err?.message)?err.message:'TURSO_PROVISIONAL_AUDIT_UNAVAILABLE');
    process.exitCode=1;
  }finally{client?.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

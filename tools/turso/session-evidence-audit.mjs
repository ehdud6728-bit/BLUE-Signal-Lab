/** Day-bounded read-only evidence audit. Never infer a regular close from
 * receipt time or label a daily-price response as an after-hours trade. */
import {createClient} from '@libsql/client/web';
import {pathToFileURL} from 'node:url';
import {auditDay} from './provisional-audit.mjs';

const DAILY='KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL';
const num=v=>{const n=Number(v??0);if(!Number.isSafeInteger(n)||n<0)throw Error('INVALID_COUNT');return n;};
const counts=(row,keys)=>Object.fromEntries(keys.map(k=>[k,num(row?.[k])]));
export async function auditSessions(db,day,now=new Date()){
 day=auditDay(day,now);
 const q=async(sql,args=[])=>(await db.execute({sql,args})).rows;
 const names=['blue_kis_provisional_daily_v1','blue_kis_live_quotes_r141','blue_kis_live_history_r141','blue_eod_daily_v1','blue_eod_ingest_audit_v1'];
 const tables=new Set((await q("SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?,?,?,?)",names)).map(v=>String(v.name)));
 const out={day,missing_tables:names.filter(n=>!tables.has(n)),daily_evidence:[],aftermarket_receipts:[],eod:{state:'NO_AUDIT',expected:0,actual:0},comparison:null};
 if(tables.has(names[3])&&tables.has(names[4])){
  const audit=await q('SELECT row_count FROM blue_eod_ingest_audit_v1 WHERE trade_day=?',[day]);
  if(audit.length>1)throw Error('DUPLICATE_EOD_AUDIT');
  out.eod.expected=num(audit[0]?.row_count);
  out.eod.actual=num((await q('SELECT COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day=?',[day]))[0]?.n);
  if(audit.length)out.eod.state=out.eod.expected>=1700&&out.eod.expected===out.eod.actual?'AUDITED_ROW_COUNT_MATCH':'INCOMPLETE_EOD';
 }
 const bucket=`CASE WHEN time(p.observed_at_utc,'+9 hours')<'15:30:00' THEN 'BEFORE_REGULAR_CLOSE'
  WHEN time(p.observed_at_utc,'+9 hours')<'20:00:00' THEN '15:30_TO_20:00'
  WHEN time(p.observed_at_utc,'+9 hours')<'22:00:00' THEN '20:00_TO_22:00' ELSE 'OUTSIDE_OR_UNKNOWN' END`;
 if(tables.has(names[0])&&tables.has(names[1])){
  const valid=`CASE WHEN json_valid(l.payload_json) THEN
    json_extract(l.payload_json,'$.source')='KIS_REST_INQUIRE_DAILY_PRICE'
    AND json_extract(l.payload_json,'$.reported_trade_date')=replace(p.trade_day,'-','')
    AND json_extract(l.payload_json,'$.trade_date_kst')=p.trade_day
    AND json_extract(l.payload_json,'$.received_at_utc')=p.observed_at_utc
    AND json_extract(l.payload_json,'$.price')=p.close
    AND json_extract(l.payload_json,'$.open')=p.open
    AND json_extract(l.payload_json,'$.high')=p.high
    AND json_extract(l.payload_json,'$.low')=p.low
    AND json_extract(l.payload_json,'$.accumulated_volume')=p.volume
    AND json_extract(l.payload_json,'$.is_confirmed_daily')=0 ELSE 0 END`;
  const endpoint=`CASE WHEN json_valid(l.payload_json) THEN CASE json_extract(l.payload_json,'$.provider_endpoint')
     WHEN 'inquire-daily-itemchartprice' THEN 'CHART_DAILY'
     WHEN 'inquire-daily-price' THEN 'DAILY_PRICE' ELSE 'UNSPECIFIED' END ELSE 'UNAVAILABLE' END`;
  const joined=`FROM blue_kis_provisional_daily_v1 p LEFT JOIN blue_kis_live_quotes_r141 l
      ON l.trade_date=p.trade_day AND l.market=p.market AND l.code=p.code AND l.received_at_utc=p.observed_at_utc`;
  const where=`p.trade_day=? AND p.market='J' AND p.source=? AND p.date_basis='KIS_REPORTED_TRADE_DATE'
     AND date(p.observed_at_utc,'+9 hours')=p.trade_day`;
  const rows=await q(`SELECT ${bucket} AS receipt_window,${endpoint} AS endpoint,COUNT(*) AS n,
     SUM(CASE WHEN l.payload_json IS NOT NULL THEN 1 ELSE 0 END) AS evidence_present,
     SUM(CASE WHEN ${valid} THEN 1 ELSE 0 END) AS evidence_match
     ${joined} WHERE ${where} GROUP BY 1,2 ORDER BY 1,2`,[day,DAILY]);
  out.daily_evidence=rows.map(v=>({receipt_window:v.receipt_window,endpoint:v.endpoint,...counts(v,['n','evidence_present','evidence_match'])}));
  if(out.eod.state==='AUDITED_ROW_COUNT_MATCH'){
   const fields=['open','high','low','close','volume'];
   const equal=fields.map(k=>`SUM(CASE WHEN p.${k}=e.${k} THEN 1 ELSE 0 END) AS ${k}_match`).join(',');
   const all=fields.map(k=>`p.${k}=e.${k}`).join(' AND ');
   const rows=await q(`SELECT ${bucket} AS receipt_window,${endpoint} AS endpoint,COUNT(*) AS paired,${equal},
      SUM(CASE WHEN ${all} THEN 1 ELSE 0 END) AS all_ohlcv_match
      ${joined} JOIN blue_eod_daily_v1 e ON e.trade_day=p.trade_day AND e.code=p.code
      WHERE ${where} AND time(p.observed_at_utc,'+9 hours')>='15:30:00'
      AND time(p.observed_at_utc,'+9 hours')<'22:00:00' AND (${valid})
      AND p.low>0 AND p.open BETWEEN p.low AND p.high AND p.close BETWEEN p.low AND p.high AND p.volume>=0
      AND e.low>0 AND e.open BETWEEN e.low AND e.high AND e.close BETWEEN e.low AND e.high AND e.volume>=0
      GROUP BY 1,2 ORDER BY 1,2`,[day,DAILY]);
   out.comparison=rows.map(v=>({receipt_window:v.receipt_window,endpoint:v.endpoint,...counts(v,['paired',...fields.map(k=>k+'_match'),'all_ohlcv_match'])}));
  }
 }
 if(tables.has(names[2])){
  const rows=await q(`SELECT market,phase,COUNT(*) AS receipts,COUNT(DISTINCT code) AS symbols
      FROM blue_kis_live_history_r141 WHERE trade_date=? AND date(received_at_utc,'+9 hours')=trade_date
      AND time(received_at_utc,'+9 hours')<'20:00:00' AND price>0 AND volume>=0
      AND ((market='J' AND phase='KRX_AFTER' AND time(received_at_utc,'+9 hours')>='16:00:00')
      OR (market='NX' AND phase='NXT_AFTER' AND time(received_at_utc,'+9 hours')>='15:40:00'))
      GROUP BY market,phase ORDER BY market`,[day]);
  out.aftermarket_receipts=rows.map(v=>({market:v.market,phase:v.phase,...counts(v,['receipts','symbols'])}));
 }
 return {...out,limits:['RECEIPT_TIME_NOT_VERIFIED_TRADE_TIME','DAILY_ENDPOINT_NOT_PROOF_OF_REGULAR_SESSION_OHLCV','LATEST_PAYLOAD_MAY_BE_OVERWRITTEN','ROW_COUNT_AUDIT_NOT_INDEPENDENT_SOURCE_PARITY','NO_PATTERN_PARITY_MEASURED']};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let db;
 try{
  const day=auditDay(process.argv[2]);
  db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
  console.log('BLUE_SESSION_EVIDENCE_AUDIT',JSON.stringify(await auditSessions(db,day)));
 }catch{console.error('BLUE_SESSION_EVIDENCE_AUDIT_FAILED');process.exitCode=1;}finally{db?.close();}
}

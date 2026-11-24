/** Opt-in publication of provisional scan results. No KIS, D1, or EOD writes.
 * Stage immutable per-symbol rows, verify readback, then atomically move the
 * day pointer. Readers must join on snapshot_id, never read staging alone.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createClient} from '@libsql/client';

const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const CODE=/^[0-9A-Z]{6}$/;
const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=10000;
const check=(ok,reason)=>{if(!ok)throw Error(reason);};
const sha=s=>createHash('sha256').update(s).digest('hex');
// Match the conservative request sizes used by the confirmed signal importer.
const WRITE_PAGE=4,READ_PAGE=2,WRITE_BYTES=24000;
const READ_ATTEMPTS=3;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function retryableRead(err){
  const code=String(err?.code||err?.cause?.code||'');
  const status=Number(err?.status??err?.statusCode??err?.cause?.status);
  return /^(?:SQLITE_UNKNOWN|SQLITE_BUSY(?:_[A-Z0-9_]+)?|SQLITE_LOCKED(?:_[A-Z0-9_]+)?|HRANA_WEBSOCKET_ERROR|STREAM_EXPIRED|FETCH_ERROR|SERVER_ERROR|ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR_CONNECT_TIMEOUT|UND_ERR_SOCKET)$/.test(code)||[408,429,500,502,503,504].includes(status);
}
export function* writeChunks(rows){
  let chunk=[],bytes=0;
  for(const row of rows){
    // JSON escaping on the wire can enlarge the stored record string.
    const size=Buffer.byteLength(JSON.stringify([row.code,row.raw,row.hash]));
    if(chunk.length&&(chunk.length>=WRITE_PAGE||bytes+size>WRITE_BYTES)){
      yield chunk;chunk=[];bytes=0;
    }
    chunk.push(row);bytes+=size;
  }
  if(chunk.length)yield chunk;
}
const SAFE_STAGES=new Set(['CONNECT','CHECK_EOD','CHECK_REFERENCE','CREATE_ROWS','CREATE_HEAD','READ_HEAD','WRITE_ROWS','READ_ROWS','PROMOTE_HEAD','VERIFY_HEAD']);
export function storageFailure(stage,err){
  // Never include the provider's message, URL, SQL, or credentials.
  const rawCode=String(err?.code||err?.cause?.code||'');
  const code=/^(?:SQLITE_[A-Z0-9_]+|HRANA_[A-Z0-9_]+|LIBSQL_[A-Z0-9_]+|SERVER_ERROR|HTTP_ERROR|FETCH_ERROR|STREAM_EXPIRED|TRANSACTION_TIMEOUT|TRANSACTION_CLOSED|CLIENT_CLOSED|URL_INVALID|AUTH_TOKEN_INVALID|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_[A-Z0-9_]+)$/.test(rawCode)?rawCode:'UNKNOWN';
  const status=Number(err?.status??err?.statusCode??err?.cause?.status);
  return 'PROVISIONAL_STORAGE_'+(SAFE_STAGES.has(stage)?stage:'UNKNOWN')+'_'+code+
    (Number.isInteger(status)&&status>=400&&status<=599?'_HTTP_'+status:'');
}
const kstDay=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);
const timestamp=s=>{
  check(typeof s==='string'&&/(?:Z|[+-]\d{2}:\d{2})$/.test(s)&&Number.isFinite(Date.parse(s)),'INVALID_PROVISIONAL_TIMESTAMP');
  return new Date(s).toISOString();
};
const validDay=s=>typeof s==='string'&&DAY.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;

export function validateSnapshot(result,quotes){
  const r=result, q=r?.quote_coverage, h=r?.history_metadata, a=r?.audit;
  check(r?.status==='KIS_PROVISIONAL'&&r.pattern_confirmed===false&&validDay(r.day)&&
    validDay(q?.reference)&&q.reference<r.day&&h?.reference===q.reference&&
    count(h.sessions)&&h.sessions>=225&&a?.asof===r.day&&a.source_latest_date===r.day,
    'INVALID_PROVISIONAL_METADATA');
  const scan=timestamp(r.scan_asof_utc);
  check(kstDay(Date.parse(scan))===r.day,'INVALID_PROVISIONAL_DAY');
  check([r.observed,r.accepted_quotes,r.excluded,r.excluded_reference,r.excluded_ohlcv,
    r.eligible,r.turnover_available_quotes,r.turnover_missing_quotes,q.joined,q.eligible,q.missingAmount,q.turnoverAvailable,
    a.observed_stocks,a.eligible_stocks,a.insufficient_history,a.suspicious_gap_excluded,a.matched_stocks,a.signal_events]
    .every(count)&&r.eligible>0&&r.observed===q.joined&&r.observed===q.eligible&&
    r.observed===r.accepted_quotes+r.excluded&&r.excluded===r.excluded_reference+r.excluded_ohlcv&&
    r.accepted_quotes===r.turnover_available_quotes+r.turnover_missing_quotes&&
    q.joined===q.missingAmount+q.turnoverAvailable&&
    r.turnover_available_quotes<=q.turnoverAvailable&&r.turnover_missing_quotes<=q.missingAmount&&
    a.observed_stocks===r.accepted_quotes&&a.eligible_stocks===r.eligible&&
    a.observed_stocks===a.eligible_stocks+a.insufficient_history+a.suspicious_gap_excluded&&
    Array.isArray(r.items)&&r.items.length===a.matched_stocks&&a.matched_stocks<=r.eligible&&
    Array.isArray(quotes)&&quotes.length===r.observed,'INVALID_PROVISIONAL_COVERAGE');
  const byCode=new Map();let newest='',available=0;
  for(const v of quotes){
    const at=timestamp(v.observed_at_utc);
    check(CODE.test(v.code)&&!byCode.has(v.code)&&v.day===r.day&&v.reference_day===q.reference&&
      ['KIS_REST_INQUIRE_PRICE_PROVISIONAL','KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL'].includes(v.source)&&
      kstDay(Date.parse(at))===r.day&&at<=scan&&
      (v.amount===null||(Number.isSafeInteger(v.amount)&&v.amount>0)),'INVALID_PROVISIONAL_QUOTE_EVIDENCE');
    if(v.amount!==null)available++;
    if(at>newest)newest=at;
    byCode.set(v.code,v);
  }
  check(available===q.turnoverAvailable,'INVALID_PROVISIONAL_TURNOVER_COVERAGE');
  const rows=[];let last='',events=0;
  for(const v of r.items){
    const evidence=byCode.get(v.code);
    const flags=typeof v.signals==='string'?v.signals.split(','):[];
    check(evidence&&v.code>last&&v.date===r.day&&v.provisional===true&&v.pattern_confirmed===false&&
      v.source==='KIS_PROVISIONAL'&&v.data_frequency==='PROVISIONAL_DAILY'&&
      ['KOSPI','KOSDAQ'].includes(v.market)&&Number.isSafeInteger(v.close)&&v.close>0&&
      v.close===evidence.close&&v.observed_at_utc===evidence.observed_at_utc&&
      flags.length>0&&flags.every(x=>/^[A-Z0-9_]{2,60}$/.test(x))&&new Set(flags).size===flags.length&&
      v.turnover_available===(evidence.amount!==null)&&v.traded_amount_krw===evidence.amount&&
      (v.turnover_available||v.amount_ratio20===null),'INVALID_PROVISIONAL_RECORD');
    const raw=JSON.stringify(v);
    check(Buffer.byteLength(raw)<=64000,'INVALID_PROVISIONAL_RECORD_SIZE');
    rows.push({code:v.code,raw,hash:sha(raw)});
    events+=flags.length;last=v.code;
  }
  check(events===a.signal_events,'INVALID_PROVISIONAL_EVENT_COUNT');
  const {items,...meta}=r;
  const metadata=JSON.stringify(meta);
  check(Buffer.byteLength(metadata)<=64000,'INVALID_PROVISIONAL_METADATA_SIZE');
  const id=sha(JSON.stringify([metadata,...rows.map(v=>v.hash)]));
  return {day:r.day,reference:q.reference,scan,newest,id,metadata,rows};
}

export async function publishSnapshot({result,quotes,mode='dry_run',env=process.env,now=new Date(),clientFactory=createClient,onProgress=()=>{},wait=sleep}){
  check(['dry_run','apply'].includes(mode),'INVALID_PROVISIONAL_MODE');
  const s=validateSnapshot(result,quotes);
  const summary={day:s.day,snapshot_id:s.id,rows:s.rows.length,latest_observed_utc:s.newest};
  if(mode==='dry_run')return {...summary,status:'DRY_RUN',written:0};
  check(s.day===kstDay(now.getTime())&&Date.parse(s.scan)<=now.getTime(),'PROVISIONAL_NOT_CURRENT_DAY');
  const url=String(env.TURSO_DATABASE_URL||'').trim(),authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  check(/^(libsql|https):\/\//.test(url)&&authToken,'PROVISIONAL_DB_NOT_CONFIGURED');
  let client,stage='CONNECT';
  try{
    onProgress({stage});
    client=clientFactory({url,authToken,intMode:'string'});
    const run=async(next,sql,args=[])=>{
      stage=next;
      return client.execute({sql,args});
    };
    // Read-only retry: new connection after a transport/temporary DB error.
    // Do not retry data mismatches, invalid SQL, or authentication failures.
    const readQuery=async(sql,args)=>{
      for(let attempt=1;attempt<=READ_ATTEMPTS;attempt++){
        try{return await run('READ_ROWS',sql,args);}
        catch(err){
          if(!retryableRead(err)||attempt===READ_ATTEMPTS)throw err;
          onProgress({stage:'READ_ROWS',retry:attempt,error:storageFailure('READ_ROWS',err)});
          try{client.close();}catch{/* Reconnect even if the old stream is broken. */}
          client=undefined;
          await wait(500*2**(attempt-1));
          client=clientFactory({url,authToken,intMode:'string'});
        }
      }
    };
    const current=await run('CHECK_EOD','SELECT trade_day FROM blue_eod_ingest_audit_v1 WHERE trade_day=? AND row_count>=1700',[s.day]);
    if(current.rows.length)return {...summary,status:'SKIPPED_VERIFIED_EOD',written:0};
    const ref=await run('CHECK_REFERENCE','SELECT trade_day,row_count FROM blue_eod_ingest_audit_v1 WHERE trade_day<? AND row_count>=1700 ORDER BY trade_day DESC LIMIT 1',[s.day]);
    check(ref.rows.length===1&&String(ref.rows[0].trade_day)===s.reference,'PROVISIONAL_REFERENCE_CHANGED');
    const n=await run('CHECK_REFERENCE','SELECT COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day=?',[s.reference]);
    check(Number(n.rows[0]?.n)===Number(ref.rows[0].row_count),'PROVISIONAL_REFERENCE_INCOMPLETE');
    await run('CREATE_ROWS','CREATE TABLE IF NOT EXISTS blue_provisional_pattern_rows_v1 (snapshot_id TEXT NOT NULL, code TEXT NOT NULL, record_json TEXT NOT NULL, row_sha256 TEXT NOT NULL, PRIMARY KEY(snapshot_id,code))');
    await run('CREATE_HEAD','CREATE TABLE IF NOT EXISTS blue_provisional_pattern_head_v1 (trade_day TEXT PRIMARY KEY, reference_day TEXT NOT NULL, snapshot_id TEXT NOT NULL, latest_observed_utc TEXT NOT NULL, scan_asof_utc TEXT NOT NULL, row_count INTEGER NOT NULL, metadata_json TEXT NOT NULL)');
    const head=(next='READ_HEAD')=>run(next,'SELECT snapshot_id,latest_observed_utc,scan_asof_utc,row_count,metadata_json FROM blue_provisional_pattern_head_v1 WHERE trade_day=?',[s.day]);
    const before=(await head()).rows[0];
    if(before&&(String(before.latest_observed_utc)>s.newest||
      (String(before.latest_observed_utc)===s.newest&&String(before.scan_asof_utc)>=s.scan))&&String(before.snapshot_id)!==s.id)
      return {...summary,status:'SKIPPED_STALE',written:0};
    let written=0;
    onProgress({stage:'WRITE_ROWS',done:0,total:s.rows.length});
    for(const chunk of writeChunks(s.rows)){
      await run('WRITE_ROWS','INSERT INTO blue_provisional_pattern_rows_v1 (snapshot_id,code,record_json,row_sha256) VALUES '+chunk.map(()=>'(?,?,?,?)').join(',')+' ON CONFLICT(snapshot_id,code) DO NOTHING',
        chunk.flatMap(v=>[s.id,v.code,v.raw,v.hash]));
      written+=chunk.length;
      if(written===s.rows.length||written%20<chunk.length)onProgress({stage:'WRITE_ROWS',done:written,total:s.rows.length});
    }
    let read=0;
    onProgress({stage:'READ_ROWS',done:0,total:s.rows.length});
    // Verify exact indexed keys instead of OFFSET pagination. Small pages
    // limit response size; fall back to single rows only on retryable errors.
    const verifyChunk=async(chunk)=>{
      let page;
      try{
        page=await readQuery('SELECT code,record_json,row_sha256 FROM blue_provisional_pattern_rows_v1 WHERE snapshot_id=? AND code IN ('+chunk.map(()=>'?').join(',')+') ORDER BY code',[s.id,...chunk.map(v=>v.code)]);
      }catch(err){
        if(chunk.length===1||!retryableRead(err))throw err;
        onProgress({stage:'READ_ROWS',fallback:'SINGLE_ROW'});
        for(const row of chunk)await verifyChunk([row]);
        return;
      }
      check(page.rows.length===chunk.length,'PROVISIONAL_READBACK_MISMATCH');
      for(let i=0;i<chunk.length;i++){
        const v=page.rows[i],expected=chunk[i];
        check(String(v.code)===expected.code&&String(v.record_json)===expected.raw&&String(v.row_sha256)===expected.hash,'PROVISIONAL_READBACK_MISMATCH');
        read++;
      }
      if(read===s.rows.length||read%20<chunk.length)onProgress({stage:'READ_ROWS',done:read,total:s.rows.length});
    };
    const total=await readQuery('SELECT COUNT(*) AS n FROM blue_provisional_pattern_rows_v1 WHERE snapshot_id=?',[s.id]);
    check(Number(total.rows[0]?.n)===s.rows.length,'PROVISIONAL_READBACK_MISMATCH');
    for(let offset=0;offset<s.rows.length;offset+=READ_PAGE)
      await verifyChunk(s.rows.slice(offset,offset+READ_PAGE));
    check(read===s.rows.length,'PROVISIONAL_READBACK_MISMATCH');
    // One SQL statement publishes a fully verified generation. Prevent both
    // out-of-order writers and promotion after an exact-day EOD audit arrives.
    onProgress({stage:'PROMOTE_HEAD'});
    await run('PROMOTE_HEAD','INSERT INTO blue_provisional_pattern_head_v1 (trade_day,reference_day,snapshot_id,latest_observed_utc,scan_asof_utc,row_count,metadata_json) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM blue_eod_ingest_audit_v1 WHERE trade_day=? AND row_count>=1700) AND ?=(SELECT trade_day FROM blue_eod_ingest_audit_v1 WHERE trade_day<? AND row_count>=1700 ORDER BY trade_day DESC LIMIT 1) ON CONFLICT(trade_day) DO UPDATE SET reference_day=excluded.reference_day,snapshot_id=excluded.snapshot_id,latest_observed_utc=excluded.latest_observed_utc,scan_asof_utc=excluded.scan_asof_utc,row_count=excluded.row_count,metadata_json=excluded.metadata_json WHERE excluded.latest_observed_utc>blue_provisional_pattern_head_v1.latest_observed_utc OR (excluded.latest_observed_utc=blue_provisional_pattern_head_v1.latest_observed_utc AND excluded.scan_asof_utc>blue_provisional_pattern_head_v1.scan_asof_utc)',
      [s.day,s.reference,s.id,s.newest,s.scan,s.rows.length,s.metadata,s.day,s.reference,s.day]);
    const after=(await head('VERIFY_HEAD')).rows[0];
    if(String(after?.snapshot_id)!==s.id)return {...summary,status:'SKIPPED_SUPERSEDED',written:0};
    check(Number(after.row_count)===s.rows.length&&String(after.metadata_json)===s.metadata,'PROVISIONAL_HEAD_READBACK_MISMATCH');
    return {...summary,status:'OK',written:s.rows.length};
  }catch(err){
    if(/^(INVALID_PROVISIONAL_|PROVISIONAL_)[A-Z0-9_]+$/.test(err?.message||''))throw err;
    throw Error(storageFailure(stage,err));
  }finally{client?.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const [resultPath,quotesPath,mode='dry_run']=process.argv.slice(2);
    const result=JSON.parse(await readFile(resultPath,'utf8')),quotes=JSON.parse(await readFile(quotesPath,'utf8'));
    console.log('BLUE_PROVISIONAL_PUBLISH',JSON.stringify(await publishSnapshot({result,quotes,mode,onProgress:p=>console.log('BLUE_PROVISIONAL_PUBLISH_PROGRESS',JSON.stringify(p))})));
  }catch(e){
    console.error('BLUE_PROVISIONAL_PUBLISH_FAILED',/^(INVALID_PROVISIONAL_|PROVISIONAL_)[A-Z0-9_]+$/.test(e?.message||'')?e.message:'SANITIZED_RUNTIME_FAILURE');
    process.exitCode=1;
  }
}

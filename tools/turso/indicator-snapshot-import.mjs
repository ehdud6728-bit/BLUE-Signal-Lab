/** Audited full-market daily indicators, independent of D1 and KIS. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createClient} from '@libsql/client';

const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const CODE=/^[0-9A-Z]{6}$/;
const HASH=/^[a-f0-9]{64}$/;
const status=new Set(['ELIGIBLE','INSUFFICIENT_HISTORY','SUSPICIOUS_GAP']);
const sha=x=>createHash('sha256').update(x).digest('hex');
const check=(ok,code)=>{if(!ok)throw Error(code);};
const validDay=x=>typeof x==='string'&&DAY.test(x)&&
  new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;

export function verifyIndicatorSnapshot(manifest,payload){
  check(manifest?.format==='BLUE_TURSO_ALL_MARKET_INDICATORS_V1'&&
    validDay(manifest.day)&&Number.isInteger(manifest.row_count)&&
    manifest.row_count>=1700&&manifest.row_count<=10000&&
    Number.isInteger(manifest.matched_stocks)&&manifest.matched_stocks>=0&&
    manifest.matched_stocks<=manifest.row_count&&
    typeof manifest.source==='string'&&manifest.source.startsWith('KRX')&&
    HASH.test(manifest.source_audit_sha256)&&HASH.test(manifest.payload_sha256),
  'INVALID_INDICATOR_MANIFEST');
  check(Buffer.isBuffer(payload)&&payload.length>0&&payload.length<32_000_000&&
    sha(payload)===manifest.payload_sha256,'INDICATOR_PAYLOAD_HASH_MISMATCH');
  const raw=payload.toString('utf8');
  check(raw.endsWith('\n'),'INVALID_INDICATOR_LINES');
  const lines=raw.trimEnd().split('\n');
  check(lines.length===manifest.row_count,'INDICATOR_ROW_COUNT_MISMATCH');
  const rows=[];let previous='',matched=0;
  for(const line of lines){
    let row;
    try{row=JSON.parse(line);}catch{throw Error('INDICATOR_INVALID_JSON');}
    check(row.trade_day===manifest.day&&CODE.test(row.code)&&row.code>previous&&
      ['KOSPI','KOSDAQ'].includes(row.market)&&Number.isSafeInteger(row.close_price)&&
      row.close_price>0&&Number.isSafeInteger(row.history_bars)&&row.history_bars>=1&&
      status.has(row.eligibility)&&
      row.indicators&&typeof row.indicators==='object'&&!Array.isArray(row.indicators)&&
      row.crosses&&typeof row.crosses==='object'&&!Array.isArray(row.crosses)&&
      Object.values(row.indicators).every(v=>v===null||typeof v==='number'&&Number.isFinite(v))&&
      Object.values(row.crosses).every(v=>typeof v==='boolean')&&
      Array.isArray(row.signal_names)&&row.signal_names.every(s=>
        typeof s==='string'&&/^[A-Z0-9_]{2,60}$/.test(s))&&
      row.signal_names.join(',')===[...new Set(row.signal_names)].sort().join(',')&&
      (row.eligibility==='ELIGIBLE'||row.signal_names.length===0),
    'INVALID_INDICATOR_RECORD');
    previous=row.code;
    if(row.signal_names.length)matched++;
    rows.push({...row,raw:line,row_sha256:sha(Buffer.from(line,'utf8'))});
  }
  check(matched===manifest.matched_stocks,'INDICATOR_MATCHED_COUNT_MISMATCH');
  return rows;
}

export async function importIndicatorSnapshot({manifest,payload,mode='dry_run',
  env=process.env,clientFactory=createClient}={}){
  check(['dry_run','apply'].includes(mode),'INVALID_INDICATOR_MODE');
  const rows=verifyIndicatorSnapshot(manifest,payload);
  if(mode==='dry_run')return {status:'DRY_RUN',day:manifest.day,rows:rows.length,written:0};
  const url=String(env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  check(/^(libsql|https):\/\//.test(url),'TURSO_URL_MISSING_OR_INVALID');
  check(authToken.length>0,'TURSO_TOKEN_MISSING');
  const client=clientFactory({url,authToken,intMode:'bigint'});
  try{
    // Fail before writes if even one audited KRX closing price differs.
    const audit=await client.execute({sql:`SELECT row_count FROM blue_eod_ingest_audit_v1
      WHERE trade_day=? LIMIT 1`,args:[manifest.day]});
    check(audit.rows.length===1&&Number(audit.rows[0].row_count)===rows.length,
      'TURSO_INDICATOR_EOD_AUDIT_MISMATCH');
    const eod=await client.execute({sql:`SELECT code,close FROM blue_eod_daily_v1
      WHERE trade_day=? ORDER BY code`,args:[manifest.day]});
    check(eod.rows.length===rows.length&&eod.rows.every((r,i)=>
      String(r.code)===rows[i].code&&Number(r.close)===rows[i].close_price),
    'TURSO_INDICATOR_EOD_UNIVERSE_OR_PRICE_MISMATCH');
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_indicators_daily_v1 (
      trade_day TEXT NOT NULL,code TEXT NOT NULL,close_price INTEGER NOT NULL,
      record_json TEXT NOT NULL,row_sha256 TEXT NOT NULL,
      source_payload_sha256 TEXT NOT NULL,
      imported_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(trade_day,code))`);
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_indicators_audit_v1 (
      trade_day TEXT PRIMARY KEY,row_count INTEGER NOT NULL,
      matched_stocks INTEGER NOT NULL,source_payload_sha256 TEXT NOT NULL,
      source_audit_sha256 TEXT NOT NULL,
      completed_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const auditBefore=await client.execute({sql:`SELECT row_count,matched_stocks,
      source_payload_sha256,source_audit_sha256 FROM blue_indicators_audit_v1
      WHERE trade_day=?`,args:[manifest.day]});
    if(auditBefore.rows.length){
      const a=auditBefore.rows[0];
      check(auditBefore.rows.length===1&&Number(a.row_count)===rows.length&&
        Number(a.matched_stocks)===manifest.matched_stocks&&
        String(a.source_payload_sha256)===manifest.payload_sha256&&
        String(a.source_audit_sha256)===manifest.source_audit_sha256,
      'TURSO_INDICATOR_AUDIT_CONFLICT');
    }
    const existing=await client.execute({sql:`SELECT code,record_json,row_sha256
      FROM blue_indicators_daily_v1 WHERE trade_day=? ORDER BY code`,args:[manifest.day]});
    check(existing.rows.length<=rows.length,'TURSO_INDICATOR_EXTRA_RECORDS');
    const map=new Map(rows.map(r=>[r.code,r]));
    for(const r of existing.rows){
      const expect=map.get(String(r.code));
      check(expect&&String(r.record_json)===expect.raw&&
        String(r.row_sha256)===expect.row_sha256,'TURSO_INDICATOR_RECORD_CONFLICT');
    }
    // Only send rows missing from a previously interrupted import. 100 rows
    // use 600 bound parameters, below SQLite's conservative 999 limit.
    const existingCodes=new Set(existing.rows.map(r=>String(r.code)));
    const missing=rows.filter(r=>!existingCodes.has(r.code));
    for(let i=0;i<missing.length;i+=100){
      const chunk=missing.slice(i,i+100);
      const placeholders=chunk.map(()=>'(?,?,?,?,?,?)').join(',');
      await client.execute({sql:`INSERT INTO blue_indicators_daily_v1
        (trade_day,code,close_price,record_json,row_sha256,source_payload_sha256)
        VALUES `+placeholders+` ON CONFLICT(trade_day,code) DO NOTHING`,
        args:chunk.flatMap(r=>[r.trade_day,r.code,r.close_price,r.raw,r.row_sha256,
          manifest.payload_sha256])});
    }
    const after=await client.execute({sql:`SELECT code,record_json,row_sha256
      FROM blue_indicators_daily_v1 WHERE trade_day=? ORDER BY code`,args:[manifest.day]});
    check(after.rows.length===rows.length&&after.rows.every((r,i)=>
      String(r.code)===rows[i].code&&String(r.record_json)===rows[i].raw&&
      String(r.row_sha256)===rows[i].row_sha256),'TURSO_INDICATOR_READBACK_MISMATCH');
    await client.execute({sql:`INSERT INTO blue_indicators_audit_v1
      (trade_day,row_count,matched_stocks,source_payload_sha256,source_audit_sha256)
      VALUES (?,?,?,?,?) ON CONFLICT(trade_day) DO NOTHING`,
      args:[manifest.day,rows.length,manifest.matched_stocks,manifest.payload_sha256,
        manifest.source_audit_sha256]});
    const proof=await client.execute({sql:`SELECT row_count,matched_stocks,
      source_payload_sha256 FROM blue_indicators_audit_v1 WHERE trade_day=?`,
      args:[manifest.day]});
    check(proof.rows.length===1&&Number(proof.rows[0].row_count)===rows.length&&
      Number(proof.rows[0].matched_stocks)===manifest.matched_stocks&&
      String(proof.rows[0].source_payload_sha256)===manifest.payload_sha256,
    'TURSO_INDICATOR_AUDIT_READBACK_MISMATCH');
    return {status:'OK',day:manifest.day,rows:rows.length,written:missing.length};
  }finally{client.close();}
}

async function main(){
  const argv=process.argv.slice(2);
  const mode=(argv.find(s=>s.startsWith('--mode='))||'--mode=dry_run').slice(7);
  const input=(argv.find(s=>s.startsWith('--input-dir='))||
    '--input-dir=output/turso_daily_research/indicators').slice(12);
  const manifest=JSON.parse(await readFile(input+'/manifest.json','utf8'));
  const payload=await readFile(input+'/records.jsonl');
  const result=await importIndicatorSnapshot({manifest,payload,mode});
  console.log('BLUE_TURSO_ALL_INDICATORS_'+result.status+
    ' day='+result.day+' rows='+result.rows+' written='+result.written);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(e=>{
    const safe=/^(INVALID_INDICATOR_|INDICATOR_|TURSO_INDICATOR_|TURSO_URL_MISSING_OR_INVALID|TURSO_TOKEN_MISSING)/;
    console.error('BLUE_TURSO_ALL_INDICATORS_FAILED',
      safe.test(e?.message||'')?e.message:'SANITIZED_RUNTIME_FAILURE');
    process.exitCode=1;
  });
}

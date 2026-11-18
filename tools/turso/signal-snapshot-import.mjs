/** Independently persist a verified R1.1 signal snapshot without reading D1.
 * All writes are opt-in; existing EOD rows and legacy D1 tables are immutable.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createClient} from '@libsql/client';

const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const CODE=/^[0-9A-Z]{6}$/;
const HASH=/^[a-f0-9]{64}$/;
const MAX_BYTES=64_000_000;
const READ_PAGE=5;
const WRITE_PAGE=4; // Chart evidence can be much larger than an OHLC row.
const assert=(condition,code)=>{if(!condition)throw Error(code);};
const sha=(buffer)=>createHash('sha256').update(buffer).digest('hex');

export function verifySignalSnapshot(manifest,payload){
  assert(manifest?.format==='BLUE_TURSO_SIGNAL_SNAPSHOT_V1'&&DAY.test(manifest.day)&&
    manifest.run_id===`blue_market_${manifest.day.replaceAll('-','')}`&&
    Number.isInteger(manifest.observed_stocks)&&manifest.observed_stocks>=1700&&
    Number.isInteger(manifest.matched_stocks)&&manifest.matched_stocks>=0&&
    manifest.matched_stocks<=manifest.observed_stocks&&
    Number.isInteger(manifest.signal_events)&&manifest.signal_events>=manifest.matched_stocks&&
    typeof manifest.source==='string'&&manifest.source.length>0&&manifest.source.length<120&&
    ['payload_sha256','source_audit_sha256','signals_csv_sha256','chart_snapshots_sha256']
      .every(k=>HASH.test(manifest[k])),'INVALID_SIGNAL_SNAPSHOT_MANIFEST');
  assert(Buffer.isBuffer(payload)&&payload.length<MAX_BYTES&&
    sha(payload)===manifest.payload_sha256,'SIGNAL_SNAPSHOT_HASH_MISMATCH');
  const source=payload.toString('utf8');
  assert(!source||source.endsWith('\n'),'INVALID_SIGNAL_SNAPSHOT_LINES');
  const lines=source?source.trimEnd().split('\n'):[];
  assert(lines.length===manifest.matched_stocks,'SIGNAL_SNAPSHOT_COUNT_MISMATCH');
  const rows=[];let last='',events=0;
  for(const line of lines){
    let row;
    try{row=JSON.parse(line);}catch{throw Error('INVALID_SIGNAL_SNAPSHOT_JSON');}
    const names=typeof row.signal_names==='string'?row.signal_names.split(','):[];
    const bars=row.chart?.bars;
    assert(row.trade_day===manifest.day&&row.run_id===manifest.run_id&&
      CODE.test(row.code)&&row.code>last&&
      names.length>0&&names.every(s=>/^[A-Z0-9_]{2,60}$/.test(s))&&
      [...names].sort().join(',')===names.join(',')&&new Set(names).size===names.length&&
      Number.isSafeInteger(row.close_price)&&row.close_price>0&&
      (row.supply_distance_pct===null||Number.isFinite(row.supply_distance_pct))&&
      row.extras&&typeof row.extras==='object'&&!Array.isArray(row.extras)&&
      row.stats&&typeof row.stats==='object'&&!Array.isArray(row.stats)&&
      row.chart?.version==='R10_CHART_V1'&&row.chart.asof===manifest.day&&
      Array.isArray(bars)&&bars.length>0&&bars.length<=180&&
      bars.at(-1)?.t===manifest.day&&bars.every(b=>typeof b.t==='string'&&
        DAY.test(b.t)&&b.t<=manifest.day)&&
      Number(bars.at(-1)?.c)===row.close_price,
      'INVALID_SIGNAL_SNAPSHOT_RECORD');
    last=row.code;events+=names.length;
    rows.push({...row,raw:line,row_sha256:sha(Buffer.from(line,'utf8'))});
  }
  assert(events===manifest.signal_events,'SIGNAL_SNAPSHOT_EVENT_COUNT_MISMATCH');
  return rows;
}

async function readSignalDay(client,day,expectedCount){
  const result=[];
  for(let offset=0;offset<=expectedCount;offset+=READ_PAGE){
    const page=await client.execute({sql:`SELECT code,record_json,row_sha256
      FROM blue_research_signals_v1 WHERE trade_day=? ORDER BY code LIMIT ? OFFSET ?`,
      args:[day,READ_PAGE,offset]});
    result.push(...page.rows);
    assert(result.length<=expectedCount,'TURSO_SIGNAL_EXTRA_RECORDS');
    if(page.rows.length<READ_PAGE)break;
  }
  return result;
}

export async function importSignalSnapshot({manifest,payload,mode='dry_run',env=process.env,
  clientFactory=createClient}={}){
  assert(['dry_run','apply'].includes(mode),'INVALID_SIGNAL_SNAPSHOT_MODE');
  const records=verifySignalSnapshot(manifest,payload);
  if(mode==='dry_run')return {status:'DRY_RUN',day:manifest.day,rows:records.length,written:0};
  const url=String(env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  assert(/^(libsql|https):\/\//.test(url),'TURSO_URL_MISSING_OR_INVALID');
  assert(Boolean(authToken),'TURSO_TOKEN_MISSING');
  const client=clientFactory({url,authToken,intMode:'bigint'});
  try{
    // The exact-day KRX candles are a separate independently audited source.
    const proof=await client.execute({sql:`SELECT row_count FROM blue_eod_ingest_audit_v1
      WHERE trade_day=? AND row_count>=1700 LIMIT 1`,args:[manifest.day]});
    assert(proof.rows.length===1,'TURSO_SIGNAL_EOD_DAY_NOT_VERIFIED');
    for(let i=0;i<records.length;i+=40){
      const chunk=records.slice(i,i+40);
      const eod=await client.execute({sql:`SELECT code,close FROM blue_eod_daily_v1
        WHERE trade_day=? AND code IN (${chunk.map(()=>'?').join(',')}) ORDER BY code`,
        args:[manifest.day,...chunk.map(r=>r.code)]});
      assert(eod.rows.length===chunk.length&&eod.rows.every((r,j)=>
        String(r.code)===chunk[j].code&&Number(r.close)===chunk[j].close_price),
      'TURSO_SIGNAL_EOD_PRICE_MISMATCH');
    }
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_research_signals_v1 (
      trade_day TEXT NOT NULL,code TEXT NOT NULL,run_id TEXT NOT NULL,
      signal_names TEXT NOT NULL,close_price INTEGER NOT NULL,
      record_json TEXT NOT NULL,row_sha256 TEXT NOT NULL,
      source_payload_sha256 TEXT NOT NULL,
      imported_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(trade_day,code))`);
    await client.execute(`CREATE INDEX IF NOT EXISTS blue_research_signals_day_v1
      ON blue_research_signals_v1(trade_day)`);
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_research_signal_audit_v1 (
      trade_day TEXT PRIMARY KEY,row_count INTEGER NOT NULL,
      observed_stocks INTEGER NOT NULL,signal_events INTEGER NOT NULL,
      source_payload_sha256 TEXT NOT NULL,source_audit_sha256 TEXT NOT NULL,
      completed_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const existingAudit=await client.execute({sql:`SELECT row_count,observed_stocks,signal_events,
      source_payload_sha256,source_audit_sha256 FROM blue_research_signal_audit_v1
      WHERE trade_day=? LIMIT 1`,args:[manifest.day]});
    if(existingAudit.rows.length){
      const a=existingAudit.rows[0];
      assert(Number(a.row_count)===records.length&&
        Number(a.observed_stocks)===manifest.observed_stocks&&
        Number(a.signal_events)===manifest.signal_events&&
        String(a.source_payload_sha256)===manifest.payload_sha256&&
        String(a.source_audit_sha256)===manifest.source_audit_sha256,
        'TURSO_SIGNAL_EXISTING_AUDIT_CONFLICT');
    }
    // Preflight every existing row BEFORE adding missing rows. No silent overwrite.
    const before=await readSignalDay(client,manifest.day,records.length);
    const expected=new Map(records.map(r=>[r.code,r]));
    for(const r of before){
      const found=expected.get(String(r.code));
      assert(found&&String(r.row_sha256)===found.row_sha256&&
        String(r.record_json)===found.raw,'TURSO_SIGNAL_EXISTING_RECORD_CONFLICT');
    }
    for(let i=0;i<records.length;i+=WRITE_PAGE){
      const chunk=records.slice(i,i+WRITE_PAGE);
      await client.execute({sql:`INSERT INTO blue_research_signals_v1
        (trade_day,code,run_id,signal_names,close_price,record_json,row_sha256,source_payload_sha256)
        VALUES ${chunk.map(()=>'(?,?,?,?,?,?,?,?)').join(',')}
        ON CONFLICT(trade_day,code) DO NOTHING`,
        args:chunk.flatMap(r=>[r.trade_day,r.code,r.run_id,r.signal_names,r.close_price,
          r.raw,r.row_sha256,manifest.payload_sha256])});
    }
    const after=await readSignalDay(client,manifest.day,records.length);
    assert(after.length===records.length&&after.every((r,i)=>
      String(r.code)===records[i].code&&String(r.record_json)===records[i].raw&&
      String(r.row_sha256)===records[i].row_sha256),
    'TURSO_SIGNAL_READBACK_MISMATCH');
    await client.execute({sql:`INSERT INTO blue_research_signal_audit_v1
      (trade_day,row_count,observed_stocks,signal_events,source_payload_sha256,source_audit_sha256)
      VALUES (?,?,?,?,?,?) ON CONFLICT(trade_day) DO NOTHING`,
      args:[manifest.day,records.length,manifest.observed_stocks,manifest.signal_events,
        manifest.payload_sha256,manifest.source_audit_sha256]});
    const audited=await client.execute({sql:`SELECT row_count,source_payload_sha256
      FROM blue_research_signal_audit_v1 WHERE trade_day=?`,args:[manifest.day]});
    assert(audited.rows.length===1&&Number(audited.rows[0].row_count)===records.length&&
      String(audited.rows[0].source_payload_sha256)===manifest.payload_sha256,
    'TURSO_SIGNAL_READBACK_AUDIT_MISMATCH');
    return {status:'OK',day:manifest.day,rows:records.length,written:records.length};
  }finally{client.close();}
}

async function main(){
  const argv=process.argv.slice(2);
  const mode=(argv.find(x=>x.startsWith('--mode='))||'--mode=dry_run').slice(7);
  const input=(argv.find(x=>x.startsWith('--input-dir='))||'--input-dir=output/turso_signals').slice(12);
  const manifest=JSON.parse(await readFile(`${input}/manifest.json`,'utf8'));
  const payload=await readFile(`${input}/records.jsonl`);
  const result=await importSignalSnapshot({manifest,payload,mode});
  console.log(`BLUE_TURSO_SIGNAL_SNAPSHOT_${result.status} day=${result.day} records=${result.rows} written=${result.written}`);
}

if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
  main().catch(err=>{
    const allowlist=/^(INVALID_SIGNAL_|SIGNAL_SNAPSHOT_|TURSO_SIGNAL_|TURSO_URL_MISSING_OR_INVALID|TURSO_TOKEN_MISSING)/;
    console.error('BLUE_TURSO_SIGNAL_SNAPSHOT_FAILED',
      allowlist.test(err?.message||'')?err.message:'SANITIZED_RUNTIME_FAILURE');
    process.exitCode=1;
  });
}

/** Strict, resumable, Turso-only importer for the exact KRX EOD day-range export. */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createClient} from '@libsql/client';

const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const CODE=/^[0-9A-Z]{6}$/;
const HASH=/^[0-9a-f]{64}$/;
const INT=/^(0|[1-9]\d*)$/;
const SOURCE=new Set(['KRX_PYKRX_EXACT_DAY_VERIFIED','KRX_OPENAPI_EXACT_DAY_VERIFIED']);
const NUMERIC=['open','high','low','close','volume','amount'];
const MAX_BIGINT=9223372036854775807n;
const INSERT_SIZE=40;

const sha256=(input)=>createHash('sha256').update(input).digest('hex');
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const dateUTC=(str)=>{
  assert(DAY.test(str),'INVALID_DATE');
  const value=new Date(`${str}T00:00:00Z`);
  assert(!Number.isNaN(value.getTime()) && value.toISOString().slice(0,10)===str,'INVALID_DATE');
  return value;
};

export function validateEodRange(manifest,buffer){
  assert(manifest?.format==='BLUE_TURSO_VERIFIED_EOD_RANGE_V1','INVALID_EOD_MANIFEST');
  const start=dateUTC(manifest.start_day),end=dateUTC(manifest.end_day);
  const daySpan=Math.round((end-start)/86400000)+1;
  assert(daySpan>=1 && daySpan<=10,'INVALID_EOD_RANGE');
  const expected=[];
  for(let i=0;i<daySpan;i++){
    const d=new Date(start.getTime()+i*86400000);
    if(d.getUTCDay()!==0 && d.getUTCDay()!==6)expected.push(d.toISOString().slice(0,10));
  }
  assert(expected.length>0 && Array.isArray(manifest.days) && manifest.days.length===expected.length,'MISSING_EOD_DAYS');
  assert(Buffer.isBuffer(buffer) && buffer.length>0 && buffer.length<16000000,'INVALID_EOD_DATA');
  assert(HASH.test(manifest.data_sha256) && sha256(buffer)===manifest.data_sha256,'EOD_PAYLOAD_HASH_MISMATCH');
  const raw=buffer.toString('utf8');
  assert(raw.endsWith('\n'),'INVALID_EOD_DATA');
  const lines=raw.trimEnd().split('\n');
  assert(lines.length===manifest.total_rows && lines.length>=expected.length*1700 && lines.length<=35000,
    'INVALID_EOD_ROW_COUNT');
  const grouped=new Map(expected.map(day=>[day,[]]));
  const chunks=new Map(expected.map(day=>[day,[]]));
  let index=0;
  for(const [i,day] of expected.entries()){
    const audit=manifest.days[i];
    assert(audit?.day===day && Number.isInteger(audit.rows) && audit.rows>=1700 && audit.rows<=10000 &&
      SOURCE.has(audit.source) && HASH.test(audit.sha256),'INVALID_EOD_DAY_AUDIT');
    let previous='';
    const marketCount={KOSPI:0,KOSDAQ:0};
    for(let j=0;j<audit.rows;j++){
      const line=lines[index++];
      assert(typeof line==='string','MISSING_EOD_ROWS');
      let row;
      try {row=JSON.parse(line);} catch {throw Error('BAD_EOD_JSON');}
      assert(row?.trade_day===day && CODE.test(row.code) && row.code>previous &&
        ['KOSPI','KOSDAQ'].includes(row.market) && typeof row.name==='string' && row.name.length<=100 &&
        row.source===audit.source,'INVALID_EOD_ROW');
      previous=row.code;
      marketCount[row.market]++;
      for(const key of NUMERIC){
        assert(typeof row[key]==='string' && INT.test(row[key]),'INVALID_EOD_NUMERIC');
        const v=BigInt(row[key]);
        assert(v>0n && v<=MAX_BIGINT,'INVALID_EOD_NUMERIC');
      }
      assert(BigInt(row.low)<=BigInt(row.open) && BigInt(row.low)<=BigInt(row.close) &&
        BigInt(row.high)>=BigInt(row.open) && BigInt(row.high)>=BigInt(row.close),'INVALID_EOD_OHLC');
      grouped.get(day).push(row);
      chunks.get(day).push(`${line}\n`);
    }
    assert(marketCount.KOSPI>=400 && marketCount.KOSDAQ>=400,'INCOMPLETE_EOD_MARKET');
    assert(sha256(Buffer.from(chunks.get(day).join(''),'utf8'))===audit.sha256,'EOD_DAY_HASH_MISMATCH');
  }
  assert(index===lines.length,'EXTRA_EOD_ROWS');
  return {dates:expected,grouped,total:lines.length};
}

export async function importEodRange({manifest,buffer,mode='dry_run',env=process.env,
  clientFactory=createClient}={}){
  assert(['dry_run','apply'].includes(mode),'INVALID_EOD_MODE');
  const prepared=validateEodRange(manifest,buffer);
  if(mode==='dry_run')return {status:'DRY_RUN',days:prepared.dates.length,rows:prepared.total,written:0};
  const url=String(env.TURSO_DATABASE_URL||'').trim(),authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  assert(/^(libsql|https):\/\//.test(url),'TURSO_URL_MISSING_OR_INVALID');
  assert(Boolean(authToken),'TURSO_TOKEN_MISSING');
  const client=clientFactory({url,authToken,intMode:'bigint'});
  try{
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_eod_daily_v1 (
      trade_day TEXT NOT NULL, code TEXT NOT NULL, market TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT '', open INTEGER NOT NULL, high INTEGER NOT NULL,
      low INTEGER NOT NULL, close INTEGER NOT NULL, volume INTEGER NOT NULL,
      amount INTEGER NOT NULL, source TEXT NOT NULL,
      imported_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(trade_day,code))`);
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_eod_ingest_audit_v1 (
      trade_day TEXT PRIMARY KEY, row_count INTEGER NOT NULL, source TEXT NOT NULL,
      day_sha256 TEXT NOT NULL, completed_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    for(const day of prepared.dates){
      const rows=prepared.grouped.get(day);
      const audit=manifest.days.find(d=>d.day===day);
      const statements=[];
      for(let i=0;i<rows.length;i+=INSERT_SIZE){
        const chunk=rows.slice(i,i+INSERT_SIZE);
        statements.push({
          sql:`INSERT INTO blue_eod_daily_v1 (trade_day,code,market,name,open,high,low,close,volume,amount,source)
            VALUES ${chunk.map(()=>'(?,?,?,?,?,?,?,?,?,?,?)').join(',')}
            ON CONFLICT(trade_day,code) DO NOTHING`,
          args:chunk.flatMap(r=>[r.trade_day,r.code,r.market,r.name,
            r.open,r.high,r.low,r.close,r.volume,r.amount,r.source]),
        });
      }
      // Bounded transactions: safe to repeat if a network failure interrupts mid-day.
      for(let i=0;i<statements.length;i+=10)await client.batch(statements.slice(i,i+10),'write');
      const result=await client.execute({sql:`SELECT code,market,name,open,high,low,close,volume,amount,source
        FROM blue_eod_daily_v1 WHERE trade_day=? ORDER BY code`,args:[day]});
      assert(result.rows.length===rows.length,'TURSO_EOD_READBACK_COUNT_MISMATCH');
      for(let i=0;i<rows.length;i++){
        const actual=result.rows[i],expected=rows[i];
        assert(actual && ['code','market','name',...NUMERIC,'source'].every(k=>
          String(actual[k])===String(expected[k])),'TURSO_EOD_EXISTING_OR_READBACK_MISMATCH');
      }
      await client.execute({sql:`INSERT INTO blue_eod_ingest_audit_v1(trade_day,row_count,source,day_sha256)
        VALUES (?,?,?,?) ON CONFLICT(trade_day) DO NOTHING`,
        args:[day,rows.length,audit.source,audit.sha256]});
      const proof=await client.execute({sql:`SELECT row_count,source,day_sha256
        FROM blue_eod_ingest_audit_v1 WHERE trade_day=?`,args:[day]});
      assert(proof.rows.length===1 && Number(proof.rows[0].row_count)===rows.length &&
        String(proof.rows[0].source)===audit.source && String(proof.rows[0].day_sha256)===audit.sha256,
        'TURSO_EOD_AUDIT_MISMATCH');
      console.log(`BLUE_TURSO_EOD_DAY_STORED day=${day} verified_rows=${rows.length}`);
    }
    return {status:'OK',days:prepared.dates.length,rows:prepared.total,written:prepared.total};
  }finally{client.close();}
}

async function main(){
  const argv=process.argv.slice(2);
  const mode=(argv.find(a=>a.startsWith('--mode='))||'--mode=dry_run').slice(7);
  const input=(argv.find(a=>a.startsWith('--input-dir='))||'--input-dir=output/turso_eod_range').slice(12);
  const manifest=JSON.parse(await readFile(`${input}/manifest.json`,'utf8'));
  const buffer=await readFile(`${input}/daily.jsonl`);
  const result=await importEodRange({manifest,buffer,mode});
  console.log(`BLUE_TURSO_EOD_RANGE_${result.status} verified_days=${result.days} verified_rows=${result.rows} written=${result.written}`);
}

if(process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href){
  main().catch(err=>{
    const safe=new Set(['INVALID_EOD_MANIFEST','INVALID_DATE','INVALID_EOD_RANGE','MISSING_EOD_DAYS',
      'INVALID_EOD_DATA','EOD_PAYLOAD_HASH_MISMATCH','INVALID_EOD_ROW_COUNT','INVALID_EOD_DAY_AUDIT',
      'MISSING_EOD_ROWS','BAD_EOD_JSON','INVALID_EOD_ROW','INVALID_EOD_NUMERIC','INVALID_EOD_OHLC',
      'INCOMPLETE_EOD_MARKET','EOD_DAY_HASH_MISMATCH','EXTRA_EOD_ROWS','INVALID_EOD_MODE',
      'TURSO_URL_MISSING_OR_INVALID','TURSO_TOKEN_MISSING','TURSO_EOD_READBACK_COUNT_MISMATCH',
      'TURSO_EOD_EXISTING_OR_READBACK_MISMATCH','TURSO_EOD_AUDIT_MISMATCH']);
    console.error('BLUE_TURSO_EOD_RANGE_FAILED',safe.has(err?.message)?err.message:'SANITIZED_RUNTIME_FAILURE');
    process.exitCode=1;
  });
}

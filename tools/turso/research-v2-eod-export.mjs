/** Reconstruct the exact original KRX day bytes from immutable Turso EOD rows.
 * Read-only. A digest mismatch stops all research; a freshly invented digest
 * must NEVER be presented as the stored KRX provider's original proof.
 */
import {createHash} from 'node:crypto';
import {createClient} from '@libsql/client';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

export const REPLAY_DAYS=Object.freeze(['2026-11-10','2026-11-13','2026-11-16','2026-11-17']);
const FIELDS=['open','high','low','close','volume','amount'];
const HASH=/^[a-f0-9]{64}$/;
const CODE=/^[0-9A-Z]{6}$/;
const POS=/^[1-9][0-9]*$/;
const SOURCE=new Set(['KRX_PYKRX_EXACT_DAY_VERIFIED','KRX_OPENAPI_EXACT_DAY_VERIFIED']);
const MAX=9223372036854775807n;
const assert=(value,error)=>{if(!value)throw Error(error);};
const sha=(value)=>createHash('sha256').update(value).digest('hex');
const safeInt=(raw,min,max)=>{
  const num=Number(raw);
  assert(raw!==undefined&&raw!==null&&Number.isSafeInteger(num)&&num>=min&&num<=max,
    'V2_REPLAY_INVALID_COUNT');
  return num;
};

export function reconstructAuditedDay(day,audit,rows){
  assert(REPLAY_DAYS.includes(day),'V2_REPLAY_BAD_AUDIT');
  return reconstructVerifiedDay(day,audit,rows);
}
export function reconstructVerifiedDay(day,audit,rows){
  assert(typeof day==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day&&audit&&audit.trade_day===day&&
    SOURCE.has(String(audit.source))&&HASH.test(String(audit.day_sha256))&&
    Array.isArray(rows),'V2_REPLAY_BAD_AUDIT');
  const expected=safeInt(audit.row_count,1700,10000);
  assert(rows.length===expected,'V2_REPLAY_EOD_COUNT_MISMATCH');
  let previous='';const markets={KOSPI:0,KOSDAQ:0};
  const records=[];
  for(const r of rows){
    const code=String(r.code),market=String(r.market),name=r.name;
    assert(r.trade_day===day&&CODE.test(code)&&code>previous&&market in markets&&
      typeof name==='string'&&name.length<=100&&String(r.source)===audit.source,
      'V2_REPLAY_BAD_ROW');
    previous=code;markets[market]++;
    const values={};
    for(const field of FIELDS){
      const raw=String(r[field]);
      assert(POS.test(raw)&&BigInt(raw)<=MAX,'V2_REPLAY_BAD_PRICE');
      values[field]=raw;
    }
    assert(BigInt(values.low)<=BigInt(values.open)&&
      BigInt(values.low)<=BigInt(values.close)&&
      BigInt(values.high)>=BigInt(values.open)&&
      BigInt(values.high)>=BigInt(values.close),'V2_REPLAY_BAD_OHLC');
    // Python original canonical_day() insertion order and JSON separators.
    records.push({trade_day:day,code,market,name,...values,source:audit.source});
  }
  assert(markets.KOSPI>=400&&markets.KOSDAQ>=400,'V2_REPLAY_PARTIAL_MARKET');
  const payload=Buffer.from(records.map(r=>JSON.stringify(r)+'\n').join(''),'utf8');
  assert(sha(payload)===audit.day_sha256,'V2_REPLAY_ORIGINAL_KRX_HASH_MISMATCH');
  return {manifest:{format:'BLUE_TURSO_VERIFIED_EOD_RANGE_V1',start_day:day,
    end_day:day,days:[{day,rows:expected,source:audit.source,sha256:audit.day_sha256}],
    total_rows:expected,data_sha256:audit.day_sha256,
    origin:'IMMUTABLE_TURSO_KRX_EOD_READBACK_HASH_EQUAL'},payload};
}

export async function exportV2ReplaySource(client,{mode='plan'}={}){
  assert(['plan','inspect'].includes(mode),'V2_REPLAY_BAD_MODE');
  if(mode==='plan')return {status:'PLAN_ONLY',days:REPLAY_DAYS,
    turso_queries:0,krx_calls:0,kis_calls:0,writes:0};
  assert(client?.execute,'V2_REPLAY_CLIENT_REQUIRED');
  const auditRows=(await client.execute({sql:`SELECT trade_day,row_count,source,day_sha256
    FROM blue_eod_ingest_audit_v1 WHERE trade_day IN (?,?,?,?) ORDER BY trade_day`,
    args:REPLAY_DAYS})).rows;
  assert(auditRows.length===REPLAY_DAYS.length,'V2_REPLAY_MISSING_EOD_AUDIT');
  const original=(await client.execute({sql:`SELECT trade_day,observed_stocks
    FROM blue_research_signal_audit_v1 WHERE trade_day IN (?,?,?,?) ORDER BY trade_day`,
    args:REPLAY_DAYS})).rows;
  assert(original.length===REPLAY_DAYS.length,'V2_REPLAY_MISSING_ORIGINAL_RESEARCH_AUDIT');
  const prepared=[];
  for(let i=0;i<REPLAY_DAYS.length;i++){
    const day=REPLAY_DAYS[i],audit=auditRows[i],old=original[i];
    assert(String(audit.trade_day)===day&&String(old.trade_day)===day&&
      safeInt(audit.row_count,1700,10000)-safeInt(old.observed_stocks,1700,10000)===50,
      'V2_REPLAY_UNEXPECTED_OLD_GAP');
    const rows=(await client.execute({sql:`SELECT trade_day,code,market,name,open,high,low,
      close,volume,amount,source FROM blue_eod_daily_v1 WHERE trade_day=? ORDER BY code`,
      args:[day]})).rows;
    prepared.push({day,...reconstructAuditedDay(day,audit,rows)});
  }
  return {status:'VERIFIED_READ_ONLY',days:prepared,
    total_rows:prepared.reduce((n,x)=>n+x.manifest.total_rows,0),
    writes:0,krx_calls:0,kis_calls:0,d1_queries:0};
}

async function main(){
  const args=process.argv.slice(2);
  const mode=(args.find(x=>x.startsWith('--mode='))||'--mode=plan').slice(7);
  const out=(args.find(x=>x.startsWith('--out='))||'--out=output/v2_replay').slice(6);
  if(mode==='plan'){
    console.log('BLUE_V2_REPLAY_PLAN',JSON.stringify(await exportV2ReplaySource(null,{mode})));
    return;
  }
  const url=String(process.env.TURSO_DATABASE_URL||''),authToken=String(process.env.TURSO_AUTH_TOKEN||'');
  assert(/^(libsql|https):\/\//.test(url)&&authToken,'V2_REPLAY_MISSING_CONFIG');
  const client=createClient({url,authToken,intMode:'string'});
  try{
    const source=await exportV2ReplaySource(client,{mode});
    for(const item of source.days){
      const path=join(out,item.day,'eod');
      await mkdir(path,{recursive:true});
      await writeFile(join(path,'manifest.json'),JSON.stringify(item.manifest)+'\n');
      await writeFile(join(path,'daily.jsonl'),item.payload);
      console.log('BLUE_V2_REPLAY_EOD_HASH_MATCH',`day=${item.day}`,
        `rows=${item.manifest.total_rows}`,`hash=${item.manifest.data_sha256}`);
    }
    console.log('BLUE_V2_REPLAY_EOD_VERIFIED',`days=${source.days.length}`,
      `rows=${source.total_rows}`,'WRITES=0','KRX_CALLS=0','KIS_CALLS=0');
  }finally{client.close();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(e=>{console.error('BLUE_V2_REPLAY_EOD_FAILED',
    String(e?.message||'').startsWith('V2_REPLAY_')?e.message:'SANITIZED_RUNTIME_FAILURE');
    process.exitCode=1;});
}

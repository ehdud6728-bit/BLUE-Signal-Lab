/**
 * Manually opt-in Turso-only pilot using the very same verified EOD symbol
 * directory artifact that the D1 importer consumes. Never queries D1 or KIS.
 * This is a bounded smoke test, NOT a complete dual-DB mirror.
 */
import {readFile} from 'node:fs/promises';
import {createClient} from '@libsql/client';

const CODE=/^[0-9A-Z]{6}$/;
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const PILOT_SIZE=12;

export function prepareDirectory(audit,directory){
  if(!audit || !directory || !DAY.test(String(audit.asof||'')) ||
     audit.asof!==directory.asof || audit.intraday_verified!==false ||
     !['SAME_DAY_EOD_VERIFIED','HISTORICAL_EOD'].includes(audit.data_phase) ||
     !Number.isInteger(audit.observed_stocks) || audit.observed_stocks<1700 ||
     !Object.values(audit.source_sha256_by_year||{}).some(v=>typeof v==='string' && /^[0-9a-f]{64}$/.test(v)) ||
     !Array.isArray(directory.symbols) || directory.symbols.length<1200 ||
     directory.symbols.length>10000){
    throw Error('UNVERIFIED_EOD_DIRECTORY');
  }
  if(audit.same_day_eod && (
      audit.data_phase!=='SAME_DAY_EOD_VERIFIED' ||
      !String(audit.target_day_source||'').includes('KRX') ||
      !Array.isArray(audit.supplemental_dates) ||
      !audit.supplemental_dates.includes(audit.asof))) {
    throw Error('UNVERIFIED_SAME_DAY_EOD');
  }
  const seen=new Set();
  const symbols=[];
  for(const s of directory.symbols){
    const code=String(s?.code??''),name=String(s?.name??'').trim(),market=String(s?.market??'');
    if(!CODE.test(code) || !name || name.length>100 ||
       !['KOSPI','KOSDAQ'].includes(market) || seen.has(code)) {
      throw Error('INVALID_EOD_SYMBOL_DIRECTORY');
    }
    seen.add(code);
    symbols.push({code,name,market,asof:directory.asof});
  }
  // Validate the ENTIRE source before selecting a tiny deterministic pilot.
  symbols.sort((a,b)=>a.code.localeCompare(b.code));
  return {asof:directory.asof,fullCount:symbols.length,sample:symbols.slice(0,PILOT_SIZE)};
}

export async function runDirectoryPilot({audit,directory,mode='dry_run',env=process.env,
  clientFactory=createClient}={}){
  if(!['dry_run','apply_12'].includes(mode))throw Error('INVALID_PILOT_MODE');
  const prepared=prepareDirectory(audit,directory);
  if(mode==='dry_run')return {status:'DRY_RUN',asof:prepared.asof,
    source_symbols:prepared.fullCount,stored:0};
  const url=String(env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^libsql:\/\//.test(url) && !/^https:\/\//.test(url))throw Error('TURSO_URL_MISSING_OR_INVALID');
  if(!authToken)throw Error('TURSO_TOKEN_MISSING');
  const client=clientFactory({url,authToken});
  try{
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_symbol_directory_v1 (
      code TEXT PRIMARY KEY, name TEXT NOT NULL, market TEXT NOT NULL,
      asof_day TEXT NOT NULL, updated_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await client.execute('CREATE INDEX IF NOT EXISTS idx_blue_symbol_directory_v1_name ON blue_symbol_directory_v1(name)');
    const batch=prepared.sample.map(s=>({sql:`INSERT INTO blue_symbol_directory_v1(code,name,market,asof_day)
      VALUES(?,?,?,?) ON CONFLICT(code) DO UPDATE SET
      name=excluded.name,market=excluded.market,asof_day=excluded.asof_day,
      updated_at_utc=CURRENT_TIMESTAMP
      WHERE excluded.asof_day>=blue_symbol_directory_v1.asof_day`,
      args:[s.code,s.name,s.market,s.asof]}));
    await client.batch(batch,'write');
    // Bounded read-back of the exact inserted keys; no full-table COUNT scan.
    const check=await client.execute({sql:`SELECT code,name,market,asof_day FROM blue_symbol_directory_v1
      WHERE code IN (${prepared.sample.map(()=>'?').join(',')})`,args:prepared.sample.map(s=>s.code)});
    const byCode=new Map(check.rows.map(row=>[String(row.code),row]));
    for(const s of prepared.sample){
      const v=byCode.get(s.code);
      if(!v || String(v.name)!==s.name || String(v.market)!==s.market || String(v.asof_day)!==s.asof){
        throw Error('TURSO_EOD_READBACK_MISMATCH');
      }
    }
    return {status:'OK',asof:prepared.asof,
      source_symbols:prepared.fullCount,stored:prepared.sample.length};
  }finally{client.close();}
}

async function main(){
  const args=process.argv.slice(2);
  const mode=(args.find(a=>a.startsWith('--mode='))||'--mode=dry_run').slice(7);
  const input=(args.find(a=>a.startsWith('--input-dir='))||'--input-dir=output').slice(12);
  const audit=JSON.parse(await readFile(`${input}/AUDIT.json`,'utf8'));
  const directory=JSON.parse(await readFile(`${input}/SYMBOL_DIRECTORY.json`,'utf8'));
  const r=await runDirectoryPilot({audit,directory,mode});
  console.log(`TURSO_EOD_DIRECTORY_${r.status} asof=${r.asof} verified_source_symbols=${r.source_symbols} written=${r.stored}`);
}

if(process.argv[1] && import.meta.url===new URL(`file://${process.argv[1]}`).href){
  main().catch(e=>{
    const safe=['INVALID_PILOT_MODE','UNVERIFIED_EOD_DIRECTORY','UNVERIFIED_SAME_DAY_EOD',
      'INVALID_EOD_SYMBOL_DIRECTORY','TURSO_URL_MISSING_OR_INVALID','TURSO_TOKEN_MISSING',
      'TURSO_EOD_READBACK_MISMATCH'];
    console.error('TURSO_EOD_DIRECTORY_PILOT_FAILED',safe.includes(e?.message)?e.message:'SANITIZED_RUNTIME_FAILURE');
    process.exitCode=1;
  });
}

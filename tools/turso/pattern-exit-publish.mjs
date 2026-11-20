/** Explicit-only, immutable publication of non-advisory Turso exit-study results.
 * The research report is recomputed from audited EOD/signal sources by the
 * workflow; publishing NEVER writes EOD, research signals, D1, or orders.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createClient} from '@libsql/client';

const SHA=/^[a-f0-9]{64}$/;
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const assert=(ok,error)=>{if(!ok)throw Error(error);};
export const hash=(raw)=>createHash('sha256').update(raw).digest('hex');

export function validateExitReport(report){
  assert(report?.schema==='BLUE_TURSO_PATTERN_EXIT_REPORT_V1'&&report.storage==='TURSO'&&
    typeof report.asof_day==='string'&&DAY.test(report.asof_day)&&
    Number.isSafeInteger(report.eod_audited_days)&&report.eod_audited_days>=1&&
    Number.isSafeInteger(report.research_audited_days)&&report.research_audited_days>=0&&
    Number.isSafeInteger(report.signal_stock_days)&&report.signal_stock_days>=0&&
    Array.isArray(report.short_and_long_windows)&&report.short_and_long_windows.length===7&&
    report.short_and_long_windows.map(x=>x.sessions).join(',')==='5,10,20,60,120,250,500'&&
    report.trading_calendar_verified===false&&report.corporate_actions_verified===false&&
    report.market_and_sector_benchmark_verified===false&&
    report.investment_recommendation_enabled===false&&Array.isArray(report.candidate_stocks)&&
    report.candidate_stocks.length===0,'INVALID_EXIT_REPORT_OR_UNVERIFIED_ADVICE');
  return report;
}

export async function publishExitReport({raw,sourceSha,mode='plan',confirm='',
  env=process.env,clientFactory=createClient}={}){
  assert(['plan','publish'].includes(mode),'INVALID_EXIT_PUBLICATION_MODE');
  if(mode==='plan')return {status:'PLAN_ONLY',written:0};
  assert(confirm==='blue-turso-exit-research-only', 'EXIT_REPORT_NOT_CONFIRMED');
  assert(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<1500000&&SHA.test(sourceSha),
    'INVALID_EXIT_PUBLICATION_SOURCE');
  const report=validateExitReport(JSON.parse(raw.toString('utf8')));
  const reportSha=hash(raw);
  const url=String(env.TURSO_DATABASE_URL||'').trim();
  const token=String(env.TURSO_AUTH_TOKEN||'').trim();
  assert(/^(libsql|https):\/\//.test(url)&&token,'EXIT_REPORT_DB_NOT_CONFIGURED');
  const client=clientFactory({url,authToken:token,intMode:'string'});
  try{
    await client.execute(`CREATE TABLE IF NOT EXISTS blue_pattern_exit_reports_v1 (
      asof_day TEXT PRIMARY KEY,report_json TEXT NOT NULL,
      report_sha256 TEXT NOT NULL,source_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const prior=await client.execute({sql:`SELECT report_sha256,source_sha256
      FROM blue_pattern_exit_reports_v1 WHERE asof_day=?`,args:[report.asof_day]});
    assert(prior.rows.length<=1,'EXIT_REPORT_MULTIPLE_AUDITS');
    assert(prior.rows.length===0||prior.rows.every(r=>String(r.report_sha256)===reportSha&&
      String(r.source_sha256)===sourceSha),'EXIT_REPORT_IMMUTABLE_CONFLICT');
    await client.execute({sql:`INSERT INTO blue_pattern_exit_reports_v1
      (asof_day,report_json,report_sha256,source_sha256) VALUES (?,?,?,?)
      ON CONFLICT(asof_day) DO NOTHING`,args:[report.asof_day,raw.toString('utf8'),reportSha,sourceSha]});
    const check=await client.execute({sql:`SELECT report_json,report_sha256,source_sha256
      FROM blue_pattern_exit_reports_v1 WHERE asof_day=?`,args:[report.asof_day]});
    assert(check.rows.length===1&&String(check.rows[0].report_json)===raw.toString('utf8')&&
      String(check.rows[0].report_sha256)===reportSha&&
      String(check.rows[0].source_sha256)===sourceSha,'EXIT_REPORT_READBACK_MISMATCH');
    return {status:'PUBLISHED',asof_day:report.asof_day,written:prior.rows.length?0:1,
      report_sha256:reportSha};
  }finally{client.close();}
}

async function main(){
  const mode=process.env.EXIT_PUBLICATION_MODE||'plan';
  if(mode==='plan'){
    console.log('BLUE_EXIT_REPORT_PUBLICATION',JSON.stringify(await publishExitReport({mode})));
    return;
  }
  const raw=await readFile('output/exit_study/report.json');
  const sourceSha=hash(await readFile('output/exit_study/source.json'));
  const r=await publishExitReport({raw,sourceSha,mode,confirm:process.env.EXIT_CONFIRM||''});
  console.log('BLUE_EXIT_REPORT_PUBLICATION',r.status,r.asof_day,'written='+r.written,
    'report_sha256='+r.report_sha256);
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(()=>{console.error('BLUE_EXIT_REPORT_PUBLICATION_FAILED');process.exitCode=1;});
}

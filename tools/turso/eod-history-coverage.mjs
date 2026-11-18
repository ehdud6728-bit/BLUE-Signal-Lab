/** Read-only coverage audit for verified KRX EOD dates stored in Turso.
 *
 * An unaudited weekday is a *candidate* for investigation, not proof that
 * the exchange was open. Never infer holiday status from a failed provider.
 */

const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const HASH=/^[a-f0-9]{64}$/;
const SOURCE=new Set(['KRX_PYKRX_EXACT_DAY_VERIFIED','KRX_OPENAPI_EXACT_DAY_VERIFIED']);
const DAY_MS=86400000;
const REQUIRED_SESSIONS=225; // 224-session average + previous session for a crossover
const MAX_AUDITS=600;

function parseDay(day){
  if(typeof day!=='string'||!DATE.test(day))throw Error('INVALID_AUDIT_DAY');
  const value=new Date(`${day}T00:00:00Z`);
  if(Number.isNaN(value.valueOf())||value.toISOString().slice(0,10)!==day)
    throw Error('INVALID_AUDIT_DAY');
  return value;
}

function isWeekday(date){return date.getUTCDay()!==0&&date.getUTCDay()!==6;}
function dayString(date){return date.toISOString().slice(0,10);}
function precedingWeekday(day){
  const date=new Date(parseDay(day).getTime()-DAY_MS);
  while(!isWeekday(date))date.setTime(date.getTime()-DAY_MS);
  return dayString(date);
}
function minusCalendarDays(day,n){return dayString(new Date(parseDay(day).getTime()-n*DAY_MS));}

export function summarizeEodHistory(rows,latestBodyCount,{asofKst,requiredSessions=REQUIRED_SESSIONS}={}){
  if(!Array.isArray(rows)||rows.length===0||rows.length>MAX_AUDITS)
    throw Error('NO_VERIFIED_EOD_HISTORY');
  if(!Number.isInteger(requiredSessions)||requiredSessions<225||requiredSessions>500)
    throw Error('INVALID_HISTORY_TARGET');
  const seen=new Set();
  let last='9999-12-31';
  const audited=[];
  for(const row of rows){
    const day=String(row.trade_day);
    const parsed=parseDay(day);
    const count=Number(row.row_count);
    if(!isWeekday(parsed)||day>=last||seen.has(day)||
      !Number.isSafeInteger(count)||count<1700||count>10000||
      !SOURCE.has(String(row.source))||!HASH.test(String(row.day_sha256)))
      throw Error('INVALID_EOD_AUDIT');
    audited.push({day,rows:count});
    seen.add(day);
    last=day;
  }
  if(!Number.isSafeInteger(latestBodyCount)||latestBodyCount!==audited[0].rows)
    throw Error('LATEST_EOD_ROW_COUNT_MISMATCH');
  const newest=audited[0].day,oldest=audited.at(-1).day;
  const first=parseDay(oldest),end=parseDay(newest);
  const candidates=[];
  for(let t=first.getTime();t<=end.getTime();t+=DAY_MS){
    const day=dayString(new Date(t));
    if(isWeekday(new Date(t))&&!seen.has(day))candidates.push(day);
  }
  // The source is a checked/limited audit list, not a trading calendar.
  // Never silently label these candidate weekdays as missing candles.
  const historicalTargetMet=audited.length>=requiredSessions;
  const nextEnd=precedingWeekday(oldest);
  const nextStart=minusCalendarDays(nextEnd,9);
  return {
    storage:'TURSO',type:'VERIFIED_EOD_HISTORY_COVERAGE',
    asof_kst:asofKst||null,latest_day:newest,oldest_day:oldest,
    audited_days:audited.length,audit_query_limit:MAX_AUDITS,
    required_sessions:requiredSessions,additional_sessions_needed:Math.max(0,requiredSessions-audited.length),
    history_count_sufficient:historicalTargetMet,
    // A sufficient day count alone does not prove full individual-symbol continuity.
    indicator_ready:false,
    latest_day_rows:latestBodyCount,
    unverified_weekday_candidate_count:candidates.length,
    unverified_weekday_candidates:candidates.slice(0,30),
    unverified_weekday_list_truncated:candidates.length>30,
    next_backfill_window_candidate:historicalTargetMet?null:{start_day:nextStart,end_day:nextEnd},
    notes:[
      'Weekday candidates can be exchange holidays; independently verify before importing.',
      'The 225-session target is a minimum for 224-day MA crossovers, not proof of uninterrupted history.',
      'Per-symbol history, corporate actions and signal calculations remain unverified.',
    ],
  };
}

export async function inspectEodHistory(client,asofKst){
  const audits=await client.execute(`SELECT trade_day,row_count,source,day_sha256
    FROM blue_eod_ingest_audit_v1 ORDER BY trade_day DESC LIMIT ${MAX_AUDITS}`);
  if(!audits.rows.length)throw Error('NO_VERIFIED_EOD_HISTORY');
  // One bounded day-count check. Do not scan or GROUP BY the full daily price history.
  const latest=String(audits.rows[0].trade_day);
  const stored=await client.execute({sql:`SELECT COUNT(*) AS n FROM blue_eod_daily_v1
    WHERE trade_day=?`,args:[latest]});
  return summarizeEodHistory(audits.rows,Number(stored.rows[0]?.n),{asofKst});
}

async function main(){
  const url=String(process.env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(process.env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(libsql|https):\/\//.test(url)||!authToken)throw Error('TURSO_CONFIG_MISSING');
  const asofKst=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10);
  const {createClient}=await import('@libsql/client');
  const client=createClient({url,authToken,intMode:'string'});
  try{
    const report=await inspectEodHistory(client,asofKst);
    console.log(`BLUE_TURSO_EOD_HISTORY_OK latest=${report.latest_day} oldest=${report.oldest_day}`+
      ` audited_days=${report.audited_days} required_sessions=${report.required_sessions}`+
      ` additional_sessions_needed=${report.additional_sessions_needed}`+
      ` unverified_weekday_candidates=${report.unverified_weekday_candidate_count}`);
    console.log(`BLUE_TURSO_EOD_HISTORY_REPORT ${JSON.stringify(report)}`);
    if(process.env.GITHUB_STEP_SUMMARY){
      const {appendFile}=await import('node:fs/promises');
      await appendFile(process.env.GITHUB_STEP_SUMMARY,
        `## Turso 검증 일봉 이력 현황 (읽기 전용)\n\n`+
        `- 최신 감사일: ${report.latest_day} (${report.latest_day_rows.toLocaleString('en-US')}종목)\n`+
        `- 가장 오래된 감사일: ${report.oldest_day}\n`+
        `- 검증된 날짜: ${report.audited_days}거래일 / 목표 최소 ${report.required_sessions}거래일\n`+
        `- 추가 확보 필요: 최소 ${report.additional_sessions_needed}거래일\n`+
        `- 내부 구간에서 미검증 평일 후보: ${report.unverified_weekday_candidate_count}일 (휴장일 포함 가능)\n`+
        `- 다음 과거 수집 검토 구간: ${report.next_backfill_window_candidate?
          `${report.next_backfill_window_candidate.start_day} ~ ${report.next_backfill_window_candidate.end_day}`:'기초 일수 충족'}\n\n`+
        `> 평일 후보는 실제 누락 확정이 아니며, 225일 확보만으로 기술 신호가 검증되는 것은 아닙니다.\n`);
    }
  }finally{client.close();}
}

if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href){
  main().catch(error=>{
    const safe=new Set(['TURSO_CONFIG_MISSING','NO_VERIFIED_EOD_HISTORY','INVALID_AUDIT_DAY',
      'INVALID_EOD_AUDIT','INVALID_HISTORY_TARGET','LATEST_EOD_ROW_COUNT_MISMATCH']);
    console.error('BLUE_TURSO_EOD_HISTORY_FAILED',safe.has(error?.message)?error.message:'SANITIZED_RUNTIME_FAILURE');
    process.exitCode=1;
  });
}

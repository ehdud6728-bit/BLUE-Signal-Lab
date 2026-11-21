/**
 * Stock-Hunter R16: fixed 30 ticker, read-only KIS daily-history export.
 * Research only. No token issuance, orders, Turso/D1 writes, or live updates.
 * Uses BLUE's pre-existing encrypted cached token through its R9 bridge.
 */
import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const CODES = Object.freeze([
  '093320','016385','332290','125210','062970','068760',
  '250000','004380','042370','015710','057540','377480',
  '054050','131090','012610','044450','100120','002450',
  '066790','177830','039240','353200','226320','129260',
  '053350','127120','001720','052020','072870','065500',
]);
export const START = '20200101';
export const END = '20251231';
export const ENDPOINT = '/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const ORIGIN = 'https://openapi.koreainvestment.com:9443';
const MAX_PAGES_PER_TICKER = 22;
const MAX_RESPONSE_BYTES = 2_000_000;
const MIN_HISTORY_BARS = 280;
const CSV_FIELDS = ['date','code','open','high','low','close','volume','amount'];
const sha = input => createHash('sha256').update(input).digest('hex');
const sleep = ms => new Promise(done => setTimeout(done, ms));

export class HistoryFailure extends Error {
  constructor(code) {super(code); this.name = 'HistoryFailure'; this.code = code;}
}

function validCompactDate(value) {
  if (typeof value !== 'string' || !/^20\d{6}$/.test(value)) return false;
  const iso = `${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === iso;
}

function dayBefore(date) {
  if (!validCompactDate(date)) throw new HistoryFailure('KIS_DATE_INVALID');
  const iso = `${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}`;
  return new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0,10).replaceAll('-','');
}

export function parsePage(body, code, requestedEnd) {
  if (body?.msg_cd === 'EGW00201') throw new HistoryFailure('KIS_RATE_LIMIT_STOP_ALL');
  if (String(body?.rt_cd) !== '0' || !Array.isArray(body?.output2)) {
    throw new HistoryFailure('KIS_PROVIDER_REJECTED');
  }
  const bars = body.output2;
  if (bars.length > 100) throw new HistoryFailure('KIS_OVER_100_ROWS');
  const parsed = [];
  let previous = null;
  for (const item of bars) {
    if (!item || typeof item !== 'object') throw new HistoryFailure('KIS_BAR_INVALID');
    const day = String(item.stck_bsop_date ?? '');
    if (!validCompactDate(day) || day < START || day > requestedEnd ||
        previous !== null && day >= previous) {
      throw new HistoryFailure('KIS_BAR_DATE_OR_ORDER_INVALID');
    }
    previous = day;
    const mapped = {date:`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}`,code};
    const fields = {open:'stck_oprc',high:'stck_hgpr',low:'stck_lwpr',
      close:'stck_clpr',volume:'acml_vol',amount:'acml_tr_pbmn'};
    for (const [name,key] of Object.entries(fields)) {
      const v = String(item[key] ?? '');
      if (!/^\d+$/.test(v) || !Number.isSafeInteger(Number(v))) {
        throw new HistoryFailure('KIS_BAR_FIELD_INVALID');
      }
      mapped[name] = Number(v);
    }
    if (['open','high','low','close'].some(name => mapped[name] <= 0) ||
        mapped.high < Math.max(mapped.open,mapped.close,mapped.low) ||
        mapped.low > Math.min(mapped.open,mapped.close,mapped.high)) {
      throw new HistoryFailure('KIS_BAR_OHLC_INVALID');
    }
    parsed.push(mapped);
  }
  return parsed;
}

export function pageUrl(code, end) {
  if (!CODES.includes(code) || !validCompactDate(end) || end < START || end > END) {
    throw new HistoryFailure('KIS_REQUEST_OUT_OF_FROZEN_SCOPE');
  }
  const query = new URLSearchParams({
    FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code,
    FID_INPUT_DATE_1:START,FID_INPUT_DATE_2:end,
    FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'1',
  });
  return `${ORIGIN}${ENDPOINT}?${query}`;
}

export async function requestPage(code, end, key, secret, token, {fetchFn=fetch}={}) {
  let response, bytes, body;
  try {
    response = await fetchFn(pageUrl(code,end), {
      method:'GET',
      headers:{authorization:`Bearer ${token}`,appkey:key,appsecret:secret,
        tr_id:'FHKST03010100',custtype:'P',accept:'application/json'},
      signal:AbortSignal.timeout(25_000),
    });
    if (response.status === 429) throw new HistoryFailure('KIS_RATE_LIMIT_STOP_ALL');
    if (response.status === 401 || response.status === 403) {
      throw new HistoryFailure('KIS_PERMISSION_DENIED_STOP_ALL');
    }
    if (!response.ok) throw new HistoryFailure('KIS_HTTP_UNAVAILABLE');
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_RESPONSE_BYTES) throw new HistoryFailure('KIS_RESPONSE_OVERSIZE');
    body = JSON.parse(bytes.toString('utf8'));
  } catch (err) {
    if (err instanceof HistoryFailure) throw err;
    throw new HistoryFailure('KIS_NETWORK_OR_JSON_UNAVAILABLE');
  }
  return {bars:parsePage(body,code,end),responseSha256:sha(bytes)};
}

export async function collectTicker(code, credentials, {getPage=requestPage,pause=sleep}={}) {
  if (!CODES.includes(code)) throw new HistoryFailure('UNSELECTED_TICKER');
  let end = END;
  const pages = [], rows = [], seen = new Set();
  let paginationComplete = false;
  for (let page=1; page<=MAX_PAGES_PER_TICKER; page++) {
    if (page !== 1) await pause(1750);
    const result = await getPage(code,end,credentials.key,credentials.secret,credentials.token);
    const bars = result.bars;
    if (!Array.isArray(bars) || bars.length > 100 ||
        !/^[a-f0-9]{64}$/.test(result.responseSha256 ?? '')) {
      throw new HistoryFailure('KIS_PAGE_EVIDENCE_INVALID');
    }
    pages.push({request_end:end,returned_rows:bars.length,response_sha256:result.responseSha256});
    for (const bar of bars) {
      const stamp = bar.date.replaceAll('-','');
      if (bar.code !== code || !validCompactDate(stamp) || stamp < START || stamp > end ||
          seen.has(stamp)) throw new HistoryFailure('KIS_PAGINATION_IDENTITY_INVALID');
      seen.add(stamp);
      rows.push(bar);
    }
    if (!bars.length || bars.length < 100) {paginationComplete = true; break;}
    const oldest = bars.at(-1).date.replaceAll('-','');
    if (oldest === START) {paginationComplete = true; break;}
    end = dayBefore(oldest);
    if (end < START) {paginationComplete = true; break;}
  }
  if (!paginationComplete) throw new HistoryFailure('KIS_MAX_PAGE_LIMIT_REACHED');
  rows.sort((a,b)=>a.date.localeCompare(b.date));
  let extremeGap = false;
  for (let i=1; i<rows.length; i++) {
    if (Math.abs(rows[i].open / rows[i-1].close - 1) > .35) extremeGap=true;
  }
  return {rows,pages,extremeGap,
    coverage:{first_date:rows[0]?.date??null,last_date:rows.at(-1)?.date??null,
      bars:rows.length,meets_r16_280_bar_minimum:rows.length>=MIN_HISTORY_BARS,
      extreme_unadjusted_gap_over_35pct:extremeGap,
      r16_structural_precheck_pass:rows.length>=MIN_HISTORY_BARS&&!extremeGap,
      first_requested_date_proven:false},
  };
}

// Runtime-only dynamic import avoids any DB driver load in offline tests/dry_run.
async function existingBlueToken(env) {
  const {obtainExistingToken} = await import('./stockhunter-r9-kis-bridge.mjs');
  return obtainExistingToken(env);
}

function csvBytes(rows) {
  return Buffer.from(`${CSV_FIELDS.join(',')}\n${rows.map(row=>CSV_FIELDS.map(field=>row[field]).join(',')).join('\n')}\n`,'utf8');
}

export async function executeExport(outDir, env=process.env, {
  mode='dry_run',tokenReader=existingBlueToken,getPage=requestPage,pause=sleep,
  now=new Date(),codes=CODES,
}={}) {
  const summary={revision:'BLUE_STOCKHUNTER_R16_KIS_DAILY_RESEARCH_ONLY',
    status:'UNSTARTED',mode,selected_codes:[...CODES],start:START,end:END,
    endpoint:ENDPOINT,adjustment:'FID_ORG_ADJ_PRC=1_UNADJUSTED',
    tokenP_calls:0,turso_reads_max:1,turso_writes:0,d1_reads:0,d1_writes:0,
    orders_placed:0,live_changed:false,full_r116_replay_done:false,
    provider_point_in_time_adjustment_certified:false,
    independent_corporate_action_validation:false,
    source_repo:'ehdud6728-bit/BLUE-Signal-Lab',
    source_commit:/^[0-9a-f]{40}$/.test(env.GITHUB_SHA??'')?env.GITHUB_SHA:null,
    source_run_id:/^\d+$/.test(env.GITHUB_RUN_ID??'')?env.GITHUB_RUN_ID:null,
  };
  await mkdir(outDir,{recursive:true});
  try {
    if (mode==='dry_run') {summary.status='DRY_RUN_NO_REMOTE_REQUESTS';return summary;}
    if (mode!=='capture' || codes.length!==CODES.length ||
        codes.some((code,i)=>code!==CODES[i])) throw new HistoryFailure('UNAPPROVED_SCOPE');
    const key=env.KIS_APP_KEY?.trim(),secret=env.KIS_APP_SECRET?.trim();
    if (!key||!secret||!env.TURSO_DATABASE_URL||!env.TURSO_AUTH_TOKEN) {
      throw new HistoryFailure('EXISTING_BLUE_SECRETS_MISSING');
    }
    const token = await tokenReader(env,{now});
    if (typeof token!=='string'||!token) throw new HistoryFailure('EXISTING_BLUE_TOKEN_INVALID');
    const all=[],audit=[];
    for (const [i,code] of codes.entries()) {
      if (i>0) await pause(1750);
      try {
        const collected = await collectTicker(code,{key,secret,token},{getPage,pause});
        all.push(...collected.rows);
        audit.push({code,status:collected.coverage.r16_structural_precheck_pass?'SOURCE_PRECHECK_PASS':'SOURCE_REVIEW_REQUIRED',
          ...collected.coverage,pages:collected.pages});
        console.log(`BLUE_R16_KIS_COLLECTED ticker=${i+1}/30 bars=${collected.rows.length} status=${audit.at(-1).status}`);
      } catch (err) {
        const codeReason=err instanceof HistoryFailure?err.code:'UNEXPECTED_SOURCE_ERROR';
        if (codeReason==='KIS_RATE_LIMIT_STOP_ALL' ||
            codeReason==='KIS_PERMISSION_DENIED_STOP_ALL') throw err;
        audit.push({code,status:'SOURCE_UNAVAILABLE',reason:codeReason,bars:0,pages:[]});
        console.log(`BLUE_R16_KIS_COLLECTED ticker=${i+1}/30 status=SOURCE_UNAVAILABLE reason=${codeReason}`);
      }
    }
    all.sort((a,b)=>a.code.localeCompare(b.code)||a.date.localeCompare(b.date));
    const payload=csvBytes(all);
    const good=audit.filter(x=>x.status==='SOURCE_PRECHECK_PASS');
    const result={...summary,status:good.length>=10?'CAPTURE_COMPLETE_REPLAY_NOT_DONE':'INSUFFICIENT_R16_COVERAGE',
      completed_at_utc:now.toISOString(),row_count:all.length,selected_count:codes.length,
      structurally_valid_ticker_count:good.length,structurally_valid_codes:good.map(x=>x.code),
      archive_sha256:sha(payload),archive_filename:'R16_KIS_UNADJUSTED_30.csv',
      audit,automatic_research_promotion:false,full_market_random_oos:false};
    await writeFile(resolve(outDir,result.archive_filename),payload);
    await writeFile(resolve(outDir,'R16_KIS_SOURCE_MANIFEST.json'),`${JSON.stringify(result,null,2)}\n`);
    Object.assign(summary,result);
    return summary;
  } catch (err) {
    summary.status='SOURCE_UNAVAILABLE_FAIL_CLOSED';
    summary.error_code=err instanceof HistoryFailure?err.code:'UNEXPECTED_SOURCE_ERROR';
    return summary;
  } finally {
    await writeFile(resolve(outDir,'R16_KIS_RUN_SUMMARY.json'),`${JSON.stringify(summary,null,2)}\n`);
  }
}

async function main() {
  const mode=process.argv[2]??'dry_run';
  const outDir=process.argv[3]??'output/stockhunter_r16_kis_history';
  const result=await executeExport(outDir,process.env,{mode});
  console.log(`BLUE_R16_KIS_STATUS=${result.status}`);
  if (result.error_code) console.log(`BLUE_R16_KIS_ERROR=${result.error_code}`);
  if (!['DRY_RUN_NO_REMOTE_REQUESTS','CAPTURE_COMPLETE_REPLAY_NOT_DONE'].includes(result.status)) {
    process.exitCode=2;
  }
}

if (process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}

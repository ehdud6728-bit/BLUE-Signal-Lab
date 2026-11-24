/**
 * R31: frozen 30 disjoint from R19-26 and R28-30 tickers, 2025 warmup => unseen 2026 period.
 * SOURCE CAPTURE ONLY. No strategy evaluation, label, rank or order.
 * Uses existing encrypted cached KIS token; no token issuance or DB write.
 * Captured prices are unadjusted and not independent PIT certified.
 */
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const CODES=Object.freeze([
  '036570','035250','090430','051900','010950','018260',
  '034730','259960','003670','058470','000810','071050',
  '016360','008770','004170','097950','047050','030200',
  '267250','010140','042660','329180','034220','011070',
  '032640','069960','028050','000720','006360','035760',
]);
export const FORBIDDEN_R19_CODES=Object.freeze([
  '093320','332290','125210','062970','068760','250000',
  '004380','042370','015710','057540','377480','054050',
  '012610','044450','100120','002450','177830','039240',
  '353200','226320','129260','053350','127120','001720',
  '052020','072870',
]);
export const FORBIDDEN_R28_CODES=Object.freeze([
  '005930','000660','035420','035720','051910','028260',
  '005380','000270','012330','105560','055550','086790',
  '003550','015760','034020','009150','006800','010130',
  '017670','033780','000100','078930','096770','032830',
  '047810','207940','066570','003490','011200','086280',
]);
export const START='20250102';
export const END='20261120';
export const EVAL_START='20260102';
export const FROZEN_PRIOR_SHA='e5edabf1b111d424a0afa8503111d7dd4d6e4827036aa7eea512ef067d122dbc';
export const R28_PREVIOUS_CSV_SHA256='2d7e5d414f01e497ac68e191537a468ff82a59dd25a65fa724f1e92dc5e8779b';
const ENDPOINT='/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice';
const ORIGIN='https://openapi.koreainvestment.com:9443';
const FIELDS=['date','code','open','high','low','close','volume','amount'];
const PAGE_MAX=8;
const MIN_BARS=350;
const MIN_VALID_CODES=20;
const PAUSE_MS=1750;
const MAX_RESPONSE_BYTES=2_000_000;
const hash=b=>createHash('sha256').update(b).digest('hex');
const sleep=ms=>new Promise(done=>setTimeout(done,ms));

export class CaptureError extends Error {
  constructor(code){super(code);this.code=code;this.name='CaptureError';}
}
const validDate=value=>{
  if(typeof value!=='string'||!/^20\d{6}$/.test(value))return false;
  const iso=value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8);
  const n=new Date(iso+'T00:00:00Z');
  return !Number.isNaN(n.getTime())&&n.toISOString().slice(0,10)===iso;
};
const prevDate=value=>{
  if(!validDate(value))throw new CaptureError('INVALID_PAGINATION_DATE');
  return new Date(Date.parse(value.slice(0,4)+'-'+value.slice(4,6)+'-'+value.slice(6,8)+'T00:00:00Z')-86400000)
    .toISOString().slice(0,10).replaceAll('-','');
};

export function frozenCodePreflight(codes=CODES){
  if(codes.length!==30||new Set(codes).size!==30
     ||codes.some((v,i)=>v!==CODES[i])||new Set(FORBIDDEN_R19_CODES).size!==26
     ||CODES.some(v=>FORBIDDEN_R19_CODES.includes(v)) ||
     new Set(FORBIDDEN_R28_CODES).size!==30 ||
     CODES.some(v=>FORBIDDEN_R28_CODES.includes(v))) {
    throw new CaptureError('R31_FIXED30_DISJOINT_R19_AND_R28_COHORT_CHANGED');
  }
  return {new_tickers:30,overlap_with_R19_26:0,overlap_with_R28_30:0,
          intended_holdout_2026_start:EVAL_START,prior_2021_25_SHA256:FROZEN_PRIOR_SHA,
          prior_R28_source_sha256:R28_PREVIOUS_CSV_SHA256};
}

export function urlFor(code,end){
  frozenCodePreflight();
  if(!CODES.includes(code)||!validDate(end)||end<START||end>END)
    throw new CaptureError('R31_UNAPPROVED_PRICE_REQUEST');
  const q=new URLSearchParams({
    FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code,
    FID_INPUT_DATE_1:START,FID_INPUT_DATE_2:end,
    FID_PERIOD_DIV_CODE:'D',FID_ORG_ADJ_PRC:'1'
  });
  return ORIGIN+ENDPOINT+'?'+q;
}

export function parsePage(body,code,end){
  if(body?.msg_cd==='EGW00201')
    throw new CaptureError('KIS_RATE_LIMIT_STOP_ALL');
  if(String(body?.rt_cd)!=='0'||!Array.isArray(body?.output2))
    throw new CaptureError('KIS_HISTORY_PROVIDER_ERROR');
  if(body.output2.length>100)throw new CaptureError('KIS_TOO_MANY_ROWS');
  const rows=[];let last=null;
  for(const raw of body.output2){
    const day=String(raw?.stck_bsop_date??'');
    if(!validDate(day)||day<START||day>end||last!==null&&day>=last)
      throw new CaptureError('KIS_DATE_ORDER_OR_RANGE_INVALID');
    last=day;
    const mapped={date:day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8),code};
    for(const [to,from] of Object.entries({
        open:'stck_oprc',high:'stck_hgpr',low:'stck_lwpr',
        close:'stck_clpr',volume:'acml_vol',amount:'acml_tr_pbmn'})){
      const rawValue=String(raw?.[from]??'');
      if(!/^\d+$/.test(rawValue)||!Number.isSafeInteger(Number(rawValue)))
        throw new CaptureError('KIS_INVALID_DAILY_BAR');
      mapped[to]=Number(rawValue);
    }
    if(['open','high','low','close'].some(k=>mapped[k]<=0)
       ||mapped.high<Math.max(mapped.open,mapped.close,mapped.low)
       ||mapped.low>Math.min(mapped.open,mapped.close,mapped.high))
      throw new CaptureError('KIS_BAD_OHLC');
    rows.push(mapped);
  }
  return rows;
}

export async function fetchPage(code,end,key,secret,token,{fetchFn=fetch}={}){
  try{
    const response=await fetchFn(urlFor(code,end),{
      method:'GET',headers:{
        authorization:'Bearer '+token,appkey:key,appsecret:secret,
        tr_id:'FHKST03010100',custtype:'P',accept:'application/json'
      },signal:AbortSignal.timeout(25000)
    });
    if(response.status===429)throw new CaptureError('KIS_RATE_LIMIT_STOP_ALL');
    if(response.status===401||response.status===403)
      throw new CaptureError('KIS_PERMISSION_DENIED_STOP_ALL');
    if(!response.ok)throw new CaptureError('KIS_HTTP_NOT_OK');
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>MAX_RESPONSE_BYTES)throw new CaptureError('KIS_RESPONSE_TOO_LARGE');
    const body=JSON.parse(bytes.toString('utf8'));
    return {bars:parsePage(body,code,end),response_sha256:hash(bytes)};
  }catch(e){
    if(e instanceof CaptureError)throw e;
    throw new CaptureError('KIS_NETWORK_OR_BAD_JSON');
  }
}

export async function fetchTicker(code,{key,secret,token},{pageFn=fetchPage,pause=sleep}={}){
  if(!CODES.includes(code))throw new CaptureError('UNKNOWN_TICKER');
  let end=END,complete=false;const rows=[],pages=[],seen=new Set();
  for(let page=0;page<PAGE_MAX;page++){
    if(page>0)await pause(PAUSE_MS);
    const got=await pageFn(code,end,key,secret,token);
    if(!Array.isArray(got.bars)||got.bars.length>100||! /^[a-f0-9]{64}$/.test(got.response_sha256??''))
      throw new CaptureError('UNVERIFIABLE_KIS_PAGE');
    pages.push({requested_end:end,returned_rows:got.bars.length,response_sha256:got.response_sha256});
    for(const row of got.bars){
      const dt=String(row.date).replaceAll('-','');
      if(row.code!==code||!validDate(dt)||dt<START||dt>end||seen.has(dt))
        throw new CaptureError('INCONSISTENT_PAGINATED_KIS_BAR');
      seen.add(dt);rows.push(row);
    }
    if(got.bars.length<100){complete=true;break;}
    const oldest=got.bars.at(-1).date.replaceAll('-','');
    end=prevDate(oldest);
    if(end<START){complete=true;break;}
  }
  if(!complete)throw new CaptureError('INCOMPLETE_KIS_PAGINATION');
  rows.sort((a,b)=>a.date.localeCompare(b.date));
  const first=rows.at(0)?.date??null,last=rows.at(-1)?.date??null;
  const giantGaps=rows.slice(1).filter((r,i)=>Math.abs(r.open/rows[i].close-1)>.35).length;
  const completeScope=rows.length>=MIN_BARS&&first<='2025-02-01'&&last>='2026-11-02';
  return {rows,pages,valid:completeScope&&giantGaps===0,
          coverage:{first_date:first,last_date:last,bars:rows.length,
            extreme_unadjusted_gaps_gt35pct:giantGaps,required_2026_sessions_present:completeScope,
            corporate_actions_independently_audited:false}};
}

async function existingToken(env){
  try{
    const {obtainExistingToken}=await import('./stockhunter-r9-kis-bridge.mjs');
    return await obtainExistingToken(env);
  }catch(e){
    const known=new Set(['EXISTING_TURSO_TOKEN_MISSING',
      'EXISTING_TOKEN_METADATA_INVALID','EXISTING_TURSO_TOKEN_EXPIRED',
      'EXISTING_TOKEN_DECRYPT_UNAVAILABLE','EXISTING_BLUE_SECRETS_MISSING',
      'EXISTING_TURSO_TOKEN_READ_UNAVAILABLE']);
    throw new CaptureError(known.has(e?.code)?e.code:'EXISTING_CACHED_TOKEN_UNAVAILABLE');
  }
}

const csvBytes=rows=>Buffer.from(
  FIELDS.join(',')+'\n'+rows.map(r=>FIELDS.map(f=>r[f]).join(',')).join('\n')+'\n','utf8');

export async function capture(outDir,env=process.env,{
  mode='dry_run',tokenReader=existingToken,pageFn=fetchPage,
  pause=sleep,codes=CODES,now=new Date()
}={}){
  const safety=frozenCodePreflight(codes);
  await mkdir(outDir,{recursive:true});
  const summary={
    revision:'BLUE_STOCKHUNTER_R31_UNSEEN30_2026_KIS_SOURCE_RESEARCH_ONLY',
    status:'NOT_CAPTURED',mode,
    codes:[...CODES],warmup_start:START,analysis_start:EVAL_START,
    fixed_end:END,prior_archive_sha256:FROZEN_PRIOR_SHA,prior_r28_sha256:R28_PREVIOUS_CSV_SHA256,
    ...safety,GET_only:true,KIS_token_issuance:0,
    token_reader_select_max:1,KIS_quotes_max:30*PAGE_MAX,
    turso_writes:0,D1_reads:0,D1_writes:0,orders_placed:0,live_changed:false,
    source_repo:'ehdud6728-bit/BLUE-Signal-Lab',
    source_commit:/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')?env.GITHUB_SHA:null,
    capture_run_id:/^\d+$/.test(env.GITHUB_RUN_ID??'')?env.GITHUB_RUN_ID:null,
    current_2026_returns_inspected_for_selection:false,
    selected_codes_prior_to_2026_price_collection:true,
    same_2026_market_window_as_prior_R28:true,
    not_fully_time_disjoint_from_R28:true,
    thirty_codes_not_random_full_market_sample:true,
    adjusted_prices:false,PIT_corporate_action_certified:false,
    historic_prelisted_delisted_included:false,
    eligible_for_live_trading:false,
  };
  try{
    if(mode==='dry_run'){
      summary.status='DRY_RUN_NO_NETWORK_OR_TOKEN_READ';return summary;
    }
    if(!['token_check','capture'].includes(mode))
      throw new CaptureError('UNSUPPORTED_MODE');
    const key=env.KIS_APP_KEY?.trim(),secret=env.KIS_APP_SECRET?.trim();
    if(!key||!secret||!env.TURSO_DATABASE_URL||!env.TURSO_AUTH_TOKEN)
      throw new CaptureError('EXISTING_BLUE_SECRETS_MISSING');
    const token=await tokenReader(env);
    if(typeof token!=='string'||!token)
      throw new CaptureError('EXISTING_TOKEN_EMPTY');
    if(mode==='token_check'){
      summary.status='TOKEN_VALID_NO_KIS_PRICE_REQUESTS';return summary;
    }
    const archiveRows=[],audits=[];
    for(const [i,code] of CODES.entries()){
      if(i>0)await pause(PAUSE_MS);
      try{
        const result=await fetchTicker(code,{key,secret,token},{pageFn,pause});
        if(result.valid)archiveRows.push(...result.rows);
        audits.push({code,status:result.valid?'VALID':'QUARANTINE_UNVERIFIED_SOURCE',
                     ...result.coverage,pages:result.pages});
        console.log('R31_KIS_CODE',i+1,'of',CODES.length,
                    'bars',result.rows.length,'status',audits.at(-1).status);
      }catch(e){
        const reason=e instanceof CaptureError?e.code:'UNEXPECTED_KIS_SOURCE_FAILURE';
        if(['KIS_RATE_LIMIT_STOP_ALL','KIS_PERMISSION_DENIED_STOP_ALL'].includes(reason))
          throw e;
        audits.push({code,status:'SOURCE_UNAVAILABLE',reason,bars:0,pages:[]});
        console.log('R31_KIS_CODE',i+1,'of',CODES.length,'status=SOURCE_UNAVAILABLE',reason);
      }
    }
    const valid=audits.filter(a=>a.status==='VALID').map(a=>a.code);
    if(valid.length<MIN_VALID_CODES)
      throw new CaptureError('R31_LESS_THAN_20_VALID_UNSEEN_2026_CODES');
    archiveRows.sort((a,b)=>a.code.localeCompare(b.code)||a.date.localeCompare(b.date));
    const bytes=csvBytes(archiveRows);
    const manifest={
      ...summary,status:'SOURCE_CAPTURE_COMPLETE_NOT_EVALUATED',
      completed_utc:now.toISOString(),
      source_provider:'KIS_fhkst03010100_unadjusted_original_daily',
      valid_codes:valid,valid_tickers:valid.length,
      unavailable_or_quarantined:CODES.filter(code=>!valid.includes(code)),
      daily_rows:archiveRows.length,filename:'R31_DISJOINT30_2025_2026_UNADJUSTED.csv',
      raw_csv_sha256:hash(bytes),audits,
      first_price_date:archiveRows.map(r=>r.date).sort()[0],
      latest_price_date:archiveRows.map(r=>r.date).sort().at(-1),
      prospective_oos_claim:false,new_ticker_disjoint_same_2026_time_retrospective_holdout:true
    };
    await writeFile(resolve(outDir,manifest.filename),bytes);
    await writeFile(resolve(outDir,'R31_SOURCE_MANIFEST.json'),
                    JSON.stringify(manifest,null,2)+'\n');
    Object.assign(summary,manifest);
    return summary;
  }catch(e){
    summary.status='SOURCE_UNAVAILABLE_FAIL_CLOSED';
    summary.failure_code=e instanceof CaptureError?e.code:'UNEXPECTED_CAPTURE_ERROR';
    return summary;
  }finally{
    await writeFile(resolve(outDir,'R31_CAPTURE_STATUS.json'),
                    JSON.stringify(summary,null,2)+'\n');
  }
}

async function main(){
  const mode=process.argv[2]??'dry_run';
  const path=process.argv[3]??'output/stockhunter_r31_new_tickers_2026';
  const status=await capture(path,process.env,{mode});
  console.log('R31_STATUS='+status.status);
  if(status.failure_code)console.log('R31_ERROR='+status.failure_code);
  if(!['DRY_RUN_NO_NETWORK_OR_TOKEN_READ','TOKEN_VALID_NO_KIS_PRICE_REQUESTS',
        'SOURCE_CAPTURE_COMPLETE_NOT_EVALUATED'].includes(status.status))
    process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  await main();

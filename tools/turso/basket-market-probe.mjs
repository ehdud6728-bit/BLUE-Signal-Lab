/** Bounded manual read-only KIS endpoint probe. Not a collector or permission
 * to raise existing rate limits. Never store/print raw quote rows or tokens. */
import {createClient} from '@libsql/client';
import {tursoDirectCachedToken} from '../../collector/src/turso-direct.mjs';
import {pathToFileURL} from 'node:url';
import {repeatedMinutes,aggregateWindow,candle} from './minute-candle-engine.mjs';
const BASE='https://openapi.koreainvestment.com:9443';
const need=(ok,code)=>{if(!ok)throw Error(code)};
const CODE=/^[0-9A-Z]{6}$/;
const number=(v)=>{need((typeof v==='string'&&/^\d+$/.test(v)||typeof v==='number')&&Number.isSafeInteger(Number(v))&&Number(v)>=0,'INVALID_NUMERIC');return Number(v)};
const fields=['price','open','high','low','volume','amount'];
function values(row,keys){
 const out=Object.fromEntries(fields.map((k,i)=>[k,number(row[keys[i]])]));
 need(out.low>0&&out.open>=out.low&&out.open<=out.high&&out.price>=out.low&&out.price<=out.high,'INVALID_OHLC');
 return out;
}
export function multiParams(codes){
 need(codes.length>=1&&codes.length<=30&&new Set(codes).size===codes.length&&codes.every(c=>CODE.test(c)),'INVALID_CODES');
 return Object.fromEntries(codes.flatMap((c,i)=>[['FID_COND_MRKT_DIV_CODE_'+(i+1),'J'],['FID_INPUT_ISCD_'+(i+1),c]]));
}
export function parseMulti(body,codes){
 need(Array.isArray(body.output)&&body.output.length<=codes.length,'MULTI_BAD_ROWS');
 const rows=new Map();
 for(const r of body.output){
  const code=r.inter_shrn_iscd;need(codes.includes(code)&&!rows.has(code),'MULTI_BAD_IDENTITY');
  rows.set(code,values(r,['inter2_prpr','inter2_oprc','inter2_hgpr','inter2_lwpr','acml_vol','acml_tr_pbmn']));
 }
 return rows;
}
export function parseSingle(body){
 need(body.output&&typeof body.output==='object','SINGLE_BAD_ROW');
 return values(body.output,['stck_prpr','stck_oprc','stck_hgpr','stck_lwpr','acml_vol','acml_tr_pbmn']);
}
export function parseMinutes(body,day,requestHour){
 need(Array.isArray(body.output2)&&body.output2.length<=30,'MINUTE_BAD_ROWS');
 const a=body.output2.map(r=>{
  need(r.stck_bsop_date===day&&/^\d{6}$/.test(r.stck_cntg_hour)&&r.stck_cntg_hour.slice(4)==='00'&&r.stck_cntg_hour<=requestHour&&r.stck_cntg_hour>='090000'&&r.stck_cntg_hour<='153000','MINUTE_BAD_TIME');
  const h=r.stck_cntg_hour;need(Number(h.slice(2,4))<60,'MINUTE_BAD_TIME');
  const o=number(r.stck_oprc),hi=number(r.stck_hgpr),lo=number(r.stck_lwpr),c=number(r.stck_prpr),v=number(r.cntg_vol);
  need(lo>0&&lo<=o&&o<=hi&&lo<=c&&c<=hi,'MINUTE_BAD_OHLC');
  return {h,o,hi,lo,c,v};
 });
 need(new Set(a.map(r=>r.h)).size===a.length&&a.every((r,i)=>i===0||a[i-1].h>r.h),'MINUTE_BAD_ORDER');
 // Provider warns first row's volume may belong to prior minute; never treat
 // it as final. A successful shape probe is not final-bar proof.
 return a;
}
export function bracket(before,multi,after){
 if(!before||!multi||!after)return 'MISSING';
 if(fields.every(k=>before[k]===multi[k]&&multi[k]===after[k]))return 'EXACT_STABLE';
 if(fields.every(k=>before[k]===after[k]))return 'MISMATCH_STABLE';
 if(multi.open!==before.open||multi.open!==after.open||['high','volume','amount'].some(k=>before[k]>multi[k]||multi[k]>after[k])||before.low<multi.low||multi.low<after.low)return 'OUTSIDE_MONOTONIC_BRACKET';
 return 'MOVING_NOT_EXACT_PROOF';
}
const local=now=>new Date(now.getTime()+9*3600000);
const hhmmss=now=>local(now).toISOString().slice(11,19).replaceAll(':','');
const day=now=>local(now).toISOString().slice(0,10);
const inSession=now=>local(now).getUTCDay()>=1&&local(now).getUTCDay()<=5&&hhmmss(now)>='093500'&&hhmmss(now)<'152000';
const stats=a=>a.length?{n:a.length,min_ms:Math.min(...a),median_ms:[...a].sort((x,y)=>x-y)[Math.floor((a.length-1)/2)],max_ms:Math.max(...a)}:{n:0};
export async function probe(client,env,{count=10,mode='shape',fetchFn=fetch,clock=()=>new Date(),sleep=ms=>new Promise(r=>setTimeout(r,ms)),tokenFn=tursoDirectCachedToken}={}){
 need([10,20].includes(count)&&['shape','repeat'].includes(mode),'BAD_COUNT_OR_MODE');
 const start=clock(),d=day(start),elapsed={multi:[],single:[],minute:[]};
 if(!inSession(start))return {status:'OUTSIDE_TEST_WINDOW_KST',writes:0,requests:0};
 const a=await client.execute({sql:'SELECT trade_day FROM blue_eod_ingest_audit_v1 WHERE trade_day<? AND row_count>=1700 ORDER BY trade_day DESC LIMIT 1',args:[d]});
 need(a.rows.length===1,'NO_EOD_REFERENCE');
 const ref=String(a.rows[0].trade_day);need(/^20\d\d-\d\d-\d\d$/.test(ref)&&ref<d&&start.getTime()-Date.parse(ref+'T00:00:00+09:00')<=8*86400000,'BAD_EOD_REFERENCE');
 const q=await client.execute({sql:'SELECT code,market FROM blue_eod_daily_v1 WHERE trade_day=? AND market IN (\'KOSPI\',\'KOSDAQ\') ORDER BY CAST(amount AS INTEGER) DESC,code LIMIT 50',args:[ref]});
 const codes=q.rows.map(r=>String(r.code));
 need(codes.length===50&&codes.every(c=>CODE.test(c))&&new Set(codes).size===50,'BAD_EOD_SAMPLE');
 const t=await tokenFn(client,env,start);
 if(!t.token)return {status:t.status||'TOKEN_UNAVAILABLE',writes:0,requests:0};
 let requests=0,last=0,stop=null;const before=new Map(),after=new Map(),multi=new Map(),minute={attempted_symbols:0,valid_symbols:0,empty_pages:0,valid_rows_excluding_first:0,overlap_rows:0,overlap_mismatch:0,older_page_missing:0,errors:0};
 const parity={},errors={};const err=e=>{const k=/^[A-Z_]+$/.test(e?.message||'')?e.message:'OTHER';errors[k]=(errors[k]||0)+1;if(['RATE_LIMIT','AUTH_ERROR','DEADLINE','WINDOW_END'].includes(k))stop=k};
 async function req(kind,path,tr,params){
  need(!stop,'STOPPED');
  const now=clock();need(inSession(now)&&day(now)===d,'WINDOW_END');need(now-start<150000&&requests<60,'DEADLINE');
  if(last){const remaining=1200-(now.getTime()-last);if(remaining>0)await sleep(remaining)}
  need(inSession(clock())&&day(clock())===d,'WINDOW_END');need(clock()-start<150000,'DEADLINE');
  last=clock().getTime();requests++;
  const url=new URL(path,BASE);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
  try{
   const response=await fetchFn(url,{method:'GET',headers:{authorization:'Bearer '+t.token,appkey:env.KIS_APP_KEY,appsecret:env.KIS_APP_SECRET,tr_id:tr,custtype:'P'},signal:AbortSignal.timeout(10000)});
   if(response.status===429)throw Error('RATE_LIMIT');
   if([401,403].includes(response.status))throw Error('AUTH_ERROR');
   need(response.ok,'HTTP_ERROR');
   const j=await response.json();if(j?.msg_cd==='EGW00201')throw Error('RATE_LIMIT');
   need(j?.rt_cd==='0','PROVIDER_REJECTED');return j;
  }finally{elapsed[kind].push(clock().getTime()-last)}
 }
 const route='/uapi/domestic-stock/v1/quotations/';
 const single=async code=>parseSingle(await req('single',route+'inquire-price','FHKST01010100',{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code}));
 // Read-only actual repeated retrieval at a frozen, already elapsed hour.
 // Three high-liquidity codes; 3 pages per pass, two passes. No raw publication.
 if(mode==='repeat'){
  const offset=local(start).getUTCHours()*60+local(start).getUTCMinutes();
  const end=Math.floor((offset-2-540)/60)*60+540;
  if(end<600||end>900)return {status:'NO_ELAPSED_HOUR',requests:0,writes:0};
  const label=m=>String(Math.floor(m/60)).padStart(2,'0')+String(m%60).padStart(2,'0')+'00';
  const anchors=[end+1,end-27,end-55];
  const result={symbols:0,stable_minutes:0,conflict_minutes:0,windows:{5:{candidate:0,incomplete:0},30:{candidate:0,incomplete:0},60:{candidate:0,incomplete:0}},candles:{}};
  for(const code of codes.slice(0,3)){
   if(stop)break;
   try{
    const pass=async()=>{const pages=[];for(const m of anchors)pages.push(parseMinutes(await req('minute',route+'inquire-time-itemchartprice','FHKST03010200',{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code,FID_INPUT_HOUR_1:label(m),FID_PW_DATA_INCU_YN:'N',FID_ETC_CLS_CODE:''}),d.replaceAll('-',''),label(m)));return pages};
    const first=await pass(),second=await pass(),e=repeatedMinutes(first,second);
    result.symbols++;
    result.stable_minutes+=[...e.map.keys()].filter(m=>m>=end-60&&m<end).length;
    result.conflict_minutes+=[...e.conflicts].filter(m=>m>=end-60&&m<end).length;
    for(const n of [5,30,60])for(let a=end-60;a<end;a+=n){
     const b=aggregateWindow(e,label(a),label(a+n),n,label(end));
     if(b.status==='REPEAT_STABLE_CANDIDATE'){result.windows[n].candidate++;const k=candle(b).shape;result.candles[k]=(result.candles[k]||0)+1;}
     else result.windows[n].incomplete++;
    }
   }catch(e){err(e)}
  }
  return {status:stop?'STOPPED_'+stop:result.symbols===3&&result.conflict_minutes===0&&result.windows[60].candidate===3?'REPEAT_CANDIDATE_COMPLETE':'REPEAT_PARTIAL',mode,day:d,window_start:label(end-60),window_end:label(end),...result,requests,errors,writes:0,total_wall_ms:clock()-start,limits:['OPEN_LABEL_ASSUMPTION','SAME_PROVIDER_REPEAT_NOT_INDEPENDENT','NO_EXCHANGE_FINALITY_PROOF','NO_STORAGE_OR_PRODUCTION_SLA']};
 }
 // 3 stable/moving brackets, two multi calls with 30+20 symbols.
 for(const code of codes.slice(0,3)){if(stop)break;try{before.set(code,await single(code))}catch(e){err(e)}}
 for(const chunk of [codes.slice(0,30),codes.slice(30)]){if(stop)break;try{for(const [k,v] of parseMulti(await req('multi',route+'intstock-multprice','FHKST11300006',multiParams(chunk)),chunk))multi.set(k,v)}catch(e){err(e)}}
 for(const code of codes.slice(0,3)){if(stop)break;try{after.set(code,await single(code))}catch(e){err(e)}}
 for(const code of codes.slice(0,3)){const k=bracket(before.get(code),multi.get(code),after.get(code));parity[k]=(parity[k]||0)+1}
 // Freeze anchor at test start, use past minute to avoid future query clamp.
 const anchor=new Date(start.getTime()-60000);anchor.setUTCSeconds(0,0);
 const h1=hhmmss(anchor);const h2=hhmmss(new Date(anchor.getTime()-28*60000));
 const minuteStart=clock();
 for(const code of codes.slice(0,count)){
  if(stop)break;minute.attempted_symbols++;
  try{
   const get=async h=>parseMinutes(await req('minute',route+'inquire-time-itemchartprice','FHKST03010200',{FID_COND_MRKT_DIV_CODE:'J',FID_INPUT_ISCD:code,FID_INPUT_HOUR_1:h,FID_PW_DATA_INCU_YN:'N',FID_ETC_CLS_CODE:''}),d.replaceAll('-',''),h);
   const p=await get(h1);if(!p.length){minute.empty_pages++;continue}
   const q=await get(h2);if(!q.length){minute.empty_pages++;minute.older_page_missing++;continue}
   const first=new Map(p.slice(1).map(r=>[r.h,r]));let mismatch=false,overlap=0;
   for(const row of q.slice(1))if(first.has(row.h)){overlap++;if(JSON.stringify(row)!==JSON.stringify(first.get(row.h))){mismatch=true;minute.overlap_mismatch++}}
   minute.overlap_rows+=overlap;minute.valid_rows_excluding_first+=new Set([...p.slice(1),...q.slice(1)].map(r=>r.h)).size;
   if(!mismatch)minute.valid_symbols++;
  }catch(e){minute.errors++;err(e)}
 }
 return {status:stop?'STOPPED_'+stop:multi.size===50&&minute.valid_symbols===count?'SHAPE_PROBE_COMPLETE':'PARTIAL_PROBE',day:d,reference_day:ref,multi_requested:50,multi_valid:multi.size,parity,minute,requests,errors,
  endpoint_latency_ms:Object.fromEntries(Object.entries(elapsed).map(([k,v])=>[k,stats(v)])),minute_wall_ms:clock()-minuteStart,total_wall_ms:clock()-start,writes:0,
  limits:['NO_SIMULTANEOUS_QUOTE_PROOF','NO_FINAL_MINUTE_BAR_PROOF','NO_PRODUCTION_CAPACITY_PROOF','NO_RAW_PAYLOAD_PUBLICATION']};
}
async function main(){
 const env=process.env;need(env.TURSO_DATABASE_URL&&env.TURSO_AUTH_TOKEN,'CONFIG_MISSING');
 const c=createClient({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN,intMode:'string'});
 try{const r=await probe(c,env,{count:Number(env.PROBE_COUNT||10),mode:env.PROBE_MODE||'shape'});console.log('BLUE_KIS_BASKET_PROBE',JSON.stringify(r));if(!['SHAPE_PROBE_COMPLETE','REPEAT_CANDIDATE_COMPLETE'].includes(r.status))process.exitCode=1}finally{c.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('BLUE_KIS_BASKET_PROBE_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED');process.exitCode=1});

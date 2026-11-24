/** Bounded read-only KIS market queries using the existing cached Turso token.
 * Store only sanitized market/industry observations, no raw provider body.
 * KIS category quote has no explicit trade date: received time != quote time.
 */
import {createClient} from '@libsql/client';
import {tursoDirectCachedToken} from './turso-direct.mjs';
import {pathToFileURL} from 'node:url';
const markets=[['KOSPI','0001','K','KSP'],['KOSDAQ','1001','Q','KSQ']];
const number=x=>typeof x==='string'&&/^[+-]?\d+(?:\.\d+)?$/.test(x.trim())&&Number.isFinite(Number(x))?Number(x):null;
const positive=x=>{const v=number(x);return v!==null&&v>=0?v:null;};
const count=x=>{const v=positive(x);return Number.isSafeInteger(v)?v:null;};
const dayOf=now=>new Date(now.getTime()+32400000).toISOString().slice(0,10);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rows=x=>Array.isArray(x)?x:x&&typeof x==='object'?[x]:[];
const label=x=>typeof x==='string'&&x.trim().length<=70&&!/[\u0000-\u001f]/.test(x)&&x.trim()?x.trim():null;
export function parseCategory(body,market,code){
  if(body?.rt_cd!=='0')throw Error('CATEGORY_PROVIDER_REJECTED');
  const a=rows(body.output1);
  if(a.length!==1)throw Error('CATEGORY_MARKET_SUMMARY_MISSING');
  const s=a[0],index=positive(s.bstp_nmix_prpr),change=number(s.bstp_nmix_prdy_ctrt);
  if(!index||change===null||Math.abs(change)>50)throw Error('CATEGORY_MARKET_INVALID');
  const sectors=[],seen=new Set();
  for(const r of rows(body.output2)){
    const id=String(r.bstp_cls_code||'').trim(),name=label(r.hts_kor_isnm),p=positive(r.bstp_nmix_prpr),delta=number(r.bstp_nmix_prdy_ctrt);
    if(!/^\d{4,5}$/.test(id)||!name||!p||delta===null||Math.abs(delta)>100||seen.has(id))throw Error('CATEGORY_SECTOR_INVALID');
    seen.add(id);
    if(id.replace(/^0(?=\d{4}$)/,'')===code)continue;
    const share=positive(r.acml_tr_pbmn_rlim);
    sectors.push({code:id,name,index:p,change_pct:delta,relative_pct:Math.round((delta-change)*100)/100,
      turnover_share_pct:share!==null&&share<=100?share:null});
  }
  if(!sectors.length||sectors.length>100)throw Error('CATEGORY_SECTOR_COUNT_INVALID');
  return {market,index,change_pct:change,up:count(s.ascn_issu_cnt),down:count(s.down_issu_cnt),flat:count(s.stnr_issu_cnt),sectors};
}
export function parseFlows(body,day){
  if(body?.rt_cd!=='0')throw Error('FLOW_PROVIDER_REJECTED');
  const seen=new Set(),out=[];
  for(const r of rows(body.output)){
    const d=String(r.stck_bsop_date||'');
    if(!/^\d{8}$/.test(d))continue;
    const date=d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6);
    if(!Number.isFinite(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>day||seen.has(date))continue;
    seen.add(date);
    // Unit has not been independently confirmed: retain only the sign.
    const direction=x=>{const v=number(x);return v===null?null:v>0?'BUY':v<0?'SELL':'FLAT';};
    out.push({day:date,foreign:direction(r.frgn_ntby_tr_pbmn),institution:direction(r.orgn_ntby_tr_pbmn),individual:direction(r.prsn_ntby_tr_pbmn)});
  }
  return out.sort((a,b)=>b.day.localeCompare(a.day)).slice(0,10);
}
export async function capture(env=process.env,{mode='plan',now=new Date(),factory=createClient,token=tursoDirectCachedToken,fetchFn=fetch,wait=sleep}={}){
  if(mode==='plan')return {status:'PLAN_ONLY',kis_calls:0,turso_writes:0};
  if(!['inspect','apply'].includes(mode))throw Error('INVALID_MARKET_CAPTURE_MODE');
  const url=String(env.TURSO_DATABASE_URL||''),authToken=String(env.TURSO_AUTH_TOKEN||'');
  if(!/^(libsql|https):\/\//.test(url)||!authToken)throw Error('MARKET_DB_NOT_CONFIGURED');
  const db=factory({url,authToken,intMode:'string'});
  try{
    const auth=await token(db,env,now);
    if(!auth.token)return {status:'TOKEN_NOT_READY',reason:auth.status};
    const day=dayOf(now),d=day.replaceAll('-',''),observed_at_utc=now.toISOString(),data=[];
    let calls=0;
    async function get(path,tr,params){
      if(calls++)await wait(1100);
      const u=new URL('https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/'+path);
      for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
      const res=await fetchFn(u,{headers:{authorization:'Bearer '+auth.token,appkey:env.KIS_APP_KEY,appsecret:env.KIS_APP_SECRET,tr_id:tr,custtype:'P'},signal:AbortSignal.timeout(15000)});
      if(!res.ok)throw Error('MARKET_HTTP_FAILURE');
      // Refuse partial paginated data instead of claiming full coverage.
      if(['M','F'].includes(res.headers.get('tr_cont')))throw Error('MARKET_CONTINUATION_REQUIRED');
      return res.json();
    }
    for(const [market,code,cls,flowCode] of markets){
      const category=await get('inquire-index-category-price','FHPUP02140000',{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:code,FID_COND_SCR_DIV_CODE:'20214',FID_MRKT_CLS_CODE:cls,FID_BLNG_CLS_CODE:'0'});
      const item=parseCategory(category,market,code);
      let flow_status='AVAILABLE',flows=[];
      try{
        flows=parseFlows(await get('inquire-investor-daily-by-market','FHPTJ04040000',{FID_COND_MRKT_DIV_CODE:'U',FID_INPUT_ISCD:code,FID_INPUT_DATE_1:d,FID_INPUT_ISCD_1:flowCode,FID_INPUT_DATE_2:d,FID_INPUT_ISCD_2:code}),day);
        if(!flows.length)flow_status='MISSING';
      }catch{flow_status='UNAVAILABLE';}
      data.push({...item,flow_status,flows});
    }
    const snapshot={schema:'BLUE_KIS_MARKET_V1',observed_at_utc,receipt_day:day,quote_trade_day:null,source:'KIS_CATEGORY_AND_DAILY_INVESTOR',markets:data};
    const payload=JSON.stringify(snapshot);
    if(Buffer.byteLength(payload)>48000)throw Error('MARKET_PAYLOAD_TOO_LARGE');
    if(mode==='apply'){
      await db.execute('CREATE TABLE IF NOT EXISTS blue_market_rotation_v1 (receipt_day TEXT PRIMARY KEY, observed_at_utc TEXT NOT NULL, payload_json TEXT NOT NULL)');
      await db.execute({sql:'INSERT INTO blue_market_rotation_v1 VALUES(?,?,?) ON CONFLICT(receipt_day) DO UPDATE SET observed_at_utc=excluded.observed_at_utc,payload_json=excluded.payload_json WHERE excluded.observed_at_utc>blue_market_rotation_v1.observed_at_utc',args:[day,observed_at_utc,payload]});
      const r=await db.execute({sql:'SELECT payload_json FROM blue_market_rotation_v1 WHERE receipt_day=?',args:[day]});
      if(r.rows[0]?.payload_json!==payload)throw Error('MARKET_READBACK_MISMATCH_OR_SUPERSEDED');
    }
    return {status:mode==='apply'?'OK':'INSPECT_ONLY',kis_calls:calls,markets:data.map(m=>({market:m.market,sectors:m.sectors.length,flow_status:m.flow_status,flow_days:m.flows.length})),snapshot};
  }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const result=await capture(process.env,{mode:process.argv[2]||'plan'});
    const {snapshot,...summary}=result;
    console.log('BLUE_MARKET_CAPTURE',JSON.stringify(summary));
    if(snapshot){const {writeFile,mkdir}=await import('node:fs/promises');await mkdir('output/market',{recursive:true});await writeFile('output/market/snapshot.json',JSON.stringify(snapshot,null,2));}
    if(!['PLAN_ONLY','INSPECT_ONLY','OK'].includes(result.status))process.exitCode=1;
  }catch(e){console.error('BLUE_MARKET_CAPTURE_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1;}
}

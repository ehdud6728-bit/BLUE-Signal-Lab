/** Bounded, read-only comparison of recorded KIS quote HISTORY across Turso/D1.
 * Never contacts KIS, changes either DB, or prints stock payloads/credentials.
 * Only records with the SAME (day,market,code,receipt) can be compared fairly.
 */
import {createClient} from '@libsql/client';
import {readFileSync} from 'node:fs';

const DAY=/^20\d\d-\d\d-\d\d$/;
const CODE=/^[0-9A-Z]{6}$/;
const MAX_SAMPLE=6;
const FIELDS=['trade_date','market','code','received_at_utc','price','volume','phase'];
const key=r=>[r.trade_date,r.market,r.code,r.received_at_utc].join('|');
const kstDay=now=>new Date(now.getTime()+9*3600_000).toISOString().slice(0,10);

function validRow(row,day){
  if(!row||String(row.trade_date)!==day||!['J','NX'].includes(String(row.market))||
     !CODE.test(String(row.code))||
     !/^20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d/.test(String(row.received_at_utc))||
     !Number.isSafeInteger(Number(row.price))||Number(row.price)<=0||
     !Number.isSafeInteger(Number(row.volume))||Number(row.volume)<0||
     typeof row.phase!=='string'||!row.phase)
    throw Error('QUOTE_PARITY_INVALID_ROW');
  return Object.fromEntries(FIELDS.map(f=>[f,String(row[f])]));
}

function d1Id(){
  const path=new URL('../../worker/wrangler.jsonc',import.meta.url);
  const cfg=JSON.parse(readFileSync(path,'utf8'));
  const db=cfg.d1_databases?.filter(x=>x.database_name==='blue-signal-lab-db');
  if(db?.length!==1||!/^[0-9a-f-]{36}$/i.test(String(db[0].database_id)))
    throw Error('QUOTE_PARITY_D1_CONFIG');
  return db[0].database_id;
}

export async function auditQuoteParity(client,env,{
  mode='turso_only',day='',now=new Date(),fetchFn=fetch,databaseId=null
}={}){
  if(!['turso_only','compare_small'].includes(mode))throw Error('QUOTE_PARITY_BAD_MODE');
  const today=kstDay(now);
  const target=day||today;
  if(!DAY.test(target)||target>today||
     (now.getTime()-Date.parse(target+'T00:00:00+09:00'))>7*86400000)
    throw Error('QUOTE_PARITY_BAD_DAY');
  const result=await client.execute({
    sql:`SELECT trade_date,market,code,received_at_utc,price,volume,phase
      FROM blue_kis_live_history_r141 WHERE trade_date=?
      ORDER BY received_at_utc DESC,code LIMIT ?`,args:[target,MAX_SAMPLE]
  });
  const sample=(result.rows||[]).map(r=>validRow(r,target));
  if(sample.length>MAX_SAMPLE||new Set(sample.map(key)).size!==sample.length)
    throw Error('QUOTE_PARITY_INVALID_SAMPLE');
  const base={day_kst:target,sampled:sample.length};
  if(!sample.length)return {...base,status:'NO_TURSO_SAMPLE'};
  if(mode==='turso_only')return {...base,status:'TURSO_SAMPLE_READY'};
  if(String(env.CONFIRM_D1_READ)!=='blue-d1-bounded-read')
    return {...base,status:'D1_READ_NOT_APPROVED'};
  const account=String(env.CLOUDFLARE_ACCOUNT_ID||'');
  const credential=String(env.CLOUDFLARE_API_TOKEN||'');
  if(!/^[0-9a-f]{32}$/i.test(account)||!credential)
    return {...base,status:'D1_CREDENTIALS_MISSING'};
  const dbId=databaseId||d1Id();
  const predicate=sample.map(()=>'(trade_date=? AND market=? AND code=? AND received_at_utc=?)').join(' OR ');
  const sql=`SELECT trade_date,market,code,received_at_utc,price,volume,phase
    FROM blue_kis_live_history_r141 WHERE ${predicate}`;
  const params=sample.flatMap(r=>[r.trade_date,r.market,r.code,r.received_at_utc]);
  let found;
  try{
    const response=await fetchFn(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`,{
      method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},
      body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(15000)
    });
    if(!response.ok)throw Error('D1_HTTP_ERROR');
    const body=await response.json();
    if(body?.success!==true||body.result?.[0]?.success!==true||
       !Array.isArray(body.result[0].results))throw Error('D1_QUERY_ERROR');
    found=body.result[0].results;
  }catch{return {...base,status:'D1_UNAVAILABLE'};}
  if(found.length>MAX_SAMPLE)return {...base,status:'D1_INVALID_RESPONSE'};
  const d1rows=found.map(r=>validRow(r,target));
  if(new Set(d1rows.map(key)).size!==d1rows.length)
    return {...base,status:'D1_INVALID_RESPONSE'};
  const byKey=new Map(d1rows.map(r=>[key(r),r]));
  let matched=0,missing=0,mismatched=0;
  for(const record of sample){
    const d1=byKey.get(key(record));
    if(!d1){missing++;continue;}
    if(FIELDS.every(f=>record[f]===d1[f]))matched++;
    else mismatched++;
  }
  return {...base,matched,d1_missing:missing,value_mismatch:mismatched,
    status:missing||mismatched?'PARITY_GAP':'PARITY_MATCHED'};
}

async function main(){
  const env=process.env;
  const url=String(env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(https|libsql):\/\//.test(url)||!authToken)throw Error('QUOTE_PARITY_TURSO_CONFIG');
  const client=createClient({url,authToken,intMode:'string'});
  try{
    const report=await auditQuoteParity(client,env,{
      mode:env.AUDIT_MODE||'turso_only',day:env.AUDIT_DAY_KST||''
    });
    console.log('BLUE_TURSO_QUOTE_PARITY '+JSON.stringify(report));
    if(!['TURSO_SAMPLE_READY','PARITY_MATCHED'].includes(report.status))process.exitCode=1;
  }finally{client.close();}
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(()=>{console.error('BLUE_TURSO_QUOTE_PARITY_FAILED');process.exitCode=1;});
}

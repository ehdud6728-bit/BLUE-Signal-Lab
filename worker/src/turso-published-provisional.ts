/** Read-only, same-day published KIS pattern snapshot. Not verified EOD or research. */
import {createClient} from '@libsql/client/web';
import {InvalidProvisionalQuery} from './turso-provisional-search.ts';
type Env={TURSO_DATABASE_URL?:string;TURSO_AUTH_TOKEN?:string};
type Client=Pick<ReturnType<typeof createClient>,'execute'|'close'>;
type Factory=(options:{url:string;authToken:string;intMode:'string'})=>Client;
const kstDay=(d:Date)=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10);
const count=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=10000;
const check=(ok:unknown)=>{if(!ok)throw Error('INVALID_PUBLISHED_PROVISIONAL');};
const CODE=/^[0-9A-Z]{6}$/;
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const HASH=/^[a-f0-9]{64}$/;

export async function tursoPublishedProvisional(env:Env,p:URLSearchParams,factory:Factory=createClient,now=new Date()){
  const day=p.get('date')||'',q=(p.get('q')||'').trim(),pageText=p.get('page')||'1';
  if(day!==kstDay(now)||!DAY.test(day)||q.length>50||/[\u0000-\u001f]/.test(q)||
    !/^[1-9]\d{0,2}$/.test(pageText)||Number(pageText)>1000)throw new InvalidProvisionalQuery();
  const page=Number(pageText),limit=10;
  const empty={storage:'TURSO',day,pattern_confirmed:false,complete_market:false,
    data_status:'NOT_PUBLISHED',page,limit,total:0,matched_count:0,observed_count:0,
    eligible_count:0,turnover_available_count:0,reference_day:null as string|null,
    scan_asof_utc:null as string|null,latest_observed_utc:null as string|null,items:[] as unknown[]};
  const url=env.TURSO_DATABASE_URL?.trim()||'',authToken=env.TURSO_AUTH_TOKEN?.trim()||'';
  if(!/^(https|libsql):\/\//.test(url)||!authToken)throw Error('TURSO_PROVISIONAL_NOT_CONFIGURED');
  const db=factory({url,authToken,intMode:'string'});
  try{
    const run=(sql:string,args:(string|number)[]=[])=>db.execute({sql,args});
    const eod=()=>run('SELECT trade_day FROM blue_eod_ingest_audit_v1 WHERE trade_day=? AND row_count>=1700',[day]);
    if((await eod()).rows.length)return {...empty,data_status:'VERIFIED_EOD_AVAILABLE'};
    const tables=await run("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('blue_provisional_pattern_head_v1','blue_provisional_pattern_rows_v1')");
    if(tables.rows.length!==2)return empty;
    const heads=await run('SELECT reference_day,snapshot_id,latest_observed_utc,scan_asof_utc,row_count,metadata_json FROM blue_provisional_pattern_head_v1 WHERE trade_day=?',[day]);
    const head=heads.rows[0];if(!head)return empty;
    const id=String(head.snapshot_id),reference=String(head.reference_day),scan=String(head.scan_asof_utc),latest=String(head.latest_observed_utc),matched=Number(head.row_count);
    const stamp=(s:string)=>Number.isFinite(Date.parse(s))&&kstDay(new Date(s))===day&&Date.parse(s)<=now.getTime();
    const meta=JSON.parse(String(head.metadata_json));
    check(HASH.test(id)&&DAY.test(reference)&&reference<day&&stamp(scan)&&stamp(latest)&&Date.parse(latest)<=Date.parse(scan)&&
      meta.day===day&&meta.status==='KIS_PROVISIONAL'&&meta.pattern_confirmed===false&&meta.quote_coverage?.reference===reference&&meta.history_metadata?.reference===reference&&
      Date.parse(meta.scan_asof_utc)===Date.parse(scan)&&count(matched)&&count(meta.observed)&&count(meta.eligible)&&count(meta.quote_coverage?.turnoverAvailable)&&
      meta.audit?.matched_stocks===matched&&matched<=meta.eligible&&meta.eligible<=meta.observed&&meta.quote_coverage.turnoverAvailable<=meta.observed);
    const refs=await run('SELECT trade_day FROM blue_eod_ingest_audit_v1 WHERE trade_day<? AND row_count>=1700 ORDER BY trade_day DESC LIMIT 1',[day]);
    if(String(refs.rows[0]?.trade_day)!==reference)return empty;
    const rows=await run('SELECT COUNT(*) AS n FROM blue_provisional_pattern_rows_v1 WHERE snapshot_id=?',[id]);
    check(Number(rows.rows[0]?.n)===matched);
    const filter=q?" AND (code LIKE ? ESCAPE '\\' OR json_extract(record_json,'$.name') LIKE ? ESCAPE '\\')":'';
    const needle='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
    const args=q?[id,needle,needle]:[id];
    const total=q?Number((await run('SELECT COUNT(*) AS n FROM blue_provisional_pattern_rows_v1 WHERE snapshot_id=?'+filter,args)).rows[0]?.n):matched;
    check(count(total)&&total<=matched);
    // Project only display fields, not chart history or unverified research extras.
    const records=await run("SELECT code,json_extract(record_json,'$.code') AS payload_code,json_extract(record_json,'$.name') AS name,json_extract(record_json,'$.date') AS day,json_extract(record_json,'$.close') AS price,json_extract(record_json,'$.signals') AS signals,json_extract(record_json,'$.observed_at_utc') AS observed_at_utc,json_extract(record_json,'$.traded_amount_krw') AS amount,json_extract(record_json,'$.turnover_available') AS turnover,json_extract(record_json,'$.provisional') AS provisional,json_extract(record_json,'$.pattern_confirmed') AS confirmed,json_extract(record_json,'$.source') AS source FROM blue_provisional_pattern_rows_v1 WHERE snapshot_id=?"+filter+' ORDER BY code LIMIT ? OFFSET ?',[...args,limit,(page-1)*limit]);
    const items=records.rows.map(r=>{
      const code=String(r.code),price=Number(r.price),at=String(r.observed_at_utc);
      const signals=String(r.signals||'').split(',');
      const available=Number(r.turnover)===1,amount=r.amount==null?null:Number(r.amount);
      check(CODE.test(code)&&r.payload_code===code&&r.day===day&&Number.isSafeInteger(price)&&price>0&&stamp(at)&&Date.parse(at)<=Date.parse(latest)&&
        signals.every(s=>/^[A-Z0-9_]{2,60}$/.test(s))&&new Set(signals).size===signals.length&&
        r.provisional!=null&&Number(r.provisional)===1&&r.confirmed!=null&&Number(r.confirmed)===0&&r.source==='KIS_PROVISIONAL'&&
        r.turnover!=null&&[0,1].includes(Number(r.turnover))&&
        (available?amount!==null&&Number.isSafeInteger(amount)&&amount>0:amount===null));
      return {code,name:String(r.name||code).slice(0,70),price,signals,observed_at_utc:at,turnover_available:available,traded_amount_krw:amount,provisional:true,pattern_confirmed:false};
    });
    check(items.length===Math.min(limit,Math.max(0,total-(page-1)*limit)));
    // EOD takes priority even if it arrived while reading this generation.
    if((await eod()).rows.length)return {...empty,data_status:'VERIFIED_EOD_AVAILABLE'};
    return {...empty,data_status:'KIS_PROVISIONAL_PATTERNS',total,matched_count:matched,
      observed_count:meta.observed,eligible_count:meta.eligible,turnover_available_count:meta.quote_coverage.turnoverAvailable,
      reference_day:reference,scan_asof_utc:scan,latest_observed_utc:latest,snapshot_id:id,items};
  }finally{db.close();}
}

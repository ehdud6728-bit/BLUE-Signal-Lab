/** Read-only, same-day published KIS pattern snapshot. Not verified EOD or research. */
import {createClient} from '@libsql/client/web';
import {InvalidProvisionalQuery} from './turso-provisional-search.ts';
import {matchedRecent} from '../../web/src/recent-match.ts';
import {RECENT_ASOF} from '../../web/src/recent-pattern-data.ts';
type Env={TURSO_DATABASE_URL?:string;TURSO_AUTH_TOKEN?:string};
type Client=Pick<ReturnType<typeof createClient>,'execute'|'close'>;
type Factory=(options:{url:string;authToken:string;intMode:'string'})=>Client;
const kstDay=(d:Date)=>new Date(d.getTime()+9*3600000).toISOString().slice(0,10);
const count=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0&&n<=10000;
const check=(ok:unknown)=>{if(!ok)throw Error('INVALID_PUBLISHED_PROVISIONAL');};
const CODE=/^[0-9A-Z]{6}$/;
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const HASH=/^[a-f0-9]{64}$/;
export function provisionalCandleFeatures(raw:unknown,price:number):string[]|null{
  if(!raw||typeof raw!=='object')return null;
  const b=raw as Record<string,unknown>;
  const [o,h,l,c]=[b.open,b.high,b.low,b.close];
  if(typeof o!=='number'||typeof h!=='number'||typeof l!=='number'||typeof c!=='number'||
    ![o,h,l,c].every(Number.isSafeInteger)||!(0<l&&l<=Math.min(o,c)&&Math.max(o,c)<=h)||c!==price)return null;
  const span=h-l,body=span?Math.abs(c-o)/span:0,lower=span?(Math.min(o,c)-l)/span:0,upper=span?(h-Math.max(o,c))/span:0,pos=span?(c-l)/span:0;
  const shape=!span?'FLAT':body<=0.1?'DOJI':lower>=0.6&&upper<=0.15?'LOWER_WICK':upper>=0.6&&lower<=0.15?'UPPER_WICK':body>=0.7?(c>o?'LONG_BULL':'LONG_BEAR'):(c>o?'BULL':'BEAR');
  const features=[shape];
  if(shape==='BULL')features.push(body<0.3?'BODY_10_30':body<0.5?'BODY_30_50':'BODY_50_70',pos<0.33?'CLOSE_LOW':pos<0.67?'CLOSE_MID':'CLOSE_HIGH');
  return features;
}
// Only scanner diagnostics consumed by the standard result card and detail sheet.
// Do not include historical outcome statistics or unaudited recommendations.
const DIAGNOSTICS=['rsi','rsi_signal','rsi_gc','rsi_last_gc','slow_14_3_3_k','slow_14_3_3_d','slow_14_3_3_gc','slow_14_3_3_last_gc','slow_12_5_5_k','slow_12_5_5_d','slow_12_5_5_gc','slow_12_5_5_last_gc','slow_20_12_12_k','slow_20_12_12_d','slow_20_12_12_gc','slow_20_12_12_last_gc','macd_12_26_9','macd_signal_9','macd_gc','macd_last_gc','ma20','ma40','ma60','ma112','ma224','ma_to_up','ma112_cross','ma224_cross','amount_ratio20','valid_line_candidates_json','supply_strength_method','supply_strength_grade','supply_reference_price','supply_volume_est_shares','supply_bin_share_pct','supply_strength_relative_pct'];
const diagnosticJson="json_object("+DIAGNOSTICS.map(k=>"'"+k+"',json_extract(record_json,'$."+k+"')").join(',')+")";
const GC:Record<string,string>={rsi:'rsi_gc',slow14:'slow_14_3_3_gc',slow12:'slow_12_5_5_gc',slow20:'slow_20_12_12_gc',macd:'macd_gc'};
const field=(key:string)=>"json_extract(record_json,'$."+key+"')";
const flag=(key:string)=>"LOWER(CAST("+field(key)+" AS TEXT)) IN ('true','1')";
const TECH:Record<string,string>={ma112:flag('ma112_cross'),ma224:flag('ma224_cross'),
 inverse:"("+['ma20','ma40','ma60'].map(k=>"json_type(record_json,'$."+k+"') IN ('integer','real') AND "+field(k)+">0").join(' AND ')+" AND "+field('ma20')+"<"+field('ma40')+" AND "+field('ma40')+"<"+field('ma60')+")"};
const SIGNALS=new Set(['BB20','BB30','BB40','ENV20','ENV40','BB20_LOWER','BB30_LOWER','BB40_LOWER','BB20_ALT','BB30_ALT','BB40_ALT','BB20_LOWER_ALT','BB30_LOWER_ALT','BB40_LOWER_ALT','BB30_LOWER_RECLAIM','ENV20_LOWER_TOUCH']);
const own=(o:object,k:string)=>Object.prototype.hasOwnProperty.call(o,k);
function names(raw:string,allowed:(k:string)=>boolean,max:number){
 const values=raw?raw.split(','):[];
 if(values.length>max||new Set(values).size!==values.length||values.some(k=>!allowed(k)))throw new InvalidProvisionalQuery();
 return values;
}
function logic(p:URLSearchParams,key:string){
 const v=p.get(key)||'any';if(v!=='any'&&v!=='all')throw new InvalidProvisionalQuery();return v==='all'?' AND ':' OR ';
}

export async function tursoPublishedProvisional(env:Env,p:URLSearchParams,factory:Factory=createClient,now=new Date()){
  const day=p.get('date')||'',q=(p.get('q')||'').trim(),pageText=p.get('page')||'1';
  if(day!==kstDay(now)||!DAY.test(day)||q.length>50||/[\u0000-\u001f]/.test(q)||
    !/^[1-9]\d{0,2}$/.test(pageText)||Number(pageText)>1000)throw new InvalidProvisionalQuery();
  const page=Number(pageText),limit=10;
  const selected=names(p.get('signals')||'',k=>SIGNALS.has(k),20);
  const gc=names(p.get('gc')||'',k=>own(GC,k),5),tech=names(p.get('tech')||'',k=>own(TECH,k),3);
  const signalLogic=logic(p,'logic'),gcLogic=logic(p,'gc_logic'),techLogic=logic(p,'tech_logic');
  const amountText=p.get('min_amount_eok')||'0',amount=Number(amountText);
  const sort=p.get('sort')||'recent',aiOnly=p.get('ai_only')||'0';
  if(!/^\d{1,5}$/.test(amountText)||amount>50000||!['recent','amount_surge','amount_decline','recommended'].includes(sort)||!['0','1'].includes(aiOnly))throw new InvalidProvisionalQuery();
  const empty={storage:'TURSO',day,pattern_confirmed:false,complete_market:false,
    data_status:'NOT_PUBLISHED',page,limit,total:0,matched_count:0,observed_count:0,ai_count:null as number|null,ai_asof:RECENT_ASOF,ai_only:false,ai_evidence_count:0,unfiltered_total:0,
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
    const directory=await run("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_symbol_directory_v1'");
    // Stored KIS names can be ticker placeholders. Resolve names before
    // filtering and pagination, not just on the displayed page.
    const storedName="NULLIF(NULLIF(TRIM(json_extract(record_json,'$.name')),''),code)";
    const directoryName=directory.rows.length?
      "(SELECT NULLIF(TRIM(n.name),'') FROM blue_symbol_directory_v1 n WHERE n.code=blue_provisional_pattern_rows_v1.code AND n.market=json_extract(record_json,'$.market') AND n.name<>n.code ORDER BY n.asof_day DESC LIMIT 1)":'NULL';
    const displayName="COALESCE("+storedName+","+directoryName+",code)";
    const filters:string[]=[],args:(string|number)[]=[id];
    if(q){const needle='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
      filters.push("(code LIKE ? ESCAPE '\\' OR "+displayName+" LIKE ? ESCAPE '\\')");args.push(needle,needle);}
    if(selected.length){filters.push('('+selected.map(()=>"instr(','||"+field('signals')+"||',',?)>0").join(signalLogic)+')');args.push(...selected.map(s=>','+s+','));}
    if(gc.length)filters.push('('+gc.map(k=>flag(GC[k])).join(gcLogic)+')');
    if(tech.length)filters.push('('+tech.map(k=>TECH[k]).join(techLogic)+')');
    if(amount>0){filters.push(field('turnover_available')+'=1 AND '+field('traded_amount_krw')+'>=?');args.push(amount*100000000);}
    const filter=filters.length?' AND '+filters.join(' AND '):'';
    const ratio=field('amount_ratio20');
    const ordering=sort==='recent'||sort==='recommended'?'code':ratio+(sort==='amount_surge'?' DESC':' ASC')+' NULLS LAST,code';
    const total=filters.length?Number((await run('SELECT COUNT(*) AS n FROM blue_provisional_pattern_rows_v1 WHERE snapshot_id=?'+filter,args)).rows[0]?.n):matched;
    check(count(total)&&total<=matched);
    // Match over the full filtered pool, before paging. Read compact evidence
    // in bounded pages instead of fetching every large diagnostic record.
    const candidates:{code:string;features:string[]|null;rate:number|null}[]=[];
    for(let offset=0;offset<total;offset+=40){
      const chunk=await run("SELECT code,"+field('signals')+" AS signals,"+field('close')+" AS price,"+field('kis_candle')+" AS candle FROM blue_provisional_pattern_rows_v1 WHERE snapshot_id=?"+filter+' ORDER BY '+ordering+' LIMIT 40 OFFSET ?',[...args,offset]);
      for(const r of chunk.rows){
        let raw:unknown=null;
        if(typeof r.candle==='string'){try{raw=JSON.parse(r.candle);}catch{/* fail closed */}}
        const features=provisionalCandleFeatures(raw,Number(r.price));
        const rec=features?matchedRecent(day,String(r.signals||'').split(','),features)[0]:undefined;
        candidates.push({code:String(r.code),features,rate:rec?.positive_return_probability_pct??null});
      }
    }
    check(candidates.length===total&&new Set(candidates.map(r=>r.code)).size===total);
    const evidenceCount=candidates.filter(r=>r.features!==null).length;
    const aiReady=day>RECENT_ASOF&&evidenceCount===total;
    const aiCount=aiReady?candidates.filter(r=>r.rate!==null).length:null;
    // Legacy snapshots without exact candle evidence must not report zero
    // recommendations or silently pretend to honor an AI-only request.
    const appliedAiOnly=aiOnly==='1'&&aiReady;
    const pool=appliedAiOnly?candidates.filter(r=>r.rate!==null):candidates;
    if(sort==='recommended'&&aiReady)pool.sort((a,b)=>(b.rate??-1)-(a.rate??-1)||a.code.localeCompare(b.code));
    const slice=pool.slice((page-1)*limit,page*limit);
    const codes=slice.map(r=>r.code);
    const featuresByCode=new Map(slice.map(r=>[r.code,r.features]));
    // Project only display fields, not chart history or unverified research extras.
    const records=codes.length?await run("SELECT code,json_extract(record_json,'$.code') AS payload_code,"+displayName+" AS name,"+diagnosticJson+" AS diagnostics,json_extract(record_json,'$.date') AS day,json_extract(record_json,'$.close') AS price,json_extract(record_json,'$.signals') AS signals,json_extract(record_json,'$.observed_at_utc') AS observed_at_utc,json_extract(record_json,'$.traded_amount_krw') AS amount,json_extract(record_json,'$.turnover_available') AS turnover,json_extract(record_json,'$.provisional') AS provisional,json_extract(record_json,'$.pattern_confirmed') AS confirmed,json_extract(record_json,'$.source') AS source FROM blue_provisional_pattern_rows_v1 WHERE snapshot_id=? AND code IN ('+codes.map(()=>'?').join(',')+')',[id,...codes]):{rows:[]};
    const items=records.rows.map(r=>{
      const code=String(r.code),price=Number(r.price),at=String(r.observed_at_utc);
      const signals=String(r.signals||'').split(',');
      const available=Number(r.turnover)===1,amount=r.amount==null?null:Number(r.amount);
      check(CODE.test(code)&&r.payload_code===code&&r.day===day&&Number.isSafeInteger(price)&&price>0&&stamp(at)&&Date.parse(at)<=Date.parse(latest)&&
        signals.every(s=>/^[A-Z0-9_]{2,60}$/.test(s))&&new Set(signals).size===signals.length&&
        r.provisional!=null&&Number(r.provisional)===1&&r.confirmed!=null&&Number(r.confirmed)===0&&r.source==='KIS_PROVISIONAL'&&
        r.turnover!=null&&[0,1].includes(Number(r.turnover))&&
        (available?amount!==null&&Number.isSafeInteger(amount)&&amount>0:amount===null));
      const diagnostics=JSON.parse(String(r.diagnostics));
      if(!available)diagnostics.amount_ratio20=null;
      return {code,name:String(r.name||code).slice(0,70),price,signals,observed_at_utc:at,turnover_available:available,traded_amount_krw:amount,
        extras:{...diagnostics,traded_amount_krw:amount,provisional_candle_features:featuresByCode.get(code)??null},provisional:true,pattern_confirmed:false};
    });
    items.sort((a,b)=>codes.indexOf(a.code)-codes.indexOf(b.code));
    check(items.length===codes.length&&items.every((r,i)=>r.code===codes[i]));
    // EOD takes priority even if it arrived while reading this generation.
    if((await eod()).rows.length)return {...empty,data_status:'VERIFIED_EOD_AVAILABLE'};
    return {...empty,data_status:'KIS_PROVISIONAL_PATTERNS',q,sort,total:pool.length,unfiltered_total:total,ai_count:aiCount,ai_only:appliedAiOnly,ai_evidence_count:evidenceCount,matched_count:matched,
      observed_count:meta.observed,eligible_count:meta.eligible,turnover_available_count:meta.quote_coverage.turnoverAvailable,
      reference_day:reference,scan_asof_utc:scan,latest_observed_utc:latest,snapshot_id:id,items};
  }finally{db.close();}
}

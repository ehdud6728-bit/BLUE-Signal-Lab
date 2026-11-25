/** Current KIS master + audited historical EOD observations.
 * No historical membership inference, order or production signal promotion.
 */
import {createClient} from '@libsql/client';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const hash=s=>createHash('sha256').update(s).digest('hex');
const validDay=x=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const kst=t=>new Date(t.getTime()+32400000).toISOString().slice(0,10);
const num=x=>x===null||x===undefined||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const round=x=>Math.round(x*100)/100;
const pct=(a,b)=>round(100*(a/b-1));
const sectorsLimit=12;
const thresholds={minimum_turnover_krw:500000000,leader_min_return10_pct:3,follower_return10_min_pct:-3,follower_return10_max_pct:3,follower_return5_max_pct:3,follower_min_turnover_ratio:1.2};
export function classifyStocks(rows,sector,isMember=r=>r.sectors.includes(sector.code)){
  const matched=rows.filter(r=>isMember(r)&&r.amount!==null&&r.amount>=thresholds.minimum_turnover_krw&&r.r5!==null&&r.r10!==null);
  // A price leader needs positive 5- and 10-day performance and adequate liquidity.
  const leaders=matched.filter(r=>r.r5>0&&r.r10>=thresholds.leader_min_return10_pct).sort((a,b)=>b.r10-a.r10||b.amount-a.amount||a.code.localeCompare(b.code)).slice(0,3);
  const leaderCodes=new Set(leaders.map(x=>x.code));
  const followers=leaders.length?matched.filter(r=>!leaderCodes.has(r.code)&&r.r10>=thresholds.follower_return10_min_pct&&r.r10<=thresholds.follower_return10_max_pct&&r.r5>0&&r.r5<=thresholds.follower_return5_max_pct&&r.amount_ratio!==null&&r.amount_ratio>=thresholds.follower_min_turnover_ratio&&r.r10<leaders[0].r10).sort((a,b)=>Number(b.signals?.length>0)-Number(a.signals?.length>0)||b.amount_ratio-a.amount_ratio||b.r5-a.r5||a.code.localeCompare(b.code)).slice(0,3):[];
  const compact=r=>({code:r.code,name:r.name,close:r.close,r5:r.r5,r10:r.r10,amount:r.amount,amount_ratio:r.amount_ratio,signals:r.signals});
  return {eligible:matched.length,leaders:leaders.map(compact),followers:followers.map(compact)};
}
// Exact labels only. Sector flags in the KIS headers are distinct from the
// three industry code fields. Never expand a theme by a stock name.
const norm=x=>String(x).normalize('NFKC').replace(/\s+/g,'').toUpperCase();
const tagNames={
 KOSPI_LARGE:['대형주','코스피대형주','KOSPI대형주'],KOSPI_MID:['중형주','코스피중형주','KOSPI중형주'],KOSPI_SMALL:['소형주','코스피소형주','KOSPI소형주'],
 KOSDAQ_LARGE:['코스닥100','KOSDAQ100'],KOSDAQ_MID:['코스닥MID300','KOSDAQMID300'],KOSDAQ_SMALL:['코스닥SMALL','KOSDAQSMALL'],
 KOSPI_MANUFACTURING:['제조업','코스피제조업','KOSPI제조업'],
 KOSPI200:['코스피200','KOSPI200'],KOSPI100:['코스피100','KOSPI100'],KOSPI50:['코스피50','KOSPI50'],
 KOSDAQ150:['코스닥150','KOSDAQ150'],KOSDAQ_VENTURE:['벤처기업','코스닥벤처기업','KOSDAQ벤처기업'],
 KRX100:['KRX100']
};
for(const x of ['건설','중공업','철강소재','에너지화학','정보통신','금융','필수소비재','자유소비재','산업재','건강관리','커뮤니케이션서비스'])
 tagNames['KOSPI200_'+x]=['코스피200'+x,'KOSPI200'+x];
for(const x of ['자동차','반도체','바이오','은행','에너지화학','철강','미디어통신','건설','증권','선박','보험','운송'])
 tagNames['KRX'+x]=['KRX'+x];
export function masterMembership(members,market,sector){
 const scoped=members.filter(r=>r.market===market);
 const tags=Object.entries(tagNames).filter(([tag,names])=>(tag.startsWith('KRX')||tag.startsWith(market))&&names.some(n=>norm(n)===norm(sector.name))).map(([tag])=>tag);
 if(tags.length===1){
   const codes=new Set(scoped.filter(r=>r.index_tags?.includes(tags[0])).map(r=>r.code));
   if(codes.size)return {source:'KIS_MASTER_FLAG',reason:null,codes};
 }
 const codes=new Set(scoped.filter(r=>r.sectors.includes(sector.code)).map(r=>r.code));
 return codes.size?{source:'KIS_MASTER_CODE',reason:null,codes}:{source:'UNMAPPED',reason:'NO_MASTER_MEMBERS',codes};
}
export function krxLookup(request,env){
 const allowed=['PATH','HOME','LANG','LC_ALL','TZ','KRX_ID','KRX_PW','KRX_DATA_ID','KRX_DATA_PW'];
 const subprocessEnv=Object.fromEntries(allowed.filter(k=>typeof env[k]==='string').map(k=>[k,env[k]]));
 // Keep the event loop and the HTTP pool responsive while Python queries KRX.
 return new Promise(resolve=>{
   try{
     const child=execFile('python',['scripts/rotation_krx_members.py'],{encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024,env:subprocessEnv},(error,stdout)=>{
       if(error){resolve({error:'KRX_LOOKUP_UNAVAILABLE'});return;}
       try{resolve(JSON.parse(stdout));}catch{resolve({error:'KRX_LOOKUP_UNAVAILABLE'});}
     });
     child.stdin.on('error',()=>{/* process callback handles failures */});
     child.stdin.end(JSON.stringify(request));
   }catch{resolve({error:'KRX_LOOKUP_UNAVAILABLE'});}
 });
}
export async function resolveMembership(members,targets,day,lookup){
 const resolved=new Map(),missing=[];
 const key=g=>g.market+'/'+g.code;
 for(const g of targets){
   const result=masterMembership(members,g.market,g);
   resolved.set(key(g),result);
   if(!result.codes.size)missing.push(g);
 }
 if(!missing.length)return resolved;
 let result;
 try{result=await lookup({day,groups:missing});}catch{result=null;}
 if(result?.catalog_counts)console.log('BLUE_LEADERS_KRX_CATALOG',JSON.stringify(result.catalog_counts));
 const known=new Map(missing.map(g=>[key(g),g]));
 if(!result||result.day!==day||!Array.isArray(result.groups)||result.groups.length!==missing.length||new Set(result.groups.map(key)).size!==missing.length||result.groups.some(g=>!known.has(key(g)))){
   for(const g of missing)resolved.set(key(g),{source:'UNMAPPED',reason:'KRX_LOOKUP_UNAVAILABLE',codes:new Set()});
   return resolved;
 }
 for(const g of result.groups){
   let codes=new Set(),reason='KRX_LOOKUP_UNAVAILABLE',source='UNMAPPED';
   if(g.status==='AVAILABLE'&&g.reason===null&&((g.krx_scope===g.market&&g.identity_basis==='LOCAL_EXACT_NAME')||(['KRX','테마'].includes(g.krx_scope)&&g.identity_basis==='CROSS_EXACT_NAME_AND_RELATIVE_HISTORY'))&&/^\d{4,6}$/.test(g.krx_code)&&Array.isArray(g.members)&&g.members.length>0&&g.members.length<=3000&&g.members.every(c=>typeof c==='string'&&/^[0-9A-Z]{6}$/.test(c))&&new Set(g.members).size===g.members.length){
     const eligible=new Set(members.filter(r=>r.market===g.market).map(r=>r.code));
     codes=new Set(g.members.filter(c=>eligible.has(c)));
     if(codes.size){source='KRX_INDEX_CONSTITUENTS';reason=null;}else reason='KRX_NO_ELIGIBLE_MEMBERS';
   }else if(['NO_EXACT_INDEX_NAME','KRX_CATALOG_UNAVAILABLE','KRX_CONSTITUENTS_UNAVAILABLE','AMBIGUOUS_INDEX_NAME','KRX_CROSS_CATALOG_INCOMPLETE','INDEX_HISTORY_PROOF_REQUIRED','INDEX_BENCHMARK_IDENTITY_MISMATCH','INDEX_HISTORY_MISMATCH','INDEX_HISTORY_UNAVAILABLE'].includes(g.reason))reason=g.reason;
   resolved.set(key(g),{source,reason,codes,...(source==='KRX_INDEX_CONSTITUENTS'?{krx_scope:g.krx_scope,krx_code:g.krx_code,identity_basis:g.identity_basis}:{})});
 }
 return resolved;
}
function masterRows(master,now){
  const at=Date.parse(master?.observed_at_utc);
  if(master?.schema!=='BLUE_KIS_STOCK_MASTER_V1'||!Number.isFinite(at)||at>now.getTime()||master.receipt_day!==kst(new Date(at))||
    kst(now)!==master.receipt_day||!['KOSPI','KOSDAQ'].every(m=>/^[a-f0-9]{64}$/.test(master.hashes?.[m]))||!Array.isArray(master.rows)||master.rows.length>10000)throw Error('MASTER_INVALID');
  const seen=new Set();
  for(const r of master.rows){
    if(!['KOSPI','KOSDAQ'].includes(r.market)||!/^[0-9A-Z]{6}$/.test(r.code)||typeof r.name!=='string'||!r.name||r.name.length>100||
      !Array.isArray(r.sectors)||r.sectors.length>3||!r.sectors.every(s=>/^\d{4,5}$/.test(s))||
      (r.index_tags!==undefined&&(!Array.isArray(r.index_tags)||r.index_tags.length>30||!r.index_tags.every(t=>Object.hasOwn(tagNames,t))||new Set(r.index_tags).size!==r.index_tags.length))||(!r.sectors.length&&!r.index_tags?.length)||
      new Set(r.sectors).size!==r.sectors.length||seen.has(r.market+'/'+r.code))throw Error('MASTER_ROW_INVALID');
    seen.add(r.market+'/'+r.code);
  }
  return master.rows;
}
/** Never substitute a different stock price date for a sector trend day.
 * Prefer latest source generation, otherwise an explicitly older aligned
 * generation. Preserve the distinction between benchmark sessions and the
 * legacy audited-date sequence when the original snapshot lacks dates.
 */
export async function selectAlignedTrend(read,receipt){
  const keys=await read('SELECT receipt_day FROM blue_market_trends_v1 WHERE receipt_day<=? ORDER BY receipt_day DESC LIMIT 7',[receipt]);
  if(!keys.length)throw Error('LEADERS_TREND_REQUIRED');
  let latest_trend_day=null;
  for(const key of keys){
    const tr=(await read('SELECT receipt_day,observed_at_utc,payload_json,payload_sha256 FROM blue_market_trends_v1 WHERE receipt_day=?',[key.receipt_day]))[0];
    if(!tr||hash(String(tr.payload_json))!==tr.payload_sha256)throw Error('LEADERS_TREND_REQUIRED');
    const trend=JSON.parse(String(tr.payload_json));
    if(trend.schema!=='BLUE_ROTATION_TRENDS_V1'||trend.receipt_day!==tr.receipt_day||trend.observed_at_utc!==tr.observed_at_utc||
      !validDay(trend.receipt_day)||trend.receipt_day>receipt||!Array.isArray(trend.markets)||trend.markets.length!==2)throw Error('LEADERS_TREND_INVALID');
    const day=trend.markets[0]?.benchmark?.day;
    if(!validDay(day)||day>receipt||!trend.markets.every(m=>m.benchmark?.day===day))throw Error('LEADERS_COMMON_DAY_REQUIRED');
    if(latest_trend_day===null)latest_trend_day=day;
    if(day>latest_trend_day)throw Error('LEADERS_TREND_ORDER_INVALID');
    const exact=trend.markets.map(m=>m.benchmark_days);
    let dates=null,reference_basis='AUDITED_DATES_LEGACY';
    if(exact.some(x=>x!==undefined)){
      if(!exact.every(x=>Array.isArray(x)&&x.length>=11&&x.every(validDay)&&x.every((d,i)=>i===0||d>x[i-1])&&x.at(-1)===day)||
         JSON.stringify(exact[0].slice(-11))!==JSON.stringify(exact[1].slice(-11)))throw Error('LEADERS_BENCHMARK_DATES_INVALID');
      dates=exact[0].slice(-11).reverse();reference_basis='EXACT_BENCHMARK_DATES';
    }
    const audit=dates?
      await read('SELECT trade_day,row_count,source,day_sha256 FROM blue_eod_ingest_audit_v1 WHERE trade_day IN ('+dates.map(()=>'?').join(',')+') ORDER BY trade_day DESC',dates):
      await read('SELECT trade_day,row_count,source,day_sha256 FROM blue_eod_ingest_audit_v1 WHERE trade_day<=? ORDER BY trade_day DESC LIMIT 11',[day]);
    const missing=dates?dates.filter(d=>!audit.some(a=>a.trade_day===d)):audit[0]?.trade_day!==day?[day]:[];
    const bad=audit.filter((a,i)=>!validDay(a.trade_day)||i>0&&a.trade_day>=audit[i-1].trade_day||
      !Number.isSafeInteger(num(a.row_count))||num(a.row_count)<1700||num(a.row_count)>10000||
      !['KRX_PYKRX_EXACT_DAY_VERIFIED','KRX_OPENAPI_EXACT_DAY_VERIFIED'].includes(a.source)||!/^[a-f0-9]{64}$/.test(a.day_sha256));
    const priorOk=trend.markets.every(m=>!m.benchmark.previous_day||m.benchmark.previous_day===audit[1]?.trade_day);
    if(audit.length!==11||missing.length||bad.length||!priorOk){
      console.log('BLUE_LEADERS_EOD_CHECK',JSON.stringify({trend_day:day,trend_receipt_day:trend.receipt_day,
        audit_days:audit.length,latest_audited_day:audit[0]?.trade_day??null,missing_dates:missing,
        invalid_audit_days:bad.map(a=>a.trade_day),prior_day_mismatch:!priorOk,reference_basis}));
      continue;
    }
    dates=audit.map(a=>a.trade_day);
    const actual=await read('SELECT trade_day,COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day IN ('+dates.map(()=>'?').join(',')+') GROUP BY trade_day',dates);
    const counts=new Map(actual.map(a=>[a.trade_day,num(a.n)]));
    const mismatch=audit.filter(a=>counts.get(a.trade_day)!==num(a.row_count)).map(a=>a.trade_day);
    if(mismatch.length){
      console.log('BLUE_LEADERS_EOD_CHECK',JSON.stringify({trend_day:day,count_mismatch_dates:mismatch,reference_basis}));continue;
    }
    console.log('BLUE_LEADERS_EOD_ALIGNED',JSON.stringify({day,latest_trend_day,trend_receipt_day:trend.receipt_day,
      reference5:dates[5],reference10:dates[10],reference_basis,older_generation:tr.receipt_day!==keys[0].receipt_day}));
    return {tr,trend,day,dates,counts,latest_trend_day,reference_basis};
  }
  throw Error('LEADERS_EOD_HISTORY_REQUIRED');
}
// Do not reuse an idle websocket after a blocking external constituent lookup.
export function leaderStorageFailure(stage,e){
  const code=String(e?.code||e?.cause?.code||'');
  const safe=/^(?:SQLITE_[A-Z0-9_]+|HRANA_[A-Z0-9_]+|LIBSQL_[A-Z0-9_]+|SERVER_ERROR|HTTP_ERROR|FETCH_ERROR|STREAM_EXPIRED|TRANSACTION_TIMEOUT|TRANSACTION_CLOSED|CLIENT_CLOSED|URL_INVALID|AUTH_TOKEN_INVALID|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR_[A-Z0-9_]+)$/.test(code)?code:'UNKNOWN';
  const kind=['TypeError','ReferenceError','RangeError','SyntaxError'].includes(e?.name)?'_'+e.name.toUpperCase():'';
  return 'LEADERS_STORAGE_'+stage+'_'+safe+kind;
}
// Only transient network errors are retried; no retry on SQL, auth or proof mismatch.
export function retryableTransport(e){
 const code=String(e?.code||e?.cause?.code||'');
 return ['UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ECONNRESET','ECONNREFUSED','ETIMEDOUT','EPIPE','EAI_AGAIN','HRANA_WEBSOCKET_ERROR','HRANA_WEBSOCKET_CLOSED','STREAM_EXPIRED'].includes(code);
}
async function publishLeadersOnce(snapshot,factory,opts){
  const raw=JSON.stringify(snapshot),digest=hash(raw);
  if(Buffer.byteLength(raw)>48000)throw Error('LEADERS_PAYLOAD_TOO_LARGE');
  let stage='CONNECT',db;
  try{
    db=factory(opts);
    stage='CREATE';
    console.log('BLUE_LEADERS_STORAGE_STAGE',JSON.stringify({stage,bytes:Buffer.byteLength(raw)}));
    await db.execute('CREATE TABLE IF NOT EXISTS blue_rotation_leaders_v1 (receipt_day TEXT PRIMARY KEY,observed_at_utc TEXT NOT NULL,payload_json TEXT NOT NULL,payload_sha256 TEXT NOT NULL)');
    stage='WRITE';
    console.log('BLUE_LEADERS_STORAGE_STAGE',JSON.stringify({stage}));
    await db.execute({sql:'INSERT INTO blue_rotation_leaders_v1(receipt_day,observed_at_utc,payload_json,payload_sha256) VALUES(?,?,?,?) ON CONFLICT(receipt_day) DO UPDATE SET observed_at_utc=excluded.observed_at_utc,payload_json=excluded.payload_json,payload_sha256=excluded.payload_sha256 WHERE excluded.observed_at_utc>blue_rotation_leaders_v1.observed_at_utc',args:[snapshot.receipt_day,snapshot.observed_at_utc,raw,digest]});
    stage='READBACK';
    console.log('BLUE_LEADERS_STORAGE_STAGE',JSON.stringify({stage}));
    const result=await db.execute({sql:'SELECT payload_json,payload_sha256 FROM blue_rotation_leaders_v1 WHERE receipt_day=?',args:[snapshot.receipt_day]});
    if(result.rows.length!==1||result.rows[0].payload_json!==raw||result.rows[0].payload_sha256!==digest)throw Error('LEADERS_READBACK_MISMATCH');
    console.log('BLUE_LEADERS_STORAGE_VERIFIED',JSON.stringify({receipt_day:snapshot.receipt_day,bytes:Buffer.byteLength(raw)}));
  }catch(e){if(e?.message==='LEADERS_READBACK_MISMATCH')throw e;throw Object.assign(Error(leaderStorageFailure(stage,e)),{retryable:retryableTransport(e)});}
  finally{try{db?.close();}catch{/* closing cannot invalidate completed readback */}}
}
export async function publishLeaders(snapshot,factory,opts,{wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=3}={}){
 // Replaying the exact payload is idempotent: the receipt-day upsert is
 // monotonic, and successful completion requires exact payload/hash readback.
 for(let attempt=1;attempt<=attempts;attempt++){
   try{return await publishLeadersOnce(snapshot,factory,opts);}
   catch(e){
     if(!e?.retryable||attempt===attempts)throw e;
     console.log('BLUE_LEADERS_STORAGE_RETRY',JSON.stringify({attempt,error:e.message}));
     await wait(750*2**(attempt-1));
   }
 }
}
export async function captureLeaders(env=process.env,{mode='plan',master=null,now=new Date(),factory=createClient,lookup=request=>krxLookup(request,env)}={}){
  if(mode==='plan')return {status:'PLAN_ONLY',turso_reads:0,turso_writes:0};
  if(!['inspect','apply'].includes(mode))throw Error('LEADERS_MODE_INVALID');
  const members=masterRows(master,now),receipt=kst(now);
  const url=String(env.TURSO_DATABASE_URL||''),authToken=String(env.TURSO_AUTH_TOKEN||'');
  if(!/^(libsql|https):\/\//.test(url)||!authToken)throw Error('LEADERS_DB_NOT_CONFIGURED');
  const db=factory({url,authToken,intMode:'string'});
  let readClosed=false;
  try{
    let reads=0;
    const read=async(sql,args=[])=>{reads++;return (await db.execute({sql,args})).rows;};
    const selected=await selectAlignedTrend(read,receipt);
    const {tr,trend,day,dates,counts,latest_trend_day,reference_basis}=selected;
    const signalMap=new Map();let signalStatus='MISSING';
    try{
      const a=(await read('SELECT row_count,observed_stocks,signal_events,source_payload_sha256 FROM blue_research_signal_audit_v1 WHERE trade_day=?',[day]))[0];
      if(a&&num(a.observed_stocks)===counts.get(day)&&/^[a-f0-9]{64}$/.test(a.source_payload_sha256)){
        let cursor='',n=0,events=0;
        while(true){
          const rs=await read('SELECT code,signal_names,source_payload_sha256 FROM blue_research_signals_v1 WHERE trade_day=? AND code>? ORDER BY code LIMIT 200',[day,cursor]);
          for(const r of rs){
            const names=String(r.signal_names).split(',');
            if(r.source_payload_sha256!==a.source_payload_sha256||!/^[0-9A-Z]{6}$/.test(r.code)||r.code<=cursor||!names.length||!names.every(x=>/^[A-Z0-9_]{2,60}$/.test(x))||names.length!==new Set(names).size)throw Error('SIGNAL_ROW_INVALID');
            signalMap.set(r.code,names);cursor=r.code;n++;events+=names.length;
          }
          if(rs.length<200)break;
          if(n>10000)throw Error('SIGNAL_LIMIT');
        }
        if(n!==num(a.row_count)||events!==num(a.signal_events))throw Error('SIGNAL_AUDIT_MISMATCH');
        signalStatus='AUDITED';
      }
    }catch{signalMap.clear();signalStatus='UNAVAILABLE';}
    const rows=[];
    // Exact date matches and prior 5 observed daily amounts (excluding current).
    // Page by code; no request to KIS quote API and no D1 dependency.
    let cursor='',pageRows=0;
    const masterByKey=new Map(members.map(r=>[r.market+'/'+r.code,r]));
    for(let page=0;page<60;page++){
      const rs=await read("SELECT e.code,e.market,e.name,e.close,e.amount,p5.close AS c5,p10.close AS c10,"+
        "(SELECT COUNT(h.amount) FROM blue_eod_daily_v1 h WHERE h.code=e.code AND h.market=e.market AND h.trade_day IN (?,?,?,?,?)) AS a5n,"+
        "(SELECT AVG(h.amount) FROM blue_eod_daily_v1 h WHERE h.code=e.code AND h.market=e.market AND h.trade_day IN (?,?,?,?,?)) AS a5 "+
        "FROM blue_eod_daily_v1 e LEFT JOIN blue_eod_daily_v1 p5 ON p5.trade_day=? AND p5.code=e.code AND p5.market=e.market "+
        "LEFT JOIN blue_eod_daily_v1 p10 ON p10.trade_day=? AND p10.code=e.code AND p10.market=e.market WHERE e.trade_day=? AND e.code>? ORDER BY e.code LIMIT 100",
        [...dates.slice(1,6),...dates.slice(1,6),dates[5],dates[10],day,cursor]);
      for(const r of rs){
        if(typeof r.code!=='string'||r.code<=cursor)throw Error('LEADERS_PAGE_INVALID');
        cursor=r.code;pageRows++;
        const m=masterByKey.get(r.market+'/'+r.code);
        if(!m)continue;
        const close=num(r.close),c5=num(r.c5),c10=num(r.c10),amount=num(r.amount),avg=num(r.a5);
        if(!close||close<=0)continue;
        rows.push({...m,name:typeof r.name==='string'&&r.name.trim()?r.name:m.name,close,amount:amount!==null&&amount>=0?amount:null,
          r5:c5&&c5>0?pct(close,c5):null,r10:c10&&c10>0?pct(close,c10):null,
          amount_ratio:num(r.a5n)===5&&avg&&avg>0&&amount!==null&&amount>=0?round(amount/avg):null,
          signals:signalStatus==='AUDITED'?(signalMap.get(r.code)||[]):null});
      }
      if(rs.length<100)break;
      if(page===59)throw Error('LEADERS_PAGE_LIMIT');
    }
    if(pageRows!==counts.get(day))throw Error('LEADERS_PAGED_COUNT_MISMATCH');
    // All audit/price reads are complete. Release before external lookup and publication.
    db.close();readClosed=true;
    const prepared=[];
    for(const m of trend.markets){
      if(!['KOSPI','KOSDAQ'].includes(m.market)||!Array.isArray(m.rows)||m.rows.length>100)throw Error('LEADERS_TREND_INVALID');
      const universe=m.rows.filter(s=>s.trend?.day===day&&s.trend.quadrant==='IMPROVING'&&Number.isFinite(s.trend.momentum)&&s.trend.momentum>0);
      const isNew=s=>s.trend.previous_day===dates[1]&&['LEADING','WEAKENING','LAGGING','NEUTRAL'].includes(s.trend.previous_quadrant);
      const sorted=universe.sort((a,b)=>Number(isNew(b))-Number(isNew(a))||b.trend.momentum-a.trend.momentum||a.code.localeCompare(b.code));
      prepared.push({market:m.market,benchmark:m.benchmark,benchmark_days:m.benchmark_days,improving:universe.length,selected:sorted.slice(0,sectorsLimit)});
    }
    const targets=prepared.flatMap(m=>m.selected.map(s=>({market:m.market,code:s.code,name:s.name,benchmark:m.benchmark,benchmark_days:m.benchmark_days?.slice(-26),trend:s.trend})));
    const membership=await resolveMembership(members,targets,day,lookup);
    console.log('BLUE_LEADERS_PHASE',JSON.stringify({stage:'CLASSIFY',targets:targets.length}));
    const markets=prepared.map(m=>{
      const groupRows=rows.filter(r=>r.market===m.market);
      const groups=m.selected.map(s=>{
        const proof=membership.get(m.market+'/'+s.code);
        const belongs=r=>proof.codes.has(r.code);
        const memberCount=proof.codes.size;
        const matched=groupRows.filter(belongs).length;
        const previous=s.trend.previous_day===dates[1]&&['LEADING','WEAKENING','IMPROVING','LAGGING','NEUTRAL'].includes(s.trend.previous_quadrant)?s.trend.previous_quadrant:null;
        console.log('BLUE_LEADERS_MEMBERSHIP',JSON.stringify({market:m.market,sector_code:s.code,sector_name:s.name,source:proof.source,reason:proof.reason,krx_scope:proof.krx_scope??null,krx_code:proof.krx_code??null,identity_basis:proof.identity_basis??null,members:memberCount,matched}));
        return {code:s.code,name:s.name,rs10:s.trend.rs10,momentum:s.trend.momentum,previous_quadrant:previous,
          entry:previous===null?'UNKNOWN':previous==='IMPROVING'?'CONTINUING':'NEW_ENTRY',members:memberCount,matched,
          membership_source:proof.source,membership_reason:proof.reason,...(proof.krx_scope?{krx_scope:proof.krx_scope,krx_code:proof.krx_code,identity_basis:proof.identity_basis}:{}),...classifyStocks(groupRows,s,belongs)};
      });
      return {market:m.market,improving:m.improving,analyzed:groups.length,master_members:members.filter(r=>r.market===m.market).length,matched_members:groupRows.length,groups};
    });
    const mapped=markets.flatMap(m=>m.groups).filter(g=>g.members>0&&g.matched>0).length;
    const totalGroups=targets.length;
    const mapping_status=totalGroups===0?'NO_IMPROVING_GROUPS':mapped===totalGroups?'COMPLETE':mapped>0?'PARTIAL':'UNAVAILABLE';
    const snapshot={schema:'BLUE_ROTATION_LEADERS_V1',receipt_day:receipt,observed_at_utc:now.toISOString(),master_receipt_day:master.receipt_day,master_observed_at_utc:master.observed_at_utc,master_hashes:master.hashes,
      trend_receipt_day:trend.receipt_day,trend_sha256:tr.payload_sha256,day,latest_trend_day,reference_basis,reference5:dates[5],reference10:dates[10],signal_status:signalStatus,mapping_status,thresholds,sector_limit:sectorsLimit,markets};
    const summary={status:mode==='inspect'?'INSPECT_ONLY':'OK',day,latest_trend_day,reference_basis,master_receipt_day:master.receipt_day,signal_status:signalStatus,mapping_status,turso_reads:reads,
      markets:markets.map(m=>({market:m.market,improving:m.improving,analyzed:m.analyzed,master_members:m.master_members,matched_members:m.matched_members,
        mapped_groups:m.groups.filter(g=>g.members>0).length,leaders:m.groups.reduce((a,g)=>a+g.leaders.length,0),followers:m.groups.reduce((a,g)=>a+g.followers.length,0),new_entries:m.groups.filter(g=>g.entry==='NEW_ENTRY').length}))};
    console.log('BLUE_LEADERS_ANALYSIS_READY',JSON.stringify({...summary,status:'CALCULATED_NOT_STORED'}));
    if(mode==='apply'){
      if(mapping_status==='UNAVAILABLE')return {...summary,status:'NO_MAPPED_IMPROVING_GROUPS'};
      await publishLeaders(snapshot,factory,{url,authToken,intMode:'string'});
    }
    return summary;
  }finally{if(!readClosed)try{db.close();}catch{/* preserve original analysis or storage outcome */}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{const mode=process.argv[2]||'plan',master=mode==='plan'?null:JSON.parse(await readFile(process.argv[3],'utf8'));
    const r=await captureLeaders(process.env,{mode,master});console.log('BLUE_ROTATION_LEADERS',JSON.stringify(r));if(!['PLAN_ONLY','INSPECT_ONLY','OK'].includes(r.status))process.exitCode=1;
  }catch(e){console.error('BLUE_ROTATION_LEADERS_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:leaderStorageFailure('RUNTIME',e));process.exitCode=1;}
}

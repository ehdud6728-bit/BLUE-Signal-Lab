/** Prospective rotation observation archive. No retrospective entry before recording.
 * Archive the first current-day receipt once. Read exact audited dates only;
 * these are observation offsets, not a verified complete exchange calendar.
 */
import {createClient} from '@libsql/client';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const sha=s=>createHash('sha256').update(s).digest('hex');
const day=v=>typeof v==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const kst=t=>new Date(t.getTime()+32400000).toISOString().slice(0,10);
const check=(ok,code)=>{if(!ok)throw Error(code)};
const price=v=>v!==null&&v!==undefined&&/^\d+$/.test(String(v))&&Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
const horizons=[1,3,5,10,20];
const archiveTable='blue_rotation_observations_v1';
const reportTable='blue_rotation_outcomes_v1';
export function decodeSnapshot(row){
 const raw=String(row.payload_json);
 check(sha(raw)===row.payload_sha256,'ROTATION_ARCHIVE_HASH_MISMATCH');
 const s=JSON.parse(raw);
 check(s.schema==='BLUE_ROTATION_LEADERS_V1'&&s.receipt_day===row.receipt_day&&s.observed_at_utc===row.observed_at_utc&&day(s.receipt_day)&&day(s.day)&&s.day<=s.receipt_day&&Number.isFinite(Date.parse(s.observed_at_utc))&&kst(new Date(s.observed_at_utc))===s.receipt_day&&['COMPLETE','PARTIAL','NO_IMPROVING_GROUPS'].includes(s.mapping_status)&&Array.isArray(s.markets)&&s.markets.length===2,'ROTATION_ARCHIVE_INVALID');
 const candidates=[],seen=new Set(),markets=new Set();
 for(const m of s.markets){
  check(['KOSPI','KOSDAQ'].includes(m.market)&&!markets.has(m.market)&&Array.isArray(m.groups)&&m.groups.length<=12,'ROTATION_ARCHIVE_MARKET_INVALID');markets.add(m.market);
  for(const g of m.groups){
   check(/^\d{4,5}$/.test(g.code)&&typeof g.name==='string'&&g.name.length<=70&&['NEW_ENTRY','CONTINUING','UNKNOWN'].includes(g.entry)&&Array.isArray(g.leaders)&&Array.isArray(g.followers)&&g.leaders.length<=3&&g.followers.length<=3,'ROTATION_ARCHIVE_GROUP_INVALID');
   for(const [role,list] of [['LEADER',g.leaders],['FOLLOWER',g.followers]]){
    for(const x of list){
     const id=m.market+'/'+g.code+'/'+x.code;
     check(/^[0-9A-Z]{6}$/.test(x.code)&&!seen.has(id)&&price(x.close)!==null&&typeof x.name==='string'&&x.name.length<=100,'ROTATION_ARCHIVE_STOCK_INVALID');seen.add(id);
     candidates.push({market:m.market,sector_code:g.code,sector_name:g.name,entry_type:g.entry,role,code:x.code,name:x.name,signal_close:Number(x.close),r5:x.r5,r10:x.r10,amount_ratio:x.amount_ratio,signals:x.signals});
    }
   }
  }
 }
 return {receipt_day:s.receipt_day,source_day:s.day,source_observed_at:s.observed_at_utc,source_sha256:row.payload_sha256,mapping_status:s.mapping_status,candidates};
}
export function calculateOutcomes(archives,dates,bars){
 const out=[];
 for(const a of archives){
  const first=dates.findIndex(d=>d>a.recorded_day);
  for(const c of a.candidates){
   const get=d=>price(bars.get(d+'/'+c.market+'/'+c.code));
   const entry=first<0?null:dates[first],entryPrice=entry?get(entry):null;
   const results=horizons.map(h=>{
    const target=first<0||first+h>=dates.length?null:dates[first+h];
    const end=target?get(target):null;
    const status=!entry?'WAITING_ENTRY':entryPrice===null?'MISSING_ENTRY_PRICE':!target?'WAITING_HORIZON':end===null?'MISSING_END_PRICE':'OBSERVED';
    return {horizon:h,target_day:target,end_close:end,status,return_pct:status==='OBSERVED'?Math.round(1000000*(end-entryPrice)/entryPrice)/10000:null};
   });
   out.push({...c,recorded_day:a.recorded_day,recorded_at:a.recorded_at,source_day:a.source_day,source_sha256:a.source_sha256,entry_day:entry,entry_close:entryPrice,results});
  }
 }
 return out;
}
const aggregate=rows=>horizons.flatMap(h=>['LEADER','FOLLOWER'].map(role=>{
 const relevant=rows.filter(r=>r.role===role);const v=relevant.map(r=>r.results.find(x=>x.horizon===h)).filter(x=>x.status==='OBSERVED').map(x=>x.return_pct).sort((a,b)=>a-b);
 return {role,horizon:h,candidates:relevant.length,observed:v.length,waiting_or_missing:relevant.length-v.length,positive_pct:v.length?Math.round(10000*v.filter(x=>x>0).length/v.length)/100:null,mean_pct:v.length?Math.round(10000*v.reduce((s,x)=>s+x,0)/v.length)/10000:null,median_pct:v.length?(v[Math.floor((v.length-1)/2)]+v[Math.floor(v.length/2)])/2:null};
}));
export async function track(env=process.env,{mode='inspect',now=new Date(),factory=createClient}={}){
 check(['inspect','apply'].includes(mode),'ROTATION_OUTCOME_MODE_INVALID');
 const today=kst(now),at=now.toISOString(),url=String(env.TURSO_DATABASE_URL||''),authToken=String(env.TURSO_AUTH_TOKEN||'');
 check(/^(libsql|https):\/\//.test(url)&&authToken,'ROTATION_OUTCOME_DB_MISSING');
 const db=factory({url,authToken,intMode:'string'});let reads=0,writes=0;
 const read=async(sql,args=[])=>{reads++;return (await db.execute({sql,args})).rows};
 const write=async(sql,args=[])=>{writes++;return db.execute({sql,args})};
 try{
  const tables=await read("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('blue_rotation_leaders_v1','blue_rotation_observations_v1','blue_rotation_outcomes_v1')");
  const names=new Set(tables.map(r=>r.name));
  const latest=names.has('blue_rotation_leaders_v1')?(await read('SELECT receipt_day,observed_at_utc,payload_json,payload_sha256 FROM blue_rotation_leaders_v1 WHERE receipt_day=?',[today]))[0]:null;
  let candidate=null;
  if(latest){const a=decodeSnapshot(latest);check(Date.parse(a.source_observed_at)<=now.getTime(),'ROTATION_FUTURE_CAPTURE');candidate={...a,recorded_day:today,recorded_at:at};}
  const load=async()=>names.has(archiveTable)?await read('SELECT receipt_day,source_observed_at,payload_json,payload_sha256,recorded_at FROM '+archiveTable+' ORDER BY receipt_day DESC LIMIT 60'):[];
  let saved=await load();
  const already=saved.some(x=>x.receipt_day===today);
  if(mode==='apply'&&latest&&!already){
   await write('CREATE TABLE IF NOT EXISTS '+archiveTable+' (receipt_day TEXT PRIMARY KEY,source_observed_at TEXT NOT NULL,payload_json TEXT NOT NULL,payload_sha256 TEXT NOT NULL,recorded_at TEXT NOT NULL)');
   await write('INSERT INTO '+archiveTable+'(receipt_day,source_observed_at,payload_json,payload_sha256,recorded_at) VALUES(?,?,?,?,?) ON CONFLICT(receipt_day) DO NOTHING',[today,latest.observed_at_utc,latest.payload_json,latest.payload_sha256,at]);
   names.add(archiveTable);saved=await load();
   const proof=saved.find(x=>x.receipt_day===today);
   check(proof&&proof.payload_sha256===latest.payload_sha256&&proof.payload_json===latest.payload_json&&proof.recorded_at===at,'ROTATION_ARCHIVE_READBACK_MISMATCH');
  }
  const archives=saved.map(r=>{
   const a=decodeSnapshot({...r,observed_at_utc:r.source_observed_at});
   check(Number.isFinite(Date.parse(r.recorded_at))&&kst(new Date(r.recorded_at))===a.receipt_day&&Date.parse(r.recorded_at)>=Date.parse(a.source_observed_at)&&Date.parse(r.recorded_at)<=now.getTime(),'ROTATION_ARCHIVE_TIMESTAMP_INVALID');
   return {...a,recorded_day:a.receipt_day,recorded_at:r.recorded_at};
  });
  // Inspect never pretends to save or include a candidate in the prospective cohort.
  const oldest=archives.map(a=>a.recorded_day).sort()[0];
  const dates=[],bars=new Map();
  if(oldest){
   const audited=await read("SELECT trade_day,row_count,source,day_sha256 FROM blue_eod_ingest_audit_v1 WHERE trade_day>? AND trade_day<=? ORDER BY trade_day LIMIT 201",[oldest,today]);
   check(audited.length<=200,'ROTATION_AUDIT_LIMIT');
   if(audited.length){
    const counts=await read('SELECT trade_day,COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day>? AND trade_day<=? GROUP BY trade_day',[oldest,today]);
    const countsByDay=new Map(counts.map(r=>[r.trade_day,Number(r.n)]));
    check(counts.length===audited.length,'ROTATION_EOD_UNAUDITED_DAY');
    for(const r of audited){
     check(day(r.trade_day)&&Number(r.row_count)>=1700&&Number(r.row_count)<=10000&&['KRX_PYKRX_EXACT_DAY_VERIFIED','KRX_OPENAPI_EXACT_DAY_VERIFIED'].includes(r.source)&&/^[a-f0-9]{64}$/.test(r.day_sha256)&&countsByDay.get(r.trade_day)===Number(r.row_count),'ROTATION_EOD_AUDIT_MISMATCH');dates.push(r.trade_day);
    }
    const wanted=[...new Set(archives.flatMap(a=>a.candidates.map(c=>c.code)))];
    for(let i=0;i<wanted.length;i+=30){
     const codes=wanted.slice(i,i+30);
     // Bound response rows; exact dates, no per-symbol LAG or missing-day fallback.
     for(let j=0;j<dates.length;j+=20){
      const ds=dates.slice(j,j+20);
      const rs=await read('SELECT trade_day,market,code,close FROM blue_eod_daily_v1 WHERE trade_day IN ('+ds.map(()=>'?').join(',')+') AND code IN ('+codes.map(()=>'?').join(',')+')',[...ds,...codes]);
      for(const r of rs){const key=r.trade_day+'/'+r.market+'/'+r.code;check(ds.includes(r.trade_day)&&codes.includes(r.code)&&['KOSPI','KOSDAQ'].includes(r.market)&&!bars.has(key)&&price(r.close)!==null,'ROTATION_OUTCOME_BAR_INVALID');bars.set(key,r.close);}
     }
    }
   }else{
    const stray=await read('SELECT trade_day FROM blue_eod_daily_v1 WHERE trade_day>? AND trade_day<=? LIMIT 1',[oldest,today]);check(!stray.length,'ROTATION_EOD_UNAUDITED_DAY');
   }
  }
  const rows=calculateOutcomes(archives,dates,bars);
  const summary={status:mode==='apply'?'OK':'INSPECT_ONLY',asof:dates.at(-1)??null,receipt_day:today,archived_receipts:archives.length,today_snapshot_available:!!candidate,today_already_archived:already,today_candidate_count:candidate?.candidates.length??0,observations:rows.length,unique_codes:new Set(rows.map(x=>x.market+'/'+x.code)).size,results:aggregate(rows),calendar_verified:false,corporate_actions_verified:false,entry_basis:'FIRST_AUDITED_CLOSE_STRICTLY_AFTER_RECORDING_DAY',scope:'RECENT_60_ARCHIVED_RECEIPTS'};
  if(mode==='apply'){
   // Private database only, not an Actions artifact or public raw prices.
   const report=JSON.stringify({schema:'BLUE_ROTATION_OUTCOMES_V1',...summary,generated_at:at,rows});
   check(Buffer.byteLength(report)<=8000000,'ROTATION_REPORT_LIMIT');
   const digest=sha(report);
   await write('CREATE TABLE IF NOT EXISTS '+reportTable+' (receipt_day TEXT PRIMARY KEY,generated_at TEXT NOT NULL,payload_json TEXT NOT NULL,payload_sha256 TEXT NOT NULL)');
   await write('INSERT INTO '+reportTable+'(receipt_day,generated_at,payload_json,payload_sha256) VALUES(?,?,?,?) ON CONFLICT(receipt_day) DO UPDATE SET generated_at=excluded.generated_at,payload_json=excluded.payload_json,payload_sha256=excluded.payload_sha256 WHERE excluded.generated_at>'+reportTable+'.generated_at',[today,at,report,digest]);
   const proof=(await read('SELECT payload_json,payload_sha256 FROM '+reportTable+' WHERE receipt_day=?',[today]))[0];
   check(proof&&proof.payload_json===report&&proof.payload_sha256===digest,'ROTATION_REPORT_READBACK_MISMATCH');
  }
  return {...summary,turso_reads:reads,turso_writes:writes};
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{const r=await track(process.env,{mode:process.argv[2]||'inspect'});console.log('BLUE_ROTATION_OUTCOMES',JSON.stringify(r));}
 catch(e){console.error('BLUE_ROTATION_OUTCOMES_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1;}
}

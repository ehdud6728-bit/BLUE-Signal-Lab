/** Read only: reconstruct exact saved R1.1 records, then reproduce UI-selected setup.
 * Never infer a tomato from price changes or from an absent stored record.
 */
import {createClient} from '@libsql/client';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const sha=x=>createHash('sha256').update(x).digest('hex');
const HASH=/^[a-f0-9]{64}$/;
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const FACTOR=/^[A-Z0-9_]{2,60}$/;
export function selectedSetup(stats,day,{floor=8,threshold=70}={}){
 if(!stats||stats.version!=='R10_MULTIFACTOR_V2'||stats.asof!==day||!DAY.test(stats.history_end||'')||stats.history_end>day||!Array.isArray(stats.setups)||stats.setups.length>12)return {status:'UNAVAILABLE'};
 if(stats.status!=='EXPLORATORY')return {status:'UNAVAILABLE'};
 const best=stats.setups.filter(s=>{const h=s?.horizons?.['10'];return Number.isInteger(Number(h?.n))&&Number(h.n)>=floor&&typeof h.up_pct==='number'&&h.up_pct>=0&&h.up_pct<=100;}).sort((a,b)=>Number(b.horizons['10'].up_pct)-Number(a.horizons['10'].up_pct)||Number(b.horizons['10'].median_return_pct||0)-Number(a.horizons['10'].median_return_pct||0)||Number(b.horizons['10'].mean_return_pct||0)-Number(a.horizons['10'].mean_return_pct||0)||Number(b.horizons['10'].n)-Number(a.horizons['10'].n))[0];
 if(!best)return {status:'NO_ELIGIBLE_SETUP'};
 const h=best.horizons['10'],f=best.factors,active=new Set((stats.active_factors||[]).map(x=>x.code));
 check(Array.isArray(f)&&f.length>=1&&f.length<=4&&new Set(f).size===f.length&&f.every(x=>FACTOR.test(x)&&active.has(x))&&best.code===f.join('+')&&Number.isFinite(h.median_return_pct)&&Number.isFinite(h.mean_return_pct),'TOMATO_INVALID_SETUP');
 return {status:h.up_pct>=threshold?'TOMATO':'BELOW_THRESHOLD',setup:best.code,factors:f,label:String(best.label||'').slice(0,150),n:Number(h.n),up:h.up_pct,median:h.median_return_pct,mean:h.mean_return_pct};
}
export function selectDays(src,bench){
 check(src.original_eod_hashes_recomputed===true&&src.cutoff===bench.cutoff,'TOMATO_SOURCE_REQUIRED');
 const ds=src.days.map(x=>x.day),eligible=src.days.filter(x=>x.signal_status==='COUNT_AND_PAYLOAD_HASH_METADATA_MATCH').map(x=>x.day);
 const index=bench.markets.map(m=>m.days.map(x=>x.day));
 check(index.length===2,'TOMATO_INDEX_REQUIRED');
 const matured=eligible.filter(d=>index.every(seq=>{const i=seq.indexOf(d);return i>=0&&seq.length>i+10&&seq.slice(i+1,i+11).every(x=>ds.includes(x));}));
 return [...new Set([...matured.slice(-3),ds.at(-1)])].sort();
}
export async function readTomatoDay(db,day,src){
 const meta=src.days.find(d=>d.day===day);
 if(meta?.signal_status!=='COUNT_AND_PAYLOAD_HASH_METADATA_MATCH')return {day,status:'SIGNAL_AUDIT_UNAVAILABLE',rows:[]};
 const a=(await db.execute({sql:'SELECT row_count,observed_stocks,signal_events,source_payload_sha256 FROM blue_research_signal_audit_v1 WHERE trade_day=?',args:[day]})).rows;
 check(a.length===1&&Number(a[0].observed_stocks)===meta.rows&&HASH.test(a[0].source_payload_sha256),'TOMATO_AUDIT_MISMATCH');
 const count=Number(a[0].row_count);check(Number.isSafeInteger(count)&&count>=0&&count<=meta.rows,'TOMATO_COUNT_MISMATCH');
 const eod=new Map(src.bars.filter(b=>b.day===day).map(b=>[b.code,b]));
 const digest=createHash('sha256');const result=[];let last='',events=0,bytes=0;
 for(let offset=0;offset<=count;offset+=5){
  const page=(await db.execute({sql:'SELECT code,record_json,row_sha256,source_payload_sha256,signal_names,close_price FROM blue_research_signals_v1 WHERE trade_day=? ORDER BY code LIMIT 5 OFFSET ?',args:[day,offset]})).rows;
  for(const r of page){
   const raw=String(r.record_json);bytes+=Buffer.byteLength(raw)+1;
   check(bytes<=64000000&&r.code>last&&sha(raw)===r.row_sha256&&r.source_payload_sha256===a[0].source_payload_sha256,'TOMATO_ROW_HASH_MISMATCH');
   digest.update(raw+'\n');last=r.code;const v=JSON.parse(raw),b=eod.get(r.code);
   check(b&&v.trade_day===day&&v.code===r.code&&v.signal_names===r.signal_names&&v.close_price===b.close&&Number(r.close_price)===b.close&&v.chart?.asof===day&&v.chart?.bars?.at(-1)?.t===day&&v.chart.bars.at(-1).c===b.close,'TOMATO_EOD_MISMATCH');
   const names=r.signal_names.split(',');events+=names.length;
   const e=v.extras||{},num=x=>typeof x==='number'||typeof x==='string'&&x.trim()?Number(x):NaN;
   const ma=[num(e.ma20),num(e.ma40),num(e.ma60)];
   const arrangement=ma.every(x=>Number.isFinite(x)&&x>0)?ma[0]<ma[1]&&ma[1]<ma[2]?'DOWN':ma[0]>ma[1]&&ma[1]>ma[2]?'UP':'MIXED':'UNKNOWN';
   const ratio=num(e.amount_ratio20);
   result.push({code:r.code,market:b.market,selection:selectedSetup(v.stats,day),stored_ma_arrangement:arrangement,stored_amount_ratio:Number.isFinite(ratio)&&ratio>=0?ratio:null,row_sha256:r.row_sha256});
  }
  check(result.length<=count,'TOMATO_COUNT_MISMATCH');if(page.length<5)break;
 }
 check(result.length===count&&events===Number(a[0].signal_events)&&digest.digest('hex')===a[0].source_payload_sha256,'TOMATO_PAYLOAD_HASH_MISMATCH');
 return {day,status:'ORIGINAL_SIGNAL_PAYLOAD_HASH_MATCH',rows:result,source_payload_sha256:a[0].source_payload_sha256};
}
async function main(){
 const src=JSON.parse(await readFile('output/full-universe/source.json','utf8')),bench=JSON.parse(await readFile('output/full-universe/benchmark.json','utf8'));
 const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
 try{
  const days=[];for(const d of selectDays(src,bench))days.push(await readTomatoDay(db,d,src));
  await mkdir('output/tomato',{recursive:true});await writeFile('output/tomato/source.json',JSON.stringify({schema:'BLUE_TOMATO_CONTEXT_SOURCE_V1',cutoff:src.cutoff,floor:8,threshold:70,days})+'\n');
  console.log('BLUE_TOMATO_SOURCE',JSON.stringify({days:days.map(d=>({day:d.day,status:d.status,rows:d.rows.length})),writes:0}));
 }finally{db.close();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href)main().catch(e=>{console.error('BLUE_TOMATO_FAILED',/^TOMATO_[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1;});

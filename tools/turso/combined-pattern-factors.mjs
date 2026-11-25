/** Read-only point-in-time factor evidence for the two envelope signal families.
 * The saved scanner factors are NOT independently verified technical indicators.
 * Raw stored records are verified by SHA and never exported to artifacts.
 */
import {createClient} from '@libsql/client';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const sha=x=>createHash('sha256').update(x).digest('hex');
const bases=new Set(['ENV20','ENV20_LOWER_TOUCH']);
const check=(ok,why)=>{if(!ok)throw Error(why)};
const number=x=>typeof x==='number'||typeof x==='string'&&/^\d+(?:\.\d+)?$/.test(x)?Number(x):NaN;
const bool=x=>x===true||x==='True'||x==='true'||x==='1'||x===1?true:x===false||x==='False'||x==='false'||x==='0'||x===0?false:null;
export function evidence(row,signal,bar){
 const raw=String(row.record_json);
 check(sha(raw)===row.row_sha256,'COMBINED_RECORD_HASH_MISMATCH');
 const r=JSON.parse(raw);
 check(row.trade_day===signal.day&&row.code===signal.code&&r.trade_day===signal.day&&r.code===signal.code&&r.signal_names===signal.names.join(',')&&Number(row.close_price)===bar.close&&r.close_price===bar.close&&r.chart?.asof===signal.day,'COMBINED_IDENTITY_MISMATCH');
 const e=r.extras??{},chart=r.chart?.bars??[],last=chart.at(-1);
 check(last?.t===signal.day&&Number(last.c)===bar.close,'COMBINED_CHART_MISMATCH');
 // Candles in the study are from audited KRX, not from chart snapshots.
 const a=[e.ma20,e.ma40,e.ma60].map(number);
 let ma=a.every(v=>Number.isFinite(v)&&v>0)?a[0]<a[1]&&a[1]<a[2]:null;
 // Check the rolling means against the chart's own closes; its earlier bars
 // have not been independently matched to the audited KRX dataset.
 let maChart=null;
 if(chart.length>=60){
  const recent=chart.slice(-60);
  if(recent.every((b,i)=>typeof b.t==='string'&&(!i||b.t>recent[i-1].t)&&Number.isFinite(number(b.c))&&number(b.c)>0)){
   const m=[20,40,60].map(n=>recent.slice(-n).reduce((s,b)=>s+number(b.c),0)/n);
   if(a.every(v=>Number.isFinite(v)&&v>0)){
    maChart=m.every((v,i)=>Math.abs(v-a[i])<=0.011);
    if(!maChart||ma!==(m[0]<m[1]&&m[1]<m[2]))ma=null;
   }
  }
 }
 let rsi=bool(e.rsi_gc),rsiChart=null;
 const prev=chart.at(-2);
 const vals=[prev?.r,prev?.rs,last?.r,last?.rs].map(number);
 if(vals.every(v=>Number.isFinite(v)&&v>=0&&v<=100)){
  // Chart displays two decimals. At equality/near-boundary it cannot prove a cross.
  if(Math.abs(vals[0]-vals[1])>0.011&&Math.abs(vals[2]-vals[3])>0.011){
   const cross=vals[0]<vals[1]&&vals[2]>vals[3];
   if(rsi!==null){rsiChart=rsi===cross;if(!rsiChart)rsi=null;}
  }
 }
 return {day:signal.day,code:signal.code,rsi_gc:rsi,ma_down:ma,ma_chart_consistent:maChart,rsi_chart_consistent:rsiChart,record_sha256:row.row_sha256};
}
export async function exportFactors(client,source){
 check(source.format==='BLUE_TURSO_EXIT_SOURCE_V1'&&source.audits_readback_verified===true,'COMBINED_SOURCE_INVALID');
 const expected=source.signals.filter(s=>s.names.some(p=>bases.has(p)));
 check(expected.length<=8000,'COMBINED_FACTOR_LIMIT');
 const bars=new Map(source.bars.map(b=>[b.day+'/'+b.code,b]));
 const factors=[];
 // Small pages: full row JSON is needed for hash verification, but is never persisted.
 for(let i=0;i<expected.length;i+=5){
  const chunk=expected.slice(i,i+5);
  const rs=await client.execute({sql:'SELECT s.trade_day,s.code,s.close_price,s.record_json,s.row_sha256 FROM blue_research_signals_v1 s JOIN blue_research_signal_audit_v1 a ON a.trade_day=s.trade_day AND a.source_payload_sha256=s.source_payload_sha256 WHERE '+chunk.map(()=>'(s.trade_day=? AND s.code=?)').join(' OR '),args:chunk.flatMap(s=>[s.day,s.code])});
  check(rs.rows.length===chunk.length,'COMBINED_FACTOR_COUNT_MISMATCH');
  for(const s of chunk){
   const r=rs.rows.find(r=>r.trade_day===s.day&&r.code===s.code),b=bars.get(s.day+'/'+s.code);
   check(r&&b,'COMBINED_FACTOR_MISSING');
   factors.push(evidence(r,s,b));
  }
 }
 return {format:'BLUE_COMBINED_FACTORS_V1',asof:source.asof_day,scope:'HASH_VERIFIED_STORED_FACTORS_NOT_INDEPENDENT_INDICATOR_PROOF',rows:factors};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let db;
 try{
  const [input,output]=process.argv.slice(2),source=JSON.parse(await readFile(input,'utf8'));
  db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
  const data=await exportFactors(db,source);
  await writeFile(output,JSON.stringify(data)+'\n');
  console.log('BLUE_COMBINED_FACTORS',JSON.stringify({asof:data.asof,rows:data.rows.length,scope:data.scope,rsi_known:data.rows.filter(x=>x.rsi_gc!==null).length,ma_known:data.rows.filter(x=>x.ma_down!==null).length}));
 }catch(e){console.error('BLUE_COMBINED_FACTORS_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1;}
 finally{db?.close();}
}

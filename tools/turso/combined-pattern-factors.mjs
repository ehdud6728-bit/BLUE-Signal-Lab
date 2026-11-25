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
export function evidence(row,signal,bar,{details=false}={}){
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
 const base={day:signal.day,code:signal.code,rsi_gc:rsi,ma_down:ma,ma_chart_consistent:maChart,rsi_chart_consistent:rsiChart,record_sha256:row.row_sha256};
 if(!details)return base;
 const validR=x=>{const v=number(x);return Number.isFinite(v)&&v>=0&&v<=100?v:null};
 const current=validR(e.rsi),sig=validR(e.rsi_signal);
 const chartR=validR(last?.r),chartS=validR(last?.rs);
 // Stored extras have five decimals; archived chart displays two decimals.
 const same=current!==null&&sig!==null&&chartR!==null&&chartS!==null?Math.abs(current-chartR)<=.0051&&Math.abs(sig-chartS)<=.0051:null;
 const historyOk=chart.slice(-6).every((b,i,a)=>typeof b.t==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(b.t)&&(!i||b.t>a[i-1].t));
 const at=n=>historyOk?validR(chart.at(-1-n)?.r):null;
 const atDay=n=>historyOk?chart.at(-1-n)?.t??null:null;
 const history=historyOk?chart.slice(-6,-1).map(b=>validR(b.r)):[];
 const delta=n=>current!==null&&at(n)!==null?Math.round((current-at(n))*1000)/1000:null;
 const priorR=historyOk?validR(prev?.r):null,priorS=historyOk?validR(prev?.rs):null;
 const observedCross=priorR!==null&&priorS!==null&&current!==null&&sig!==null&&Math.abs(priorR-priorS)>.011&&Math.abs(current-sig)>.011?priorR<priorS&&current>sig:null;
 const sameCross=observedCross!==null&&rsi!==null?observedCross===rsi:null;
 const usable=same!==false&&sameCross!==false;
 // Do not overwrite the original cohort flag; mark detailed values ineligible
 // separately if their stored evidence conflicts.
 const val=x=>usable?x:null;
 return {...base,rsi_value:val(current),rsi_signal:val(sig),prior_rsi:val(priorR),prior_rsi_signal:val(priorS),prior_day:val(atDay(1)),rsi_delta3_day:val(atDay(3)),rsi_delta5_day:val(atDay(5)),
   rsi_delta3:val(delta(3)),rsi_delta5:val(delta(5)),rsi_gap:val(current!==null&&sig!==null?Math.round((current-sig)*1000)/1000:null),
   rsi_prior5_min:val(history.length===5&&history.every(x=>x!==null)?Math.min(...history):null),
   rsi_value_chart_consistent:same,rsi_cross_value_consistent:sameCross,
   ma20:Number.isFinite(a[0])&&a[0]>0?a[0]:null,ma40:Number.isFinite(a[1])&&a[1]>0?a[1]:null,ma60:Number.isFinite(a[2])&&a[2]>0?a[2]:null,
   amount_ratio20:Number.isFinite(number(e.amount_ratio20))&&number(e.amount_ratio20)>=0?number(e.amount_ratio20):null};
}
export async function exportFactors(client,source,{details=false}={}){
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
   factors.push(evidence(r,s,b,{details}));
  }
 }
 const data={format:'BLUE_COMBINED_FACTORS_V1',asof:source.asof_day,scope:'HASH_VERIFIED_STORED_FACTORS_NOT_INDEPENDENT_INDICATOR_PROOF',rows:factors};
 if(details){const keys=['day','code','rsi_gc','ma_down','ma_chart_consistent','rsi_chart_consistent','record_sha256'];data.legacy_factors_sha256=sha(JSON.stringify({...data,rows:factors.map(f=>Object.fromEntries(keys.map(k=>[k,f[k]])))})+'\n');}
 return data;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let db;
 try{
  const [input,output]=process.argv.slice(2),source=JSON.parse(await readFile(input,'utf8'));
  db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
  const data=await exportFactors(db,source,{details:process.argv.includes('--details')});
  await writeFile(output,JSON.stringify(data)+'\n');
  console.log('BLUE_COMBINED_FACTORS',JSON.stringify({asof:data.asof,rows:data.rows.length,scope:data.scope,rsi_known:data.rows.filter(x=>x.rsi_gc!==null).length,ma_known:data.rows.filter(x=>x.ma_down!==null).length}));
 }catch(e){console.error('BLUE_COMBINED_FACTORS_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1;}
 finally{db?.close();}
}

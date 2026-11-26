/** Exact stored ENV20_LOWER_TOUCH factor evidence, read only.
 * Reuse the established combined evidence validator, not a new MA definition. */
import {createClient} from '@libsql/client';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {evidence} from './combined-pattern-factors.mjs';
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
export async function readFactors(db,src){
 check(src.schema==='BLUE_FULL_UNIVERSE_SOURCE_V1'&&src.original_eod_hashes_recomputed===true,'PULLBACK_SOURCE_REQUIRED');
 const days=new Map(src.days.map(d=>[d.day,d])),bars=new Map(src.bars.map(b=>[b.day+'/'+b.code,b]));
 const signals=src.signals.filter(s=>s.names.includes('ENV20_LOWER_TOUCH'));
 check(signals.length<=8000&&new Set(signals.map(s=>s.day+'/'+s.code)).size===signals.length,'PULLBACK_FACTOR_CAP');
 const rows=[];
 for(let i=0;i<signals.length;i+=5){
  const chunk=signals.slice(i,i+5);
  const r=await db.execute({sql:'SELECT s.trade_day,s.code,s.close_price,s.record_json,s.row_sha256 FROM blue_research_signals_v1 s JOIN blue_research_signal_audit_v1 a ON a.trade_day=s.trade_day AND a.source_payload_sha256=s.source_payload_sha256 WHERE '+chunk.map(()=>'(s.trade_day=? AND s.code=?)').join(' OR '),args:chunk.flatMap(s=>[s.day,s.code])});
  check(r.rows.length===chunk.length,'PULLBACK_FACTOR_COUNT');
  for(const s of chunk){
   const x=r.rows.filter(z=>z.trade_day===s.day&&z.code===s.code),b=bars.get(s.day+'/'+s.code);
   check(x.length===1&&b&&days.get(s.day)?.signal_status==='COUNT_AND_PAYLOAD_HASH_METADATA_MATCH','PULLBACK_FACTOR_MISSING');
   const e=evidence(x[0],s,b);
   rows.push({day:e.day,code:e.code,ma_down:e.ma_down,ma_chart_consistent:e.ma_chart_consistent,record_sha256:e.record_sha256});
  }
 }
 return {schema:'BLUE_ENV20_PULLBACK_FACTORS_V1',cutoff:src.cutoff,rows};
}
async function main(){
 const src=JSON.parse(await readFile('output/full-universe/source.json','utf8')),db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
 try{const r=await readFactors(db,src);await writeFile('output/full-universe/pullback-factors.json',JSON.stringify(r)+'\n');console.log('BLUE_ENV20_PULLBACK_FACTORS',JSON.stringify({rows:r.rows.length,stored_inverse:r.rows.filter(x=>x.ma_down===true).length,chart_consistent_inverse:r.rows.filter(x=>x.ma_down===true&&x.ma_chart_consistent===true).length,unknown:r.rows.filter(x=>x.ma_down===null).length,writes:0}));}finally{db.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{console.error('BLUE_ENV20_PULLBACK_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1});

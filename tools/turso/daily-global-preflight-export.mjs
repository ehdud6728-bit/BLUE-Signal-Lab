/** Read-only, reconstitute original audited KRX days for private local preflight. */
import {createClient} from '@libsql/client';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {reconstructVerifiedDay} from './research-v2-eod-export.mjs';
const start='2026-10-12',end='2026-11-27';
async function run(){
 const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
 const out='output/global-preflight/private-eod';let count=0;
 const select=async(sql,args)=>{if(!/^SELECT\b/i.test(sql))throw Error('SELECT_ONLY');return (await db.execute({sql,args})).rows};
 try{
  for(let d=new Date(start+'T00:00:00Z');d.toISOString().slice(0,10)<=end;d.setUTCDate(d.getUTCDate()+1)){
   if(d.getUTCDay()===0||d.getUTCDay()===6)continue;
   const day=d.toISOString().slice(0,10);
   const a=await select('SELECT trade_day,row_count,source,day_sha256 FROM blue_eod_ingest_audit_v1 WHERE trade_day=?',[day]);
   if(a.length!==1)throw Error('GLOBAL_PREFLIGHT_MISSING_EOD');
   const rows=await select('SELECT trade_day,code,market,name,open,high,low,close,volume,amount,source FROM blue_eod_daily_v1 WHERE trade_day=? ORDER BY code',[day]);
   const {manifest,payload}=reconstructVerifiedDay(day,a[0],rows);
   const dir=join(out,day);await mkdir(dir,{recursive:true});
   await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest)+'\n');await writeFile(join(dir,'daily.jsonl'),payload);count++;
  }
  console.log('BLUE_GLOBAL_PREFLIGHT_EOD',JSON.stringify({days:count,writes:0}));
 }finally{db.close()}
}
run().catch(()=>{console.error('BLUE_GLOBAL_PREFLIGHT_SOURCE_FAILED');process.exitCode=1});

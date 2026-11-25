/** Bounded read-only preflight for scheduled/manual provisional publication. */
import {createClient} from '@libsql/client';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
export async function publicationGate(db,now=new Date(),{scheduled=false}={}){
 const kst=new Date(now.getTime()+32400000),day=kst.toISOString().slice(0,10),clock=kst.toISOString().slice(11,16);
 if(kst.getUTCDay()===0||kst.getUTCDay()===6||clock<'09:00'||clock>='22:00')return {ready:false,day,reason:'OUTSIDE_PUBLICATION_WINDOW'};
 const q=async(sql,args=[])=>(await db.execute({sql,args})).rows;
 const audited=async(row)=>{
  const expected=Number(row.row_count);
  const actual=Number((await q('SELECT COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day=?',[String(row.trade_day)]))[0]?.n);
  if(!Number.isSafeInteger(expected)||expected<1700||expected>10000||actual!==expected)throw Error('EOD_AUDIT_COUNT_MISMATCH');
 };
 const current=(await q('SELECT trade_day,row_count FROM blue_eod_ingest_audit_v1 WHERE trade_day=? AND row_count>=1700',[day]))[0];
 if(current){await audited(current);return {ready:false,day,reason:'EOD_ALREADY_AVAILABLE'};}
 const ref=(await q('SELECT trade_day,row_count FROM blue_eod_ingest_audit_v1 WHERE trade_day<? AND row_count>=1700 ORDER BY trade_day DESC LIMIT 1',[day]))[0];
 if(!ref)return {ready:false,day,reason:'NO_AUDITED_REFERENCE'};
 await audited(ref);
 if(!(await q("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_kis_provisional_daily_v1'")).length)return {ready:false,day,reason:'NO_QUOTE_TABLE'};
 const r=(await q("SELECT COUNT(*) AS n,MAX(observed_at_utc) AS latest FROM blue_kis_provisional_daily_v1 WHERE trade_day=? AND reference_day=? AND market='J' AND date_basis IN ('KIS_REPORTED_TRADE_DATE','COLLECTOR_KST_REGULAR_SESSION') AND source IN ('KIS_REST_INQUIRE_PRICE_PROVISIONAL','KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL')",[day,String(ref.trade_day)]))[0];
 const n=Number(r.n);
 if(!Number.isSafeInteger(n)||n<0||n>10000)throw Error('INVALID_QUOTE_COUNT');
 if(!n)return {ready:false,day,reason:'NO_CURRENT_QUOTES'};
 const latest=Date.parse(String(r.latest));
 if(!Number.isFinite(latest)||latest>now.getTime()+300000)throw Error('INVALID_QUOTE_TIME');
 if(scheduled&&now.getTime()-latest>60*60000)return {ready:false,day,reason:'STALE_QUOTES',n};
 // A recent intraday receipt is not eligible for a post-close daily scan.
 // Check the session before downloading history; the exporter still verifies
 // each payload, so this is only a conservative preflight.
 let effectiveLatest=latest;
 if(clock>='15:30'){
  const eligible=(await q("SELECT COUNT(*) AS n,MAX(observed_at_utc) AS latest FROM blue_kis_provisional_daily_v1 WHERE trade_day=? AND reference_day=? AND market='J' AND date_basis='KIS_REPORTED_TRADE_DATE' AND source='KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL' AND date(observed_at_utc,'+9 hours')=trade_day AND time(observed_at_utc,'+9 hours')>='15:30:00' AND julianday(observed_at_utc)<=julianday(?)",[day,String(ref.trade_day),now.toISOString()]))[0];
  const usable=Number(eligible.n);
  if(!Number.isSafeInteger(usable)||usable<0||usable>n)throw Error('INVALID_QUOTE_COUNT');
  if(!usable)return {ready:false,day,reason:'NO_POST_CLOSE_QUOTES',n};
  effectiveLatest=Date.parse(String(eligible.latest));
  if(!Number.isFinite(effectiveLatest))throw Error('INVALID_QUOTE_TIME');
  if(scheduled&&now.getTime()-effectiveLatest>60*60000)return {ready:false,day,reason:'STALE_POST_CLOSE_QUOTES',n};
 }
 if(scheduled&&(await q("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_provisional_pattern_head_v1'")).length){
  const head=(await q('SELECT latest_observed_utc FROM blue_provisional_pattern_head_v1 WHERE trade_day=? AND reference_day=?',[day,String(ref.trade_day)]))[0];
  if(head&&Date.parse(String(head.latest_observed_utc))>=effectiveLatest)return {ready:false,day,reason:'NO_NEW_QUOTES',n};
 }
 return {ready:true,day,reason:'CURRENT_QUOTES_AVAILABLE',n};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
 try{
  const r=await publicationGate(db,new Date(),{scheduled:process.env.GITHUB_EVENT_NAME==='schedule'});
  console.log('BLUE_PROVISIONAL_PUBLICATION_GATE',JSON.stringify(r));
  if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'ready='+String(r.ready)+'\n');
 }finally{db.close();}
}

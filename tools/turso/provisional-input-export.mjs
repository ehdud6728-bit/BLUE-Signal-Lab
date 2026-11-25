/** Read-only input bridge. Export exact saved KIS turnover and audited EOD history.
 * Fail closed on incomplete history; no DB writes or inferred turnover.
 */
import {createClient} from '@libsql/client';
import {writeFileSync} from 'node:fs';
export async function exportInputs(client,day,now,sessions=260,{quotesOnly=false}={}){
 if(!/^20\d\d-\d\d-\d\d$/.test(day)||!Number.isInteger(sessions)||sessions<225||sessions>500)throw Error('INVALID_INPUT');
 const local=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(local!==day)throw Error('INVALID_DAY');
 const run=async(sql,args=[])=>(await client.execute({sql,args})).rows;
 const dates=await run('SELECT trade_day,row_count FROM blue_eod_ingest_audit_v1 WHERE trade_day<? AND row_count>=1700 ORDER BY trade_day DESC LIMIT ?',[day,sessions]);
 if(dates.length<(quotesOnly?1:225))throw Error('INSUFFICIENT_AUDITED_HISTORY');
 const reference=String(dates[0].trade_day);
 const count=await run('SELECT COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day=?',[reference]);
 if(Number(count[0].n)!==Number(dates[0].row_count))throw Error('EOD_COUNT_MISMATCH');
 const observations=await run('SELECT source,COUNT(*) AS n,MIN(observed_at_utc) AS oldest,MAX(observed_at_utc) AS newest FROM blue_kis_provisional_daily_v1 WHERE trade_day=? AND reference_day=? GROUP BY source',[day,reference]);
 const quotes=await run(`SELECT p.*,e.market AS listing_market,e.name AS listing_name,l.payload_json
 FROM blue_kis_provisional_daily_v1 p JOIN blue_eod_daily_v1 e ON e.trade_day=p.reference_day AND e.code=p.code
 JOIN blue_kis_live_quotes_r141 l ON l.trade_date=p.trade_day AND l.market=p.market AND l.code=p.code AND l.received_at_utc=p.observed_at_utc
 WHERE p.trade_day=? AND p.reference_day=? AND p.market='J' AND p.date_basis IN ('KIS_REPORTED_TRADE_DATE','COLLECTOR_KST_REGULAR_SESSION')
 AND p.source IN ('KIS_REST_INQUIRE_PRICE_PROVISIONAL','KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL') ORDER BY p.code`,[day,reference]);
 const eligible=[];let missingAmount=0;const bySource={},rejected={};
 const reject=reason=>{rejected[reason]=(rejected[reason]??0)+1;};
 // The collector rotates the universe: one cycle at 40/min is roughly 67 min.
 // During the session allow 90 min, but never carry a pre-close observation
 // into a post-close scan. The daily-price endpoint alone is not proof of close.
 const closeAt=Date.parse(day+'T15:30:00+09:00');
 const cutoff=now.getTime();
 const afterClose=cutoff>=closeAt;
 const seen=new Set();
 for(const q of quotes){
  if(seen.has(String(q.code)))throw Error('DUPLICATE_QUOTE_EVIDENCE');
  seen.add(String(q.code));
  const stats=bySource[q.source]??={joined:0,absent:0,nullAmount:0,valid:0,newest:null,rejected:0};
  stats.joined++;
  const skip=reason=>{stats.rejected++;reject(reason);};
  const at=Date.parse(String(q.observed_at_utc));
  if(!Number.isFinite(at)||at>cutoff||new Date(at+9*3600000).toISOString().slice(0,10)!==day||at<Date.parse(day+'T09:00:00+09:00')){skip('INVALID_TIMESTAMP');continue;}
  if(afterClose?(q.source!=='KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL'||at<closeAt):cutoff-at>90*60000){skip(afterClose?'PRE_CLOSE_OBSERVATION':'STALE_INTRADAY');continue;}
  let p;
  try{p=JSON.parse(String(q.payload_json));}catch{skip('MALFORMED_PAYLOAD');continue;}
  if(!p||typeof p!=='object'||p.code!==q.code||p.trade_date_kst!==day||p.received_at_utc!==q.observed_at_utc||p.price!==Number(q.close)||p.accumulated_volume!==Number(q.volume)){skip('QUOTE_MISMATCH');continue;}
  const [o,h,l,c,v]=[q.open,q.high,q.low,q.close,q.volume].map(Number);
  if(!/^[0-9A-Z]{6}$/.test(String(q.code))||![o,h,l,c,v].every(Number.isSafeInteger)||!(0<l&&l<=Math.min(o,c)&&Math.max(o,c)<=h&&v>0)){skip('INVALID_OHLCV');continue;}
  if(!stats.newest||q.observed_at_utc>stats.newest)stats.newest=q.observed_at_utc;
  const amount=p.accumulated_amount_krw;
  if(!Object.hasOwn(p,'accumulated_amount_krw'))stats.absent++;else if(amount===null)stats.nullAmount++;
  const validAmount=Number.isSafeInteger(amount)&&amount>0;
  if(validAmount)stats.valid++;else missingAmount++;
  eligible.push({code:String(q.code),name:String(q.listing_name||q.code),market:String(q.listing_market),day,reference_day:reference,observed_at_utc:String(q.observed_at_utc),source:String(q.source),open:Number(q.open),high:Number(q.high),low:Number(q.low),close:Number(q.close),volume:Number(q.volume),amount:validAmount?amount:null});
 }
 const codes=new Set(eligible.map(q=>q.code)),history=[];
 for(const d of (quotesOnly?[]:dates.slice().reverse())){
  const rows=await run('SELECT trade_day,code,name,market,open,high,low,close,volume,amount FROM blue_eod_daily_v1 WHERE trade_day=? ORDER BY code',[String(d.trade_day)]);
  if(rows.length!==Number(d.row_count))throw Error('EOD_COUNT_MISMATCH');
  for(const r of rows)if(codes.has(String(r.code)))history.push([r.trade_day,r.code,r.name,r.market,r.open,r.high,r.low,r.close,r.volume,r.amount]);
 }
 const csv=v=>'"'+String(v??'').replaceAll('"','""')+'"';
 return {reference,quotes:eligible,history:['Date,Code,Name,Market,Open,High,Low,Close,Volume,Amount',...history.map(r=>r.map(csv).join(','))].join('\n')+'\n',coverage:{observations:observations.map(x=>({...x,n:Number(x.n)})),bySource,joined:eligible.length,joinedRaw:quotes.length,rejected,rejectedCount:quotes.length-eligible.length,quoteAgePolicy:afterClose?'POST_CLOSE_DAILY_ONLY':'INTRADAY_MAX_90_MIN',missingAmount,turnoverAvailable:eligible.length-missingAmount,eligible:eligible.length,historySessions:quotesOnly?0:dates.length,calendarVerified:false}};
}
if(process.argv[1]?.endsWith('/provisional-input-export.mjs')){
 const [day,prefix]=process.argv.slice(2);if(!prefix)throw Error('OUTPUT_REQUIRED');
 const client=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
 try{const r=await exportInputs(client,day,new Date(),260,{quotesOnly:process.argv.includes('--quotes-only')});writeFileSync(prefix+'.csv',r.history);writeFileSync(prefix+'.quotes.json',JSON.stringify(r.quotes));writeFileSync(prefix+'.meta.json',JSON.stringify({reference:r.reference,...r.coverage}));}finally{client.close();}
}

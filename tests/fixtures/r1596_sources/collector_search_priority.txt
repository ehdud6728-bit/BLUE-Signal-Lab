/** R1.5.9.4: bounded, quote-only priority collection. No new orders or tokens.
 * Existing research collector and basket watch run unchanged after this task.
 */
import {cachedToken,kstParts,marketsFor,getKisQuote,parseQuote} from './core.mjs';
const dateISO=x=>new Date(x).toISOString();
const LIMIT=4;
export async function collectSearchPriority(env,now=new Date(),deps={}){
 if(String(env.COLLECTOR_ENABLED).toLowerCase()!=='true')return {status:'DISABLED'};
 const db=env.DB;
 const available=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_search_quote_priority_r1594'").first();
 if(!available)return {status:'NOT_CONFIGURED'};
 const phases=(deps.phases||marketsFor)(now,env.CLOSED_DATES||'');
 if(!phases.length)return {status:'MARKET_CLOSED'};
 const kst=kstParts(now),stamp=now.toISOString();
 await db.prepare('CREATE TABLE IF NOT EXISTS blue_search_quote_lock_r1594(id INTEGER PRIMARY KEY CHECK(id=1),lease_until_ms INTEGER NOT NULL)').run();
 await db.prepare('INSERT OR IGNORE INTO blue_search_quote_lock_r1594(id,lease_until_ms) VALUES(1,0)').run();
 const lock=await db.prepare('UPDATE blue_search_quote_lock_r1594 SET lease_until_ms=? WHERE id=1 AND lease_until_ms<?')
  .bind(now.getTime()+55000,now.getTime()).run();
 if(lock.meta?.changes!==1)return {status:'BUSY'};
 try{
  // Keep a bounded overnight/weekend backlog until the next eligible KIS session.
  const since=dateISO(now.getTime()-7*86400000);
  const due=await db.prepare(`SELECT code,base_day,baseline_close FROM blue_search_quote_priority_r1594
    WHERE next_due_utc<=? AND requested_at_utc>=?
    ORDER BY CASE status WHEN 'QUEUED' THEN 0 WHEN 'RETRY' THEN 1 ELSE 2 END,requested_at_utc DESC,next_due_utc ASC LIMIT 4`)
    .bind(stamp,since).all();
  if(!due.results.length)return {status:'IDLE'};
  let token=null;
  if(env.KIS_APP_KEY&&env.KIS_APP_SECRET){try{token=await (deps.token||cachedToken)(db,env.KIS_APP_KEY,env.KIS_APP_SECRET,now);}catch{}}
  if(!token)return {status:'WAITING_TOKEN',count:due.results.length};
  const [market,phase]=phases.find(x=>x[0]==='J')||phases[0];
  let saved=0;let errors=0;
  for(const item of due.results.slice(0,LIMIT)){
   if(!/^[0-9]{6}$/.test(item.code)||!Number.isFinite(item.baseline_close)||item.baseline_close<=0)continue;
   try{
    const raw=await (deps.quote||getKisQuote)(env,token,market,item.code);
    const parsed=parseQuote({code:item.code,name:'',eod_close:item.baseline_close,
     eod_asof:item.base_day,eod_signals:'',origin:'SEARCH_PRIORITY_R1594'},market,phase,raw,now,kst.date);
    await db.prepare(`UPDATE blue_search_quote_priority_r1594 SET
      status='READY',checked_at_utc=?,trade_date=?,price=?,high=?,quote_at_utc=?,
      market=?,last_error=NULL,next_due_utc=? WHERE code=?`)
      .bind(stamp,parsed.trade_date_kst,parsed.price,parsed.high,stamp,market,
        dateISO(now.getTime()+10*60000),item.code).run();
    saved++;
   }catch{
    await db.prepare(`UPDATE blue_search_quote_priority_r1594 SET
      status='RETRY',checked_at_utc=?,last_error='PRICE_UNAVAILABLE',next_due_utc=? WHERE code=?`)
      .bind(stamp,dateISO(now.getTime()+5*60000),item.code).run();
    errors++;
   }
  }
  console.log(`BLUE_R1594_SEARCH_PRIORITY checked=${due.results.length} saved=${saved} errors=${errors}`);
  return {status:'PROCESSED',saved,errors};
 }finally{
  await db.prepare('UPDATE blue_search_quote_lock_r1594 SET lease_until_ms=0 WHERE id=1').run().catch(()=>{});
 }
}

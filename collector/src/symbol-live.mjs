/** Bounded one-symbol KIS quote collector for independently requested analysis.
 * No credential or token issuance; this never writes official KRX EOD tables.
 */
import {inspectCachedToken,kstParts,marketsFor,getKisQuote} from './core.mjs';

const table='blue_symbol_live_quotes_v1';
const queue='blue_symbol_live_requests_v1';
const isoTime=when=>when.toISOString();
const positive=x=>Number.isSafeInteger(x)&&x>0;

/** Validate actual provider fields without assuming the quote is an EOD close. */
export function parseSymbolLiveQuote(code,market,phase,json,receivedAt){
 const day=kstParts(receivedAt).date;
 if(!/^[0-9A-Z]{6}$/.test(code)||!['J','NX'].includes(market)||
    json?.rt_cd!=='0'||!json.output||typeof json.output!=='object')
  throw Error('QUOTE_INVALID');
 const o=json.output;
 const price=Number(o.stck_prpr),open=Number(o.stck_oprc),high=Number(o.stck_hgpr),
  low=Number(o.stck_lwpr),volume=Number(o.acml_vol);
 if(![price,open,high,low].every(positive)||!Number.isSafeInteger(volume)||volume<0||
    low>high||open<low||open>high||price<low||price>high)
  throw Error('QUOTE_INCONSISTENT');
 const reported=String(o.stck_bsop_date||'').trim();
 if(reported&&reported!==day.replaceAll('-',''))throw Error('TRADE_DATE_MISMATCH');
 const pct=String(o.prdy_ctrt??'').trim();const change=pct!==''?Number(pct):NaN;
 const rawTurnover=String(o.acml_tr_pbmn??'').trim();
 const clock=String(o.stck_cntg_hour??'').trim();
 return {code,market,market_label:market==='J'?'KRX':'NXT',phase,
  trade_date_kst:day,received_at_utc:isoTime(receivedAt),
  price,open,high,low,accumulated_volume:volume,
  accumulated_turnover_raw:/^\d+$/.test(rawTurnover)?rawTurnover:null,
  turnover_unit_verified:false,
  change_from_prev_close_pct:Number.isFinite(change)&&change>=-100&&change<=1000?change:null,
  reported_trade_date:reported||null,provider_trade_day_verified:!!reported,
  reported_trade_clock:/^\d{6}$/.test(clock)?clock:null,
  exchange_tick_time_verified:false,market_phase_verified:false,
  source:'KIS_REST_INQUIRE_PRICE',research_only:true,official_eod:false};
}

export async function collectSymbolLivePriority(env,now=new Date(),deps={}){
 if(String(env.COLLECTOR_ENABLED).toLowerCase()!=='true')return {status:'DISABLED'};
 const phases=(deps.phases||marketsFor)(now,env.CLOSED_DATES||'');
 if(!phases.length)return {status:'MARKET_CLOSED'};
 const db=env.DB;
 const found=await db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
   AND name='blue_symbol_live_requests_v1'`).first();
 if(!found)return {status:'NOT_CONFIGURED'};
 const stamp=isoTime(now);
 const due=await db.prepare(`SELECT code FROM ${queue} WHERE next_due_utc<=?
   AND status IN ('QUEUED','RETRY','WAITING_TOKEN')
   ORDER BY CASE status WHEN 'QUEUED' THEN 0 ELSE 1 END,requested_at_utc ASC LIMIT 3`)
  .bind(stamp).all();
 const items=due.results||[];
 if(!items.length)return {status:'IDLE'};
 await db.prepare(`CREATE TABLE IF NOT EXISTS blue_symbol_live_lock_v1 (
   id INTEGER PRIMARY KEY CHECK(id=1),lease_until_ms INTEGER NOT NULL)`).run();
 await db.prepare('INSERT OR IGNORE INTO blue_symbol_live_lock_v1(id,lease_until_ms) VALUES(1,0)').run();
 const lock=await db.prepare(`UPDATE blue_symbol_live_lock_v1 SET lease_until_ms=?
   WHERE id=1 AND lease_until_ms<?`).bind(now.getTime()+55_000,now.getTime()).run();
 if(lock.meta?.changes!==1)return {status:'BUSY'};
 try{
 let checked;
 try{checked=deps.token?
   {token:await deps.token(db,env.KIS_APP_KEY,env.KIS_APP_SECRET,now),status:'TOKEN_READY'}:
   await inspectCachedToken(db,env.KIS_APP_KEY,env.KIS_APP_SECRET,now);}
 catch{checked={token:null,status:'TOKEN_UNAVAILABLE'};}
 if(!checked.token){
  const next=isoTime(new Date(now.getTime()+5*60_000));
  for(const item of items){
   await db.prepare(`UPDATE ${queue} SET status='WAITING_TOKEN',checked_at_utc=?,
     next_due_utc=?,message=? WHERE code=?`)
    .bind(stamp,next,checked.status,item.code).run();
  }
  return {status:'WAITING_TOKEN',count:items.length,reason:checked.status};
 }
 // Explicit venue and session: after-hours KRX/NXT is NEVER labelled KRX regular EOD.
 const [market,phase]=phases.find(p=>p[0]==='J')||phases[0];
 let saved=0,errors=0;
 for(const item of items){
  if(!/^[0-9A-Z]{6}$/.test(item.code))continue;
  try{
   const raw=await (deps.quote||getKisQuote)(env,checked.token,market,item.code);
   const q=parseSymbolLiveQuote(item.code,market,phase,raw,now);
   await db.prepare(`INSERT INTO ${table}
     (trade_date,market,code,received_at_utc,payload_json) VALUES(?,?,?,?,?)
     ON CONFLICT(trade_date,market,code) DO UPDATE SET
      received_at_utc=excluded.received_at_utc,payload_json=excluded.payload_json
     WHERE excluded.received_at_utc>${table}.received_at_utc`)
    .bind(q.trade_date_kst,q.market,q.code,q.received_at_utc,JSON.stringify(q)).run();
   await db.prepare(`UPDATE ${queue} SET status='READY',checked_at_utc=?,
     next_due_utc=?,message=NULL WHERE code=?`)
    .bind(stamp,isoTime(new Date(now.getTime()+5*60_000)),item.code).run();
   saved++;
  }catch{
   await db.prepare(`UPDATE ${queue} SET status='RETRY',checked_at_utc=?,
     next_due_utc=?,message='KIS_QUOTE_UNAVAILABLE' WHERE code=?`)
    .bind(stamp,isoTime(new Date(now.getTime()+5*60_000)),item.code).run();
   errors++;
  }
 }
 console.log(`BLUE_SYMBOL_LIVE saved=${saved} errors=${errors} market=${market} phase=${phase}`);
 return {status:'PROCESSED',saved,errors};
 }finally{
  await db.prepare('UPDATE blue_symbol_live_lock_v1 SET lease_until_ms=0 WHERE id=1')
   .run().catch(()=>{});
 }
}

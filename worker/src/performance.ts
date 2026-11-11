/** BLUE R1.5.3: authenticated, verified EOD basket enrollment and read-only results.
 * Browser input never supplies a price or a direct KIS symbol query; only validated
 * historical search observations are enrolled. No KIS credentials in API Worker.
 */
export type PerformanceEnv = { DB:D1Database };
export const BASKET_WATCH_SCHEMA = `CREATE TABLE IF NOT EXISTS blue_basket_watch_r153 (
 code TEXT NOT NULL, base_day TEXT NOT NULL, baseline_close REAL NOT NULL,
 created_at_utc TEXT NOT NULL, last_seen_at_utc TEXT NOT NULL,
 next_due_utc TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'QUEUED',
 checked_at_utc TEXT, progress_to_day TEXT, highest_price REAL, highest_day TEXT,
 recent_close REAL, recent_day TEXT, quote_price REAL, quote_high REAL,
 quote_day TEXT, quote_at_utc TEXT, quote_market TEXT,
 last_error TEXT, PRIMARY KEY(code,base_day))`;
const validCode=(s:unknown):s is string=>typeof s==='string'&&/^\d{6}$/.test(s);
const validDay=(s:unknown):s is string=>{
 if(typeof s!=='string'||!/^20\d\d-\d\d-\d\d$/.test(s))return false;
 const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.valueOf())&&d.toISOString().slice(0,10)===s;
};
const respond=(x:unknown, status=200)=>new Response(JSON.stringify(x),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const todayKST=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
type Item={code:string;day:string};
export function decodeItems(raw:unknown,limit:number):Item[]|null{
 if(!Array.isArray(raw)||raw.length>limit)return null;
 const all=new Map<string,Item>();
 for(const x of raw){
  if(!x||typeof x!=='object')return null;
  const entry=x as {code?:unknown;day?:unknown};
  if(!validCode(entry.code)||!validDay(entry.day)||entry.day<'2025-01-01'||entry.day>todayKST())return null;
  all.set(`${entry.code}:${entry.day}`,{code:entry.code,day:entry.day});
 }
 return [...all.values()];
}
export async function basketWatch(req:Request,env:PerformanceEnv):Promise<Response>{
 if(req.method!=='POST'&&req.method!=='GET')return respond({error:'METHOD_NOT_ALLOWED'},405);
 const db=env.DB;
 await db.prepare(BASKET_WATCH_SCHEMA).run();
 if(req.method==='POST'){
  let input:unknown;
  try{input=await req.json();}catch{return respond({error:'INVALID_JSON'},400);}
  const items=decodeItems((input as {items?:unknown})?.items,20);
  if(!items||!items.length)return respond({error:'INVALID_ITEMS',message:'한 번에 최대 20개 종목·날짜를 등록할 수 있습니다.'},400);
  const now=new Date().toISOString();const result:{code:string;day:string;status:string}[]=[];
  const active=await db.prepare('SELECT COUNT(*) AS n FROM blue_basket_watch_r153 WHERE last_seen_at_utc >= ?')
   .bind(new Date(Date.now()-7*86400000).toISOString()).first<{n:number}>();
  for(const it of items){
   const existing=await db.prepare('SELECT status FROM blue_basket_watch_r153 WHERE code=? AND base_day=?')
    .bind(it.code,it.day).first<{status:string}>();
   if(existing){
    await db.prepare('UPDATE blue_basket_watch_r153 SET last_seen_at_utc=? WHERE code=? AND base_day=?')
      .bind(now,it.code,it.day).run();
    result.push({...it,status:existing.status});continue;
   }
   if((active?.n||0)+result.filter(x=>x.status==='QUEUED').length>=80){result.push({...it,status:'CAPACITY_LIMIT'});continue;}
   // The symbol and discovery price MUST exist in a non-demo, day-verified scan.
   const proof=await db.prepare(`SELECT s.close_price AS close FROM signals s
      JOIN runs r ON r.run_id=s.run_id
      WHERE s.code=? AND s.day=? AND r.is_demo=0 AND r.latest_price_date=s.day
        AND s.close_price>0 ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1`)
    .bind(it.code,it.day).first<{close:number}>();
   if(!proof||!Number.isFinite(Number(proof.close))||proof.close<=0){result.push({...it,status:'UNVERIFIED_EOD'});continue;}
   await db.prepare(`INSERT OR IGNORE INTO blue_basket_watch_r153
    (code,base_day,baseline_close,created_at_utc,last_seen_at_utc,next_due_utc,status)
    VALUES(?,?,?,?,?,?,'QUEUED')`).bind(it.code,it.day,proof.close,now,now,now).run();
   result.push({...it,status:'QUEUED'});
  }
  return respond({status:'REGISTERED',items:result});
 }
 const u=new URL(req.url);const encoded=u.searchParams.get('items')||'';
 if(encoded.length>2900)return respond({error:'TOO_MANY_ITEMS'},400);
 const parts=encoded.split(',').filter(Boolean).map(x=>{
  const [code,day,...extra]=x.split(':');return extra.length?null:{code,day};
 });
 const items=decodeItems(parts,100);
 if(!items)return respond({error:'INVALID_ITEMS'},400);
 const out=[];
 for(const it of items){
  const x=await db.prepare(`SELECT code,base_day,baseline_close,status,created_at_utc,
    checked_at_utc,progress_to_day,highest_price,highest_day,recent_close,recent_day,
    quote_price,quote_high,quote_day,quote_at_utc,quote_market,last_error
    FROM blue_basket_watch_r153 WHERE code=? AND base_day=?`)
   .bind(it.code,it.day).first();
  if(!x){out.push({...it,status:'NOT_REGISTERED'});continue;}
  // Daily history is complete only when all requested dates have been covered.
  // R154_CLARITY: server-verified discovery signals, including old locally saved baskets.
  const origin=await db.prepare(`SELECT s.signal_names FROM signals s JOIN runs r ON r.run_id=s.run_id
    WHERE s.code=? AND s.day=? AND r.is_demo=0 AND r.latest_price_date=s.day
    ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1`).bind(it.code,it.day)
    .first<{signal_names:string|null}>();
  const complete=x.status==='READY'||x.status==='WAITING_NEXT_SESSION';
  out.push({code:x.code,day:x.base_day,baseline:x.baseline_close,status:x.status,
   signal_names:typeof origin?.signal_names==='string'?origin.signal_names.slice(0,240):null,
   registered_at:x.created_at_utc,checked_at:x.checked_at_utc,
   last_covered_day:x.progress_to_day,
   highest_price:complete?x.highest_price:null,highest_day:complete?x.highest_day:null,
   recent_close:x.recent_close,recent_day:x.recent_day,
   quote_price:x.quote_price,quote_high:x.quote_high,
   quote_day:x.quote_day,quote_at:x.quote_at_utc,quote_market:x.quote_market,
   last_error:x.last_error||null});
 }
 return respond({status:'OK',items:out,server_time:new Date().toISOString(),source:'KIS_DAILY_UNADJUSTED_J_AND_KIS_QUOTE'});
}

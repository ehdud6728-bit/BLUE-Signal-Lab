/** BLUE R1.5.9.4 - authenticated, rate-bounded search-first quote queue.
 * This module NEVER touches KIS: only validated D1 EOD discoveries can enqueue.
 * Dedicated collector Cron (separate Worker) consumes requests.
 */
const CREATE=`CREATE TABLE IF NOT EXISTS blue_search_quote_priority_r1594 (
 code TEXT PRIMARY KEY, base_day TEXT NOT NULL, baseline_close REAL NOT NULL,
 requested_at_utc TEXT NOT NULL, next_due_utc TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'QUEUED', checked_at_utc TEXT,
 trade_date TEXT, price REAL, high REAL, quote_at_utc TEXT, market TEXT,
 last_error TEXT)`;
export const REQUEST_LIMIT=8;
const validDay=(s:unknown):s is string=>typeof s==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const reply=(obj:unknown,code=200)=>new Response(JSON.stringify(obj),{status:code,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function decodeRequested(value:unknown,nowDay:string):{code:string;day:string}[]|null{
 if(!Array.isArray(value)||value.length<1||value.length>REQUEST_LIMIT)return null;
 const seen=new Set<string>();const out:{code:string;day:string}[]=[];
 for(const v of value){
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const {code,day}=v as Record<string,unknown>;
  if(typeof code!=='string'||!/^[0-9]{6}$/.test(code)||!validDay(day)||day<'2025-01-01'||day>nowDay)return null;
  // one KIS quote per symbol, dates remain separate for outcome comparisons.
  if(!seen.has(code)){out.push({code,day});seen.add(code);}
 }
 return out;
}
export async function requestSearchQuotes(req:Request,db:D1Database):Promise<Response>{
 if(req.method!=='POST')return reply({error:'METHOD_NOT_ALLOWED'},405);
 const raw=await req.text();if(raw.length>3500)return reply({error:'PAYLOAD_TOO_LARGE'},413);
 let body:unknown;try{body=JSON.parse(raw);}catch{return reply({error:'INVALID_JSON'},400);}
 const items=decodeRequested((body as {items?:unknown})?.items,today());
 if(!items)return reply({error:'INVALID_ITEMS',message:'검색 결과의 유효한 종목·날짜를 최대 8개 요청하세요.'},400);
 await db.prepare(CREATE).run();
 const stamp=new Date().toISOString();const throttle=new Date(Date.now()-10*60000).toISOString();
 const stats={queued:0,throttled:0,not_verified:0};
 for(const it of items){
  // Never accept an arbitrary stock-code request; a nondemo validated discovery is required.
  const proof=await db.prepare(`SELECT s.close_price FROM signals s JOIN runs r ON r.run_id=s.run_id
    WHERE s.code=? AND s.day=? AND s.close_price>0 AND r.is_demo=0
     AND r.latest_price_date=s.day ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1`)
    .bind(it.code,it.day).first<{close_price:number}>();
  if(!proof||!Number.isFinite(proof.close_price)||proof.close_price<=0){stats.not_verified++;continue;}
  const current=await db.prepare('SELECT requested_at_utc FROM blue_search_quote_priority_r1594 WHERE code=?')
    .bind(it.code).first<{requested_at_utc:string}>();
  if(current?.requested_at_utc&&current.requested_at_utc>throttle){stats.throttled++;continue;}
  await db.prepare(`INSERT INTO blue_search_quote_priority_r1594
    (code,base_day,baseline_close,requested_at_utc,next_due_utc,status)
    VALUES(?,?,?,?,?,'QUEUED') ON CONFLICT(code) DO UPDATE SET
      base_day=excluded.base_day, baseline_close=excluded.baseline_close,
      requested_at_utc=excluded.requested_at_utc, next_due_utc=excluded.next_due_utc,
      status='QUEUED',last_error=NULL`)
    .bind(it.code,it.day,proof.close_price,stamp,stamp).run();
  stats.queued++;
 }
 return reply({status:'ACCEPTED',...stats,source:'VALIDATED_EOD_ONLY',
  note:'서버 Cron이 순서대로 KIS 시세를 수집합니다. 새 시세는 즉시 조회를 보장하지 않습니다.'});
}

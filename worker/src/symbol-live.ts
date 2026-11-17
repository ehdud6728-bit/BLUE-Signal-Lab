/** Access-protected, per-symbol KIS quote request and saved-quote lookup.
 * This is INTRADAY RESEARCH, never a substitute for an official KRX EOD bar.
 * KIS credentials remain exclusively on the collector Worker.
 */
export const validLiveCode=(value:string)=>/^[0-9A-Z]{6}$/.test(value);
const kstDay=(when:Date)=>new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
}).format(when);
const validNumber=(x:unknown):number|null=>
  typeof x==='number'&&Number.isFinite(x)&&x>0?x:null;

const QUEUE=`CREATE TABLE IF NOT EXISTS blue_symbol_live_requests_v1 (
  code TEXT PRIMARY KEY,requested_at_utc TEXT NOT NULL,
  next_due_utc TEXT NOT NULL,status TEXT NOT NULL,
  checked_at_utc TEXT,message TEXT
)`;

const QUOTES=`CREATE TABLE IF NOT EXISTS blue_symbol_live_quotes_v1 (
  trade_date TEXT NOT NULL,market TEXT NOT NULL,code TEXT NOT NULL,
  received_at_utc TEXT NOT NULL,payload_json TEXT NOT NULL,
  PRIMARY KEY(trade_date,market,code)
)`;

const tableNames=async(db:D1Database):Promise<Set<string>>=>{
  const rows=await db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name IN ('blue_symbol_directory_v1','blue_symbol_analysis_v1','signals',
      'runs','blue_symbol_live_requests_v1','blue_symbol_live_quotes_v1',
      'blue_kis_live_quotes_r141','blue_kis_live_quotes_r14')`)
    .all<{name:string}>();
  return new Set((rows.results||[]).map(x=>x.name));
};

async function knownSymbol(db:D1Database,code:string,tables:Set<string>):Promise<{name:string}|null>{
  if(tables.has('blue_symbol_directory_v1')){
    const found=await db.prepare('SELECT name FROM blue_symbol_directory_v1 WHERE code=? LIMIT 1')
      .bind(code).first<{name:string}>();
    if(found)return {name:found.name||''};
  }
  if(tables.has('blue_symbol_analysis_v1')){
    const row=await db.prepare(`SELECT diagnosis_json FROM blue_symbol_analysis_v1
      WHERE code=? ORDER BY day DESC LIMIT 1`).bind(code).first<{diagnosis_json:string}>();
    if(row){
      try{const data=JSON.parse(row.diagnosis_json) as {name?:unknown};
        return {name:typeof data.name==='string'?data.name.slice(0,80):''};}
      catch{return {name:''};}
    }
  }
  if(tables.has('signals')&&tables.has('runs')){
    const row=await db.prepare(`SELECT s.extras_json FROM signals s JOIN runs r ON r.run_id=s.run_id
      WHERE s.code=? AND r.is_demo=0 AND r.latest_price_date=s.day
      ORDER BY s.day DESC LIMIT 1`).bind(code).first<{extras_json:string}>();
    if(row){try{const data=JSON.parse(row.extras_json||'{}') as {name?:unknown;Name?:unknown};
      const name=data.name||data.Name;return {name:typeof name==='string'?name.slice(0,80):''};}
    catch{return {name:''};}}
  }
  // Existing KIS research snapshots are valid proof that this ticker was
  // already collected; re-use them instead of depending on today's EOD scan.
  for(const table of ['blue_kis_live_quotes_r141','blue_kis_live_quotes_r14']){
    if(!tables.has(table))continue;
    const row=await db.prepare(`SELECT payload_json FROM ${table}
      WHERE code=? ORDER BY received_at_utc DESC LIMIT 1`).bind(code)
      .first<{payload_json:string}>();
    if(row){try{const q=JSON.parse(row.payload_json) as {code?:unknown;name?:unknown};
      if(q.code===code)return {name:typeof q.name==='string'?q.name.slice(0,80):''};
    }catch{/* Ignore malformed legacy snapshots. */}}
  }
  return null;
}

async function historicalReference(db:D1Database,code:string,day:string,tables:Set<string>){
  if(!tables.has('blue_symbol_analysis_v1'))return null;
  const row=await db.prepare(`SELECT day,diagnosis_json,quality_status FROM blue_symbol_analysis_v1
    WHERE code=? AND day<? ORDER BY day DESC LIMIT 1`).bind(code,day)
    .first<{day:string;diagnosis_json:string;quality_status:string}>();
  if(!row)return null;
  try{
    const d=JSON.parse(row.diagnosis_json) as Record<string,unknown>;
    if(d.code!==code||d.asof!==row.day)return null;
    return {day:row.day,quality_status:row.quality_status,
      ma20:validNumber(d.ma20),ma40:validNumber(d.ma40),
      ma112:validNumber(d.ma112),ma224:validNumber(d.ma224),
      env20_lower_20pct:validNumber(d.env20_lower_20pct),
      source:'STORED_HISTORICAL_DIAGNOSIS',not_current_moving_averages:true};
  }catch{return null;}
}

export async function lookupSymbolLive(db:D1Database,code:string,now=new Date()):Promise<Record<string,unknown>>{
  if(!validLiveCode(code))return {status:'INVALID_CODE'};
  const tables=await tableNames(db);
  const known=await knownSymbol(db,code,tables);
  if(!known)return {status:'UNKNOWN_SYMBOL',code,
    message:'종목명 목록이나 기존 검증 분석 기록에서 확인되지 않은 종목입니다.'};
  const request=tables.has('blue_symbol_live_requests_v1')?
    await db.prepare(`SELECT status,requested_at_utc,checked_at_utc,message
      FROM blue_symbol_live_requests_v1 WHERE code=?`).bind(code)
      .first<{status:string;requested_at_utc:string;checked_at_utc:string|null;message:string|null}>():null;
  const rows:Array<{trade_date:string;market:string;received_at_utc:string;payload_json:string}>=[];
  for(const table of ['blue_symbol_live_quotes_v1','blue_kis_live_quotes_r141','blue_kis_live_quotes_r14']){
    if(!tables.has(table))continue;
    const row=await db.prepare(`SELECT trade_date,market,received_at_utc,payload_json
      FROM ${table} WHERE code=? ORDER BY received_at_utc DESC LIMIT 1`).bind(code)
      .first<{trade_date:string;market:string;received_at_utc:string;payload_json:string}>();
    if(row)rows.push(row);
  }
  if(!rows.length)return {status:'NOT_COLLECTED',code,name:known.name,request,
    message:'저장된 개별 시세가 없습니다. 수집을 요청하면 다음 거래 가능 시간에 수집됩니다.'};
  try{
    // Ignore malformed candidate records without suppressing a different
    // correctly stored KIS quote. No cross-market price aggregation.
    const valid=rows.sort((a,b)=>b.received_at_utc.localeCompare(a.received_at_utc))
      .map(row=>{try{const q=JSON.parse(row.payload_json) as Record<string,unknown>;
        if(q.code!==code||q.trade_date_kst!==row.trade_date||q.market!==row.market||
          q.received_at_utc!==row.received_at_utc||!validNumber(q.price)||
          !['J','NX'].includes(row.market))return null;
        return {row,snapshot:{...q,official_eod:false}};
      }catch{return null;}}).find(Boolean);
    if(!valid)throw Error('INVALID_STORED_QUOTE');
    const {row,snapshot}=valid;
    const today=kstDay(now);
    const providerDayConfirmed=snapshot.provider_trade_day_verified===true||
      snapshot.reported_trade_day_matches_today===true;
    const fresh=row.trade_date===today;
    return {status:!fresh?'STALE_SNAPSHOT':providerDayConfirmed?'READY':'DAY_UNVERIFIED',code,
      name:known.name||snapshot.name||'',snapshot,
      reference:await historicalReference(db,code,row.trade_date,tables),request,
      message:!fresh?'마지막 저장 시세이며 오늘의 현재가가 아닙니다. 시세 수집 시각을 확인하세요.':
        providerDayConfirmed?'오늘 날짜가 확인된 KIS 수집 시세입니다. 확정 종가는 아닙니다.':
        '오늘 수집한 시세지만 제공처의 거래일 표기가 없어 당일 체결 여부는 미확인입니다.'};
  }catch{return {status:'CORRUPT_SNAPSHOT',code,message:'저장 시세 무결성이 확인되지 않습니다.'};}
}

export async function requestSymbolLive(db:D1Database,code:string,now=new Date()):Promise<{status:string;message:string;[key:string]:unknown}>{
  if(!validLiveCode(code))return {status:'INVALID_CODE',message:'종목코드는 영문·숫자 6자리여야 합니다.'};
  const tables=await tableNames(db);
  if(!await knownSymbol(db,code,tables))return {status:'UNKNOWN_SYMBOL',
    message:'등록된 종목명 또는 과거 검증 기록이 있는 종목만 요청할 수 있습니다.'};
  await db.prepare(QUEUE).run();
  await db.prepare(QUOTES).run();
  const stamp=now.toISOString();
  const cutoff=new Date(now.getTime()-2*60_000).toISOString();
  const current=await db.prepare(`SELECT requested_at_utc,status FROM blue_symbol_live_requests_v1
    WHERE code=?`).bind(code).first<{requested_at_utc:string;status:string}>();
  if(current&&current.requested_at_utc>=cutoff)return {status:'THROTTLED',code,
    message:'최근 요청이 이미 접수됐습니다. 잠시 후 다시 조회해 주세요.'};
  // Limit server-side backlog. An Access-authenticated user cannot request the whole market.
  const pending=await db.prepare(`SELECT COUNT(*) AS n FROM blue_symbol_live_requests_v1
    WHERE status IN ('QUEUED','RETRY','WAITING_TOKEN')`).first<{n:number}>();
  if(Number(pending?.n||0)>=80)return {status:'QUEUE_FULL',
    message:'현재 개별 시세 요청이 많습니다. 잠시 후 다시 요청해 주세요.'};
  await db.prepare(`INSERT INTO blue_symbol_live_requests_v1
    (code,requested_at_utc,next_due_utc,status,message) VALUES(?,?,?,'QUEUED','Awaiting KIS collection')
    ON CONFLICT(code) DO UPDATE SET requested_at_utc=excluded.requested_at_utc,
      next_due_utc=excluded.next_due_utc,status='QUEUED',message=excluded.message`)
    .bind(code,stamp,stamp).run();
  return {status:'QUEUED',code,
    message:'KIS 시세 수집을 예약했습니다. 거래 가능 시간의 자동수집 후 최근 시세를 조회하세요.'};
}

/** R1.4: D1-only market read API. Never fetches KIS or returns token vault data. */
export type LiveQuote = {
  code:string; name:string; received_at_utc:string; trade_date_kst:string;
  price:number;open:number;high:number;low:number;accumulated_volume:number;
  change_from_eod_pct:number|null;day_range_position_pct:number|null;
  eod_asof:string|null;eod_close:number|null;eod_signals:string;
  exchange_tick_time_verified:boolean;
  provider:string;research_only:boolean;
};

function kstDate(d:Date):string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
  }).format(d);
}
function timeKST(d:Date):string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).format(d);
}

export async function liveQuotes(db:D1Database):Promise<Record<string,unknown>> {
  const exists=await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='blue_kis_live_quotes_r14' LIMIT 1`).first();
  if(!exists)return {status:'NOT_CONFIGURED',items:[],poll_seconds:30,source:'KIS_REST',message:'R1.4 수집기를 아직 실행하지 않았습니다.'};
  const max=await db.prepare('SELECT MAX(trade_date) AS day FROM blue_kis_live_quotes_r14').first<{day:string|null}>();
  if(!max?.day)return {status:'WAITING_FOR_QUOTES',items:[],poll_seconds:30,source:'KIS_REST'};
  const now=new Date();
  const latestDate=max.day;
  const rows=await db.prepare(`SELECT payload_json FROM blue_kis_live_quotes_r14 WHERE trade_date=? ORDER BY code LIMIT 40`)
    .bind(latestDate).all<{payload_json:string}>();
  const valid:LiveQuote[]=[];
  for(const row of rows.results){
    try {
      const v=JSON.parse(row.payload_json) as Partial<LiveQuote>;
      if(typeof v.code==='string'&&/^[0-9A-Z]{6}$/.test(v.code)&&typeof v.price==='number'&&v.price>0&&
         typeof v.received_at_utc==='string'&&Number.isFinite(Date.parse(v.received_at_utc))&&
         typeof v.trade_date_kst==='string'&&v.trade_date_kst===latestDate){
        valid.push(v as LiveQuote);
      }
    }catch{/* Ignore corrupt rows. */}
  }
  const latest=valid.reduce((s,r)=>r.received_at_utc>s?r.received_at_utc:s,'');
  const ageMin=latest?Math.max(0,(now.getTime()-Date.parse(latest))/60000):null;
  const hour=timeKST(now);
  const today=kstDate(now);
  const inWindow=now.getUTCDay()!==0&&now.getUTCDay()!==6&&hour>='13:00'&&hour<='15:25';
  const fresh=latestDate===today&&ageMin!==null&&ageMin<=10;
  const status = !valid.length ? 'WAITING_FOR_QUOTES':
    latestDate!==today ? 'PREVIOUS_DAY':
    !inWindow ? 'OUTSIDE_COLLECTION_WINDOW':
    fresh ? 'RECENT_SNAPSHOT' : 'STALE_SNAPSHOT';
  return {
    status, items:valid, trade_date_kst:latestDate, latest_received_at_utc:latest||null,
    age_minutes:ageMin===null?null:Math.round(ageMin*10)/10,
    polling:'Browser D1 refresh every 30s; server KIS REST target every 5min during 13:00-15:25 KST',
    exchange_tick_time_verified:false,
    source:'KIS_REST', poll_seconds:30, market_phase_verified:false,
    note:'조회 수신 시각은 거래소 체결 시각이 아닙니다. REST 스냅샷은 실시간 체결 스트림이 아닙니다.'
  };
}

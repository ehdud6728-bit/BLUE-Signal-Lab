/** BLUE R1.4.1: Cloudflare D1-only market read API.
 * Never calls KIS or returns secrets/vault ciphertext.
 * Prefers separate KRX/NXT R1.4.1 snapshots, gracefully reads legacy R1.4.
 */
export type LiveQuote = {
  code:string;name:string;received_at_utc:string;trade_date_kst:string;
  price:number;open:number;high:number;low:number;accumulated_volume:number;
  change_from_eod_pct:number|null;day_range_position_pct:number|null;
  eod_asof:string|null;eod_close:number|null;eod_signals:string;
  market:string;market_label:string;phase:string;
  reported_trade_date?:string|null;reported_trade_day_matches_today?:boolean|null;
  exchange_tick_time_verified:boolean;source?:string;research_only:boolean;
};
function kstParts(now:Date):{date:string;minutes:number;weekday:number} {
  const fmt=new Intl.DateTimeFormat('en-US',{
    timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
    weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  });
  const p=Object.fromEntries(fmt.formatToParts(now).map(v=>[v.type,v.value]));
  const weekdays:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return {date:`${p.year}-${p.month}-${p.day}`,
    minutes:Number(p.hour)*60+Number(p.minute),weekday:weekdays[p.weekday]??0};
}
function marketWindow(s:{minutes:number;weekday:number}):boolean {
  if(s.weekday===0||s.weekday===6)return false;
  const t=s.minutes;
  return (t>=8*60&&t<8*60+50)||
    (t>=9*60&&t<15*60+20)||
    (t>=15*60+40&&t<20*60);
}
export async function liveQuotes(db:D1Database):Promise<Record<string,unknown>> {
  const info=await db.prepare(`SELECT name FROM sqlite_master WHERE type='table'
    AND name IN ('blue_kis_live_quotes_r141','blue_kis_live_quotes_r14')`).all<{name:string}>();
  const tables=new Set(info.results.map(x=>x.name));
  if(!tables.size)return {status:'NOT_CONFIGURED',items:[],poll_seconds:30,source:'KIS_REST',
    message:'KIS 수집기 D1 테이블이 아직 준비되지 않았습니다.'};
  let table='';let latestDay:string|null=null;
  for(const name of ['blue_kis_live_quotes_r141','blue_kis_live_quotes_r14']) {
    if(!tables.has(name))continue;
    const max=await db.prepare(`SELECT MAX(trade_date) AS day FROM ${name}`).first<{day:string|null}>();
    if(max?.day){table=name;latestDay=max.day;break;}
  }
  if(!table||!latestDay)return {status:'WAITING_FOR_QUOTES',items:[],poll_seconds:30,source:'KIS_REST'};
  const q=await db.prepare(`SELECT payload_json FROM ${table} WHERE trade_date=?
    ORDER BY code,received_at_utc DESC LIMIT 80`).bind(latestDay)
    .all<{payload_json:string}>();
  const latest:LiveQuote[]=[];
  for(const row of q.results){
    try {
      const raw=JSON.parse(row.payload_json) as Partial<LiveQuote>;
      if(typeof raw.code!=='string'||!/^[0-9A-Z]{6}$/.test(raw.code)||
         typeof raw.price!=='number'||!Number.isFinite(raw.price)||raw.price<=0||
         typeof raw.received_at_utc!=='string'||!Number.isFinite(Date.parse(raw.received_at_utc))||
         raw.trade_date_kst!==latestDay)continue;
      const market=table.endsWith('r141')?raw.market:'J';
      if(market!=='J'&&market!=='NX')continue;
      latest.push({...raw,market,market_label:market==='J'?'KRX':'NXT',
        phase:table.endsWith('r141')?(raw.phase||'UNKNOWN_PHASE'):'LEGACY_R14_UNVERIFIED'} as LiveQuote);
    }catch{/* Malformed source records never reach the browser */}
  }
  const received=latest.reduce((acc,x)=>x.received_at_utc>acc?x.received_at_utc:acc,'');
  const now=new Date();const state=kstParts(now);
  const age=received?Math.max(0,(now.getTime()-Date.parse(received))/60000):null;
  const current=state.date===latestDay;
  const status=latest.length===0?'WAITING_FOR_QUOTES':
    !current?'PREVIOUS_DAY':
    !marketWindow(state)?'OUTSIDE_COLLECTION_WINDOW':
    age!==null&&age<=10?'RECENT_SNAPSHOT':'STALE_SNAPSHOT';
  return {
    status,items:latest,trade_date_kst:latestDay,
    latest_received_at_utc:received||null,
    age_minutes:age===null?null:Math.round(age*10)/10,
    source:'KIS_REST',schema:table.endsWith('r141')?'R1.4.1':'R1.4_LEGACY',
    polling:'UI D1 read every 30 seconds; KIS REST scheduled at most every 5min during open phases',
    poll_seconds:30,market_phase_verified:false,exchange_tick_time_verified:false,
    note:'가격은 KIS REST 마지막 응답의 시세로, 거래소 체결 시각이 검증되지 않았습니다. '
      +'KRX/NXT별 가격·거래량을 구분하고 서로 합산하지 않습니다.'
  };
}

/** Read-only same-day KIS provisional observations and bounded candle previews.
 * The existing collector writes these limited-coverage quotes to Turso;
 * this endpoint never calls KIS, issues a token, touches D1 or writes research signals.
 */
import {createClient} from '@libsql/client/web';

type Env={TURSO_DATABASE_URL?:string;TURSO_AUTH_TOKEN?:string};
type Client=Pick<ReturnType<typeof createClient>,'execute'|'close'>;
type Factory=(options:{url:string;authToken:string;intMode:'string'})=>Client;
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const CODE=/^[0-9A-Z]{6}$/;

export class InvalidProvisionalQuery extends Error{
  constructor(){super('INVALID_PROVISIONAL_QUERY');}
}
function todayKST(now:Date){return new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'
}).format(now);}
function validDay(day:string){if(!DAY.test(day))return false;
  const date=new Date(day+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===day;
}
function fail():never{throw new InvalidProvisionalQuery();}
function like(raw:string){return `%${raw.replace(/[\\%_]/g,'\\$&')}%`;}

// A single provisional candle cannot establish BLUE/RSI/MACD/ENV/GC patterns.
// These deterministic, price-only observations are explicitly NOT signals.
export function provisionalCandleObservations(q:{open:number;high:number;low:number;
  price:number;volume:number},previous:{high:number;volume:number}|null){
  const observations:string[]=[];
  if(q.price>q.open)observations.push('UP_CANDLE');
  if(q.high>q.low&&10*(q.price-q.low)>=8*(q.high-q.low))
    observations.push('NEAR_HIGH');
  if(previous&&q.price>previous.high)observations.push('ABOVE_REFERENCE_HIGH');
  if(previous&&previous.volume>0&&q.volume>=2*previous.volume)
    observations.push('DOUBLE_REFERENCE_VOLUME');
  return observations;
}

export async function tursoProvisionalSearch(env:Env,p:URLSearchParams,
  factory:Factory=createClient,now=new Date()){
  const day=p.get('date')||'',q=(p.get('q')||'').trim();
  const limitText=p.get('limit')||'50';
  if(!validDay(day)||day!==todayKST(now)||q.length>50||/[\u0000-\u001f]/.test(q)||
    !/^[1-9]\d?$/.test(limitText)||Number(limitText)>50)fail();
  const limit=Number(limitText);
  const url=env.TURSO_DATABASE_URL?.trim()||'',token=env.TURSO_AUTH_TOKEN?.trim()||'';
  if(!/^(https|libsql):\/\//.test(url)||!token)throw Error('TURSO_PROVISIONAL_NOT_CONFIGURED');
  const client=factory({url,authToken:token,intMode:'string'});
  try{
    const latest=await client.execute({sql:`SELECT trade_day,row_count
      FROM blue_eod_ingest_audit_v1 WHERE trade_day<? AND row_count>=1700
      ORDER BY trade_day DESC LIMIT 1`,args:[day]});
    const reference=latest.rows[0];
    const reference_day=reference?String(reference.trade_day):null;
    const reference_market_count=reference?Number(reference.row_count):null;
    if(reference_market_count!==null&&(!Number.isSafeInteger(reference_market_count)||
      reference_market_count<1700||reference_market_count>10000))
      throw Error('INVALID_PROVISIONAL_REFERENCE_AUDIT');
    const empty={storage:'TURSO',data_status:'KIS_PARTIAL_PROVISIONAL',
      day,source:'KIS_SAVED_ONLY',pattern_analysis:false,observation_preview:true,
      observation_scope:'SINGLE_CANDLE_AND_AUDITED_REFERENCE_ONLY',complete_market:false,
      reference_day,reference_market_count,observed_count:0,total:0,
      latest_observed_utc:null,items:[]};
    if(!reference_day)return empty;
    // A stored audit without its full underlying KRX day is not a safe baseline.
    const coverage=await client.execute({sql:
      'SELECT COUNT(*) AS n FROM blue_eod_daily_v1 WHERE trade_day=?',args:[reference_day]});
    if(Number(coverage.rows[0]?.n)!==reference_market_count)
      throw Error('INCOMPLETE_PROVISIONAL_REFERENCE');
    const table=await client.execute(`SELECT 1 AS found FROM sqlite_master
      WHERE type='table' AND name='blue_kis_provisional_daily_v1' LIMIT 1`);
    if(!table.rows.length)return empty;
    const basis=`p.date_basis IN ('KIS_REPORTED_TRADE_DATE','COLLECTOR_KST_REGULAR_SESSION')`;
    const source=`p.source IN ('KIS_REST_INQUIRE_PRICE_PROVISIONAL',
      'KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL')`;
    const trusted=`p.trade_day=? AND p.market='J' AND p.reference_day=? AND ${basis} AND ${source}`;
    const count=await client.execute({sql:`SELECT COUNT(*) AS n,MAX(p.observed_at_utc) AS last_seen
      FROM blue_kis_provisional_daily_v1 p WHERE ${trusted}`,args:[day,reference_day]});
    const observed_count=Number(count.rows[0]?.n||0);
    if(!Number.isSafeInteger(observed_count)||observed_count<0||
      observed_count>reference_market_count!)throw Error('INVALID_PROVISIONAL_COVERAGE');
    const directory=await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_symbol_directory_v1'");
    const withNames=directory.rows.length>0;
    const from=withNames?`FROM blue_kis_provisional_daily_v1 p LEFT JOIN blue_eod_daily_v1 e ON e.trade_day=p.reference_day AND e.code=p.code LEFT JOIN blue_symbol_directory_v1 d ON d.code=p.code AND d.market=e.market`:`FROM blue_kis_provisional_daily_v1 p LEFT JOIN blue_eod_daily_v1 e ON e.trade_day=p.reference_day AND e.code=p.code`;
    const display=withNames?"CASE WHEN TRIM(COALESCE(p.name,''))<>'' AND p.name<>p.code THEN p.name ELSE COALESCE(NULLIF(d.name,p.code),p.code) END":"p.name";
    const condition=q?` AND (p.code LIKE ? ESCAPE '\\' OR ${display} LIKE ? ESCAPE '\\')`:'';
    const args=q?[day,reference_day,like(q),like(q)]:[day,reference_day];
    const filtered=q?await client.execute({sql:`SELECT COUNT(*) AS n
      ${from} WHERE ${trusted}${condition}`,args}):null;
    const total=filtered?Number(filtered.rows[0]?.n):observed_count;
    const rows=await client.execute({sql:`SELECT p.trade_day,p.code,${display} AS name,p.open,p.high,
      p.low,p.close,p.volume,p.reference_day,p.observed_at_utc,p.date_basis,p.source,
      e.high AS previous_high,e.volume AS previous_volume
      ${from}
      WHERE ${trusted}${condition}
      ORDER BY p.observed_at_utc DESC,p.code ASC LIMIT ?`,args:[...args,limit]});
    const items=rows.rows.map(r=>{
      const code=String(r.code),price=Number(r.close),open=Number(r.open),
        high=Number(r.high),low=Number(r.low),volume=Number(r.volume),
        at=String(r.observed_at_utc);
      if(!CODE.test(code)||![price,open,high,low,volume].every(Number.isSafeInteger)||
        low<=0||low>open||low>price||high<open||high<price||volume<0||
        !Number.isFinite(Date.parse(at))||Date.parse(at)>now.getTime()+300000)
        throw Error('INVALID_PROVISIONAL_ROW');
      const prevHigh=r.previous_high===null||r.previous_high===undefined?null:Number(r.previous_high);
      const prevVolume=r.previous_volume===null||r.previous_volume===undefined?null:Number(r.previous_volume);
      const previous=prevHigh!==null&&prevVolume!==null&&
        Number.isSafeInteger(prevHigh)&&prevHigh>0&&Number.isSafeInteger(prevVolume)&&prevVolume>=0
        ?{high:prevHigh,volume:prevVolume}:null;
      return {day,code,name:String(r.name||code).slice(0,70),open,high,low,
        price,volume,observed_at_utc:at,reference_day,
        source:String(r.source),date_basis:String(r.date_basis),
        provisional:true,pattern_confirmed:false,
        observations:provisionalCandleObservations({price,open,high,low,volume},previous),
        reference_comparable:previous!==null};
    });
    if(!Number.isSafeInteger(total)||total<items.length||total>observed_count)
      throw Error('INVALID_PROVISIONAL_TOTAL');
    return {...empty,observed_count,total,
      latest_observed_utc:count.rows[0]?.last_seen?String(count.rows[0].last_seen):null,
      items};
  }finally{client.close();}
}

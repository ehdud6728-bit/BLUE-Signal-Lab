/** Read-only, audited KRX daily candles from Turso. Never synthesize signals. */
import {createClient} from '@libsql/client/web';
import {decodePairs,type PriceCompareRow} from './price-compare.ts';

type TursoConfig = {TURSO_DATABASE_URL?:string;TURSO_AUTH_TOKEN?:string};
type DbClient = Pick<ReturnType<typeof createClient>,'execute'|'close'>;
type ClientFactory = (options:{url:string;authToken:string;intMode:'string'})=>DbClient;

const dayPattern=/^20\d{2}-\d{2}-\d{2}$/;

export class InvalidEodQuery extends Error {
  constructor(){super('INVALID_EOD_QUERY');}
}

function validDay(day:string):boolean {
  if(!dayPattern.test(day))return false;
  const d=new Date(day+'T00:00:00Z');
  return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===day;
}

async function withTurso<T>(env:TursoConfig,query:(client:DbClient)=>Promise<T>,factory:ClientFactory=createClient):Promise<T> {
  const url=env.TURSO_DATABASE_URL?.trim()||'';
  const authToken=env.TURSO_AUTH_TOKEN?.trim()||'';
  if(!/^(libsql|https):\/\//.test(url)||!authToken)throw Error('TURSO_EOD_NOT_CONFIGURED');
  const client=factory({url,authToken,intMode:'string'});
  try{return await query(client);}finally{client.close();}
}

export async function tursoEodDates(env:TursoConfig,factory?:ClientFactory){
  return withTurso(env,async client=>{
    const result=await client.execute(`SELECT trade_day AS day, row_count AS rows, source
      FROM blue_eod_ingest_audit_v1 WHERE row_count>=1700
      ORDER BY trade_day DESC LIMIT 400`);
    const items=result.rows.map(r=>({day:String(r.day),rows:Number(r.rows),source:String(r.source)}));
    return {storage:'TURSO',data_status:'VERIFIED_EOD_ONLY',items,latest:items[0]?.day||null};
  },factory);
}

export async function tursoEodSearch(env:TursoConfig,params:URLSearchParams,factory?:ClientFactory){
  const day=params.get('day')||'';
  const q=(params.get('q')||'').trim();
  const pageText=params.get('page')||'1',limitText=params.get('limit')||'50';
  if(!validDay(day)||q.length>50||/[\u0000-\u001f]/.test(q)||
    !/^[1-9]\d{0,3}$/.test(pageText)||!/^[1-9]\d{0,2}$/.test(limitText))throw new InvalidEodQuery();
  const page=Number(pageText),limit=Number(limitText);
  if(limit>100)throw new InvalidEodQuery();
  return withTurso(env,async client=>{
    const audit=await client.execute({sql:`SELECT row_count, source FROM blue_eod_ingest_audit_v1
      WHERE trade_day=? AND row_count>=1700 LIMIT 1`,args:[day]});
    if(!audit.rows.length)return {storage:'TURSO',data_status:'NOT_VERIFIED',day,q,page,limit,total:0,items:[]};
    // The EOD provider's exact-date price API may not include company names.
    // Keep immutable audited EOD candles untouched; join the independently
    // validated name directory when it exists, without querying D1.
    const directoryTable=await client.execute(`SELECT 1 AS ok FROM sqlite_master
      WHERE type='table' AND name='blue_symbol_directory_v1' LIMIT 1`);
    const withNames=directoryTable.rows.length>0;
    const from=withNames?`FROM blue_eod_daily_v1 e LEFT JOIN blue_symbol_directory_v1 n
      ON n.code=e.code AND n.market=e.market`:'FROM blue_eod_daily_v1 e';
    const displayName=withNames?`(CASE WHEN TRIM(COALESCE(e.name,''))<>'' AND e.name<>e.code
      THEN e.name ELSE COALESCE(NULLIF(n.name,e.code),'') END)`:'e.name';
    const nameAsOf=withNames?'n.asof_day':'NULL';
    const escaped=q.replace(/[\\%_]/g,'\\$&');
    const conditions=q?` AND (e.code LIKE ? ESCAPE '\\' OR ${displayName} LIKE ? ESCAPE '\\')`:'';
    const args=q?[day,`%${escaped}%`,`%${escaped}%`]:[day];
    const count=await client.execute({sql:`SELECT COUNT(*) AS n ${from}
      WHERE e.trade_day=?${conditions}`,args});
    const total=Number(count.rows[0]?.n||0);
    // When no search filter is applied, the complete audited day must agree
    // with its day-level import proof. Never show a partial day as exhaustive.
    if(!q&&total!==Number(audit.rows[0].row_count))throw Error('TURSO_EOD_AUDIT_ROW_COUNT_MISMATCH');
    const result=await client.execute({sql:`SELECT e.trade_day AS day,e.code,${displayName} AS name,
      ${nameAsOf} AS name_asof_day,e.market,e.open,e.high,e.low,e.close,e.volume,e.amount,e.source
      ${from} WHERE e.trade_day=?${conditions}
      ORDER BY e.amount DESC,e.code ASC LIMIT ? OFFSET ?`,args:[...args,limit,(page-1)*limit]});
    const items=result.rows.map(r=>({
      day:String(r.day),code:String(r.code),name:String(r.name||''),
      name_asof_day:r.name_asof_day?String(r.name_asof_day):null,market:String(r.market),
      open:Number(r.open),high:Number(r.high),low:Number(r.low),close:Number(r.close),
      volume:String(r.volume),amount_krw:String(r.amount),source:String(r.source)
    }));
    return {storage:'TURSO',data_status:'VERIFIED_EOD_ONLY',day,q,page,limit,
      total,items};
  },factory);
}

/** Compare user-owned discovery dates against *later*, audited KRX daily rows
 * and separately validated KIS saved snapshots. Neither is an exchange feed.
 * This does not require the discovery day to exist in Turso: older basket
 * baselines belong to the user's preserved local/D1 discovery evidence.
 * A KIS saved price is never labelled a confirmed close or full-period high.
 */
export async function tursoEodCompare(env:TursoConfig,params:URLSearchParams,
  today:string,factory?:ClientFactory){
  const pairs=decodePairs(params.get('items')||'',today);
  if(!pairs||!pairs.length)throw new InvalidEodQuery();
  return withTurso(env,async client=>{
    const codes=[...new Set(pairs.map(p=>p.code))];
    const earliest=pairs.reduce((a,b)=>a<b.day?a:b.day,pairs[0].day);
    const result=await client.execute({sql:`SELECT e.trade_day,e.code,e.close,e.high
      FROM blue_eod_daily_v1 e
      JOIN blue_eod_ingest_audit_v1 a ON a.trade_day=e.trade_day AND a.row_count>=1700
      WHERE e.code IN (${codes.map(()=>'?').join(',')}) AND e.trade_day>?
        AND e.trade_day<=?
      ORDER BY e.trade_day ASC,e.code ASC LIMIT 5001`,args:[...codes,earliest,today]});
    if(result.rows.length>5000)throw Error('TURSO_EOD_COMPARE_RANGE_TOO_LARGE');
    const snapshots=await client.execute({sql:`SELECT trade_date,code,market,received_at_utc,payload_json
      FROM blue_kis_live_quotes_r141
      WHERE code IN (${codes.map(()=>'?').join(',')}) AND trade_date>?
        AND trade_date<=?
      ORDER BY trade_date ASC,received_at_utc DESC LIMIT 5001`,
      args:[...codes,earliest,today]});
    if(snapshots.rows.length>5000)throw Error('TURSO_KIS_COMPARE_RANGE_TOO_LARGE');
    const byCode=new Map<string,{day:string;close:number;high:number}[]>();
    for(const r of result.rows){
      const day=String(r.trade_day),code=String(r.code);
      const close=Number(r.close),high=Number(r.high);
      if(!validDay(day)||!codes.includes(code)||!Number.isSafeInteger(close)||close<=0||
        !Number.isSafeInteger(high)||high<close)throw Error('TURSO_EOD_COMPARE_INVALID_PRICE');
      const rows=byCode.get(code)||[];rows.push({day,close,high});byCode.set(code,rows);
    }
    type QuoteSnapshot={day:string;price:number;high:number;at:string;market:string};
    const quotesByCode=new Map<string,QuoteSnapshot[]>();
    for(const r of snapshots.rows){
      try{
        const code=String(r.code),day=String(r.trade_date),market=String(r.market);
        const at=String(r.received_at_utc);
        const payload=JSON.parse(String(r.payload_json)) as Record<string,unknown>;
        const price=Number(payload.price),high=Number(payload.high),low=Number(payload.low);
        const timestamp=Date.parse(at);
        // Verify stored row keys AND the original KIS evidence. Invalid rows
        // are omitted, never converted to prices or allowed to hide audited EOD.
        if(!codes.includes(code)||!validDay(day)||day>today||
          !['J','NX'].includes(market)||payload.code!==code||
          payload.trade_date_kst!==day||payload.market!==market||
          payload.received_at_utc!==at||payload.source!=='KIS_REST_INQUIRE_PRICE'||
          payload.research_only!==true||!Number.isFinite(timestamp)||
          new Date(timestamp+9*3600_000).toISOString().slice(0,10)!==day||
          !Number.isSafeInteger(price)||price<=0||
          !Number.isSafeInteger(high)||high<price||
          !Number.isSafeInteger(low)||low<=0||low>price||
          (payload.reported_trade_date!=null&&payload.reported_trade_date!==day.replaceAll('-','')))continue;
        const rows=quotesByCode.get(code)||[];
        rows.push({day,price,high,at,market});quotesByCode.set(code,rows);
      }catch{/* A corrupt or unverified snapshot does not invalidate audited EOD. */}
    }
    const items=pairs.map(({code,day})=>{
      const later=(byCode.get(code)||[]).filter(r=>r.day>day);
      const quoteRows=(quotesByCode.get(code)||[]).filter(r=>r.day>day);
      const eodLatest=later.at(-1)||null;
      const quoteLatest=quoteRows.sort((a,b)=>b.day.localeCompare(a.day)||b.at.localeCompare(a.at)||
        (a.market==='J'?-1:1))[0]||null;
      // Confirmed EOD supersedes a same-day intraday quote. A later KIS
      // snapshot supersedes an older confirmed EOD, never vice versa.
      const useQuote=!!quoteLatest&&(!eodLatest||quoteLatest.day>eodLatest.day);
      const latestDay=useQuote?quoteLatest!.day:eodLatest?.day??null;
      const auditedDays=new Set(later.map(r=>r.day));
      const highs=[...later.map(r=>({day:r.day,high:r.high,source:'KRX_VERIFIED_EOD_HIGH'})),
        // Audited full-day high supersedes the same-day partial KIS high.
        ...quoteRows.filter(r=>!auditedDays.has(r.day))
          .map(r=>({day:r.day,high:r.high,source:'KIS_TURSO_DAY_HIGH'}))];
      const high=highs.sort((a,b)=>b.high-a.high||a.day.localeCompare(b.day))[0]||null;
      const observedDays=[...later.map(r=>r.day),...quoteRows.map(r=>r.day)].sort();
      return {code,day,status:latestDay?'READY':'NO_LATER_PRICE',
        latest_price:useQuote?quoteLatest!.price:eodLatest?.close??null,latest_day:latestDay,
        latest_source:useQuote?'KIS_TURSO_SNAPSHOT':eodLatest?'KRX_VERIFIED_EOD_CLOSE':null,
        latest_at:useQuote?quoteLatest!.at:null,latest_market:useQuote?quoteLatest!.market:null,
        period_high:high?.high??null,period_high_day:high?.day??null,
        period_high_source:high?.source??null,
        high_coverage_from:observedDays[0]??null,
        high_coverage_to:observedDays.at(-1)??null,
        // Import range is currently short; it cannot establish complete
        // coverage for arbitrary older local basket discovery dates.
        high_complete:false} satisfies PriceCompareRow & {high_coverage_from:string|null};
    });
    const hasSavedQuotes=[...quotesByCode.values()].some(rows=>rows.length>0);
    return {status:'OK',storage:'TURSO',
      source:hasSavedQuotes?'KRX_VERIFIED_EOD_PLUS_KIS_SAVED':'KRX_VERIFIED_EOD_ONLY',items,
      note:hasSavedQuotes?
        'KRX 확정 종가와 별도로 수집된 KIS 저장 시세를 날짜·시각과 함께 구분합니다. 실시간 체결가가 아니며 최고가는 부분 관측입니다.':
        '검증된 KRX 확정 일봉만 사용합니다. 장중 현재가가 아니며 기간 최고가는 부분 관측입니다.'};
  },factory);
}

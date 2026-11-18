/** Read-only, audited KRX daily candles from Turso. Never synthesize signals. */
import {createClient} from '@libsql/client/web';

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

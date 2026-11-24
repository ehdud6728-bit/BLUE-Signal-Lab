import {createClient} from '@libsql/client/web';
type Env={TURSO_DATABASE_URL?:string;TURSO_AUTH_TOKEN?:string};
type DB=Pick<ReturnType<typeof createClient>,'execute'|'close'>;
type Factory=(opts:{url:string;authToken:string;intMode:'string'})=>DB;
const day=(x:unknown):x is string=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const n=(x:unknown)=>finite(x)&&Number.isSafeInteger(x)&&x>=0;
const hex=(a:ArrayBuffer)=>Array.from(new Uint8Array(a),v=>v.toString(16).padStart(2,'0')).join('');
const symbols=['.DJI','.NDX','.SPX','.SOX','.VIX'];
function summary(x:any,cutoff:string){
  return x===null||x&&day(x.day)&&day(x.previous_day)&&x.previous_day<x.day&&x.day<=cutoff&&finite(x.close)&&x.close>0&&finite(x.change_pct)&&(x.change5_pct===null||finite(x.change5_pct))&&n(x.sessions)&&x.sessions>=2&&x.sessions<=150;
}
export async function tursoMarketTrends(env:Env,factory:Factory=createClient,now=new Date()){
  const url=env.TURSO_DATABASE_URL?.trim()||'',authToken=env.TURSO_AUTH_TOKEN?.trim()||'';
  if(!/^(https|libsql):\/\//.test(url)||!authToken)throw Error('TREND_DB_NOT_CONFIGURED');
  const today=new Date(now.getTime()+32400000).toISOString().slice(0,10);
  const db=factory({url,authToken,intMode:'string'});
  try{
    const query=(sql:string,args:string[]=[])=>db.execute({sql,args});
    if(!(await query("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_market_trends_v1'")).rows.length)return {status:'NOT_CAPTURED'};
    const r=(await query('SELECT receipt_day,observed_at_utc,payload_json,payload_sha256 FROM blue_market_trends_v1 WHERE receipt_day<=? ORDER BY receipt_day DESC LIMIT 1',[today])).rows[0];
    if(!r)return {status:'NOT_CAPTURED'};
    const raw=String(r.payload_json),digest=hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)));
    if(digest!==r.payload_sha256)throw Error('TREND_HASH_MISMATCH');
    const s=JSON.parse(raw);
    if(s.schema!=='BLUE_ROTATION_TRENDS_V1'||s.receipt_day!==r.receipt_day||s.observed_at_utc!==r.observed_at_utc||
      !day(s.receipt_day)||s.receipt_day>today||!day(s.category_receipt_day)||s.category_receipt_day>s.receipt_day||
      !Number.isFinite(Date.parse(s.observed_at_utc))||Date.parse(s.observed_at_utc)>now.getTime()||
      new Date(Date.parse(s.observed_at_utc)+32400000).toISOString().slice(0,10)!==s.receipt_day||
      !day(s.domestic_cutoff)||s.domestic_cutoff>=s.receipt_day||!day(s.overseas_cutoff)||s.overseas_cutoff>=s.receipt_day||
      !Array.isArray(s.markets)||s.markets.length!==2||!Array.isArray(s.global)||s.global.length!==symbols.length)throw Error('TREND_SNAPSHOT_INVALID');
    const scopes=new Set<string>();
    for(const m of s.markets){
      if(!['KOSPI','KOSDAQ'].includes(m.market)||scopes.has(m.market)||!n(m.universe)||m.universe<1||m.universe>100||
        m.attempted!==m.universe||!n(m.benchmark_sessions)||!summary(m.benchmark,s.domestic_cutoff)||!Array.isArray(m.rows)||m.rows.length!==m.universe)throw Error('TREND_SCOPE_INVALID');
      scopes.add(m.market);const seen=new Set<string>();
      for(const x of m.rows){
        if(!/^\d{4,5}$/.test(x.code)||seen.has(x.code)||typeof x.name!=='string'||!x.name||x.name.length>70||
          (x.status==='AVAILABLE')!==(x.trend!==null)||!['AVAILABLE','MISSING'].includes(x.status))throw Error('TREND_ROW_INVALID');
        seen.add(x.code);
        const t=x.trend;
        if(t!==null){
          if(x.reason!==null||!m.benchmark||t.day!==m.benchmark.day||t.matched_sessions!==26||
            ![t.rs5,t.rs10,t.rs20,t.momentum].every(finite)||!['LEADING','WEAKENING','IMPROVING','LAGGING','NEUTRAL'].includes(t.quadrant))throw Error('TREND_METRIC_INVALID');
          const q=t.rs10===0||t.momentum===0?'NEUTRAL':t.rs10>0?t.momentum>0?'LEADING':'WEAKENING':t.momentum>0?'IMPROVING':'LAGGING';
          if(t.quadrant!==q)throw Error('TREND_QUADRANT_INVALID');
        }
      }
    }
    const gs=new Set<string>();
    for(const x of s.global){
      if(!symbols.includes(x.symbol)||gs.has(x.symbol)||typeof x.name!=='string'||!['AVAILABLE','MISSING'].includes(x.status)||
        (x.status==='AVAILABLE')!==(x.summary!==null)||!summary(x.summary,s.overseas_cutoff))throw Error('TREND_GLOBAL_INVALID');
      gs.add(x.symbol);
    }
    return {status:'READY',...s,stale_receipt:s.receipt_day!==today};
  }finally{db.close();}
}

import {createClient} from '@libsql/client/web';
type Env={TURSO_DATABASE_URL?:string;TURSO_AUTH_TOKEN?:string};
type DB=Pick<ReturnType<typeof createClient>,'execute'|'close'>;
type Factory=(opts:{url:string;authToken:string;intMode:'string'})=>DB;
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const positive=(n:unknown)=>finite(n)&&n>0;
const count=(n:unknown)=>n===null||typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
const DAY=/^20\d{2}-\d{2}-\d{2}$/;
const direction=(x:unknown)=>x===null||['BUY','SELL','FLAT'].includes(String(x));
const dayOf=(now:Date)=>new Date(now.getTime()+32400000).toISOString().slice(0,10);
function validated(row:Record<string,unknown>,now:Date){
  const s=JSON.parse(String(row.payload_json));
  if(s.schema!=='BLUE_KIS_MARKET_V1'||s.source!=='KIS_CATEGORY_AND_DAILY_INVESTOR'||s.quote_trade_day!==null||
    s.receipt_day!==row.receipt_day||s.observed_at_utc!==row.observed_at_utc||!DAY.test(s.receipt_day)||
    !Number.isFinite(Date.parse(s.observed_at_utc))||Date.parse(s.observed_at_utc)>now.getTime()||
    dayOf(new Date(s.observed_at_utc))!==s.receipt_day||!Array.isArray(s.markets)||s.markets.length!==2)
    throw Error('INVALID_MARKET_SNAPSHOT');
  const seen=new Set<string>();
  for(const m of s.markets){
    if(!['KOSPI','KOSDAQ'].includes(m.market)||seen.has(m.market)||!positive(m.index)||!finite(m.change_pct)||
      ![m.up,m.down,m.flat].every(count)||!Array.isArray(m.sectors)||!m.sectors.length||m.sectors.length>100||
      !['AVAILABLE','MISSING','UNAVAILABLE'].includes(m.flow_status)||!Array.isArray(m.flows)||m.flows.length>10)
      throw Error('INVALID_MARKET_SCOPE');
    const coverage=m.sector_coverage;
    if(coverage!==undefined){
      const reasons=['invalid_code','invalid_name','invalid_index','invalid_change','duplicate'];
      if(!coverage||![coverage.received,coverage.accepted,coverage.summary_rows,coverage.excluded_rows].every(n=>count(n)&&n!==null)||
        coverage.received>250||coverage.accepted!==m.sectors.length||
        coverage.received!==coverage.accepted+coverage.summary_rows+coverage.excluded_rows||
        !coverage.excluded||!reasons.every(k=>count(coverage.excluded[k])&&coverage.excluded[k]!==null)||
        reasons.reduce((n,k)=>n+coverage.excluded[k],0)!==coverage.excluded_rows||
        coverage.status!==(coverage.excluded_rows?'PARTIAL':'COMPLETE_RESPONSE'))throw Error('INVALID_MARKET_SECTOR_COVERAGE');
    }
    seen.add(m.market);
    const codes=new Set<string>();
    for(const x of m.sectors){
      if(!/^\d{4,5}$/.test(x.code)||codes.has(x.code)||typeof x.name!=='string'||!x.name||x.name.length>70||
        !positive(x.index)||!finite(x.change_pct)||!finite(x.relative_pct)||Math.abs(x.relative_pct-(x.change_pct-m.change_pct))>.011||
        !(x.turnover_share_pct===null||finite(x.turnover_share_pct)&&x.turnover_share_pct>=0&&x.turnover_share_pct<=100))
        throw Error('INVALID_MARKET_SECTOR');
      codes.add(x.code);
    }
    let prev='9999-99-99';
    for(const f of m.flows){
      if(!DAY.test(f.day)||f.day>s.receipt_day||f.day>=prev||![f.foreign,f.institution,f.individual].every(direction))
        throw Error('INVALID_MARKET_FLOW');
      prev=f.day;
    }
  }
  return s;
}
export async function tursoMarketRotation(env:Env,factory:Factory=createClient,now=new Date()){
  const empty={status:'NOT_CAPTURED',source:'KIS_CATEGORY_AND_DAILY_INVESTOR',markets:[],external:{vix:null,vix_futures:null,global_indices:null,events:null}};
  const url=env.TURSO_DATABASE_URL?.trim()||'',authToken=env.TURSO_AUTH_TOKEN?.trim()||'';
  if(!/^(https|libsql):\/\//.test(url)||!authToken)throw Error('MARKET_DB_NOT_CONFIGURED');
  const db=factory({url,authToken,intMode:'string'});
  try{
    const run=(sql:string,args:string[]=[])=>db.execute({sql,args});
    const t=await run("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_market_rotation_v1'");
    if(!t.rows.length)return empty;
    const keys=await run('SELECT receipt_day FROM blue_market_rotation_v1 WHERE receipt_day<=? ORDER BY receipt_day DESC LIMIT 6',[dayOf(now)]);
    if(!keys.rows.length)return empty;
    const load=async(day:string)=>{
      const r=await run('SELECT receipt_day,observed_at_utc,payload_json FROM blue_market_rotation_v1 WHERE receipt_day=?',[day]);
      if(r.rows.length!==1)throw Error('MARKET_SNAPSHOT_CHANGED');
      return validated(r.rows[0],now);
    };
    const latest=await load(String(keys.rows[0].receipt_day));
    const earlier=keys.rows.length>1?await load(String(keys.rows[1].receipt_day)):null;
    const markets=latest.markets.map((m:any)=>{
      const prev=earlier?.markets.find((x:any)=>x.market===m.market);
      const breadth=m.up!==null&&m.down!==null&&m.flat!==null&&m.up+m.down+m.flat>0?m.up/(m.up+m.down+m.flat)*100:null;
      const sectors=m.sectors.map((s:any)=>{
        const p=prev?.sectors.find((x:any)=>x.code===s.code&&x.name===s.name);
        return {...s,relative_delta_pp:p?Math.round((s.relative_pct-p.relative_pct)*100)/100:null,
          share_delta_pp:p&&s.turnover_share_pct!==null&&p.turnover_share_pct!==null?Math.round((s.turnover_share_pct-p.turnover_share_pct)*100)/100:null};
      }).sort((a:any,b:any)=>b.relative_pct-a.relative_pct||a.code.localeCompare(b.code));
      return {...m,breadth_pct:breadth,sectors};
    });
    const current=latest.receipt_day===dayOf(now);
    const state=!current?'STALE_RECEIPT':markets.every((m:any)=>m.breadth_pct!==null&&m.change_pct>0&&m.breadth_pct>=55)?'BROAD_ADVANCE_OBSERVED':
      markets.every((m:any)=>m.breadth_pct!==null&&m.change_pct<0&&m.breadth_pct<=45)?'BROAD_DECLINE_OBSERVED':'MIXED_OR_INCOMPLETE';
    return {...empty,status:'READY',receipt_day:latest.receipt_day,observed_at_utc:latest.observed_at_utc,quote_trade_day:null,
      comparison_receipt_day:earlier?.receipt_day??null,capture_days:keys.rows.length,state,markets};
  }finally{db.close();}
}

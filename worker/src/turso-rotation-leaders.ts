import {createClient} from '@libsql/client/web';
type Env={TURSO_DATABASE_URL?:string;TURSO_AUTH_TOKEN?:string};
type DB=Pick<ReturnType<typeof createClient>,'execute'|'close'>;
type Factory=(opts:{url:string;authToken:string;intMode:'string'})=>DB;
const day=(x:unknown):x is string=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const finite=(x:unknown):x is number=>typeof x==='number'&&Number.isFinite(x);
const count=(x:unknown)=>finite(x)&&Number.isSafeInteger(x)&&x>=0;
const hex=(a:ArrayBuffer)=>Array.from(new Uint8Array(a),x=>x.toString(16).padStart(2,'0')).join('');
export async function tursoRotationLeaders(env:Env,factory:Factory=createClient,now=new Date()){
 const url=env.TURSO_DATABASE_URL?.trim()||'',authToken=env.TURSO_AUTH_TOKEN?.trim()||'';
 if(!/^(https|libsql):\/\//.test(url)||!authToken)throw Error('LEADERS_DB_NOT_CONFIGURED');
 const today=new Date(now.getTime()+32400000).toISOString().slice(0,10),db=factory({url,authToken,intMode:'string'});
 try{
  const q=(sql:string,args:string[]=[])=>db.execute({sql,args});
  if(!(await q("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_rotation_leaders_v1'")).rows.length)return {status:'NOT_CAPTURED'};
  const r=(await q('SELECT receipt_day,observed_at_utc,payload_json,payload_sha256 FROM blue_rotation_leaders_v1 WHERE receipt_day<=? ORDER BY receipt_day DESC LIMIT 1',[today])).rows[0];
  if(!r)return {status:'NOT_CAPTURED'};
  const raw=String(r.payload_json);
  if(hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)))!==r.payload_sha256)throw Error('LEADERS_HASH_MISMATCH');
  const s=JSON.parse(raw);
  if(s.schema!=='BLUE_ROTATION_LEADERS_V1'||s.receipt_day!==r.receipt_day||s.observed_at_utc!==r.observed_at_utc||
    !day(s.receipt_day)||s.receipt_day>today||!Number.isFinite(Date.parse(s.observed_at_utc))||Date.parse(s.observed_at_utc)>now.getTime()||
    new Date(Date.parse(s.observed_at_utc)+32400000).toISOString().slice(0,10)!==s.receipt_day||
    s.master_receipt_day!==s.receipt_day||!Number.isFinite(Date.parse(s.master_observed_at_utc))||Date.parse(s.master_observed_at_utc)>Date.parse(s.observed_at_utc)||
    !day(s.day)||!day(s.reference5)||!day(s.reference10)||s.reference10>=s.reference5||s.reference5>=s.day||s.day>s.receipt_day||
    !day(s.trend_receipt_day)||s.trend_receipt_day>s.receipt_day||!/^[a-f0-9]{64}$/.test(s.trend_sha256)||
    !['KOSPI','KOSDAQ'].every(m=>/^[a-f0-9]{64}$/.test(s.master_hashes?.[m]))||
    !['AUDITED','MISSING','UNAVAILABLE'].includes(s.signal_status)||s.sector_limit!==12||!Array.isArray(s.markets)||s.markets.length!==2)throw Error('LEADERS_INVALID');
  if(s.latest_trend_day!==undefined&&(!day(s.latest_trend_day)||s.latest_trend_day<s.day||s.latest_trend_day>s.receipt_day||!['AUDITED_DATES_LEGACY','EXACT_BENCHMARK_DATES'].includes(s.reference_basis)))throw Error('LEADERS_ALIGNMENT_INVALID');
  const thresholds=s.thresholds;
  if(!thresholds||thresholds.minimum_turnover_krw!==500000000||thresholds.leader_min_return10_pct!==3||thresholds.follower_return10_min_pct!==-3||thresholds.follower_return10_max_pct!==3||thresholds.follower_return5_max_pct!==3||thresholds.follower_min_turnover_ratio!==1.2)throw Error('LEADERS_THRESHOLDS_INVALID');
  const markets=new Set<string>();
  for(const m of s.markets){
   if(!['KOSPI','KOSDAQ'].includes(m.market)||markets.has(m.market)||![m.improving,m.analyzed,m.master_members,m.matched_members].every(count)||
     m.analyzed!==Math.min(m.improving,s.sector_limit)||m.matched_members>m.master_members||!Array.isArray(m.groups)||m.groups.length!==m.analyzed)throw Error('LEADERS_SCOPE_INVALID');
   markets.add(m.market);const codes=new Set<string>();
   for(const g of m.groups){
    const expected=g.previous_quadrant===null?'UNKNOWN':g.previous_quadrant==='IMPROVING'?'CONTINUING':'NEW_ENTRY';
    if(!/^\d{4,5}$/.test(g.code)||codes.has(g.code)||typeof g.name!=='string'||!g.name||g.name.length>70||!finite(g.rs10)||g.rs10>=0||!finite(g.momentum)||g.momentum<=0||
      !(g.previous_quadrant===null||['LEADING','WEAKENING','IMPROVING','LAGGING','NEUTRAL'].includes(g.previous_quadrant))||g.entry!==expected||
      ![g.members,g.matched,g.eligible].every(count)||g.matched>g.members||g.eligible>g.matched||
      !Array.isArray(g.leaders)||!Array.isArray(g.followers)||g.leaders.length>3||g.followers.length>3||g.leaders.length+g.followers.length>g.eligible||
      g.followers.length&&!g.leaders.length)throw Error('LEADERS_GROUP_INVALID');
    codes.add(g.code);const stockCodes=new Set<string>();
    for(const [kind,rows] of [['leader',g.leaders],['follower',g.followers]] as const){
     for(const x of rows){
      if(!/^[0-9A-Z]{6}$/.test(x.code)||stockCodes.has(x.code)||typeof x.name!=='string'||!x.name||x.name.length>100||
        !finite(x.close)||x.close<=0||!finite(x.amount)||x.amount<thresholds.minimum_turnover_krw||!finite(x.r5)||x.r5<=0||!finite(x.r10)||
        !(x.amount_ratio===null||finite(x.amount_ratio)&&x.amount_ratio>=0)||
        !(s.signal_status==='AUDITED'?Array.isArray(x.signals)&&x.signals.length<=30&&x.signals.every((v:unknown)=>typeof v==='string'&&/^[A-Z0-9_]{2,60}$/.test(v)):x.signals===null))throw Error('LEADERS_STOCK_INVALID');
      if(kind==='leader'?x.r10<3:x.r10< -3||x.r10>3||x.r5>3||!finite(x.amount_ratio)||x.amount_ratio<1.2||x.r10>=g.leaders[0].r10)throw Error('LEADERS_STOCK_RULE_MISMATCH');
      stockCodes.add(x.code);
     }
    }
   }
  }
  // Ensure current ranking is still bound to the exact source trend generation.
  const latest=(await q('SELECT payload_sha256 FROM blue_market_trends_v1 WHERE receipt_day<=? ORDER BY receipt_day DESC LIMIT 1',[today])).rows[0];
  return {status:'READY',...s,stale_receipt:s.receipt_day!==today,trend_superseded:latest?.payload_sha256!==s.trend_sha256};
 }finally{db.close();}
}

/** Bounded Turso SELECT-only source for diagnosing four historical research gaps.
 * Existing EOD and R1.1 research are immutable. Signals contain matches only,
 * so these records cannot prove which individual codes the old scan observed.
 */
import {createClient} from '@libsql/client';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

export const DAYS=Object.freeze(['2026-11-10','2026-11-13','2026-11-16','2026-11-17']);
const HASH=/^[0-9a-f]{64}$/;
const CODE=/^[0-9A-Z]{6}$/;
const SOURCES=new Set(['KRX_PYKRX_EXACT_DAY_VERIFIED','KRX_OPENAPI_EXACT_DAY_VERIFIED']);
const assert=(condition,code)=>{if(!condition)throw Error(code);};
const n=(value,min,max)=>{
  const result=Number(value);
  assert(value!==null&&value!==undefined&&Number.isSafeInteger(result)&&
    result>=min&&result<=max,'UNIVERSE_GAP_INVALID_COUNT');
  return result;
};

export async function exportResearchUniverseGap(client,{mode='plan'}={}){
  assert(['plan','inspect'].includes(mode),'UNIVERSE_GAP_BAD_MODE');
  if(mode==='plan')return {status:'PLAN_ONLY',days:DAYS,turso_queries:0,
    d1_queries:0,writes:0,krx_requests:0,kis_requests:0};
  assert(client?.execute,'UNIVERSE_GAP_CLIENT_REQUIRED');
  const placeholders=DAYS.map(()=>'?').join(',');
  const ea=(await client.execute({sql:`SELECT trade_day,row_count,source,day_sha256
    FROM blue_eod_ingest_audit_v1 WHERE trade_day IN (${placeholders}) ORDER BY trade_day`,
    args:DAYS})).rows;
  const sa=(await client.execute({sql:`SELECT trade_day,row_count,observed_stocks,
    source_payload_sha256,source_audit_sha256 FROM blue_research_signal_audit_v1
    WHERE trade_day IN (${placeholders}) ORDER BY trade_day`,args:DAYS})).rows;
  assert(ea.length===DAYS.length&&sa.length===DAYS.length,'UNIVERSE_GAP_MISSING_AUDIT');
  const details=[];
  for(let i=0;i<DAYS.length;i++){
    const day=DAYS[i],e=ea[i],s=sa[i];
    assert(String(e.trade_day)===day&&String(s.trade_day)===day&&
      SOURCES.has(String(e.source))&&HASH.test(String(e.day_sha256))&&
      HASH.test(String(s.source_payload_sha256))&&
      HASH.test(String(s.source_audit_sha256)),'UNIVERSE_GAP_BAD_AUDIT');
    const expected=n(e.row_count,1700,10000),observed=n(s.observed_stocks,1700,10000),
      signals=n(s.row_count,0,10000);
    assert(expected>observed&&expected-observed===50&&signals<=observed,
      'UNIVERSE_GAP_CHANGED_OR_RESOLVED');
    const rows=(await client.execute({sql:`SELECT code,market,name
      FROM blue_eod_daily_v1 WHERE trade_day=? ORDER BY code`,args:[day]})).rows;
    assert(rows.length===expected,'UNIVERSE_GAP_EOD_READBACK_MISMATCH');
    let prev='';const markets={KOSPI:0,KOSDAQ:0};
    const eod_codes=rows.map(r=>{
      const code=String(r.code),market=String(r.market),name=String(r.name);
      assert(CODE.test(code)&&code>prev&&market in markets&&name.length<=100,
        'UNIVERSE_GAP_INVALID_EOD_CODE');
      prev=code;markets[market]++;
      return {code,market,name};
    });
    assert(markets.KOSPI>=400&&markets.KOSDAQ>=400,'UNIVERSE_GAP_PARTIAL_MARKET');
    details.push({day,eod_count:expected,research_observed_count:observed,
      research_signal_count:signals,net_gap:expected-observed,
      eod_source:String(e.source),eod_audit_sha256:String(e.day_sha256),
      research_payload_sha256:String(s.source_payload_sha256),
      research_audit_sha256:String(s.source_audit_sha256),eod_codes});
  }
  return {format:'BLUE_RESEARCH_UNIVERSE_GAP_SOURCE_V1',days:details,
    eod_rows_readback:details.reduce((sum,d)=>sum+d.eod_count,0),
    note:'Audited EOD codes versus a fresh MARCAP snapshot; historic research audit has only counts and selected signals. Candidate code lists are NOT an original-scan membership proof.',
    turso_read_only:true,d1_queries:0,writes:0,krx_requests:0,kis_requests:0};
}

async function main(){
  const args=process.argv.slice(2);
  const mode=(args.find(a=>a.startsWith('--mode='))||'--mode=plan').slice(7);
  const out=(args.find(a=>a.startsWith('--out='))||'--out=output/universe_gap/source.json').slice(6);
  if(mode==='plan'){
    console.log('BLUE_RESEARCH_UNIVERSE_GAP_PLAN',JSON.stringify(await exportResearchUniverseGap(null,{mode})));
    return;
  }
  const url=String(process.env.TURSO_DATABASE_URL||''),authToken=String(process.env.TURSO_AUTH_TOKEN||'');
  assert(/^(libsql|https):\/\//.test(url)&&authToken,'UNIVERSE_GAP_MISSING_CONFIG');
  const client=createClient({url,authToken,intMode:'string'});
  try{
    const source=await exportResearchUniverseGap(client,{mode});
    await mkdir(dirname(out),{recursive:true});
    await writeFile(out,JSON.stringify(source)+'\n','utf8');
    console.log('BLUE_RESEARCH_UNIVERSE_GAP_SOURCE',`days=${source.days.length}`,
      `eod_readback=${source.eod_rows_readback}`,'TURSO_WRITES=0','D1_SQL=0');
  }finally{client.close();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(error=>{
    const known=String(error?.message||'');
    console.error('BLUE_RESEARCH_UNIVERSE_GAP_FAILED',
      known.startsWith('UNIVERSE_GAP_')?known:'SANITIZED_RUNTIME_FAILURE');
    process.exitCode=1;
  });
}

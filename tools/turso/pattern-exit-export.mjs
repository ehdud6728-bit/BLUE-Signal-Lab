/** Select-only Turso export for offline short/long first-touch exit research.
 * Calendar holidays, corporate actions and sector benchmarks are NOT verified.
 * A bounded dataset can generate descriptive results, never trade advice.
 */
import {createClient} from '@libsql/client';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';

const WINDOWS=new Set([5,10,20,60,120,250,500]);
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const CODE=/^[0-9A-Z]{6}$/;
const TOKEN=/^[A-Z0-9_]{2,60}$/;
const assert=(ok,reason)=>{if(!ok)throw Error(reason);};
function validDay(value){if(typeof value!=='string'||!DATE.test(value))return false;
  const parsed=new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;}
function n(value,min,max){const x=Number(value);
  assert(Number.isSafeInteger(x)&&x>=min&&x<=max,'INVALID_EXIT_EXPORT_COUNT');return x;}

export async function exportPatternExitSource(client,{sessions=60,mode='plan'}={}){
  assert(WINDOWS.has(sessions)&&['plan','study'].includes(mode),'INVALID_EXIT_EXPORT_MODE');
  if(mode==='plan')return {status:'PLAN_ONLY',storage:'TURSO',turso_sql_queries:0,
    d1_sql_queries:0,requested_sessions:sessions};
  assert(client?.execute,'EXIT_EXPORT_CLIENT_REQUIRED');
  const audit=await client.execute({sql:`SELECT trade_day,row_count,source,day_sha256
    FROM blue_eod_ingest_audit_v1 ORDER BY trade_day DESC LIMIT ?`,args:[sessions]});
  const eod=audit.rows.map(r=>({day:String(r.trade_day),
    expected:n(r.row_count,1700,10000),source:String(r.source),hash:String(r.day_sha256)}));
  assert(eod.length>0,'EXIT_EXPORT_NO_EOD_AUDIT');
  eod.reverse();let prior='';
  for(const d of eod){assert(validDay(d.day)&&d.day>prior&&d.source.startsWith('KRX_')&&
    /^[a-f0-9]{64}$/.test(d.hash),'EXIT_EXPORT_BAD_EOD_AUDIT');prior=d.day;}
  const start=eod[0].day,end=eod.at(-1).day;
  const actualEod=await client.execute({sql:`SELECT trade_day,COUNT(*) AS n
    FROM blue_eod_daily_v1 WHERE trade_day BETWEEN ? AND ? GROUP BY trade_day`,args:[start,end]});
  const counts=new Map(actualEod.rows.map(r=>[String(r.trade_day),n(r.n,0,10000)]));
  const eodSet=new Set(eod.map(x=>x.day));
  assert(actualEod.rows.length===eod.length&&
    actualEod.rows.every(r=>eodSet.has(String(r.trade_day)))&&
    eod.every(r=>counts.get(r.day)===r.expected),'EXIT_EXPORT_INCOMPLETE_EOD');
  const audited=await client.execute({sql:`SELECT trade_day,row_count,observed_stocks,
    signal_events,source_payload_sha256 FROM blue_research_signal_audit_v1
    WHERE trade_day BETWEEN ? AND ? ORDER BY trade_day`,args:[start,end]});
  const researchDays=new Map();
  const excludedResearchDays=[];
  const seenResearchDays=new Set();
  for(const r of audited.rows){const day=String(r.trade_day);
    assert(eodSet.has(day)&&!seenResearchDays.has(day),'EXIT_EXPORT_RESEARCH_WITHOUT_EOD');
    seenResearchDays.add(day);
    const matched=n(r.row_count,0,10000),observed=n(r.observed_stocks,1700,10000);
    const events=n(r.signal_events,0,300000);
    const hash=String(r.source_payload_sha256);
    assert(matched<=observed&&events>=matched&&events<=matched*30&&/^[a-f0-9]{64}$/.test(hash),
      'EXIT_EXPORT_BAD_RESEARCH_AUDIT');
    if(observed!==counts.get(day)){
      excludedResearchDays.push({day,reason:'RESEARCH_UNIVERSE_EOD_COUNT_MISMATCH',
        observed_stocks:observed,eod_stocks:counts.get(day)});
      continue;
    }
    researchDays.set(day,{matched,events,hash});
  }
  const excludedSet=new Set(excludedResearchDays.map(r=>r.day));
  const research=await client.execute({sql:`SELECT trade_day,code,signal_names,source_payload_sha256
    FROM blue_research_signals_v1 WHERE trade_day BETWEEN ? AND ?
    ORDER BY trade_day,code LIMIT 100001`,args:[start,end]});
  assert(research.rows.length<=100000,'EXIT_EXPORT_TOO_MANY_SIGNALS');
  const signals=[],signalCount=new Map(),eventsCount=new Map();
  for(const r of research.rows){const day=String(r.trade_day),code=String(r.code);
    // The earlier importer checked the close of selected stocks but did not
    // compare total observed vs independently audited KRX universe. These
    // historical partial-universe signals are not valid study outcomes.
    if(excludedSet.has(day))continue;
    const names=String(r.signal_names).split(',');const proof=researchDays.get(day);
    assert(proof&&CODE.test(code)&&String(r.source_payload_sha256)===proof.hash&&
      names.length>0&&names.length<=30&&names.every(x=>TOKEN.test(x))&&
      names.join(',')===[...new Set(names)].sort().join(','),'EXIT_EXPORT_UNVERIFIED_SIGNAL');
    signals.push({day,code,names});
    signalCount.set(day,(signalCount.get(day)||0)+1);
    eventsCount.set(day,(eventsCount.get(day)||0)+names.length);
  }
  for(const [day,proof] of researchDays){
    assert((signalCount.get(day)||0)===proof.matched&&
      (eventsCount.get(day)||0)===proof.events,'EXIT_EXPORT_SIGNAL_AUDIT_MISMATCH');
  }
  const bars=[];const PAGE=2000;
  const validDays=[...researchDays.keys()];
  for(let offset=0;validDays.length&&offset<=350000;offset+=PAGE){
    const result=await client.execute({sql:`SELECT e.trade_day AS day,e.code,e.open,e.high,e.low,e.close
      FROM blue_eod_daily_v1 e WHERE e.trade_day BETWEEN ? AND ? AND e.code IN
      (SELECT DISTINCT s.code FROM blue_research_signals_v1 s
       WHERE s.trade_day IN (${validDays.map(()=>'?').join(',')}))
      ORDER BY e.trade_day,e.code LIMIT ? OFFSET ?`,
      args:[start,end,...validDays,PAGE,offset]});
    for(const r of result.rows){const day=String(r.day),code=String(r.code);
      assert(eodSet.has(day)&&CODE.test(code),'EXIT_EXPORT_BAD_BAR_KEY');
      const prices={};
      for(const key of ['open','high','low','close']){
        const value=n(r[key],1,10000000000);prices[key]=value;
      }
      assert(prices.low<=Math.min(prices.open,prices.close)&&
        prices.high>=Math.max(prices.open,prices.close),'EXIT_EXPORT_INVALID_OHLC');
      bars.push({day,code,...prices});
    }
    assert(bars.length<=350000,'EXIT_EXPORT_TOO_MANY_BARS');
    if(result.rows.length<PAGE)break;
  }
  return {format:'BLUE_TURSO_EXIT_SOURCE_V1',storage:'TURSO',asof_day:end,
    eod_days:eod.map(d=>({day:d.day,expected:d.expected,actual:counts.get(d.day)})),
    research_audited_days:researchDays.size,research_excluded_days:excludedResearchDays,
    signals,bars,
    audits_readback_verified:true,trading_calendar_verified:false,
    corporate_actions_verified:false,
    note:'종목 수가 KRX EOD와 다른 구 연구일은 신호 성과에서 제외. KRX EOD/남은 연구 감사 및 해시 확인; 거래소 휴장일·기업행동·시장/업종 기준선은 검증 전.'};
}

async function main(){
  const args=process.argv.slice(2);
  const mode=(args.find(s=>s.startsWith('--mode='))||'--mode=plan').slice(7);
  const sessions=Number((args.find(s=>s.startsWith('--sessions='))||'--sessions=60').slice(11));
  const out=(args.find(s=>s.startsWith('--out='))||'--out=output/exit_study/source.json').slice(6);
  assert(WINDOWS.has(sessions)&&['plan','study'].includes(mode),'INVALID_EXIT_EXPORT_MODE');
  if(mode==='plan'){
    console.log('BLUE_PATTERN_EXIT_EXPORT',JSON.stringify(await exportPatternExitSource(null,{sessions,mode})));
    return;
  }
  const url=String(process.env.TURSO_DATABASE_URL||''),authToken=String(process.env.TURSO_AUTH_TOKEN||'');
  assert(/^(libsql|https):\/\//.test(url)&&authToken,'EXIT_EXPORT_MISSING_CONFIG');
  const client=createClient({url,authToken,intMode:'string'});
  try{
    const result=await exportPatternExitSource(client,{sessions,mode});
    await mkdir(dirname(out),{recursive:true});
    await writeFile(out,JSON.stringify(result)+'\n','utf8');
    console.log('BLUE_PATTERN_EXIT_SOURCE',`asof=${result.asof_day}`,
      `eod_days=${result.eod_days.length}`,`research_days=${result.research_audited_days}`,
      `signal_stock_days=${result.signals.length}`,`bars=${result.bars.length}`,
      'D1_SQL=0','TURSO_WRITES=0');
  }finally{client.close();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(()=>{console.error('BLUE_PATTERN_EXIT_EXPORT_FAILED');process.exitCode=1;});
}

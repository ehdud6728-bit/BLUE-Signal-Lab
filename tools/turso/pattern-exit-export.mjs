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
  // Close-known market condition: use the entire independently audited KRX
  // EOD universe, not only stocks that matched a search signal. The reference
  // is the exact previous / fifth previous AUDITED date, not LAG per issuer
  // (which can skip suspended or delisted sessions). No index API/network use.
  const market=await client.execute({sql:`WITH ordered AS (
      SELECT trade_day,
        LAG(trade_day,1) OVER (ORDER BY trade_day) AS prior1,
        LAG(trade_day,5) OVER (ORDER BY trade_day) AS prior5
      FROM blue_eod_ingest_audit_v1 WHERE trade_day BETWEEN ? AND ?
    ), priced AS (
      SELECT o.trade_day AS day,e.market,e.close AS current_close,
        p1.close AS prev1,p5.close AS prev5
      FROM ordered o JOIN blue_eod_daily_v1 e ON e.trade_day=o.trade_day
      LEFT JOIN blue_eod_daily_v1 p1 ON p1.trade_day=o.prior1 AND p1.code=e.code
      LEFT JOIN blue_eod_daily_v1 p5 ON p5.trade_day=o.prior5 AND p5.code=e.code
    ), scoped AS (
      SELECT day,'ALL' AS scope,current_close,prev1,prev5 FROM priced
      UNION ALL
      SELECT day,market AS scope,current_close,prev1,prev5 FROM priced
    ) SELECT day,scope,COUNT(*) AS universe,
      SUM(CASE WHEN current_close<=0 THEN 1 ELSE 0 END) AS invalid_prices,
      SUM(CASE WHEN prev1>0 THEN 1 ELSE 0 END) AS matched1,
      SUM(CASE WHEN prev1>0 AND current_close>prev1 THEN 1 ELSE 0 END) AS up1,
      SUM(CASE WHEN prev1>0 AND current_close<prev1 THEN 1 ELSE 0 END) AS down1,
      SUM(CASE WHEN prev5>0 THEN 1 ELSE 0 END) AS matched5,
      SUM(CASE WHEN prev5>0 AND current_close>prev5 THEN 1 ELSE 0 END) AS up5,
      SUM(CASE WHEN prev5>0 AND current_close<prev5 THEN 1 ELSE 0 END) AS down5
    FROM scoped GROUP BY day,scope ORDER BY day,scope`,args:[start,end]});
  const marketBreadth=[];
  const marketByDay=new Map();
  for(const r of market.rows){
    const day=String(r.day),scope=String(r.scope);
    assert(eodSet.has(day)&&['ALL','KOSPI','KOSDAQ'].includes(scope)&&
      !marketByDay.has(`${day}/${scope}`),'EXIT_EXPORT_BAD_MARKET_SCOPE');
    const universe=n(r.universe,1,10000),invalid=n(r.invalid_prices,0,10000);
    const matched1=n(r.matched1,0,10000),up1=n(r.up1,0,10000),down1=n(r.down1,0,10000);
    const matched5=n(r.matched5,0,10000),up5=n(r.up5,0,10000),down5=n(r.down5,0,10000);
    assert(invalid===0&&up1+down1<=matched1&&matched1<=universe&&
      up5+down5<=matched5&&matched5<=universe,'EXIT_EXPORT_BAD_MARKET_BREADTH');
    const value={day,scope,universe,matched1,up1,down1,matched5,up5,down5};
    marketByDay.set(`${day}/${scope}`,value);marketBreadth.push(value);
  }
  assert(eod.every(d=>marketByDay.get(`${d.day}/ALL`)?.universe===d.expected),
    'EXIT_EXPORT_MARKET_UNIVERSE_MISMATCH');
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
  const research=await client.execute({sql:`SELECT s.trade_day,s.code,s.signal_names,
    s.source_payload_sha256,e.name AS stock_name
    FROM blue_research_signals_v1 s
    JOIN blue_eod_daily_v1 e ON e.trade_day=s.trade_day AND e.code=s.code
    WHERE s.trade_day BETWEEN ? AND ?
    ORDER BY s.trade_day,s.code LIMIT 100001`,args:[start,end]});
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
    // A display name is taken from the SAME audited KRX EOD row as the
    // signal's close. No live directory/current name or external API lookup.
    const stockName=String(r.stock_name??'').trim();
    assert(stockName.length<=100&&!/[\u0000-\u001f\u007f]/.test(stockName),
      'EXIT_EXPORT_BAD_STOCK_NAME');
    signals.push({day,code,names,stock_name_at_signal:stockName||null});
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
    const result=await client.execute({sql:`SELECT e.trade_day AS day,e.code,e.market,e.open,e.high,e.low,e.close
      FROM blue_eod_daily_v1 e WHERE e.trade_day BETWEEN ? AND ? AND e.code IN
      (SELECT DISTINCT s.code FROM blue_research_signals_v1 s
       WHERE s.trade_day IN (${validDays.map(()=>'?').join(',')}))
      ORDER BY e.trade_day,e.code LIMIT ? OFFSET ?`,
      args:[start,end,...validDays,PAGE,offset]});
    for(const r of result.rows){const day=String(r.day),code=String(r.code);
      const marketScope=String(r.market);
      assert(eodSet.has(day)&&CODE.test(code)&&['KOSPI','KOSDAQ'].includes(marketScope),
        'EXIT_EXPORT_BAD_BAR_KEY');
      const prices={};
      for(const key of ['open','high','low','close']){
        const value=n(r[key],1,10000000000);prices[key]=value;
      }
      assert(prices.low<=Math.min(prices.open,prices.close)&&
        prices.high>=Math.max(prices.open,prices.close),'EXIT_EXPORT_INVALID_OHLC');
      bars.push({day,code,market:marketScope,...prices});
    }
    assert(bars.length<=350000,'EXIT_EXPORT_TOO_MANY_BARS');
    if(result.rows.length<PAGE)break;
  }
  return {format:'BLUE_TURSO_EXIT_SOURCE_V1',storage:'TURSO',asof_day:end,
    eod_days:eod.map(d=>({day:d.day,expected:d.expected,actual:counts.get(d.day)})),
    research_audited_days:researchDays.size,research_excluded_days:excludedResearchDays,
    signals,bars,market_breadth_by_day:marketBreadth,
    market_breadth_method:'AUDITED_KRX_EQUAL_WEIGHT_ADVANCERS_VS_PRIOR_1_AND_5_AUDITED_EOD_DATES',
    audits_readback_verified:true,trading_calendar_verified:false,
    corporate_actions_verified:false,
    note:'종목 수가 KRX EOD와 다른 구 연구일은 신호 성과에서 제외. 시장 구분은 감사된 전체 종목의 1/5감사일 상승 비율이며 코스피/코스닥 공식 지수 수익률이 아니다. KRX EOD/남은 연구 감사 및 해시 확인; 거래소 휴장일·기업행동·유동성·지수/섹터 독립 기준선은 검증 전.'};
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

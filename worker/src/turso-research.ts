/** Read the independently audited Turso R1.1 research snapshots without D1.
 * Historical indicators are imported scanner results, never recomputed from
 * Turso's short EOD candle range. All methods are read-only.
 */
import {createClient} from '@libsql/client/web';
import {technicalFilterWhere} from './technical-filters.ts';

type ResearchEnv={TURSO_DATABASE_URL?:string;TURSO_AUTH_TOKEN?:string};
type Client=Pick<ReturnType<typeof createClient>,'execute'|'close'>;
type Factory=(args:{url:string;authToken:string;intMode:'string'})=>Client;
const DATE=/^20\d{2}-\d{2}-\d{2}$/;
const CODE=/^[0-9A-Z]{6}$/;
const ALLOWED=new Set(['BB20','BB30','BB40','ENV20','ENV40',
  'BB20_LOWER','BB30_LOWER','BB40_LOWER','BB20_ALT','BB30_ALT','BB40_ALT',
  'BB20_LOWER_ALT','BB30_LOWER_ALT','BB40_LOWER_ALT','BB30_LOWER_RECLAIM',
  'ENV20_LOWER_TOUCH']);
const GC:Record<string,string>={rsi:'rsi_gc',slow14:'slow_14_3_3_gc',
  slow12:'slow_12_5_5_gc',slow20:'slow_20_12_12_gc',macd:'macd_gc'};
const SORT=new Set(['recent','highest_gain','lowest_return','amount_surge','amount_decline']);
const FLOOR=new Set([3,4,5,6,7,8,10,15,20,30]);
export class InvalidResearchQuery extends Error{constructor(){super('INVALID_TURSO_RESEARCH_QUERY');}}
function dayValid(x:string){if(!DATE.test(x))return false;
  const d=new Date(`${x}T00:00:00Z`);return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===x;}
function bad():never{throw new InvalidResearchQuery();}
function intParam(s:string,min:number,max:number){if(!/^\d{1,7}$/.test(s))bad();
  const n=Number(s);if(!Number.isSafeInteger(n)||n<min||n>max)bad();return n;}
function tagNames(raw:string){return raw.split(',').map(s=>s.trim().toUpperCase())
  .filter(Boolean).map(s=>s.startsWith('BLUE')?s.replace(/^BLUE/,'BB'):s);}
function escapedLike(s:string){return `%${s.replace(/[\\%_]/g,'\\$&')}%`;}
async function withClient<T>(env:ResearchEnv,fn:(client:Client)=>Promise<T>,factory:Factory=createClient){
  const url=env.TURSO_DATABASE_URL?.trim()||'',authToken=env.TURSO_AUTH_TOKEN?.trim()||'';
  if(!/^(libsql|https):\/\//.test(url)||!authToken)throw Error('TURSO_RESEARCH_NOT_CONFIGURED');
  const client=factory({url,authToken,intMode:'string'});
  try{return await fn(client);}finally{client.close();}
}

export async function tursoResearchDates(env:ResearchEnv,factory?:Factory){
  return withClient(env,async client=>{
    const result=await client.execute(`SELECT trade_day AS day,row_count AS matched_stocks,
      observed_stocks,signal_events FROM blue_research_signal_audit_v1
      ORDER BY trade_day DESC LIMIT 500`);
    const items=result.rows.map(r=>({day:String(r.day),matched_stocks:Number(r.matched_stocks),
      observed_stocks:Number(r.observed_stocks),signal_events:Number(r.signal_events)}));
    if(items.some(r=>!dayValid(r.day)||!Number.isSafeInteger(r.matched_stocks)||
      r.matched_stocks<0||r.observed_stocks<1700||r.matched_stocks>r.observed_stocks))
      throw Error('TURSO_RESEARCH_INVALID_AUDIT');
    return {storage:'TURSO',data_status:'VERIFIED_RESEARCH_SNAPSHOT',
      latest:items[0]?.day||null,items};
  },factory);
}

/** A cheap, read-only coverage inventory for the AI research workbench.
 * These are audit-ledger counts, NOT proof of contiguous bars, mature outcomes,
 * sector coverage, or an investable backtest. Never query D1 here.
 */
export async function tursoResearchCoverage(env:ResearchEnv,factory?:Factory){
  return withClient(env,async client=>{
    const eod=await client.execute(`SELECT COUNT(*) AS days,MIN(trade_day) AS first_day,
      MAX(trade_day) AS last_day,COALESCE(SUM(row_count),0) AS declared_rows
      FROM blue_eod_ingest_audit_v1 WHERE row_count>=1700 AND row_count<=10000`);
    const research=await client.execute(`SELECT COUNT(*) AS days,MIN(trade_day) AS first_day,
      MAX(trade_day) AS last_day,COALESCE(SUM(row_count),0) AS declared_rows
      FROM blue_research_signal_audit_v1 WHERE observed_stocks>=1700 AND row_count>=0`);
    const toStats=(r:typeof eod.rows[number])=>({
      audited_days:Number(r.days),first_day:r.first_day==null?null:String(r.first_day),
      last_day:r.last_day==null?null:String(r.last_day),declared_rows:Number(r.declared_rows)});
    const a=toStats(eod.rows[0]),b=toStats(research.rows[0]);
    if([a,b].some(x=>!Number.isSafeInteger(x.audited_days)||x.audited_days<0||
      !Number.isSafeInteger(x.declared_rows)||x.declared_rows<0||
      (x.first_day!==null&&!dayValid(x.first_day))||
      (x.last_day!==null&&!dayValid(x.last_day))||
      (x.first_day!==null&&x.last_day!==null&&x.first_day>x.last_day)))
      throw Error('TURSO_COVERAGE_INVALID_AUDIT');
    return {storage:'TURSO',status:'AUDIT_COUNTS_ONLY',eod:a,research:b,
      readiness:a.audited_days<140||b.audited_days<120?'INSUFFICIENT_FOR_RECENT_EXIT_RESEARCH':
        'GAP_AND_OUTCOME_VALIDATION_REQUIRED',
      goals:{rolling_windows:[5,10,20,60,120,250,500],eod_audited_days_min:140,
        research_audited_days_min:120,history_target_days:250},
      note:'감사 원장 집계만 확인했습니다. 거래일 연속성·실제 행수·수정주가·지수/업종·완성된 미래 성과·독립 검증은 별도 확인이 필요합니다.'};
  },factory);
}

/** Descriptive pattern activity from the latest 5 audited research days.
 * Previous five audit days are a baseline only when available. Never interpret
 * this as trade performance, profitability, contiguous sessions or advice.
 */
export async function tursoPatternPulse(env:ResearchEnv,factory?:Factory){
  return withClient(env,async client=>{
    const audit=await client.execute(`SELECT trade_day,row_count,observed_stocks,signal_events
      FROM blue_research_signal_audit_v1 ORDER BY trade_day DESC LIMIT 10`);
    const days=audit.rows.map(r=>({day:String(r.trade_day),matched:Number(r.row_count),
      observed:Number(r.observed_stocks),events:Number(r.signal_events)}));
    if(days.some((r,i)=>!dayValid(r.day)||(i>0&&r.day>=days[i-1].day)||
      ![r.matched,r.observed,r.events].every(Number.isSafeInteger)||
      r.observed<1700||r.observed>10000||r.matched<0||r.matched>r.observed||
      r.events<r.matched||r.events>r.matched*30))
      throw Error('TURSO_PULSE_INVALID_AUDIT');
    const recent=days.slice(0,5),previous=days.slice(5,10);
    if(!days.length)return {storage:'TURSO',status:'NO_AUDITED_RESEARCH',recent_days:[],
      prior_days:[],patterns:[],baseline_complete:false,outcomes_verified:false,
      note:'감사된 패턴 연구 날짜가 없습니다. 패턴 출현·성숙 수익률을 표시하지 않습니다.'};
    const placeholders=days.map(()=>'?').join(','),args=days.map(r=>r.day);
    const counts=await client.execute({sql:`SELECT s.trade_day,COUNT(*) AS n,
      SUM(CASE WHEN a.source_payload_sha256=s.source_payload_sha256 THEN 1 ELSE 0 END) AS verified,
      COALESCE(SUM(1+LENGTH(s.signal_names)-LENGTH(REPLACE(s.signal_names,',',''))),0) AS events
      FROM blue_research_signals_v1 s JOIN blue_research_signal_audit_v1 a
      ON a.trade_day=s.trade_day
      WHERE s.trade_day IN (${placeholders}) GROUP BY s.trade_day`,args});
    const actual=new Map(counts.rows.map(r=>[String(r.trade_day),
      {matched:Number(r.n),verified:Number(r.verified),events:Number(r.events)}]));
    if(counts.rows.length>days.length||days.some(d=>{
      const got=actual.get(d.day)||{matched:0,verified:0,events:0};
      return ![got.matched,got.verified,got.events].every(Number.isSafeInteger)||
        got.matched!==d.matched||got.verified!==d.matched||got.events!==d.events;
    }))throw Error('TURSO_PULSE_INCOMPLETE_AUDITED_DAY');
    const tokens=await client.execute({sql:`SELECT s.trade_day,CAST(tag.value AS TEXT) AS label,
      COUNT(*) AS n FROM blue_research_signals_v1 s
      JOIN blue_research_signal_audit_v1 a ON a.trade_day=s.trade_day
        AND a.source_payload_sha256=s.source_payload_sha256
      JOIN json_each('["'||REPLACE(s.signal_names,',','","')||'"]') tag
      WHERE s.trade_day IN (${placeholders})
      GROUP BY s.trade_day,tag.value`,args});
    const dayMap=new Map(days.map(d=>[d.day,d]));
    const recentMap=new Map<string,number>(),priorMap=new Map<string,number>();
    const dailyEvents=new Map<string,number>();
    for(const token of tokens.rows){
      const day=String(token.trade_day),name=String(token.label),n=Number(token.n);
      const d=dayMap.get(day);
      if(!d||!/^[A-Z0-9_]{2,60}$/.test(name)||!Number.isSafeInteger(n)||
        n<1||n>d.matched)throw Error('TURSO_PULSE_INVALID_SIGNAL');
      const group=recent.some(r=>r.day===day)?recentMap:priorMap;
      group.set(name,(group.get(name)||0)+n);
      dailyEvents.set(day,(dailyEvents.get(day)||0)+n);
    }
    if(days.some(d=>(dailyEvents.get(d.day)||0)!==d.events))
      throw Error('TURSO_PULSE_EVENT_COUNT_MISMATCH');
    const recentObserved=recent.reduce((sum,r)=>sum+r.observed,0);
    const priorObserved=previous.reduce((sum,r)=>sum+r.observed,0);
    const baselineComplete=previous.length===5;
    const patterns=[...recentMap].map(([name,occurrences])=>{
      const prior=priorMap.get(name)||0;
      return {name,recent_occurrences:occurrences,
        recent_per_1000_stock_days:Math.round(10000*occurrences/recentObserved)/10,
        previous_occurrences:baselineComplete?prior:null,
        previous_per_1000_stock_days:baselineComplete&&priorObserved?
          Math.round(10000*prior/priorObserved)/10:null,
        relative_change_pct:baselineComplete&&prior>=3&&occurrences>=3&&priorObserved?
          Math.round(100*(occurrences/recentObserved/(prior/priorObserved)-1)*10)/10:null};
    }).sort((a,b)=>b.recent_occurrences-a.recent_occurrences||a.name.localeCompare(b.name));
    return {storage:'TURSO',status:recent.length===5?'AUDITED_PATTERN_ACTIVITY':'PARTIAL_PATTERN_ACTIVITY',
      recent_days:recent.map(({day,matched,observed,events})=>({day,matched,observed,events})),
      prior_days:previous.map(({day,matched,observed,events})=>({day,matched,observed,events})),
      patterns,baseline_complete:baselineComplete,outcomes_verified:false,
      session_continuity_verified:false,
      note:'최근 감사 완료 연구일의 기술신호 발생 횟수입니다. 출현 변화는 매매 수익률·성공 확률·종목 추천이 아니며 실제 거래일 연속성·성숙한 청산 성과는 검증 전입니다.'};
  },factory);
}

/** Latest opt-in published exploratory backtest summary; never query D1 or
 * compute a historical million-bar simulation during a browser request. */
export async function tursoExitStudyReport(env:ResearchEnv,factory?:Factory){
  return withClient(env,async client=>{
    const tables=await client.execute(`SELECT name FROM sqlite_master WHERE type='table'
      AND name='blue_pattern_exit_reports_v1' LIMIT 1`);
    const empty={storage:'TURSO',status:'NOT_PUBLISHED',report:null,
      note:'과거 데이터·기업행동·거래일 연속성 검증 후 연구 결과를 수동 게시할 수 있습니다.'};
    if(!tables.rows.length)return empty;
    const records=await client.execute(`SELECT asof_day,report_json,report_sha256
      FROM blue_pattern_exit_reports_v1 ORDER BY asof_day DESC LIMIT 1`);
    if(!records.rows.length)return empty;
    const row=records.rows[0],raw=String(row.report_json);
    if(raw.length>1500000||!/^[a-f0-9]{64}$/.test(String(row.report_sha256)))
      throw Error('INVALID_TURSO_EXIT_REPORT');
    const report=JSON.parse(raw);
    if(report.schema!=='BLUE_TURSO_PATTERN_EXIT_REPORT_V1'||report.storage!=='TURSO'||
      report.asof_day!==String(row.asof_day)||!dayValid(report.asof_day)||
      !Number.isSafeInteger(report.eod_audited_days)||
      !Number.isSafeInteger(report.research_audited_days)||
      !Array.isArray(report.short_and_long_windows)||
      report.short_and_long_windows.map((r:{sessions:number})=>r.sessions).join(',')!==
        '5,10,20,60,120,250,500'||
      report.investment_recommendation_enabled!==false||
      !Array.isArray(report.candidate_stocks)||report.candidate_stocks.length!==0||
      report.trading_calendar_verified!==false||
      report.corporate_actions_verified!==false||
      report.market_and_sector_benchmark_verified!==false)
      throw Error('INVALID_TURSO_EXIT_REPORT');
    // Older immutable reports may omit these additive research-only fields.
    // Never allow a published summary to inject a fabricated path ranking.
    if(report.observed_path_windows!==undefined){
      const path=report.observed_path_windows;
      if(!Array.isArray(path)||path.length!==4||
        path.map((w:{holding_sessions:number})=>w.holding_sessions).join(',')!=='5,10,20,60'||
        path.some((w:{mature_signal_stock_days:number;pending_recent:number;
          excluded_missing_price_path:number;patterns:unknown[];
          investment_recommendation_enabled:boolean;same_session_order_knowable:boolean})=>
          !Number.isSafeInteger(w.mature_signal_stock_days)||w.mature_signal_stock_days<0||
          !Number.isSafeInteger(w.pending_recent)||w.pending_recent<0||
          !Number.isSafeInteger(w.excluded_missing_price_path)||w.excluded_missing_price_path<0||
          !Array.isArray(w.patterns)||w.patterns.length>12||
          w.investment_recommendation_enabled!==false||w.same_session_order_knowable!==false||
          w.patterns.some((p:unknown)=>{
            if(!p||typeof p!=='object')return true;
            const v=p as Record<string,unknown>;
            return typeof v.pattern!=='string'||!/^[A-Z0-9_]{2,60}$/.test(v.pattern)||
              !Number.isSafeInteger(v.n)||Number(v.n)<3||
              !Number.isFinite(v.median_max_gain_pct)||Number(v.median_max_gain_pct)<0||
              !Number.isFinite(v.median_max_loss_pct)||Number(v.median_max_loss_pct)>0||
              Number(v.median_max_loss_pct)<-100||
              !Number.isSafeInteger(v.low_first_count)||!Number.isSafeInteger(v.high_first_count)||
              !Number.isSafeInteger(v.same_session_unresolved_count)||
              Number(v.low_first_count)<0||Number(v.high_first_count)<0||
              Number(v.same_session_unresolved_count)<0||
              Number(v.low_first_count)+Number(v.high_first_count)+
                Number(v.same_session_unresolved_count)!==v.n;
          })))throw Error('INVALID_TURSO_EXIT_REPORT');
    }
    return {storage:'TURSO',status:'EXPLORATORY_ONLY',report,
      note:'독립 검증 전 탐색 연구입니다. 매매 추천과 달리 출현·성숙 표본·익절·손절 관측 결과만 표시합니다.'};
  },factory);
}

export async function tursoResearchSearch(env:ResearchEnv,p:URLSearchParams,factory?:Factory){
  const mode=p.get('mode')||'single';if(!['single','range'].includes(mode))bad();
  const start=mode==='single'?(p.get('date')||''):(p.get('start')||'');
  const end=mode==='single'?start:(p.get('end')||'');
  if(!dayValid(start)||!dayValid(end)||start>end)bad();
  // Keep range searches bounded so a malformed request cannot scan a whole
  // unbounded future archive. 370 days matches the old D1 count horizon.
  if((Date.parse(end)-Date.parse(start))/86400000>370)bad();
  const page=intParam(p.get('page')||'1',1,10000),limit=intParam(p.get('limit')||'100',1,500);
  const q=(p.get('q')||'').trim();if(q.length>60||/[\u0000-\u001f]/.test(q))bad();
  const code=(p.get('code')||'').trim().toUpperCase();if(code&&!CODE.test(code))bad();
  const runId=(p.get('run_id')||'').trim();if(runId&&!/^blue_market_20\d{6}$/.test(runId))bad();
  const signals=tagNames(p.get('signals')||'');
  if(signals.length>20||signals.some(s=>!ALLOWED.has(s)))bad();
  const logic=p.get('logic')||'any',gcLogic=p.get('gc_logic')||'any',techLogic=p.get('tech_logic')||'any';
  if(!['any','all'].includes(logic)||!['any','all'].includes(gcLogic))bad();
  const gcNames=(p.get('gc')||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(gcNames.length>5||new Set(gcNames).size!==gcNames.length||gcNames.some(k=>!GC[k]))bad();
  const tech=technicalFilterWhere(p.get('tech')||'',techLogic);if(tech===null)bad();
  const amount=intParam(p.get('min_amount_eok')||'0',0,50000);
  const onlyPattern=p.get('only_pattern')||'0';if(!['0','1'].includes(onlyPattern))bad();
  const threshold=intParam(p.get('min_pattern_up')||'70',60,90);
  if(![60,70,80,90].includes(threshold))bad();
  const floor=intParam(p.get('min_pattern_n')||'8',3,30);if(!FLOOR.has(floor))bad();
  const sort=(p.get('sort')||'recent').trim();if(!SORT.has(sort))bad();
  const nameArgs=[escapedLike(q),escapedLike(q),escapedLike(q)];
  const filters=['day BETWEEN ? AND ?'];const args:(string|number)[]=[start,end];
  if(runId){filters.push('run_id=?');args.push(runId);}
  if(code){filters.push('code=?');args.push(code);}
  if(q){filters.push(`(code LIKE ? ESCAPE '\\' OR
    CAST(json_extract(extras_json,'$.name') AS TEXT) LIKE ? ESCAPE '\\' OR
    CAST(json_extract(extras_json,'$.Name') AS TEXT) LIKE ? ESCAPE '\\')`);
    args.push(...nameArgs);}
  if(signals.length){filters.push('('+signals.map(()=>"(','||signal_names||',') LIKE ?")
    .join(logic==='all'?' AND ':' OR ')+')');args.push(...signals.map(s=>`%,${s},%`));}
  if(gcNames.length){filters.push('('+gcNames.map(k=>
    `LOWER(CAST(json_extract(extras_json,'$.${GC[k]}') AS TEXT)) IN ('true','1')`)
    .join(gcLogic==='all'?' AND ':' OR ')+')');}
  if(tech)filters.push(tech);
  if(amount>0){filters.push(`CAST(json_extract(extras_json,'$.traded_amount_krw') AS REAL)>=?`);
    args.push(amount*100000000);}
  const setupRows=`json_each(CASE WHEN json_valid(stats_json) THEN stats_json
    ELSE '{"setups":[]}' END,'$.setups') setup`;
  const setupN=`CAST(json_extract(setup.value,'$.horizons."10".n') AS INTEGER)`;
  const setupUp=`CAST(json_extract(setup.value,'$.horizons."10".up_pct') AS REAL)`;
  if(onlyPattern==='1'){
    filters.push(`EXISTS (SELECT 1 FROM ${setupRows} WHERE
      json_type(setup.value,'$.horizons."10".up_pct') IN ('integer','real')
      AND ${setupN}>=? AND ${setupUp}>=?)`);
    args.push(floor,threshold);
  }
  const base=`WITH verified AS (SELECT s.trade_day AS day,s.run_id,s.code,s.signal_names,
    s.close_price,s.row_sha256,s.source_payload_sha256,s.record_json,
    json_extract(s.record_json,'$.extras') AS extras_json,
    json_extract(s.record_json,'$.stats') AS stats_json,
    json_extract(s.record_json,'$.supply_distance_pct') AS supply_distance_pct
    FROM blue_research_signals_v1 s INNER JOIN blue_research_signal_audit_v1 a
    ON a.trade_day=s.trade_day AND a.source_payload_sha256=s.source_payload_sha256)`;
  const where=filters.join(' AND ');
  // Only later, independently audited EOD candles count as observed highs and
  // lows. Turso currently has a short date range, never full-period coverage.
  const later=(field:'high'|'low',aggregate:'MAX'|'MIN')=>
    `(SELECT ${aggregate}(e.${field}) FROM blue_eod_daily_v1 e
      JOIN blue_eod_ingest_audit_v1 a ON a.trade_day=e.trade_day AND a.row_count>=1700
      WHERE e.code=verified.code AND e.trade_day>verified.day)`;
  const high=`CASE WHEN close_price>0 THEN 100.0*(1.0*${later('high','MAX')}/close_price-1) END`;
  const low=`CASE WHEN close_price>0 THEN 100.0*(1.0*${later('low','MIN')}/close_price-1) END`;
  const ratio=`CAST(json_extract(extras_json,'$.amount_ratio20') AS REAL)`;
  const ordering=sort==='highest_gain'?`observed_high_pct DESC NULLS LAST,day DESC,code`:
    sort==='lowest_return'?`observed_low_pct ASC NULLS LAST,day DESC,code`:
    sort==='amount_surge'?`amount_ratio20_sort DESC NULLS LAST,day DESC,code`:
    sort==='amount_decline'?`amount_ratio20_sort ASC NULLS LAST,day DESC,code`:'day DESC,code';
  return withClient(env,async client=>{
    const audit=await client.execute({sql:`SELECT trade_day,row_count,observed_stocks,signal_events
      FROM blue_research_signal_audit_v1 WHERE trade_day BETWEEN ? AND ?
      ORDER BY trade_day DESC LIMIT 371`,args:[start,end]});
    if(audit.rows.length>370)throw Error('TURSO_RESEARCH_AUDIT_RANGE_LIMIT');
    if(audit.rows.length){
      const found=await client.execute({sql:`SELECT s.trade_day,COUNT(*) AS n
        FROM blue_research_signals_v1 s JOIN blue_research_signal_audit_v1 a
          ON a.trade_day=s.trade_day AND a.source_payload_sha256=s.source_payload_sha256
        WHERE s.trade_day BETWEEN ? AND ?
        GROUP BY s.trade_day ORDER BY s.trade_day DESC`,args:[start,end]});
      const counts=new Map(found.rows.map(r=>[String(r.trade_day),Number(r.n)]));
      if(audit.rows.some(r=>counts.get(String(r.trade_day))!==Number(r.row_count)))
        throw Error('TURSO_RESEARCH_INCOMPLETE_AUDITED_DAY');
    }
    const daily_counts=audit.rows.map(r=>({day:String(r.trade_day),
      observed_stocks:Number(r.observed_stocks),signal_events:Number(r.signal_events),
      matched_stocks:Number(r.row_count)}));
    const total=await client.execute({sql:`${base} SELECT COUNT(*) AS n FROM verified WHERE ${where}`,args});
    const n=Number(total.rows[0]?.n||0);
    const metrics=sort==='highest_gain'?`${high} AS observed_high_pct,`:
      sort==='lowest_return'?`${low} AS observed_low_pct,`:
      sort==='amount_surge'||sort==='amount_decline'?`${ratio} AS amount_ratio20_sort,`:'';
    const result=await client.execute({sql:`${base} SELECT run_id,code,day,signal_names,
      close_price,supply_distance_pct,extras_json,stats_json,record_json,${metrics}
      row_sha256 FROM verified WHERE ${where} ORDER BY ${ordering} LIMIT ? OFFSET ?`,
      args:[...args,limit,(page-1)*limit]});
    // Read only exact-day audited candles for candidates on this result page.
    const candleMatches=new Set<string>();
    const candidates=result.rows.filter(r=>String(r.day)>'2026-11-23'&&String(r.signal_names).split(',').includes('ENV20_LOWER_TOUCH'));
    for(let i=0;i<candidates.length;i+=40){
      const chunk=candidates.slice(i,i+40);
      const candles=await client.execute({sql:`SELECT e.trade_day,e.code,e.open,e.high,e.low,e.close
        FROM blue_eod_daily_v1 e JOIN blue_eod_ingest_audit_v1 a
        ON a.trade_day=e.trade_day AND a.row_count>=1700
        WHERE ${chunk.map(()=>'(e.trade_day=? AND e.code=?)').join(' OR ')}`,
        args:chunk.flatMap(r=>[String(r.day),String(r.code)])});
      for(const b of candles.rows){
        const row=chunk.find(r=>r.day===b.trade_day&&r.code===b.code);
        const [o,h,l,c]=[b.open,b.high,b.low,b.close].map(Number);
        if(!row||![o,h,l,c].every(Number.isFinite)||!(0<l&&l<=o&&o<c&&c<=h)||c!==Number(row.close_price))continue;
        const span=h-l,body=(c-o)/span,lower=(o-l)/span,upper=(h-c)/span,pos=(c-l)/span;
        if(body>0.1&&body<0.7&&!(lower>=0.6&&upper<=0.15)&&!(upper>=0.6&&lower<=0.15)&&pos>=0.33&&pos<0.67)
          candleMatches.add(String(b.trade_day)+':'+String(b.code));
      }
    }
    const items=result.rows.map(r=>{
      const record=JSON.parse(String(r.record_json)) as {trade_day:string;code:string;close_price:number;
        extras:Record<string,unknown>;stats:{setups?:Array<any>};chart:{asof:string}};
      if(record.trade_day!==r.day||record.code!==r.code||record.close_price!==Number(r.close_price)||
        record.chart?.asof!==r.day)throw Error('TURSO_RESEARCH_ROW_CONFLICT');
      const extras={...record.extras};
      delete extras.recent_candle_match;
      if(candleMatches.has(String(r.day)+':'+String(r.code)))extras.recent_candle_match='ENV20_BULL_CLOSE_MID_20261123';
      const setups=Array.isArray(record.stats?.setups)?record.stats.setups:[];
      const best=setups.filter(s=>{
        const h=s?.horizons?.['10'];return Number.isInteger(Number(h?.n))&&Number(h.n)>=floor&&
          typeof h.up_pct==='number'&&h.up_pct>=0&&h.up_pct<=100;
      }).sort((a,b)=>Number(b.horizons['10'].up_pct)-Number(a.horizons['10'].up_pct)||
        Number(b.horizons['10'].median_return_pct||0)-Number(a.horizons['10'].median_return_pct||0)||
        Number(b.horizons['10'].mean_return_pct||0)-Number(a.horizons['10'].mean_return_pct||0)||
        Number(b.horizons['10'].n)-Number(a.horizons['10'].n))[0];
      if(best){const h=best.horizons['10'];
        extras.r159_pattern_up_10d=h.up_pct;extras.r159_pattern_n_10d=h.n;
        extras.r159_pattern_label_10d=String(best.label||'').slice(0,150);
        extras.r159_pattern_signal_days_10d_json=JSON.stringify([...new Set(
          (Array.isArray(h.cases)?h.cases:[]).map((c:any)=>c?.signal_day)
            .filter((d:unknown):d is string=>typeof d==='string'&&dayValid(d)&&d<=String(r.day)))]
          .sort().slice(-12));
      }
      return {run_id:String(r.run_id),code:String(r.code),day:String(r.day),
        close_price:Number(r.close_price),supply_distance_pct:r.supply_distance_pct==null?
          null:Number(r.supply_distance_pct),name:extras.name||extras.Name||null,
        signals:String(r.signal_names).split(',').filter(Boolean),extras,
        ...(sort==='highest_gain'?{observed_high_pct:r.observed_high_pct==null?null:Number(r.observed_high_pct)}:{}),
        ...(sort==='lowest_return'?{observed_low_pct:r.observed_low_pct==null?null:Number(r.observed_low_pct)}:{}),
        ...(sort==='amount_surge'||sort==='amount_decline'?{amount_ratio20_sort:r.amount_ratio20_sort==null?null:Number(r.amount_ratio20_sort)}:{})};
    });
    return {storage:'TURSO',data_status:daily_counts.length?'AVAILABLE':'NOT_IMPORTED',
      mode,start,end,q,sort,total:n,page,limit,items,daily_counts,
      high_complete:false,
      note:'Turso 감사 완료 연구 신호만 조회합니다. 이후 최고·최저가는 현재 저장된 후속 KRX 일봉의 부분 관측이며, 장중 시세가 아닙니다.'};
  },factory);
}

/** Chart and backtest evidence belong to the exact archived research day.
 * Never reconstruct a chart from later prices or read the D1 chart table.
 */
export async function tursoResearchChart(env:ResearchEnv,p:URLSearchParams,factory?:Factory){
  const day=p.get('date')||'',code=(p.get('code')||'').trim().toUpperCase();
  if(!dayValid(day)||!CODE.test(code))bad();
  return withClient(env,async client=>{
    const audit=await client.execute({sql:`SELECT a.row_count,COUNT(s.code) AS actual
      FROM blue_research_signal_audit_v1 a LEFT JOIN blue_research_signals_v1 s
        ON s.trade_day=a.trade_day AND s.source_payload_sha256=a.source_payload_sha256
      WHERE a.trade_day=? GROUP BY a.trade_day,a.row_count`,args:[day]});
    if(!audit.rows.length)return {status:'NOT_AVAILABLE',reason:'DAY_NOT_IMPORTED',
      message:'Turso에 해당 거래일의 검증된 연구 기록이 없습니다.'};
    if(Number(audit.rows[0].row_count)!==Number(audit.rows[0].actual))
      throw Error('TURSO_RESEARCH_INCOMPLETE_AUDITED_DAY');
    const result=await client.execute({sql:`SELECT s.record_json,s.close_price
      FROM blue_research_signals_v1 s JOIN blue_research_signal_audit_v1 a
        ON a.trade_day=s.trade_day AND a.source_payload_sha256=s.source_payload_sha256
      WHERE s.trade_day=? AND s.code=? LIMIT 1`,args:[day,code]});
    if(!result.rows.length)return {status:'NOT_AVAILABLE',reason:'NO_SIGNAL_FOR_SYMBOL',
      message:'해당 날짜에 연구 신호가 등록된 종목이 아닙니다. 다른 날짜의 차트를 대체하지 않습니다.'};
    const record=JSON.parse(String(result.rows[0].record_json)) as {
      trade_day:string;code:string;close_price:number;chart?:{
        asof:string;bars?:Array<{t:string;c:number}>};stats?:unknown};
    const bars=record.chart?.bars;
    if(record.trade_day!==day||record.code!==code||
      record.close_price!==Number(result.rows[0].close_price)||
      record.chart?.asof!==day||!Array.isArray(bars)||!bars.length||
      bars[bars.length-1].t!==day||bars[bars.length-1].c!==record.close_price||
      bars.some((b,i)=>!dayValid(b.t)||b.t>day||(i>0&&b.t<=bars[i-1].t)))
      throw Error('TURSO_RESEARCH_CHART_CONFLICT');
    return {status:'READY',chart:record.chart,stats:record.stats,
      message:'Turso 감사 완료 연구 스냅샷의 기준일 차트입니다.'};
  },factory);
}

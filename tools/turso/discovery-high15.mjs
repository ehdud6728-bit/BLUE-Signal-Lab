import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createClient} from '@libsql/client';
import {reconstructVerifiedDay} from './research-v2-eod-export.mjs';
import {evidence} from './combined-pattern-factors.mjs';
import {storedContext} from './env20-pullback-factors.mjs';
import {study as conditionalStudy,conditionalTest,compare} from './discovery-high15-conditional.mjs';
import {historicalFeatures,withinSignalStudy,withinTest} from './discovery-high15-within-signal.mjs';
import {amountEvidence,frozenStudy,collectCases,caseTest} from './discovery-high15-case-study.mjs';
import {seal,sealTest} from './discovery-high15-case-seal.mjs';

const DAYS=["2026-11-16","2026-11-17","2026-11-18","2026-11-19","2026-11-20","2026-11-23","2026-11-24","2026-11-25","2026-11-26","2026-11-27"];
const HOLDOUT_DAYS=["2026-11-30","2026-12-01","2026-12-02","2026-12-03","2026-12-04","2026-12-07","2026-12-08","2026-12-09","2026-12-10","2026-12-11","2026-12-14","2026-12-15","2026-12-16","2026-12-17","2026-12-18"];
function need(ok,code){if(!ok)throw Error(code)}

function band(v,edges,labels){return Number.isFinite(v)?labels[edges.findIndex(x=>v<x)===-1?edges.length:edges.findIndex(x=>v<x)]:"UNKNOWN"}

function median(xs){if(!xs.length)return null;const a=[...xs].sort((a,b)=>a-b),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2}

function round(x){return x===null?null:Math.round(x*10000)/10000}

function outcome(base,expected,barAt){
 const vals=[];let prev=base.close,stopped=null,first=null,beforeLow=base.close,lowestBefore=null;
 for(const day of expected){
  const b=barAt(day,base.code);
  if(!b||b.market!==base.market){stopped=b?"MARKET_CHANGED":"MISSING_BAR";break}
  if(Math.abs(b.open/prev-1)>=.4){stopped="PRICE_DISCONTINUITY";break}
  if(!first&&BigInt(b.high)*100n>=BigInt(base.close)*115n){first=day;lowestBefore=vals.length?100*(beforeLow/base.close-1):null;}
  if(!first)beforeLow=Math.min(beforeLow,b.low);
  vals.push(b);prev=b.close;
 }
 const complete=expected.length>0&&vals.length===expected.length;
 const max=vals.length?Math.max(...vals.map(b=>b.high)):null;
 const min=vals.length?Math.min(...vals.map(b=>b.low)):null;
 return {status:complete?(first?"HIT":"MISS"):(first?"PARTIAL_HIT":"UNKNOWN"),complete,first,first_sessions:first?expected.indexOf(first)+1:null,
   max_pct:max===null?null:100*(max/base.close-1),min_pct:min===null?null:100*(min/base.close-1),before_hit_low_pct:lowestBefore,observed:vals.length,reason:complete?null:(stopped||"NO_FOLLOWUP")};
}

function summarize(events){
 const valid=events.filter(e=>e.result.complete),hits=valid.filter(e=>e.result.status==="HIT"),miss=valid.filter(e=>e.result.status==="MISS");
 const values=[...new Set(events.flatMap(e=>Object.keys(e.features)))].sort();
 const comparisons=[];
 for(const key of values){
  const known=valid.filter(e=>e.features[key]!==undefined&&e.features[key]!=="UNKNOWN");
  const hk=known.filter(e=>e.result.status==="HIT"),mk=known.filter(e=>e.result.status==="MISS");
  for(const value of [...new Set(known.map(e=>e.features[key]))].sort()){
   const a=hk.filter(e=>e.features[key]===value),b=mk.filter(e=>e.features[key]===value);
   const others=known.filter(e=>e.features[key]!==value),otherHits=others.filter(e=>e.result.status==="HIT");
   comparisons.push({feature:key,value,hit_n:a.length,miss_n:b.length,hit_known_n:hk.length,miss_known_n:mk.length,
    unknown_n:valid.length-known.length,hit_share_pct:hk.length?round(100*a.length/hk.length):null,miss_share_pct:mk.length?round(100*b.length/mk.length):null,
    hit_rate_pct:a.length+b.length?round(100*a.length/(a.length+b.length)):null,other_hit_rate_pct:others.length?round(100*otherHits.length/others.length):null,
    dates:new Set([...a,...b].map(e=>e.day)).size,stocks:new Set([...a,...b].map(e=>e.code)).size,
    small_sample:a.length+b.length<30||others.length<30||new Set([...a,...b].map(e=>e.day)).size<3});
  }
 }
 return {n:events.length,unique_stocks:new Set(events.map(e=>e.code)).size,complete:valid.length,hits:hits.length,misses:miss.length,
 partial_hits:events.filter(e=>e.result.status==="PARTIAL_HIT").length,unknown:events.filter(e=>e.result.status==="UNKNOWN").length,
 unique_hit_stocks:new Set(events.filter(e=>["HIT","PARTIAL_HIT"].includes(e.result.status)).map(e=>e.code)).size,
 complete_hit_rate_pct:valid.length?round(100*hits.length/valid.length):null,
 median_max_pct:round(median(valid.map(e=>e.result.max_pct))),median_min_pct:round(median(valid.map(e=>e.result.min_pct))),
 median_hit_sessions:round(median(hits.map(e=>e.result.first_sessions))),median_hit_prior_low_pct:round(median(hits.map(e=>e.result.before_hit_low_pct).filter(x=>x!==null))),
 comparisons};
}

function features(base,record,ev,supply,market){
 const ex=record.extras||{},span=base.high-base.low,body=Math.abs(base.close-base.open),upper=base.high-Math.max(base.close,base.open),lower=Math.min(base.close,base.open)-base.low;
 const f={market:base.market,market_breadth:market,candle:!span?"FLAT":body/span<=.1?"DOJI":lower/span>=.6&&upper/span<=.15?"LOWER_WICK":upper/span>=.6&&lower/span<=.15?"UPPER_WICK":body/span>=.7?(base.close>base.open?"LONG_BULL":"LONG_BEAR"):base.close>base.open?"BULL":"BEAR",
 body_ratio:span?band(body/span,[.1,.3,.5,.7],["LT10","10_30","30_50","50_70","GE70"]):"UNKNOWN",
 close_position:span?band((base.close-base.low)/span,[.33,.67],["LOW","MID","HIGH"]):"UNKNOWN",
 amount_eok:band(base.amount/1e8,[5,50,200,1000],["LT5","5_50","50_200","200_1000","GE1000"]),
 amount_ratio20_stored:band(ev.amount_ratio20??NaN,[.5,1,1.5,2,3],["LT0_5","0_5_1","1_1_5","1_5_2","2_3","GE3"]),
 ma20_40_60:ev.ma_chart_consistent===true?(ev.ma20<ev.ma40&&ev.ma40<ev.ma60?"REVERSE":ev.ma20>ev.ma40&&ev.ma40>ev.ma60?"ALIGNED":"MIXED"):"UNKNOWN",
 rsi_stored:ev.rsi_value_chart_consistent===true?band(ev.rsi_value??NaN,[30,50,70],["LT30","30_50","50_70","GE70"]):"UNKNOWN",
 rsi_gc:ev.rsi_chart_consistent===true?(ev.rsi_gc===true?"YES":ev.rsi_gc===false?"NO":"UNKNOWN"):"UNKNOWN",
 supply_distance:supply.status==="NO_UPPER_CONCENTRATION"?"NO_UPPER":supply.status==="STORED_ESTIMATE"?band(supply.distance_pct,[3,8,15],["LT3","3_8","8_15","GE15"]):"UNKNOWN"};
 for(const k of ["macd_gc","slow_14_3_3_gc","slow_12_5_5_gc","slow_20_12_12_gc","ma112_cross","ma224_cross"]){const v=ex[k];f[k+"_stored"]=[true,1,"1","true","True"].includes(v)?"YES":[false,0,"0","false","False"].includes(v)?"NO":"UNKNOWN"}
 const known=["BB20","BB30","BB40","ENV20","ENV40","BB20_LOWER","BB30_LOWER","BB40_LOWER","BB20_ALT","BB30_ALT","BB40_ALT","BB20_LOWER_ALT","BB30_LOWER_ALT","BB40_LOWER_ALT","BB30_LOWER_RECLAIM","ENV20_LOWER_TOUCH"];
 for(const p of known)f["signal_"+p]=record.signal_names.split(",").includes(p)?"YES":"NO";
 f.signal_count=band(record.signal_names.split(",").length,[2,3,5],["1","2","3_4","GE5"]);
 return f;
}

function buildReport(data){
 const {coverage,events,barAt,historyCoverage=[],runDays=DAYS,holdout=false}=data;
 const windows={},conditional={},within_signal={},frozen={};
 const withHistory=es=>es.map(e=>({...e,features:{...e.features,...e.historyFeatures}}));
 const evaluate=h=>events.map(e=>{const path=runDays.slice(runDays.indexOf(e.day)+1),expected=h==="ASOF"?path:path.slice(0,h);const result=h!=="ASOF"&&expected.length<h?{status:"UNKNOWN",complete:false,reason:"HORIZON_NOT_MATURE"}:outcome(e.base,expected,barAt);return {...e,result}});
 if(holdout){for(const h of [1,3,5])frozen[h]=frozenStudy(withHistory(evaluate(h)),compare);return {schema:"BLUE_HIGH15_FROZEN_HOLDOUT_V1",start:runDays[0],end:"2026-12-11",cutoff:runDays.at(-1),primary_horizon:3,coverage,history_coverage:historyCoverage,frozen_study:frozen,notes:["Prospective fixed date window. No exploratory feature scans. Full audited dates required before analysis; independent provider and corporate actions remain unverified."]}}
 for(const h of ["ASOF",1,3,5]){
  const es=evaluate(h);
  if(h!=="ASOF"){conditional[h]=conditionalStudy(es);within_signal[h]=withinSignalStudy(withHistory(es),compare);frozen[h]=frozenStudy(withHistory(es),compare)}
  windows[h]={all_recorded:summarize(es),full_universe_days_only:summarize(es.filter(e=>e.full)),
   by_discovery_day:DAYS.slice(0,-1).map(day=>{const s=summarize(es.filter(e=>e.day===day));delete s.comparisons;return {day,...s}})};
 }
 // The search screen ranks MAX(high) over all later audited dates, even
 // when intermediate observations are absent. Keep this descriptive screen
 // metric distinct from the contiguous, risk-aware research cohort.
 const screenRows=events.map(e=>{
  const path=DAYS.slice(DAYS.indexOf(e.day)+1),observed=path.map(day=>barAt(day,e.code)).filter(Boolean);
  const high=observed.length?Math.max(...observed.map(b=>b.high)):null;
  const hit=high===null?null:BigInt(high)*100n>=BigInt(e.base.close)*115n;
  return {day:e.day,code:e.code,hit,complete:observed.length===path.length};
 });
 const screenSummary=rows=>({n:rows.length,observed:rows.filter(r=>r.hit!==null).length,
   observed_hits:rows.filter(r=>r.hit===true).length,observed_nonhits:rows.filter(r=>r.hit===false).length,
   no_observations:rows.filter(r=>r.hit===null).length,
   incomplete_hits:rows.filter(r=>r.hit===true&&!r.complete).length,
   unique_hit_stocks:new Set(rows.filter(r=>r.hit===true).map(r=>r.code)).size});
 const screen_metric={...screenSummary(screenRows),by_day:DAYS.slice(0,-1).map(day=>({day,...screenSummary(screenRows.filter(r=>r.day===day))})),
   note:"Search-style observed maximum, not a completed outcome; no path continuity or corporate-action guard."};
 const issueSummary=rows=>{const statuses={},issues={};for(const e of rows){const status=e.amountAudit??"NOT_CHECKED";statuses[status]=(statuses[status]||0)+1;if(status!=="MATCH")for(const issue of e.amountEvidence?.issues??[])issues[issue]=(issues[issue]||0)+1}return {n:rows.length,statuses,issues}};
 const amount_audit_issue_counts={all_recorded:issueSummary(events),full_universe_3d_complete:issueSummary(evaluate(3).filter(e=>e.full&&e.result.complete))};
 return {schema:"BLUE_DISCOVERY_HIGH15_V1",conditional,within_signal,frozen_study:frozen,amount_audit_issue_counts,history_coverage:historyCoverage,screen_metric,start:DAYS[0],end:DAYS.at(-2),cutoff:DAYS.at(-1),target_pct:15,
   reference:"STORED_DISCOVERY_CLOSE_MATCHED_TO_KRX_EOD",future:"LATER_EOD_HIGH_ONLY",expected_sessions:DAYS,
   coverage,windows,limitations:["Recorded V1 discovery rows only; partial scanner universe reported separately; V2 replay not substituted.","Fixed weekday session list; independent calendar verification pending.","Corporate actions and outside-source price verification pending; gaps >=40% censored.","ASOF follow-up differs by date; compare equal 1/3/5 session windows and date groups.","Feature comparisons descriptive, overlapping stock-days, not independent validation or investment returns.","Stored technical factors are not independently recomputed from provider prices.","Prior-to-hit low excludes hit-day low because intraday order is unknown.","No stock identifiers or raw quotes in public aggregate; separate private ciphertext only."]};
}

function selfTest(){
 let count=0;const t=(ok)=>{need(ok,"SELF_TEST_FAIL");count++};
 const base={code:"000001",market:"KOSPI",close:100,open:99,high:102,low:98,amount:1e9};
 const b=(high,low=90,open=100)=>({...base,high,low,open,close:100});
 const path=["d1","d2","d3"],lookup=(arr)=>(d)=>arr[path.indexOf(d)];
 t(outcome(base,path,lookup([b(114),b(115),b(120)])).status==="HIT");
 t(outcome(base,path,lookup([b(114),b(114),b(114)])).status==="MISS");
 t(outcome(base,path,lookup([b(115),undefined,b(120)])).status==="PARTIAL_HIT");
 t(outcome(base,path,lookup([b(114),undefined,b(120)])).status==="UNKNOWN");
 t(outcome(base,path,lookup([b(114),b(120,90,141),b(120)])).reason==="PRICE_DISCONTINUITY");
 t(outcome(base,path,lookup([b(110,92),b(115,80),b(120)])).before_hit_low_pct < -7.99&&outcome(base,path,lookup([b(110,92),b(115,80),b(120)])).before_hit_low_pct > -8.01);
 t(outcome(base,path,lookup([b(115),b(120),b(120)])).before_hit_low_pct===null);
 t(outcome(base,[],lookup([])).status==="UNKNOWN");
 const e=(day,code,result,features,full=true)=>({day,code,result,features,full});
 const h=outcome(base,path,lookup([b(115),b(120),b(120)])),m=outcome(base,path,lookup([b(110),b(110),b(110)])),p=outcome(base,path,lookup([b(115),undefined]));
 const s=summarize([e("a","1",h,{X:"YES"}),e("b","2",m,{X:"NO"}),e("b","1",p,{X:"YES"}),e("c","3",m,{X:"UNKNOWN"})]);
 t(s.complete===3&&s.hits===1&&s.misses===2&&s.partial_hits===1&&s.unique_hit_stocks===1);
 t(s.comparisons.find(r=>r.value==="YES").hit_known_n===1&&s.comparisons.find(r=>r.value==="YES").miss_known_n===1&&s.comparisons.find(r=>r.value==="YES").unknown_n===1);
 const ev={day:DAYS[8],code:base.code,base,full:true,features:{X:"YES"}};
 const r=buildReport({coverage:[],events:[ev],barAt:()=>b(115)});
 t(r.windows.ASOF.all_recorded.hits===1&&r.windows[1].all_recorded.hits===1&&r.windows[3].all_recorded.unknown===1);
 t(r.screen_metric.observed_hits===1&&r.screen_metric.unique_hit_stocks===1);
 const gap=buildReport({coverage:[],events:[{...ev,day:DAYS[0]}],barAt:(day)=>day===DAYS[2]?b(115):undefined});
 t(gap.screen_metric.observed_hits===1&&gap.screen_metric.incomplete_hits===1&&gap.windows.ASOF.all_recorded.unknown===1);
 t(!JSON.stringify(r).includes(base.code));
 const hv={...ev,day:HOLDOUT_DAYS[9]};const hr=buildReport({coverage:[],events:[hv],barAt:()=>b(115),runDays:HOLDOUT_DAYS,holdout:true});
 t(hr.frozen_study[5].eligible_n===1&&hr.end==="2026-12-11"&&!hr.windows&&!hr.within_signal);
 return count;
}

const sha=x=>createHash('sha256').update(x).digest('hex');
async function readReport(db,holdout=false){
 const runDays=holdout?HOLDOUT_DAYS:DAYS,discoveryDays=holdout?runDays.slice(0,10):runDays.slice(0,-1);
 const allDays=[holdout?'2026-11-27':'2026-11-13',...runDays],bars=new Map(),coverage=[],events=[];
 const select=async(sql,args)=>{need(/^SELECT\b/i.test(sql),'NON_SELECT');return (await db.execute({sql,args})).rows};
 for(const day of allDays){
  const a=await select('SELECT trade_day,row_count,source,day_sha256 FROM blue_eod_ingest_audit_v1 WHERE trade_day=?',[day]);
  need(a.length<=1,'DUP_EOD_AUDIT');if(!a.length){coverage.push({day,eod:'MISSING',signals:'NOT_CHECKED'});continue}
  const raw=await select('SELECT trade_day,code,market,name,open,high,low,close,volume,amount,source FROM blue_eod_daily_v1 WHERE trade_day=? ORDER BY code',[day]);
  reconstructVerifiedDay(day,a[0],raw);
  for(const row of raw){
   const r={day,code:row.code,market:row.market,name:row.name??null};
   for(const k of ['open','high','low','close','amount']){r[k]=Number(row[k]);need(Number.isSafeInteger(r[k])&&r[k]>0,'BAD_NUMBER')}
   bars.set(day+'/'+r.code,r);
  }
  coverage.push({day,eod:'HASH_MATCH',eod_rows:raw.length,eod_sha256:a[0].day_sha256,signals:'NOT_APPLICABLE'});
 }
 const barAt=(day,code)=>bars.get(day+'/'+code);
 // Pre-discovery history is read independently; never change the original window or its coverage.
 const historyDays=[];for(let d=new Date('2026-10-12T00:00:00Z');d.toISOString().slice(0,10)<=runDays.at(-1);d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()>=1&&d.getUTCDay()<=5)historyDays.push(d.toISOString().slice(0,10));
 const historyCoverage=[];
 for(const day of historyDays.filter(d=>d<allDays[0])){
  const a=await select('SELECT trade_day,row_count,source,day_sha256 FROM blue_eod_ingest_audit_v1 WHERE trade_day=?',[day]);
  need(a.length<=1,'DUP_HISTORY_AUDIT');if(!a.length){historyCoverage.push({day,eod:'MISSING'});continue}
  const raw=await select('SELECT trade_day,code,market,name,open,high,low,close,volume,amount,source FROM blue_eod_daily_v1 WHERE trade_day=? ORDER BY code',[day]);
  reconstructVerifiedDay(day,a[0],raw);
  for(const row of raw){const r={day,code:row.code,market:row.market};for(const k of ['open','high','low','close','amount']){r[k]=Number(row[k]);need(Number.isSafeInteger(r[k])&&r[k]>0,'BAD_HISTORY_NUMBER')}bars.set(day+'/'+r.code,r)}
  historyCoverage.push({day,eod:'HASH_MATCH',eod_rows:raw.length,eod_sha256:a[0].day_sha256});
 }
 for(const day of discoveryDays){
  const c=coverage.find(x=>x.day===day);
  if(c.eod!=='HASH_MATCH')continue;
  const audits=await select('SELECT row_count,observed_stocks,signal_events,source_payload_sha256 FROM blue_research_signal_audit_v1 WHERE trade_day=?',[day]);
  need(audits.length<=1,'DUP_SIGNAL_AUDIT');if(!audits.length){c.signals='MISSING_AUDIT';continue}
  const a=audits[0],n=Number(a.row_count),observed=Number(a.observed_stocks),signalEvents=Number(a.signal_events);
  need(Number.isSafeInteger(n)&&n>=0&&n<=10000&&Number.isSafeInteger(observed)&&observed>=n&&observed>=1700&&observed<=10000&&Number.isSafeInteger(signalEvents)&&signalEvents>=n&&signalEvents<=30*n&&/^[a-f0-9]{64}$/.test(a.source_payload_sha256),'BAD_SIGNAL_AUDIT');
  const full=observed===c.eod_rows;
  c.signals=full?'FULL_RECORDED_UNIVERSE':'PARTIAL_RECORDED_UNIVERSE';
  c.observed_stocks=observed;c.recorded_rows=n;c.signal_payload_sha256=a.source_payload_sha256;
  const hash=createHash('sha256');let prior='',count=0,nEvents=0;
  const prev=allDays[allDays.indexOf(day)-1];let matched=0,up=0,down=0;
  for(const b of bars.values())if(b.day===day){const p=barAt(prev,b.code);if(p&&p.market===b.market){matched++;if(b.close>p.close)up++;else if(b.close<p.close)down++}}
  const market=matched>=.9*c.eod_rows?(up/matched>=.55?'UP':down/matched>=.55?'DOWN':'MIXED'):'UNKNOWN';
  for(let offset=0;offset<=n;offset+=5){
   const rows=await select('SELECT trade_day,code,close_price,signal_names,record_json,row_sha256,source_payload_sha256 FROM blue_research_signals_v1 WHERE trade_day=? ORDER BY code LIMIT ? OFFSET ?',[day,5,offset]);
   for(const r of rows){
    need(r.trade_day===day&&/^[0-9A-Z]{6}$/.test(r.code)&&r.code>prior&&r.source_payload_sha256===a.source_payload_sha256,'BAD_SIGNAL_ID');
    prior=r.code;count++;need(count<=n,'EXTRA_SIGNAL_ROW');
    const names=String(r.signal_names).split(',');
    need(names.length>0&&names.length<=30&&names.every(x=>/^[A-Z0-9_]{2,60}$/.test(x))&&names.join(',')===[...new Set(names)].sort().join(','),'BAD_SIGNALS');
    nEvents+=names.length;
    const raw=String(r.record_json);need(sha(raw)===r.row_sha256,'SIGNAL_ROW_HASH_MISMATCH');hash.update(raw+'\n');
    const base=barAt(day,r.code);need(base&&base.close===Number(r.close_price),'DISCOVERY_EOD_PRICE_MISMATCH');
    const record=JSON.parse(raw),ev=evidence(r,{day,code:r.code,names},base,{details:true});
    const supply=storedContext(raw,base.close).supply;
    const hist=historicalFeatures(base,historyDays,barAt,ev.amount_ratio20);
    const extras=record.extras??{};
    const event={day,code:r.code,base,full,recordSha:r.row_sha256,payloadSha:a.source_payload_sha256,signalNames:names,amountRatio:ev.amount_ratio20,amountAudit:hist.audit,storedAmount:extras.traded_amount_krw,chartDates:record.chart?.bars?.slice(-21).map(b=>b.t),
      indicatorValues:Object.fromEntries(["rsi","rsi_signal","rsi_gc","slow_12_5_5_k","slow_12_5_5_d","slow_12_5_5_gc","slow_20_12_12_k","slow_20_12_12_d","slow_20_12_12_gc","macd_12_26_9","macd_signal_9","ma20","ma40","ma60"].map(k=>[k,extras[k]??null])),
      features:features(base,record,ev,supply,market),historyFeatures:{...hist.features,supply_grade_stored:supply.status==="STORED_ESTIMATE"&&supply.grade?supply.grade:"UNKNOWN"}};
    event.amountEvidence=amountEvidence(event,historyDays,barAt);events.push(event);
   }
   if(rows.length<5)break;
  }
  need(count===n&&nEvents===signalEvents&&hash.digest('hex')===a.source_payload_sha256,'SIGNAL_PAYLOAD_AUDIT_MISMATCH');
  c.payload_hash_recomputed=true;
 }
 if(holdout){need(coverage.every(c=>c.eod==="HASH_MATCH"),"HOLDOUT_EOD_NOT_COMPLETE");need(discoveryDays.every(d=>coverage.find(c=>c.day===d)?.signals==="FULL_RECORDED_UNIVERSE"),"HOLDOUT_SIGNAL_UNIVERSE_NOT_COMPLETE");need(events.length>0,"HOLDOUT_EMPTY");}
 return {report:buildReport({coverage,events,barAt,historyCoverage,runDays,holdout}),cases:holdout?null:collectCases(events,runDays,barAt,outcome)};
}
if(process.argv.includes('--test')){console.log('BLUE_HIGH15_SYNTHETIC_CHECKS',selfTest());console.log('BLUE_HIGH15_CONDITIONAL_CHECKS',conditionalTest());console.log('BLUE_HIGH15_WITHIN_CHECKS',withinTest(compare));console.log('BLUE_HIGH15_CASE_CHECKS',caseTest(compare));console.log('BLUE_HIGH15_CRYPTO_CHECKS',sealTest())}
else{
 let db;
 try{
  need(/^(libsql|https):\/\//.test(process.env.TURSO_DATABASE_URL||'')&&process.env.TURSO_AUTH_TOKEN,'MISSING_CONFIG');
  db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
  const mode=process.argv.find(x=>x.startsWith('--mode='))?.slice(7)||'discovery';need(["discovery","holdout"].includes(mode),"BAD_STUDY_MODE");
  const holdout=mode==="holdout";if(holdout)need(Date.now()>=Date.parse("2026-12-18T22:30:00+09:00"),"HOLDOUT_NOT_MATURE");
  const {report,cases}=await readReport(db,holdout),out=process.argv.find(x=>x.startsWith('--out='))?.slice(6)||'output/high15/report.json';
  const caseOut=process.argv.find(x=>x.startsWith('--cases='))?.slice(8);
  if(!holdout&&caseOut){need(caseOut.endsWith('.sealed.json')&&caseOut!==out,"BAD_CASE_OUTPUT");const bundle=seal(JSON.stringify(cases));await mkdir(dirname(caseOut),{recursive:true});await writeFile(caseOut,JSON.stringify(bundle)+'\n');console.log('BLUE_HIGH15_PRIVATE_CASES',JSON.stringify({records:cases.cases.length,screen_hits:cases.cases.filter(x=>x.screen.hit===true).length,payload_sha256:bundle.payload_sha256,recipient_sha256:bundle.recipient_sha256,writes:0}));}
  await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
  if(holdout){console.log('BLUE_HIGH15_HOLDOUT',JSON.stringify({eligible_n:report.frozen_study[3].eligible_n,rules:report.frozen_study[3].rules.length,writes:0}))}
  else{const s=report.windows.ASOF.all_recorded;console.log('BLUE_HIGH15_AGGREGATE',JSON.stringify({n:s.n,complete:s.complete,hits:s.hits,partial_hits:s.partial_hits,misses:s.misses,unknown:s.unknown,unique_hit_stocks:s.unique_hit_stocks,writes:0}));}
 }catch(e){console.error('BLUE_HIGH15_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1}finally{db?.close()}
}

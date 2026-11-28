/** Read-only structural research on exactly the previously verified replay cohort. */
import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createClient} from '@libsql/client';
import {reconstructVerifiedDay} from './research-v2-eod-export.mjs';
import {readReport} from './discovery-high15.mjs';
import {loadSnapshots,replayAdapter} from './global-corrected-high15-replay.mjs';
import {compare} from './discovery-high15-conditional.mjs';
import {structure,evaluate,study,groups,stochastic,classifyHistory,stats,classifyOutcome} from './price-structure-10-20.mjs';
import {seal} from './discovery-high15-case-seal.mjs';
const PINNED_PAYLOADS={
 '2026-11-16':'07d98a8c245a35bd3a42acf2cfc024cd034c0d04d6cbb4412f44b77208199638',
 '2026-11-17':'edcdab5a9efea880a6e4a72e5a5a389b623fb6f102fd1e9d019349c61e58fdd5',
 '2026-11-18':'28c08172bbcb310f78734f9ceadf2d2b14c1caa3a991197e31006c36bea0ea36',
 '2026-11-19':'701fb7e654b0626837c1fb3e445a3659c4b6ea37fed97725529c761100cb1b6e',
 '2026-11-20':'a8df91af4f2f417ae6b60341a152e87c5d6e19b8191e15fb6cf804eeeaa81961',
 '2026-11-23':'c5352fc46018e8902a3a48bcf7a23c70e2c2965754e4b320b595a38eb771338f',
 '2026-11-24':'8175568df7fc79136552632a14ea3ff656354a7234968c68d5e1014fb8749d02',
 '2026-11-25':'066d05465da8696371ef166b553457bccd8ef049f9440d7dd268017a690e44be',
 '2026-11-26':'649374b6d016937b3c791509dc9473f33a1b1501282bcdf0bfd21eff66c81912'
};
const PINNED_YEARS={"2025":"2bfd93c217eb74263bc5020b23fa6debb6b02531c11eaccc2826639bc191559e","2026":"9d5fb93ca4d9d5527e5b15a10b0289e7b15be65353636cb62fd1a01d442536d8"};
const START='2026-11-16',INITIAL='2026-11-27',CUTOFFS=[INITIAL,'2026-12-10','2026-12-24'];
const need=(x,code)=>{if(!x)throw Error(code)};
const sha=x=>createHash('sha256').update(x).digest('hex');
function weekdays(start,end){const a=[];for(let d=new Date(start+'T00:00:00Z');d.toISOString().slice(0,10)<=end;d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()>=1&&d.getUTCDay()<=5)a.push(d.toISOString().slice(0,10));return a}
const AUDIT_START='2026-10-12';
function reconcileCalendar(source,coverage){
 // The provider is deliberately pinned to the original replay bytes.
 // Exact-date audited KRX days take precedence over a stale source calendar,
 // but only after the complete expected date set has been proved.
 const validDate=d=>typeof d==="string"&&/^20\d{2}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 need(Array.isArray(source)&&source.length>100&&source.every((d,i)=>validDate(d)&&(!i||d>source[i-1])),"STRUCTURE_BAD_SOURCE_CALENDAR");
 const expected=weekdays(AUDIT_START,INITIAL);
 const days=coverage.map(c=>c.day);
 need(coverage.length===expected.length&&new Set(days).size===days.length&&coverage.every(c=>validDate(c.day)&&c.eod==="HASH_MATCH"&&/^[a-f0-9]{64}$/.test(c.eod_sha256)&&Number.isSafeInteger(c.eod_rows)&&c.eod_rows>=1700)&&expected.every(d=>days.includes(d)),"STRUCTURE_AUDIT_CALENDAR_INCOMPLETE");
 const recent=source.filter(d=>d>=AUDIT_START&&d<=INITIAL),auditSet=new Set(expected);
 const sourceOnly=recent.filter(d=>!auditSet.has(d));
 // A provider-only session requires reconciliation; don't silently erase it.
 need(sourceOnly.length===0,"STRUCTURE_UNEXPECTED_SOURCE_SESSION");
 const krxOnly=expected.filter(d=>!recent.includes(d));
 const calendar=[...source.filter(d=>d<AUDIT_START),...expected];
 return {calendar,proof:{method:"PINNED_PRE_AUDIT_PLUS_EXACT_KRX_AUDITED_SESSIONS_V2",audit_start:AUDIT_START,audit_end:INITIAL,audited_days:expected.length,source_days_in_audit_range:recent.length,source_missing_dates_replaced_by_audited_krx:krxOnly,source_only_dates:sourceOnly,source_last_day:source.at(-1)}};
}
function guardCutoff(cutoff,now=Date.now()){
 need(CUTOFFS.includes(cutoff),"STRUCTURE_BAD_CUTOFF");
 need(now>=Date.parse(cutoff+'T22:30:00+09:00'),"STRUCTURE_CUTOFF_NOT_MATURE");
}
async function run(cutoff){
 guardCutoff(cutoff);
 const db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'}),root='output/global-replay';
 try{
  const snapshots=await loadSnapshots(root);
  for(const [day,s] of snapshots){
   need(s.manifest.payload_sha256===PINNED_PAYLOADS[day]&&JSON.stringify(s.audit.source_sha256_by_year)===JSON.stringify(PINNED_YEARS),"STRUCTURE_PINNED_REPLAY_MISMATCH");
  }
  const replay=await readReport(replayAdapter(db,snapshots)),data=replay.data;
  need(data.events.length===1676&&data.coverage.every(c=>c.eod==="HASH_MATCH")&&data.historyCoverage.every(c=>c.eod==="HASH_MATCH")&&Object.keys(PINNED_PAYLOADS).every(day=>data.coverage.find(c=>c.day===day)?.signals==="FULL_RECORDED_UNIVERSE"),"STRUCTURE_BASE_UNIVERSE_MISMATCH");
  const sourceCalendar=JSON.parse(await readFile(join(root,'source-calendar.json'),'utf8'));
  const {calendar,proof:calendarProof}=reconcileCalendar(sourceCalendar,[...data.historyCoverage,...data.coverage]);
  console.log('BLUE_PRICE_STRUCTURE_CALENDAR',JSON.stringify(calendarProof));
  const sessions=weekdays(START,cutoff),extra=new Map(),futureCoverage=[];
  const select=async(sql,args)=>{need(/^SELECT\b/i.test(sql),"STRUCTURE_SELECT_ONLY");return (await db.execute({sql,args})).rows};
  for(const day of sessions.filter(d=>d>INITIAL)){
   const a=await select('SELECT trade_day,row_count,source,day_sha256 FROM blue_eod_ingest_audit_v1 WHERE trade_day=?',[day]);
   need(a.length<=1,"STRUCTURE_DUP_EOD");
   if(!a.length){futureCoverage.push({day,status:"MISSING"});continue}
   const rows=await select('SELECT trade_day,code,market,name,open,high,low,close,volume,amount,source FROM blue_eod_daily_v1 WHERE trade_day=? ORDER BY code',[day]);
   reconstructVerifiedDay(day,a[0],rows);
   for(const r of rows){const b={day,code:r.code,market:r.market,name:r.name};for(const k of ['open','high','low','close','amount']){b[k]=Number(r[k]);need(Number.isSafeInteger(b[k])&&b[k]>0,"STRUCTURE_BAD_EOD")}extra.set(day+'/'+r.code,b)}
   futureCoverage.push({day,status:"HASH_MATCH",rows:rows.length,sha256:a[0].day_sha256});
  }
  const barAt=(d,c)=>d>INITIAL?extra.get(d+'/'+c):data.barAt(d,c);
  const records=new Map([...snapshots].flatMap(([d,s])=>s.rows.map(r=>[d+'/'+r.code,r])));
  const events=data.events.map(e=>{const r=records.get(e.day+'/'+e.code);need(r,"STRUCTURE_RECORD_MISSING");
   return {...e,name:e.base.name??r.extras?.name??null,structure:structure(e,r,calendar,data.barAt)}});
  const {privateRows,...result}=study(events,sessions,barAt,compare);
  const report={schema:"BLUE_PRICE_STRUCTURE_10_20_V2",source:"PINNED_46131165692_CORRECTED_REPLAY_NOT_ACTUAL_DISCOVERIES",source_commit:"ad832658580379c20b8f605797afb10ecfcc690f",cohort_n:events.length,discovery_start:START,discovery_end:"2026-11-26",cutoff,primary_horizon:10,extended_horizon:20,calendar_sha256:sha(JSON.stringify(calendar)),source_calendar_sha256:sha(JSON.stringify(sourceCalendar)),calendar_proof:calendarProof,expected_sessions:sessions,
    source_hashes:PINNED_YEARS,discovery_payload_sha256:PINNED_PAYLOADS,initial_coverage:[...data.historyCoverage,...data.coverage],future_coverage:futureCoverage,...result,writes:0,
    outcome_labels:{TARGET_MET_PROFIT:"달성·수익",TARGET_MET_FLAT:"달성·보합",TARGET_MET_LOSS:"달성 후 실패",TARGET_MISSED_PROFIT:"미달·수익",TARGET_MISSED_FLAT:"미달·보합",TARGET_MISSED_LOSS:"실패(목표 미달 및 종료 손실)"},limitations:["Target attainment and terminal close P/L are separate. Failure here means negative hypothetical horizon close return, not an executed trade; incomplete is excluded. Target-day low is excluded from preceding-session drawdown; same-day high/low order unknown. No new stop or take-profit trading rules.","Same reconstructed November cohort; exploratory, not independent holdout. All nine corrected discovery dates are full-universe; repeated stock-days and overlapping patterns are not independent.","21-bar price features require exact dates and all OHLC from audited KRX; 61-bar features use pinned MARCAP plus audited overlap, not fully independent. Stored supply is an estimate.","Calendar before 10/12 comes from pinned MARCAP, 10/12–11/27 from all 35 hash-verified KRX sessions; missing provider dates are explicitly reported, never guessed or filled with fabricated bars. Future expected sessions use fixed weekdays; missing future EOD is not skipped; incomplete horizons excluded from rates.","NEXT_OPEN assumes available fill at recorded open, H-th close exit; DISCOVERY_CLOSE_REFERENCE is not a certified tradable entry. No fees, tax, slippage, intraday sequence or corporate-action certification.","Day-market-turnover-band overlap is descriptive and not a causal adjustment. Thresholds are fixed exploration candidates, not recommendations. No old strategy reactivated."]};
  await mkdir(join(root,'structure'),{recursive:true});
  await writeFile(join(root,'structure','report.json'),JSON.stringify(report,null,2)+'\n');
  const sealed=seal(JSON.stringify({schema:"BLUE_PRICE_STRUCTURE_PRIVATE_V2",cutoff,source:report.source,cases:privateRows}));
  await writeFile(join(root,'structure','cases.sealed.json'),JSON.stringify(sealed)+'\n');
  console.log('BLUE_PRICE_STRUCTURE_RESULT',JSON.stringify({cohort:events.length,cutoff,history_quality:result.history_quality,complete10:result.rows.find(x=>x.entry==="NEXT_OPEN"&&x.horizon===10).overall.complete,complete20:result.rows.find(x=>x.entry==="NEXT_OPEN"&&x.horizon===20).overall.complete,private_sha256:sealed.payload_sha256,writes:0}));
 }finally{db.close()}
}
function selfTest(){
 let n=0;const t=x=>{need(x,"STRUCTURE_TEST_FAILED");n++};
 const calendar=weekdays('2026-08-01','2026-11-27'),day='2026-11-26';
 const days=calendar.filter(d=>d<=day).slice(-61);
 const a=days.map((t,i)=>({t,o:100+i,h:102+i,l:99+i,c:101+i}));
 const barAt=(d)=>{const b=a.find(b=>b.t===d);return b?{market:"KOSPI",open:b.o,high:b.h,low:b.l,close:b.c}:null};
 const e={day,code:"000001",base:{market:"KOSPI",close:a.at(-1).c},amountAudit:"MATCH",amountRatio:2,signalNames:["ENV20"],features:{supply_distance:"NO_UPPER"}};
 const record={chart:{asof:day,bars:a}};
 const s=structure(e,record,calendar,barAt);
 t(s.history21==="ALL_KRX_MATCH"&&s.history61==="PINNED_SOURCE_WITH_KRX_OVERLAP");
 t(s.features.higher_high_and_low_5v5==="YES"&&s.features.prior20_high_break_close==="NO");
 t(s.features.ma5_gt_ma10_gt_ma20==="YES"&&s.features.ma20_40_60_aligned==="YES");
 t(s.features.stored_upper_supply_absent==="YES");
 t(structure(e,{chart:{...record.chart,bars:a.filter(b=>b.t!==days.at(-8))}},calendar,barAt).history21!=="ALL_KRX_MATCH");
 t(structure(e,record,calendar,d=>d===days.at(-1)?{...barAt(d),close:1}:barAt(d)).history21==="OHLC_MISMATCH");
 t(structure(e,{chart:{...record.chart,price_adjusted:true}},calendar,barAt).history61==="CORPORATE_ACTION_REVIEW");
 t(structure(e,record,calendar,d=>{if(d>day)throw Error("FUTURE_INPUT");return barAt(d)}).history21==="ALL_KRX_MATCH");
 t(stochastic(a.map(b=>({...b,o:100,h:100,l:100,c:100})),12,5,5).k===50);
 const base={...e,base:{market:"KOSPI",close:100},day:"d0",structure:s};
 const future=[{market:"KOSPI",open:110,high:115,low:100,close:105},{market:"KOSPI",open:105,high:130,low:104,close:120}];
 const look=d=>future[Number(d.slice(1))-1];
 const x=evaluate(base,["d0","d1","d2"],look,2,"NEXT_OPEN"),y=evaluate(base,["d0","d1","d2"],look,2,"DISCOVERY_CLOSE_REFERENCE");
 t(x.first[15]===2&&y.first[15]===1&&Math.abs(x.return_pct-100*(120/110-1))<1e-9);
 t(evaluate(base,["d0","d1"],look,10,"NEXT_OPEN").reason==="HORIZON_NOT_MATURE");
 t(evaluate(base,["d0","d1","d2"],d=>d==="d1"?null:look(d),2,"NEXT_OPEN").reason==="MISSING_BAR");
 t(evaluate(base,["d0","d1","d2"],d=>({...look(d),open:150}),2,"NEXT_OPEN").reason==="PRICE_DISCONTINUITY");
 t(stats([{...base,result:x},{...base,result:{complete:false}}]).targets[15].hits===1);
 // Exactly six disjoint completed outcome categories, plus incomplete.
 const make=(hit,exit)=>({complete:true,entry:100,exit,first:Object.fromEntries([3,5,7,10,15,20].map(t=>[t,hit?1:null]))});
 t(classifyOutcome(make(true,101))==="TARGET_MET_PROFIT");
 t(classifyOutcome(make(true,100))==="TARGET_MET_FLAT");
 t(classifyOutcome(make(true,99))==="TARGET_MET_LOSS");
 t(classifyOutcome(make(false,101))==="TARGET_MISSED_PROFIT");
 t(classifyOutcome(make(false,100))==="TARGET_MISSED_FLAT");
 t(classifyOutcome(make(false,99))==="TARGET_MISSED_LOSS");
 t(classifyOutcome({complete:false})===null);
 const riskPath=[{market:"KOSPI",open:100,high:114,low:92,close:105},{market:"KOSPI",open:105,high:120,low:90,close:110},{market:"KOSPI",open:110,high:112,low:94,close:97}];
 const riskResult=evaluate(base,["d0","d1","d2","d3"],d=>riskPath[Number(d.slice(1))-1],3,"NEXT_OPEN");
 t(riskResult.outcome15==="TARGET_MET_LOSS"&&riskResult.risk.target15_then_later_close_below_entry);
 t(riskResult.risk.downside_first[5]===1&&riskResult.risk.downside_first[10]===2);
 t(Math.abs(riskResult.risk.pre_target15_prior_sessions_low_pct+8)<1e-9);
 t(riskResult.risk.target15_and_downside_same_session[10]===true&&riskResult.risk.first_negative_close===3);
 const rec=stats([{...base,result:riskResult},{...base,result:x},{...base,result:{complete:false}}]);
 t(rec.complete===2&&rec.unknown===1&&rec.outcome_summary.loss.n===1&&rec.outcome_summary.profit.n===1);
 t(rec.outcome_summary.target15_hit_then_close_loss_given_hit.denominator===2&&rec.outcome_summary.target15_hit_then_close_loss_given_hit.rate_pct===50);
 t(Object.values(rec.outcome_summary.by_target).every(v=>Object.values(v).reduce((n,c)=>n+c.n,0)===rec.complete));
 t(rec.outcome_summary.downside_targets[10].n===1);
 const empty=stats([{...base,result:{complete:false}}]);
 t(empty.outcome_summary.loss.rate_pct===null&&empty.outcome_summary.target15_hit_then_close_loss_given_hit.rate_pct===null);
 const sameDay=evaluate(base,["d0","d1"],()=>({market:"KOSPI",open:100,high:115,low:95,close:100}),1,"NEXT_OPEN");
 t(sameDay.outcome15==="TARGET_MET_FLAT"&&sameDay.risk.pre_target15_prior_sessions_low_pct===null&&sameDay.risk.target15_then_later_close_below_entry===false&&sameDay.risk.target15_and_downside_same_session[5]);
 const report=study([base],["d0","d1","d2"],look,compare);
 t(report.rows.find(r=>r.entry==="NEXT_OPEN"&&r.horizon===10).overall.complete===0);
 t(report.rows.find(r=>r.entry==="NEXT_OPEN"&&r.horizon===1).same_10day_cohort.complete===0);
 t(!JSON.stringify(report.rows).includes('"code"'));
 t(weekdays('2026-11-27','2026-12-10').length===10&&weekdays('2026-11-27','2026-12-24').length===20);
 const src=weekdays('2025-01-01',INITIAL),expected=weekdays(AUDIT_START,INITIAL);
 const proofs=expected.map(day=>({day,eod:"HASH_MATCH",eod_rows:2656,eod_sha256:"a".repeat(64)}));
 const reconciled=reconcileCalendar(src.filter(d=>d!=="2026-11-27"&&d!=="2026-10-20"),proofs);
 t(reconciled.proof.source_missing_dates_replaced_by_audited_krx.join(",")==="2026-10-20,2026-11-27");
 t(reconciled.calendar.join(",")===src.join(",")&&reconciled.proof.audited_days===35);
 t(reconcileCalendar(src,proofs).proof.source_missing_dates_replaced_by_audited_krx.length===0);
 const rejects=(fn,error)=>{try{fn();return false}catch(e){return e.message===error}};
 t(rejects(()=>reconcileCalendar(src,proofs.slice(0,-1)),"STRUCTURE_AUDIT_CALENDAR_INCOMPLETE"));
 t(rejects(()=>reconcileCalendar(src,[...proofs.slice(0,-1),{...proofs.at(-1),eod:"MISSING"}]),"STRUCTURE_AUDIT_CALENDAR_INCOMPLETE"));
 t(rejects(()=>reconcileCalendar(src,[...proofs.slice(0,-1),proofs[0]]),"STRUCTURE_AUDIT_CALENDAR_INCOMPLETE"));
 t(rejects(()=>reconcileCalendar([...src,"2026-11-21"].sort(),proofs),"STRUCTURE_UNEXPECTED_SOURCE_SESSION"));
 t(rejects(()=>reconcileCalendar([...src,src.at(-1)],proofs),"STRUCTURE_BAD_SOURCE_CALENDAR"));
 t(rejects(()=>reconcileCalendar(src,[...proofs.slice(0,-1),{...proofs.at(-1),eod_sha256:"invalid"}]),"STRUCTURE_AUDIT_CALENDAR_INCOMPLETE"));
 const mergedDays=reconciled.calendar.filter(d=>d<=day).slice(-21);
 const mergedBars=mergedDays.map((t,i)=>({t,o:100+i,h:102+i,l:99+i,c:101+i}));
 const mergedLookup=d=>{const b=mergedBars.find(x=>x.t===d);return b?{open:b.o,high:b.h,low:b.l,close:b.c}:null};
 t(classifyHistory({asof:day,bars:mergedBars},day,reconciled.calendar,e.code,mergedLookup,21).status==="ALL_KRX_MATCH");
 t(classifyHistory({asof:day,bars:mergedBars.filter(b=>b.t!==mergedDays[5])},day,reconciled.calendar,e.code,mergedLookup,21).status!=="ALL_KRX_MATCH");
 let blocked=false;try{guardCutoff('2026-12-10',Date.parse('2026-11-28T00:00Z'))}catch(e){blocked=e.message==="STRUCTURE_CUTOFF_NOT_MATURE"}t(blocked);
 return n;
}
if(process.argv.includes('--test'))console.log('BLUE_PRICE_STRUCTURE_TESTS',selfTest());
else run(process.argv.find(x=>x.startsWith('--cutoff='))?.slice(9)||INITIAL).catch(e=>{console.error('BLUE_PRICE_STRUCTURE_FAILED',/^[A-Z_]+$/.test(e?.message||'')?e.message:'SANITIZED_FAILURE');process.exitCode=1});

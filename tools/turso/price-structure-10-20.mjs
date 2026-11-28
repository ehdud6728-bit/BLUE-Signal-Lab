/** Descriptive price structure, not a trading rule. All inputs at or before discovery. */
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const pct=(a,b)=>100*(a/b-1);
const r4=x=>Number.isFinite(x)?Math.round(x*1e4)/1e4:null;
const highest=a=>Math.max(...a.map(b=>b.h)),lowest=a=>Math.min(...a.map(b=>b.l));
const width=a=>{const c=a.map(b=>b.c),m=mean(c);return 4*Math.sqrt(mean(c.map(x=>(x-m)**2)))/m*100};
const yes=x=>x?"YES":"NO";
const band=(x,edges,names)=>names[edges.findIndex(y=>x<y)===-1?edges.length:edges.findIndex(y=>x<y)];
const numeric=(x)=>typeof x==="number"&&Number.isFinite(x);
const groups=Object.freeze({
 "prior_5d_return_ge5":21,"prior_10d_return_ge10":21,"prior_20d_return_ge15":21,
 "higher_high_and_low_5v5":21,"lower_high_and_low_5v5":21,"prior10_high_break_close":21,
 "prior20_high_break_close":21,"prior20_low_distance_ge10":21,
 "ma5_10_20_spread_le2":21,"ma5_gt_ma10_gt_ma20":21,
 "ma10_slope5_positive":21,"range5_vs_previous5_le0_7":21,
 "atr5_vs_previous5_le0_7":21,"bb20_unshifted_width_le8":21,
 "three_prior_bull_candles":21,"prior5_small_body_ge3":21,
 "prior20_range_position_ge80":21,
 "prior40_high_break_close":61,"prior60_high_break_close":61,
 "ma20_40_60_spread_le5":61,"ma20_40_60_aligned":61,
 "bb20_width_vs_20_sessions_ago_le0_7":61,
 "prior60_range_position_ge80":61,
 "stoch12_5_5_gc":61,"stoch20_12_12_gc":61,
 "stoch12_5_5_k_band":61,"stoch20_12_12_k_band":61
});
const extraGroups=Object.freeze({stored_upper_supply_absent:"STORED_ESTIMATE",stored_upper_supply_distance:"STORED_ESTIMATE",stored_upper_supply_grade:"STORED_ESTIMATE"});
function validBar(b){return b&&typeof b.t==="string"&&[b.o,b.h,b.l,b.c].every(x=>numeric(x)&&x>0)&&b.l<=Math.min(b.o,b.c)&&b.h>=Math.max(b.o,b.c)}
function classifyHistory(chart,day,calendar,code,barAt,n){
 const days=calendar.filter(d=>d<=day).slice(-n);
 const bs=chart?.bars;
 if(!Array.isArray(bs)||days.length!==n||days.at(-1)!==day||chart.asof!==day||bs.length<n)return {status:"INSUFFICIENT"};
 if(chart.price_adjusted===true||chart.corporate_action_status==="CORPORATE_ACTION_REVIEW_REQUIRED")return {status:"CORPORATE_ACTION_REVIEW"};
 const a=bs.slice(-n);
 if(a.some((b,i)=>!validBar(b)||b.t!==days[i]||(i>0&&Math.abs(b.o/a[i-1].c-1)>=.4)))return {status:"GAP_OR_INVALID"};
 let checked=0;
 for(const b of a){
  if(b.t<"2026-10-12")continue;
  const q=barAt(b.t,code);
  if(!q)return {status:"MISSING_AUDITED_BAR"};
  if(b.o!==q.open||b.h!==q.high||b.l!==q.low||b.c!==q.close)return {status:"OHLC_MISMATCH"};
  checked++;
 }
 if(checked<21)return {status:"INSUFFICIENT_AUDIT_OVERLAP"};
 return {status:checked===n?"ALL_KRX_MATCH":"PINNED_SOURCE_WITH_KRX_OVERLAP",bars:a,checked};
}
function stochastic(a,n,k,d){
 const fast=[];
 for(let i=n-1;i<a.length;i++){const w=a.slice(i-n+1,i+1),lo=lowest(w),hi=highest(w);fast.push(hi===lo?50:Math.min(100,Math.max(0,100*(a[i].c-lo)/(hi-lo))))}
 const slow=[];for(let i=k-1;i<fast.length;i++)slow.push(mean(fast.slice(i-k+1,i+1)));
 const sig=[];for(let i=d-1;i<slow.length;i++)sig.push(mean(slow.slice(i-d+1,i+1)));
 if(sig.length<2)return null;
 return {k:slow.at(-1),d:sig.at(-1),gc:slow.at(-2)<=sig.at(-2)&&slow.at(-1)>sig.at(-1)};
}
function structure(event,record,calendar,barAt){
 const short=classifyHistory(record.chart,event.day,calendar,event.code,barAt,21);
 const long=classifyHistory(record.chart,event.day,calendar,event.code,barAt,61);
 const f=Object.fromEntries(Object.keys(groups).map(k=>[k,"UNKNOWN"])),raw={};
 const put=(k,v,x)=>{f[k]=typeof v==="boolean"?yes(v):v;raw[k]=r4(x)};
 if(short.bars){
  const a=short.bars,c=a.at(-1).c,p=a.slice(0,-1),p5=p.slice(-5),p10=p.slice(-10),old5=p.slice(-10,-5),ma=n=>mean(a.slice(-n).map(b=>b.c));
  const ret5=pct(p.at(-1).c,a.at(-7).c),ret10=pct(p.at(-1).c,a.at(-12).c);
  // Twenty prior closes span 19 intervals. Use D-20 to D-1 explicitly, not claim 20 full returns.
  const ret20=pct(p.at(-1).c,p[0].c);
  put("prior_5d_return_ge5",ret5>=5,ret5);put("prior_10d_return_ge10",ret10>=10,ret10);put("prior_20d_return_ge15",ret20>=15,ret20);
  put("higher_high_and_low_5v5",highest(p5)>highest(old5)&&lowest(p5)>lowest(old5),pct(lowest(p5),lowest(old5)));
  put("lower_high_and_low_5v5",highest(p5)<highest(old5)&&lowest(p5)<lowest(old5),pct(lowest(p5),lowest(old5)));
  put("prior10_high_break_close",c>highest(p10),pct(c,highest(p10)));
  put("prior20_high_break_close",c>highest(p),pct(c,highest(p)));
  const lowdist=pct(c,lowest(p));put("prior20_low_distance_ge10",lowdist>=10,lowdist);
  const mas=[ma(5),ma(10),ma(20)],spread=pct(Math.max(...mas),Math.min(...mas));
  put("ma5_10_20_spread_le2",spread<=2,spread);put("ma5_gt_ma10_gt_ma20",mas[0]>mas[1]&&mas[1]>mas[2],spread);
  const slope=pct(ma(10),mean(a.slice(-15,-5).map(b=>b.c)));put("ma10_slope5_positive",slope>0,slope);
  const span=b=>(b.h-b.l)/b.c,rangeRatio=mean(p5.map(span))/mean(old5.map(span));
  if(numeric(rangeRatio))put("range5_vs_previous5_le0_7",rangeRatio<=.7,rangeRatio);
  const tr=p.slice(1).map((b,i)=>Math.max(b.h-b.l,Math.abs(b.h-p[i].c),Math.abs(b.l-p[i].c))/p[i].c);
  const atrRatio=mean(tr.slice(-5))/mean(tr.slice(-10,-5));if(numeric(atrRatio))put("atr5_vs_previous5_le0_7",atrRatio<=.7,atrRatio);
  const bw=width(a.slice(-20));put("bb20_unshifted_width_le8",bw<=8,bw);
  put("three_prior_bull_candles",p.slice(-3).every(b=>b.c>b.o),p.slice(-3).filter(b=>b.c>b.o).length);
  const small=p5.filter(b=>b.h>b.l&&Math.abs(b.c-b.o)/(b.h-b.l)<=.3).length;put("prior5_small_body_ge3",small>=3,small);
  const pos=(c-lowest(p))/(highest(p)-lowest(p))*100;if(numeric(pos))put("prior20_range_position_ge80",pos>=80,pos);
 }
 if(long.bars){
  const a=long.bars,c=a.at(-1).c,p=a.slice(0,-1);
  for(const n of [40,60])put("prior"+n+"_high_break_close",c>highest(p.slice(-n)),pct(c,highest(p.slice(-n))));
  const mas=[20,40,60].map(n=>mean(a.slice(-n).map(b=>b.c))),spread=pct(Math.max(...mas),Math.min(...mas));
  put("ma20_40_60_spread_le5",spread<=5,spread);put("ma20_40_60_aligned",mas[0]>mas[1]&&mas[1]>mas[2],spread);
  const ratio=width(a.slice(-20))/width(a.slice(-40,-20));if(numeric(ratio))put("bb20_width_vs_20_sessions_ago_le0_7",ratio<=.7,ratio);
  const pos=(c-lowest(p))/(highest(p)-lowest(p))*100;if(numeric(pos))put("prior60_range_position_ge80",pos>=80,pos);
  for(const [n,k,d] of [[12,5,5],[20,12,12]]){
   const s=stochastic(a,n,k,d),key="stoch"+n+"_"+k+"_"+d;
   if(s){put(key+"_gc",s.gc,s.k-s.d);put(key+"_k_band",band(s.k,[20,50,80],["LT20","20_50","50_80","GE80"]),s.k);}
  }
 }
 f.stored_upper_supply_absent=event.features?.supply_distance==="UNKNOWN"||!event.features?.supply_distance?"UNKNOWN":yes(event.features.supply_distance==="NO_UPPER");
 f.stored_upper_supply_distance=event.features?.supply_distance??"UNKNOWN";
 f.stored_upper_supply_grade=event.historyFeatures?.supply_grade_stored??"UNKNOWN";
 return {features:f,raw,history21:short.status,history61:long.status,audited61:long.checked??0};
}
const horizons=[1,2,3,4,5,6,7,8,9,10,15,20],targets=[3,5,7,10,15,20];
function evaluate(e,sessions,barAt,h,entry){
 const index=sessions.indexOf(e.day);if(index<0)throw Error("STRUCTURE_DISCOVERY_CALENDAR");
 const days=sessions.slice(index+1,index+1+h),base=e.base;
 if(days.length<h)return {complete:false,reason:"HORIZON_NOT_MATURE"};
 const path=[];let prev=base.close;
 for(const day of days){
  const b=barAt(day,e.code);
  if(!b||b.market!==base.market||Math.abs(b.open/prev-1)>=.4)return {complete:false,reason:!b?"MISSING_BAR":b.market!==base.market?"MARKET_CHANGED":"PRICE_DISCONTINUITY"};
  path.push(b);prev=b.close;
 }
 const p=entry==="NEXT_OPEN"?path[0].open:base.close;
 if(!Number.isSafeInteger(p)||p<=0)throw Error("STRUCTURE_ENTRY_PRICE");
 const high=Math.max(...path.map(b=>b.high)),low=Math.min(...path.map(b=>b.low));
 const first={};for(const t of targets){const i=path.findIndex(b=>BigInt(b.high)*100n>=BigInt(p)*BigInt(100+t));first[t]=i<0?null:i+1}
 return {complete:true,entry:p,exit:path.at(-1).close,return_pct:pct(path.at(-1).close,p),max_pct:pct(high,p),min_pct:pct(low,p),first,opening_gap_pct:pct(path[0].open,base.close)};
}
function stats(rows){
 const a=rows.filter(x=>x.result.complete),ret=a.map(x=>x.result.return_pct);
 const med=xs=>{if(!xs.length)return null;const s=[...xs].sort((a,b)=>a-b),i=Math.floor(s.length/2);return s.length%2?s[i]:(s[i-1]+s[i])/2};
 const agg=xs=>({mean:xs.length?r4(mean(xs)):null,median:r4(med(xs)??NaN)});
 return {n:rows.length,complete:a.length,unknown:rows.length-a.length,stocks:new Set(a.map(x=>x.code)).size,dates:new Set(a.map(x=>x.day)).size,
  positive_close:a.filter(x=>x.result.return_pct>0).length,close_return:agg(ret),max_return:agg(a.map(x=>x.result.max_pct)),min_return:agg(a.map(x=>x.result.min_pct)),
  targets:Object.fromEntries(targets.map(t=>{const hits=a.filter(x=>x.result.first[t]!==null);return [t,{hits:hits.length,rate_pct:a.length?r4(100*hits.length/a.length):null,first_day:agg(hits.map(x=>x.result.first[t]))}]}))};
}
function ratioBand(e){if(e.amountAudit!=="MATCH"||!numeric(e.amountRatio)||e.amountRatio<0)return null;return band(e.amountRatio,[1,3,5,10],["LT1","1_3","3_5","5_10","GE10"])}
function contrast(rows,key,value,compare){
 const flag=e=>e.structure.features[key]==="UNKNOWN"||e.structure.features[key]===undefined?null:e.structure.features[key]===value;
 const valid=rows.filter(e=>e.result.complete),yes=valid.filter(e=>flag(e)===true),no=valid.filter(e=>flag(e)===false);
 const tagged=valid.map(e=>({...e,result:{...e.result,status:e.result.first[15]!==null?"HIT":"MISS"}}));
 const matched=compare(tagged,flag),known=tagged.filter(e=>ratioBand(e)!==null).map(e=>({...e,base:{...e.base,market:e.base.market+"|"+ratioBand(e)}}));
 const amountAdjusted=compare(known,flag);
 return {key,value,source_tier:groups[key]===21?"RECENT_KRX_OHLC_MATCH":groups[key]===61?"PINNED_61_WITH_KRX_OVERLAP":"STORED_ESTIMATE_NOT_INDEPENDENT",yes:stats(yes),no:stats(no),unknown:valid.length-yes.length-no.length,
  day_market_overlap:matched.overlap,day_market_amount_overlap:amountAdjusted.overlap,amount_known_n:known.length,
  small_sample:matched.small_sample||new Set(yes.map(x=>x.code)).size<30||new Set(no.map(x=>x.code)).size<30};
}
function study(events,sessions,barAt,compare){
 const patterns=[...new Set(events.flatMap(e=>e.signalNames))].sort(),rows=[];
 const privateRows=events.map(e=>({day:e.day,code:e.code,name:e.name??null,signal_names:e.signalNames,base:e.base,structure:e.structure,amount_ratio:e.amountRatio,amount_audit:e.amountAudit,windows:{}}));
 for(const entry of ["NEXT_OPEN","DISCOVERY_CLOSE_REFERENCE"]){
  for(const h of horizons){
   const es=events.map((e,i)=>{const result=evaluate(e,sessions,barAt,h,entry);privateRows[i].windows[entry]??={};privateRows[i].windows[entry][h]=result;return {...e,result}});
   const same10=es.filter(e=>evaluate(e,sessions,barAt,10,entry).complete);
   const same20=es.filter(e=>evaluate(e,sessions,barAt,20,entry).complete);
   const result={entry,horizon:h,overall:stats(es),same_10day_cohort:h<=10?stats(same10):null,same_20day_cohort:stats(same20),
    by_pattern:patterns.map(p=>({pattern:p,...stats(es.filter(e=>e.signalNames.includes(p)))})),
    incomplete_reasons:Object.fromEntries([...new Set(es.filter(e=>!e.result.complete).map(e=>e.result.reason))].map(k=>[k,es.filter(e=>e.result.reason===k).length]))};
   if([3,5,10,20].includes(h)&&entry==="NEXT_OPEN"&&result.overall.complete){
    const valid=es.filter(e=>e.result.complete);
    const compareFeatures=cohort=>Object.keys({...groups,...extraGroups}).flatMap(key=>{
     const values=[...new Set(cohort.map(e=>e.structure.features[key]).filter(v=>v!==undefined&&v!=="UNKNOWN"))].sort();
     return values.filter(v=>v!=="NO").map(v=>contrast(cohort,key,v,compare));
    });
    result.structure={all:compareFeatures(valid),amount_lt3:compareFeatures(valid.filter(e=>["LT1","1_3"].includes(ratioBand(e)))),
      by_pattern:patterns.map(p=>{const a=valid.filter(e=>e.signalNames.includes(p));return {pattern:p,baseline:stats(a),all:compareFeatures(a),amount_lt3:compareFeatures(a.filter(e=>["LT1","1_3"].includes(ratioBand(e))))}})};
   }
   rows.push(result);
  }
 }
 const counts=k=>Object.fromEntries([...new Set(events.map(e=>e.structure[k]))].map(s=>[s,events.filter(e=>e.structure[k]===s).length]));
 return {history_quality:{recent21:counts("history21"),long61:counts("history61")},rows,privateRows};
}
export {structure,evaluate,study,groups,stochastic,classifyHistory,stats};

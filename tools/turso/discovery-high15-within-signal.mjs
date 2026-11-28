/** Same-search-condition descriptive comparisons; no outcome-driven feature selection. */
const patterns=["BB20","BB30","BB40","ENV20","ENV40","BB20_LOWER","BB30_LOWER","BB40_LOWER","BB20_ALT","BB30_ALT","BB40_ALT","BB20_LOWER_ALT","BB30_LOWER_ALT","BB40_LOWER_ALT","BB30_LOWER_RECLAIM","ENV20_LOWER_TOUCH"];
function historicalFeatures(base,days,barAt,stored){
 const i=days.indexOf(base.day),prior=n=>i>=n?barAt(days[i-n],base.code):null;
 const good=b=>b&&b.market===base.market&&Number.isSafeInteger(b.amount)&&b.amount>0&&Number.isSafeInteger(b.close)&&b.close>0;
 const range=(from,to)=>{if(i<to)return null;const a=[];for(let k=from;k<=to;k++){const b=prior(k);if(!good(b))return null;a.push(b)}return a};
 const avg=a=>a.reduce((s,b)=>s+b.amount,0)/a.length;
 const ratio=n=>{const a=range(n+1,n+20),b=n===0?base:prior(n);return a&&good(b)?b.amount/avg(a):null};
 const r=ratio(0),r1=ratio(1),r3=ratio(3),r5=ratio(5);
 const storedOK=typeof stored==="number"&&Number.isFinite(stored)&&stored>=0;
 const audit=r===null?"MISSING_20_EXACT_SESSIONS":!storedOK?"STORED_UNKNOWN":Math.abs(r-stored)<=0.0000051?"MATCH":"MISMATCH";
 const f={};
 const flag=(v)=>v===null?"UNKNOWN":v?"YES":"NO";
 const five=range(1,5),ten=range(1,10),three=range(1,3);
 // Use only exact audited KRX rows; missing calendar dates are not silently skipped.
 f.prior_3d_amount_rising=flag(three?three[2].amount<three[1].amount&&three[1].amount<three[0].amount:null);
 f.prior_5d_amount_mean_vs_previous5=flag(ten?avg(ten.slice(0,5))>=1.5*avg(ten.slice(5)):null);
 f.prior_5d_amount_at_least_half_signal=flag(five?five.some(b=>b.amount>=base.amount/2):null);
 f.ratio_ge3_recomputed=flag(audit==="MATCH"?r>=3:null);
 f.ratio_5_10_recomputed=flag(audit==="MATCH"?r>=5&&r<10:null);
 f.prior_ratio_ge1_5=flag(r1===null||r3===null||r5===null?null:r1>=1.5&&r3>=1.5&&r5>=1.5);
 f.ratio_rising_5_3_1_0=flag(audit!=="MATCH"||r1===null||r3===null||r5===null?null:r5<r3&&r3<r1&&r1<r);
 const maNow=range(1,19),maPrior=range(5,24);
 const meanClose=a=>a.reduce((sum,b)=>sum+b.close,0)/a.length;
 const maSlope=maNow&&maPrior&&good(base)?100*(meanClose([base,...maNow])/meanClose(maPrior)-1):null;
 f.ma20_slope_5d=maSlope===null?"UNKNOWN":maSlope< -0.5?"FALLING":maSlope>0.5?"RISING":"FLAT";
 if(ten&&ten.every(b=>Number.isSafeInteger(b.high)&&Number.isSafeInteger(b.low)&&b.high>=b.close&&b.low<=b.close&&b.low>0)){
  const hi=Math.max(...ten.map(b=>b.high)),lo=Math.min(...ten.map(b=>b.low));
  const distHi=100*(hi/base.close-1),distLo=100*(base.close/lo-1);
  const distance=v=>v<0?"BREAK":v<3?"LT3":v<10?"3_10":"GE10";
  f.prior_10d_high_distance=distance(distHi);f.prior_10d_low_distance=distance(distLo);
 }else{f.prior_10d_high_distance="UNKNOWN";f.prior_10d_low_distance="UNKNOWN"}
 for(const n of [3,5,10]){
  const a=range(1,n);
  const contiguous=a&&[base,...a].every((b,j,all)=>j===all.length-1||Math.abs(b.open/all[j+1].close-1)<.4);
  const ret=contiguous?100*(base.close/a.at(-1).close-1):null;
  f["return_dminus"+n+"_to_signal"]=ret===null?"UNKNOWN":ret< -5?"LT_MINUS5":ret<0?"MINUS5_0":ret<5?"0_5":ret<15?"5_15":"GE15";
 }
 return {audit,features:f};
}

function rate(a,b){return b?Math.round(a/b*1000000)/10000:null}

function summary(rows){
 const h=rows.filter(e=>e.result.status==="HIT");
 const stat=k=>{const a=rows.map(e=>e.result[k]).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return {n:0,mean:null,median:null};const i=Math.floor(a.length/2),rnd=v=>Math.round(v*10000)/10000;return {n:a.length,mean:rnd(a.reduce((s,v)=>s+v,0)/a.length),median:rnd(a.length%2?a[i]:(a[i-1]+a[i])/2)}};
 return {n:rows.length,hits:h.length,hit_pct:rate(h.length,rows.length),stocks:new Set(rows.map(e=>e.code)).size,dates:new Set(rows.map(e=>e.day)).size,max_pct:stat("max_pct"),min_pct:stat("min_pct")};
}

function contrast(rows,key,val,compare){
 const flag=e=>e.features[key]===undefined||e.features[key]==="UNKNOWN"?null:e.features[key]===val;
 const a=rows.filter(e=>flag(e)===true),b=rows.filter(e=>flag(e)===false),c=compare(rows,flag);
 return {feature:key,value:val,yes:summary(a),no:summary(b),unknown:c.unknown,overlap:c.overlap,small_sample:c.small_sample||new Set(a.map(e=>e.code)).size<30||new Set(b.map(e=>e.code)).size<30};
}

function withinSignalStudy(rows,compare){
 const valid=rows.filter(e=>e.full&&e.result.complete);
 const keys=[...new Set(valid.flatMap(e=>Object.keys(e.features)))].filter(k=>!k.startsWith("signal_")&&k!=="market"&&k!=="market_breadth").sort();
 const featureCoverage=cohort=>Object.fromEntries(keys.map(k=>[k,cohort.filter(e=>e.features[k]!==undefined&&e.features[k]!=="UNKNOWN").length]));
 const byFeature=cohort=>keys.flatMap(key=>[...new Set(cohort.map(e=>e.features[key]).filter(v=>v!==undefined&&v!=="UNKNOWN"))].sort().map(v=>contrast(cohort,key,v,compare)));
 const result=patterns.map(p=>{
  const cohort=valid.filter(e=>e.features["signal_"+p]==="YES");
  const single=cohort.filter(e=>e.signalNames?.length===1);
  return {pattern:p,baseline:summary(cohort),single_signal:summary(single),multiple_signal:summary(cohort.filter(e=>e.signalNames?.length>1)),feature_known_counts:featureCoverage(cohort),additional_features:byFeature(cohort),
   // Keep co-occurrence out of the additional-feature section.
   co_signals:patterns.filter(q=>q!==p).map(q=>contrast(cohort,"signal_"+q,"YES",compare))};
 });
 const audit={};for(const e of valid){const k=e.amountAudit??"NOT_CHECKED";audit[k]=(audit[k]||0)+1}
 return {schema:"BLUE_HIGH15_WITHIN_SIGNAL_V1",baseline:summary(valid),excluded:rows.length-valid.length,ratio_audit:audit,
  feature_known_counts:featureCoverage(valid),additional_features_all:byFeature(valid),patterns:result,notes:["Base signal membership is never used as an additional feature. All 16 search flags and signal count are excluded there.","Cohorts overlap; do not add their counts. Co-signals are separate.","Only complete outcome and full scanner-universe dates. Same-day and market overlap weighting, not causal effects.","Historical features use fixed expected dates and hash-verified KRX rows; missing days or unmatched ratios are unknown, not zero.","Stored technical factors remain distinct from independently recalculated turnover ratio."]};
}

function withinTest(compare){
 let n=0;const t=v=>{if(!v)throw Error("HIGH15_WITHIN_TEST_FAILED");n++};
 const days=Array.from({length:26},(_,i)=>"d"+i),base={day:"d25",code:"000001",market:"KOSPI",amount:300,close:100,open:100};
 const at=(day)=>({day,code:base.code,market:base.market,amount:100,close:100,open:100});
 const a=historicalFeatures(base,days,at,3);
 t(a.audit==="MATCH"&&a.features.ratio_ge3_recomputed==="YES"&&a.features.return_dminus10_to_signal==="0_5");
 t(historicalFeatures(base,days,at,3.01).audit==="MISMATCH");
 t(historicalFeatures(base,days,at,3.01).features.ratio_ge3_recomputed==="UNKNOWN");
 t(historicalFeatures(base,days,(d)=>d==="d10"?null:at(d),3).audit==="MISSING_20_EXACT_SESSIONS");
 t(historicalFeatures(base,days,(d)=>{if(d==="d26")throw Error("FUTURE");return at(d)},3).audit==="MATCH");
 const row=(code,p,hit,flag,full=true)=>({code,day:"d25",base,full,signalNames:p,result:{complete:true,status:hit?"HIT":"MISS",max_pct:hit?16:5,min_pct:-2},features:{signal_ENV20:p.includes("ENV20")?"YES":"NO",signal_BB40:p.includes("BB40")?"YES":"NO",signal_count:p.length===1?"1":"2",rsi_gc:flag},amountAudit:"MATCH"});
 const rs=[row("000001",["ENV20","BB40"],true,"YES"),row("000002",["ENV20"],false,"NO"),row("000003",["BB40"],true,"UNKNOWN"),row("000004",["ENV20"],true,"YES",false)];
 const v=withinSignalStudy(rs,compare),env=v.patterns.find(x=>x.pattern==="ENV20"),bb=v.patterns.find(x=>x.pattern==="BB40");
 t(v.baseline.n===3&&v.excluded===1&&env.baseline.n===2&&bb.baseline.n===2);
 t(env.single_signal.n===1&&env.multiple_signal.n===1);
 t(env.additional_features.every(x=>!x.feature.startsWith("signal_")));
 t(env.additional_features.find(x=>x.feature==="rsi_gc"&&x.value==="YES").yes.hits===1);
 t(env.co_signals.every(x=>x.feature!=="signal_ENV20"));
 t(env.co_signals.find(x=>x.feature==="signal_BB40").yes.n===1);
 t(!JSON.stringify(v).includes("000001"));
 return n;
}
export {historicalFeatures,withinSignalStudy,withinTest};

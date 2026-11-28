/** Exploratory aggregate contrasts; no causal or independent validation claim. */
function ratioBand(x){
 if(typeof x!=="number"||!Number.isFinite(x)||x<0)return "UNKNOWN";
 const edges=[.5,1,1.5,2,3,5,10],labels=["LT0_5","0_5_1","1_1_5","1_5_2","2_3","3_5","5_10","GE10"];
 const i=edges.findIndex(y=>x<y);return labels[i<0?edges.length:i];
}

function pct(a,b){return b?Math.round(1000000*a/b)/10000:null}

function counts(rows){const h=rows.filter(e=>e.result.status==="HIT").length;return {n:rows.length,hits:h,hit_pct:pct(h,rows.length),dates:new Set(rows.map(e=>e.day)).size,stocks:new Set(rows.map(e=>e.code)).size}}

function compare(rows,flag){
 const yes=[],no=[];let unknown=0;
 for(const e of rows){const v=flag(e);if(v===true)yes.push(e);else if(v===false)no.push(e);else unknown++}
 const strata=new Map();
 for(const [group,rs] of [["yes",yes],["no",no]])for(const e of rs){
  const key=e.day+"/"+e.base.market;if(!strata.has(key))strata.set(key,{yes:[],no:[]});
  strata.get(key)[group].push(e);
 }
 let overlap=0,aSum=0,bSum=0,matchedYes=0,matchedNo=0;const details=[];
 for(const [key,v] of strata){
  const a=counts(v.yes),b=counts(v.no);
  if(!a.n||!b.n)continue;
  // Equal weight per overlap unit; identical weights for the two groups.
  const w=Math.min(a.n,b.n);overlap+=w;matchedYes+=a.n;matchedNo+=b.n;
  aSum+=w*a.hits/a.n;bSum+=w*b.hits/b.n;
  const [day,market]=key.split("/");
  details.push({day,market,yes_n:a.n,yes_hits:a.hits,no_n:b.n,no_hits:b.hits,weight:w});
 }
 return {yes:counts(yes),no:counts(no),unknown,
  overlap:{method:"DAY_MARKET_MIN_GROUP_SIZE_WEIGHT",strata:details,weight:overlap,matched_yes:matchedYes,matched_no:matchedNo,
   yes_pct:overlap?pct(aSum,overlap):null,no_pct:overlap?pct(bSum,overlap):null,
   difference_pp:overlap?Math.round(1000000*(aSum-bSum)/overlap)/10000:null},
  small_sample:yes.length<30||no.length<30||new Set(yes.map(e=>e.day)).size<3||overlap<30};
}

function study(rows){
 const valid=rows.filter(e=>e.full&&e.result.complete);
 const ge3=e=>typeof e.amountRatio==="number"&&Number.isFinite(e.amountRatio)&&e.amountRatio>=0?e.amountRatio>=3:null;
 const high=valid.filter(e=>ge3(e)===true);
 const yesFlag=(e,k)=>e.features[k]==="YES"?true:e.features[k]==="NO"?false:null;
 const eq=(e,k,v)=>e.features[k]===undefined||e.features[k]==="UNKNOWN"?null:e.features[k]===v;
 const rules=[
 ["STOCH_20_12_12_GC",e=>yesFlag(e,"slow_20_12_12_gc_stored")],
 ["STOCH_12_5_5_GC",e=>yesFlag(e,"slow_12_5_5_gc_stored")],
 ["NO_UPPER_SUPPLY",e=>eq(e,"supply_distance","NO_UPPER")],
 ["LONG_BEAR",e=>eq(e,"candle","LONG_BEAR")],
 ["ENV20_LOWER_TOUCH",e=>yesFlag(e,"signal_ENV20_LOWER_TOUCH")],
 ["BB40_LOWER",e=>yesFlag(e,"signal_BB40_LOWER")]];
 const and=(a,b)=>a===false||b===false?false:a===true&&b===true?true:null;
 const bands=["LT0_5","0_5_1","1_1_5","1_5_2","2_3","3_5","5_10","GE10"];
 return {baseline:counts(valid),excluded:rows.length-valid.length,
   ratio_unknown:valid.filter(e=>ratioBand(e.amountRatio)==="UNKNOWN").length,
   ratio_bands:bands.map(b=>({band:b,...counts(valid.filter(e=>ratioBand(e.amountRatio)===b))})),
   ratio_ge3:compare(valid,ge3),
   compounds:rules.map(([name,f])=>({name,all_vs_rest:compare(valid,e=>and(ge3(e),f(e))),incremental_within_ge3:compare(high,f)}))};
}

function conditionalTest(){
 let n=0;const t=ok=>{if(!ok)throw Error("HIGH15_CONDITIONAL_TEST_FAILED");n++};
 const r=(day,market,code,ratio,hit,flag="YES",full=true,complete=true)=>({day,code,amountRatio:ratio,base:{market},full,result:{complete,status:hit?"HIT":"MISS"},features:{slow_20_12_12_gc_stored:flag}});
 t(ratioBand(3)==="3_5"&&ratioBand(5)==="5_10"&&ratioBand(10)==="GE10");
 t(ratioBand(null)==="UNKNOWN"&&ratioBand(-1)==="UNKNOWN"&&ratioBand(0)==="LT0_5");
 const rows=[r("a","KOSPI","000001",3,true),r("a","KOSPI","000002",2,false),r("b","KOSDAQ","000003",5,false,"NO"),r("b","KOSDAQ","000004",1,true),r("a","KOSPI","000005",10,false,"UNKNOWN"),r("c","KOSPI","000006",null,true),r("c","KOSPI","000007",3,true,"YES",false),r("c","KOSPI","000008",3,true,"YES",true,false)];
 const s=study(rows);
 t(s.baseline.n===6&&s.excluded===2&&s.ratio_unknown===1);
 t(s.ratio_ge3.yes.n===3&&s.ratio_ge3.no.n===2&&s.ratio_ge3.unknown===1);
 t(s.ratio_ge3.overlap.weight===2&&s.ratio_ge3.overlap.yes_pct===25&&s.ratio_ge3.overlap.no_pct===50);
 const c=s.compounds[0];t(c.incremental_within_ge3.yes.n===1&&c.incremental_within_ge3.no.n===1&&c.incremental_within_ge3.unknown===1);
 t(c.incremental_within_ge3.overlap.difference_pp===null&&c.incremental_within_ge3.small_sample);
 t(s.ratio_bands.find(x=>x.band==="GE10").n===1);
 t(!JSON.stringify(s).includes("000001"));
 return n;
}
export {study,conditionalTest,compare};

/** Frozen research hypotheses and private case extraction. */
const rules=[
  {
    "id": "ENV20_AMOUNT3",
    "pattern": "ENV20",
    "conditions": [
      [
        "ratio_ge3_recomputed",
        "YES"
      ]
    ]
  },
  {
    "id": "ENV20_AMOUNT5_10",
    "pattern": "ENV20",
    "conditions": [
      [
        "ratio_5_10_recomputed",
        "YES"
      ]
    ]
  },
  {
    "id": "ENV20_AMOUNT3_STOCH12",
    "pattern": "ENV20",
    "conditions": [
      [
        "ratio_ge3_recomputed",
        "YES"
      ],
      [
        "slow_12_5_5_gc_stored",
        "YES"
      ]
    ]
  },
  {
    "id": "ENV20_AMOUNT3_RETURN3",
    "pattern": "ENV20",
    "conditions": [
      [
        "ratio_ge3_recomputed",
        "YES"
      ],
      [
        "return_dminus3_to_signal",
        "5_15"
      ]
    ]
  },
  {
    "id": "ENV40_AMOUNT3",
    "pattern": "ENV40",
    "conditions": [
      [
        "ratio_ge3_recomputed",
        "YES"
      ]
    ]
  },
  {
    "id": "ENV40_AMOUNT3_PRIOR3",
    "pattern": "ENV40",
    "conditions": [
      [
        "ratio_ge3_recomputed",
        "YES"
      ],
      [
        "prior_3d_amount_rising",
        "YES"
      ]
    ]
  },
  {
    "id": "ENV20_TOUCH_LONG_BEAR",
    "pattern": "ENV20_LOWER_TOUCH",
    "conditions": [
      [
        "candle",
        "LONG_BEAR"
      ]
    ]
  },
  {
    "id": "ENV20_TOUCH_LONG_BEAR_RSI30_50",
    "pattern": "ENV20_LOWER_TOUCH",
    "conditions": [
      [
        "candle",
        "LONG_BEAR"
      ],
      [
        "rsi_stored",
        "30_50"
      ]
    ]
  },
  {
    "id": "BB40_LOWER_STOCH12",
    "pattern": "BB40_LOWER",
    "conditions": [
      [
        "slow_12_5_5_gc_stored",
        "YES"
      ]
    ]
  },
  {
    "id": "BB40_LOWER_STOCH12_AMOUNT3",
    "pattern": "BB40_LOWER",
    "conditions": [
      [
        "slow_12_5_5_gc_stored",
        "YES"
      ],
      [
        "ratio_ge3_recomputed",
        "YES"
      ]
    ]
  }
];
function amountEvidence(e,days,barAt){
 const i=days.indexOf(e.day),expected=i>=20?days.slice(i-20,i):[],history=expected.map(day=>({day,bar:barAt(day,e.code)}));
 const valid=x=>x.bar&&x.bar.market===e.base.market&&Number.isSafeInteger(x.bar.amount)&&x.bar.amount>0;
 const missing=history.filter(x=>!valid(x)).map(x=>x.day);
 const sum=expected.length===20&&!missing.length?history.reduce((n,x)=>n+BigInt(x.bar.amount),0n):null;
 const recomputed=sum&&sum>0n?Number(BigInt(e.base.amount)*20n)/Number(sum):null;
 const stored=e.amountRatio;
 const diff=Number.isFinite(stored)&&recomputed!==null?recomputed-stored:null;
 const raw=e.storedAmount;
 const storedAmount=(typeof raw==="number"||typeof raw==="string"&&raw.trim()!=="")&&Number.isSafeInteger(Number(raw))?Number(raw):null;
 const chartDates=e.chartDates??[];
 const chartDateMatch=chartDates.length===21&&expected.length===20?chartDates.join(",")===[...expected,e.day].join(","):null;
 const issues=[];
 if(expected.length!==20)issues.push("CALENDAR_HISTORY_INSUFFICIENT");
 if(missing.length)issues.push("MISSING_OR_INVALID_KRX_ROWS");
 if(storedAmount!==null&&storedAmount!==e.base.amount)issues.push("SIGNAL_AMOUNT_DIFFERS_FROM_KRX");
 if(chartDateMatch===false)issues.push("STORED_CHART_SESSION_LIST_DIFFERS");
 if(diff!==null&&Math.abs(diff)>0.0000051)issues.push("STORED_RATIO_DIFFERS");
 if(storedAmount===null)issues.push("STORED_SIGNAL_AMOUNT_UNAVAILABLE");
 if(recomputed===null||!Number.isFinite(stored))issues.push("RATIO_COMPARISON_UNAVAILABLE");
 const inferredMean=Number.isFinite(stored)&&stored>0&&storedAmount!==null?storedAmount/stored:null;
 return {status:e.amountAudit??"NOT_CHECKED",stored_ratio:stored??null,recomputed_ratio:recomputed,difference:diff,krx_amount:e.base.amount,stored_signal_amount:storedAmount,prior20_sum:sum===null?null:String(sum),prior20_mean:sum===null?null:Number(sum)/20,implied_stored_mean:inferredMean,chart_sessions_match:chartDateMatch,issues,missing_days:missing,
  prior20_details:e.amountAudit==="MATCH"?undefined:history.map(x=>({day:x.day,amount:valid(x)?x.bar.amount:null})),stored_chart_last21:e.amountAudit==="MATCH"?undefined:chartDates};
}

function frozenStudy(rows,compare){
 const valid=rows.filter(e=>e.full&&e.result.complete);
 const flag=(e,c)=>e.features[c[0]]===undefined||e.features[c[0]]==="UNKNOWN"?null:e.features[c[0]]===c[1];
 const all=(e,cs)=>{const f=cs.map(c=>flag(e,c));return f.includes(false)?false:f.includes(null)?null:true};
 const checks=(x)=>({enough_sample:x.yes.stocks>=30&&x.no.stocks>=30&&x.yes.dates>=3&&x.no.dates>=3&&x.overlap.weight>=30,positive_raw:x.yes.hit_pct!==null&&x.no.hit_pct!==null&&x.yes.hit_pct>x.no.hit_pct,positive_adjusted:x.overlap.difference_pp!==null&&x.overlap.difference_pp>0});
 return {rules:rules.map(r=>{
  const base=valid.filter(e=>e.features["signal_"+r.pattern]==="YES");
  const a=compare(base,e=>all(e,r.conditions));
  const extra=r.conditions.length>1?compare(base.filter(e=>all(e,r.conditions.slice(0,-1))===true),e=>flag(e,r.conditions.at(-1))):null;
  return {...r,base_n:base.length,combined:a,screen_checks:checks(a),incremental:extra,incremental_checks:extra?checks(extra):null};
 }),eligible_n:valid.length,notes:["Prespecified after November exploratory period; original period is training, not holdout.","Only full scanner-universe dates and complete outcome paths. Feature unknowns excluded from applicable contrasts.","Screen checks are descriptive minimums, not a significance test or approval to trade. Repeated stock-days and multiple comparisons remain."]};
}

function collectCases(events,days,barAt,outcome){
 const cases=events.map(e=>{
  const path=days.slice(days.indexOf(e.day)+1),bars=path.map(day=>({day,bar:barAt(day,e.code)}));
  const observed=bars.filter(x=>x.bar);
  const peak=observed.reduce((a,b)=>!a||b.bar.high>a.bar.high?b:a,null);
  const low=observed.reduce((a,b)=>!a||b.bar.low<a.bar.low?b:a,null);
  const windows={ASOF:outcome(e.base,path,barAt)};
  for(const h of [1,3,5])windows[h]=path.length>=h?outcome(e.base,path.slice(0,h),barAt):{status:"UNKNOWN",reason:"HORIZON_NOT_MATURE",complete:false};
  return {code:e.code,name:e.base.name??null,day:e.day,market:e.base.market,signal_names:e.signalNames,full_universe:e.full,source_record_sha256:e.recordSha,source_payload_sha256:e.payloadSha,discovery_ohlc:{open:e.base.open,high:e.base.high,low:e.base.low,close:e.base.close},amount_evidence:e.amountEvidence,features:{...e.features,...e.historyFeatures},indicator_values:e.indicatorValues,
    screen:{peak_day:peak?.day??null,high:peak?.bar.high??null,low_day:low?.day??null,low:low?.bar.low??null,max_pct:peak?100*(peak.bar.high/e.base.close-1):null,min_pct:low?100*(low.bar.low/e.base.close-1):null,hit:peak?BigInt(peak.bar.high)*100n>=BigInt(e.base.close)*115n:null},windows,
    future_bars:bars.map(x=>({day:x.day,...(x.bar?{open:x.bar.open,high:x.bar.high,low:x.bar.low,close:x.bar.close,amount:x.bar.amount}: {missing:true})}))};
 });
 return {schema:"BLUE_HIGH15_PRIVATE_CASES_V1",start:days[0],cutoff:days.at(-1),cases,notes:["Actual original discovery records, not an investment return. Screen maximum ignores continuity; guarded windows censor gaps. No intraday order known.","Cases include successes and misses, not just selected winners."]};
}

function caseTest(compare){
 let n=0;const t=ok=>{if(!ok)throw Error("HIGH15_CASE_TEST_FAILED");n++};
 const days=Array.from({length:22},(_,i)=>"d"+i);
 const e={day:"d20",code:"000001",base:{name:"FIXTURE",market:"KOSPI",amount:300,close:100},amountRatio:3,amountAudit:"MATCH",storedAmount:"300",chartDates:days.slice(0,21),full:true,signalNames:["ENV20"],features:{signal_ENV20:"YES",ratio_ge3_recomputed:"YES"},historyFeatures:{},result:{complete:true,status:"HIT"}};
 const at=(d)=>({market:"KOSPI",amount:100,high:115,low:90,close:110,open:100});
 const a=amountEvidence(e,days,at);t(a.recomputed_ratio===3&&a.prior20_sum==="2000"&&a.chart_sessions_match&&a.issues.length===0);
 const b=amountEvidence({...e,storedAmount:290,amountRatio:2.9,amountAudit:"MISMATCH"},days,at);t(b.issues.includes("SIGNAL_AMOUNT_DIFFERS_FROM_KRX")&&b.issues.includes("STORED_RATIO_DIFFERS")&&b.prior20_details.length===20);
 t(amountEvidence(e,days,d=>d==="d3"?null:at(d)).missing_days[0]==="d3");
 t(amountEvidence(e,days,d=>{if(d==="d21")throw Error("LOOKAHEAD");return at(d)}).recomputed_ratio===3);
 const f=frozenStudy([e],compare);t(f.rules[0].combined.yes.n===1&&f.rules[2].combined.unknown===1&&f.rules[4].base_n===0);
 const c=collectCases([e],days.slice(20),at,()=>({complete:true,status:"HIT"}));t(c.cases.length===1&&c.cases[0].screen.hit===true&&c.cases[0].windows[3].complete===false&&c.cases[0].name==="FIXTURE");
 t(!JSON.stringify(f).includes("000001"));
 return n;
}
export {amountEvidence,frozenStudy,collectCases,caseTest};

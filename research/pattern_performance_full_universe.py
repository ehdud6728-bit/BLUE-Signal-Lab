"""Full-universe, close-known research: stock direction before signal versus market state.
No recommendation, no threshold tuning; no use of future outcomes for feature selection.
"""
import argparse,json,math
from collections import Counter,defaultdict
from datetime import date
from pathlib import Path
from statistics import median
from pattern_performance_audited import candle
from pattern_performance_structure import structure
HORIZONS=(1,3,5,10)
SCOPES=("KOSPI","KOSDAQ")
STATES=("UP_CONFIRMED","DOWN_CONFIRMED","RECOVERY_WATCH","WEAKENING_WATCH","MIXED_OR_DIVERGENT","UNKNOWN")
def check(ok,msg):
    if not ok:raise ValueError(msg)
def direction(a,b):
    return "UP" if b>a else "DOWN" if b<a else "FLAT"
def features(h):
    c=h[-1];prev=h[-2]
    # Prior five-observation move ends BEFORE the signal candle.
    stock=direction(h[-7]["close"],prev["close"])
    f=["BASELINE","CANDLE_"+candle(c)]
    if c["close"]>prev["close"]:f.append("UP_DAY")
    if c["close"]>prev["high"]:f.append("PREV_HIGH_BREAK")
    if c["close"]>max(x["high"] for x in h[-6:-1]):f.append("PRIOR5_HIGH_BREAK")
    if 20*c["close"]>sum(x["close"] for x in h[-20:]) and 20*prev["close"]<=sum(x["close"] for x in h[-21:-1]):f.append("MA20_FIRST_CROSS")
    if c["amount"]*20>=sum(x["amount"] for x in h[-21:-1])*1.5:f.append("AMOUNT_SURGE_1_5")
    st=structure(h[-11:])
    if st.startswith("PRIOR_RISE"):f.append(st)
    return stock,f
def summarize(events):
    vals=[x[2] for x in events if x[2] is not None];n=len(vals)
    pos=[r for r in vals if r>0];neg=[r for r in vals if r<0]
    nd=len({x[0] for x in events if x[2] is not None});ns=len({x[1] for x in events if x[2] is not None})
    return dict(events=len(events),sample_count=n,signal_dates=nd,symbols=ns,pending=sum(x[3]=="PENDING" for x in events),missing_path=sum(x[3]=="MISSING_PATH" for x in events),positive_pct=round(100*len(pos)/n,2) if n else None,mean_pct=round(math.fsum(vals)/n,3) if n else None,median_pct=round(median(vals),3) if n else None,profit_factor=round(math.fsum(pos)/-math.fsum(neg),3) if neg else None,sample_floor_met=n>=30 and nd>=5 and ns>=10)
def study(src,bench):
    check(src.get("schema")=="BLUE_FULL_UNIVERSE_SOURCE_V1" and src.get("original_eod_hashes_recomputed") is True and bench.get("schema")=="BLUE_BENCHMARK_DAILY_STATES_V1" and src["cutoff"]==bench["cutoff"],"SOURCE_PROOF_REQUIRED")
    days=[x["day"] for x in src["days"]];check(bool(days) and days==sorted(set(days)) and days[-1]<=src["cutoff"],"BAD_DATES")
    meta={x["day"]:x for x in src["days"]};idx={d:i for i,d in enumerate(days)}
    by={};counts=Counter()
    for b in src["bars"]:
        k=(b["day"],b["code"]);check(k not in by and k[0] in idx and b["market"] in SCOPES and all(type(b[x]) is int and b[x]>0 for x in ("open","high","low","close","amount")) and b["low"]<=min(b["open"],b["close"])<=max(b["open"],b["close"])<=b["high"],"BAD_BAR")
        by[k]=b;counts[k[0]]+=1
    check(all(counts[d]==meta[d]["rows"] for d in days),"BAD_UNIVERSE_COUNT")
    states={};dates={};positions={}
    for m in bench["markets"]:
        scope=m["market"];check(scope in SCOPES and scope not in dates,"BAD_BENCHMARK_SCOPE")
        ds=[x["day"] for x in m["days"]];check(ds==sorted(set(ds)) and all(date.fromisoformat(d).isoformat()==d and d<=bench["cutoff"] for d in ds),"BAD_BENCHMARK_DATES")
        dates[scope]=ds;positions[scope]={d:i for i,d in enumerate(ds)}
        for x in m["days"]:
            check(x["state"] in STATES and x["index_trend"] in ("UP","DOWN","MIXED","UNKNOWN"),"BAD_BENCHMARK_STATE")
            states[scope,x["day"]]=(x["state"],x["index_trend"])
    check(set(dates)==set(SCOPES),"MISSING_BENCHMARK_SCOPE")
    old={}
    for s in src["signals"]:
        k=(s["day"],s["code"])
        check(k in by and k not in old and meta[k[0]]["signal_status"]=="COUNT_AND_PAYLOAD_HASH_METADATA_MATCH","BAD_SIGNAL")
        old[k]=s["names"]
    split=len(days)*7//10;groups=defaultdict(list);coverage=Counter();market_days=defaultdict(set);available=Counter()
    for (d,c),b in by.items():
        i=idx[d];scope=b["market"];state,trend=states.get((scope,d),("UNKNOWN","UNKNOWN"))
        market_days[scope,state].add(d)
        p=positions[scope].get(d)
        if i<20 or p is None or p<20 or dates[scope][p-20:p+1]!=days[i-20:i+1]:
            coverage["INSUFFICIENT_ALIGNED_HISTORY"]+=1;continue
        h=[by.get((day,c)) for day in days[i-20:i+1]]
        if any(x is None or x["market"]!=scope for x in h):
            coverage["MISSING_STOCK_HISTORY"]+=1;continue
        stock,fs=features(h)
        coverage["ELIGIBLE"]+=1;available[scope,state,trend,stock]+=1
        prior=meta[d]["signal_status"]
        if prior=="COUNT_AND_PAYLOAD_HASH_METADATA_MATCH":
            if (d,c) in old:
                fs+=["HAS_STORED_SIGNAL"]+["LEGACY_"+x for x in old[d,c]]
            else:fs.append("NO_STORED_SIGNAL")
        else:fs.append("STORED_SIGNAL_UNAVAILABLE")
        # A close-known signal is never entered at that close. Next open to hth close.
        for seg,end in (("ALL",len(days)),("EARLY" if i<split else "LATE",split if i<split else len(days))):
            for n in HORIZONS:
                r=None
                if i+n>=end:st="PENDING"
                else:
                    path=[by.get((x,c)) for x in days[i+1:i+n+1]]
                    if dates[scope][p+1:p+n+1]!=days[i+1:i+n+1] or any(x is None or x["market"]!=scope for x in path):st="MISSING_PATH"
                    else:st="OBSERVED";r=100*(path[-1]["close"]/path[0]["open"]-1)
                ev=(d,c,r,st)
                for f in set(fs):groups[scope,state,trend,stock,seg,n,f].append(ev)
    rows=[dict(market=m,market_state=s,index_trend=t,prior_stock_direction=d,segment=g,horizon=h,feature=f,**summarize(es)) for (m,s,t,d,g,h,f),es in sorted(groups.items())]
    return dict(schema="BLUE_FULL_UNIVERSE_DIVERGENCE_V1",status="DESCRIPTIVE_ONLY_NO_PROMOTION",asof=days[-1],audited_days=len(days),universe_stock_days=len(by),coverage=dict(coverage),market_days=[dict(market=m,state=s,days=len(ds)) for (m,s),ds in sorted(market_days.items())],eligible_groups=[dict(market=m,state=s,index_trend=t,prior_stock_direction=d,events=n) for (m,s,t,d),n in sorted(available.items())],split_late_start=days[split] if split<len(days) else None,rows=rows,limits=["INDEX_STATE_RULE_UNVALIDATED","KIS_DATE_ALIGNMENT_NOT_INDEPENDENT_EXCHANGE_CALENDAR","NO_CORPORATE_ACTION_VERIFICATION","NO_COSTS_OR_REAL_EXECUTION","SIGNAL_AUDIT_COUNT_NOT_FULL_CODE_PARITY","NO_STORED_SIGNAL_NOT_PROOF_NO_TECHNICAL_PATTERN","FEATURES_FIXED_EXPLORATORY_NOT_OPTIMIZED","DEPENDENT_STOCK_DAY_EVENTS","NO_OOS_ACCURACY_OR_PROMOTION"],return_basis="Signal close known; next observed open to Nth observed close, full date-aligned path; EARLY/LATE cannot cross segment boundary.",prior_direction="Close six observations before signal vs prior close (five observations, before current candle).")
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--source",type=Path,required=True);p.add_argument("--benchmark",type=Path,required=True);p.add_argument("--out",type=Path,required=True);a=p.parse_args()
    r=study(json.loads(a.source.read_text()),json.loads(a.benchmark.read_text()))
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,indent=2)+"\n")
    print("BLUE_FULL_UNIVERSE_DIVERGENCE",json.dumps({k:r[k] for k in ("asof","audited_days","universe_stock_days","coverage","market_days","eligible_groups","split_late_start")}))

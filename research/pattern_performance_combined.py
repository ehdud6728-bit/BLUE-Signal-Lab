"""Predeclared joint study: ENV20/ENV20_LOWER_TOUCH + long bullish candle
+ stored RSI cross + MA20<MA40<MA60. No ranking or production promotion.
Matched, known-factor cohort only for nested comparisons.
"""
import argparse,json,math,hashlib
from pathlib import Path
from fractions import Fraction
from statistics import mean,median
from collections import defaultdict
from pattern_performance_audited import candle
from pattern_performance_phase1 import return_profile
BASES=("ENV20","ENV20_LOWER_TOUCH")
HORIZONS=(1,3,5,10,20)
GROUPS=("BASE_KNOWN","LONG_BULL","LONG_BULL_RSI_GC","LONG_BULL_MA_DOWN","JOINT","LONG_BULL_NOT_JOINT")
def summarize(items):
    y=[x[2] for x in items]
    if not y:return dict(n=0,dates=0,stocks=0,up_pct=None,mean_pct=None,median_pct=None,profile=None,min_pct=None)
    return dict(n=len(y),dates=len({x[0] for x in items}),stocks=len({x[1] for x in items}),
        up_pct=round(100*sum(v>0 for v in y)/len(y),2),mean_pct=round(float(mean(y)),3),median_pct=round(float(median(y)),3),
        min_pct=round(float(min(y)),3),profile=return_profile([float(v) for v in y]))
def thin(items):
    last={};out=[]
    for x in sorted(items):
        i,c=x[:2]
        if i-last.get(c,-10000)>=10:
            out.append(x);last[c]=i
    return out
def analyze(source,evidence,focus="024720"):
    if source.get("format")!="BLUE_TURSO_EXIT_SOURCE_V1" or source.get("audits_readback_verified") is not True or evidence.get("format")!="BLUE_COMBINED_FACTORS_V1" or evidence["asof"]!=source["asof_day"]:raise ValueError("source mismatch")
    days=[d["day"] for d in source["eod_days"]]
    if not days or days!=sorted(set(days)) or days[-1]!=source["asof_day"] or any(d["expected"]!=d["actual"] for d in source["eod_days"]):raise ValueError("invalid days")
    idx={d:i for i,d in enumerate(days)}
    coverage=set(source["research_audited_dates"])
    if not coverage.issubset(idx):raise ValueError("invalid coverage")
    bars={}
    for b in source["bars"]:
        k=b["day"],b["code"]
        if k in bars or k[0] not in idx or not all(type(b[x]) is int and b[x]>0 for x in ("open","high","low","close")) or not b["low"]<=min(b["open"],b["close"])<=max(b["open"],b["close"])<=b["high"]:raise ValueError("invalid bar")
        bars[k]=b
    fs={}
    for f in evidence["rows"]:
        k=f["day"],f["code"]
        if k in fs or k[0] not in coverage or any(f[x] is not None and type(f[x]) is not bool for x in ("rsi_gc","ma_down")):raise ValueError("invalid factors")
        fs[k]=f
    seen=set();events=[];quality=defaultdict(int)
    for s in source["signals"]:
        bases=set(s["names"])&set(BASES)
        if not bases:continue
        d,c=s["day"],s["code"];k=d,c
        if k in seen or k not in bars or k not in fs or d not in coverage:raise ValueError("invalid signal")
        seen.add(k);f=fs[k];i=idx[d]
        r,m=f["rsi_gc"],f["ma_down"]
        quality["target_signal_stock_days"]+=1
        if r is None or m is None:quality["unknown_factor_stock_days"]+=1
        # Cross-check stored MA against audited exact-date closes when 60 are available.
        prior=[bars.get((j,c)) for j in days[max(0,i-59):i+1]]
        ma_audit=None
        if len(prior)==60 and all(prior) and len({x.get("market") for x in prior})==1:
            sums=[sum(x["close"] for x in prior[-n:]) for n in (20,40,60)]
            ma_audit=sums[0]*2<sums[1] and sums[1]*3<sums[2]*2
            quality["ma_eod_checked"]+=1
            if m is not None and m!=ma_audit:
                quality["ma_eod_disagrees"]+=1;m=None
        if r is None or m is None:continue
        quality["known_factor_stock_days"]+=1
        long=candle(bars[k])=="LONG_BULL"
        groups=["BASE_KNOWN"]
        if long:
            groups.append("LONG_BULL")
            if r:groups.append("LONG_BULL_RSI_GC")
            if m:groups.append("LONG_BULL_MA_DOWN")
            groups.append("JOINT" if r and m else "LONG_BULL_NOT_JOINT")
        for base in sorted(bases):events.append((i,c,base,groups))
    if seen!=set(fs):raise ValueError("unexpected factors")
    rows=[]
    split=len(days)*7//10
    for scope in ("MARKET","FOCUS_STOCK"):
        for base in BASES:
            for group in GROUPS:
                cohort=[(i,c) for i,c,b,g in events if b==base and group in g and (scope=="MARKET" or c==focus)]
                for sampling in ("ALL_EVENTS","COOLDOWN_10_PER_CONDITION"):
                    selected=cohort if sampling=="ALL_EVENTS" else thin(cohort)
                    for basis in ("SIGNAL_CLOSE","NEXT_OPEN"):
                        for h in HORIZONS:
                            completed=[];missing=0;pending=0
                            for i,c in selected:
                                if i+h>=len(days):pending+=1;continue
                                path=[bars.get((d,c)) for d in days[i:i+h+1]]
                                if any(x is None for x in path) or len({x.get("market") for x in path})!=1:missing+=1;continue
                                entry=path[0]["close"] if basis=="SIGNAL_CLOSE" else path[1]["open"]
                                end=path[-1]["close"]
                                completed.append((i,c,Fraction(100*(end-entry),entry)))
                            train=[x for x in completed if x[0]+h<split]
                            hold=[x for x in completed if x[0]>=split]
                            stat=summarize(completed)
                            rows.append(dict(scope=scope,base=base,condition=group,sampling=sampling,entry_basis=basis,horizon=h,
                                total_signals=len(selected),pending=pending,missing=missing,all=stat,train=summarize(train),holdout=summarize(hold),
                                research_status="NO_MATURED_CASES" if not stat["n"] else "SMALL_SAMPLE" if stat["n"]<30 or stat["dates"]<5 or (scope=="MARKET" and stat["stocks"]<10) else "DESCRIPTIVE_ONLY"))
    return dict(schema="BLUE_COMBINED_PATTERN_STUDY_V1",asof=source["asof_day"],audit_sessions=len(days),signal_audit_sessions=len(coverage),focus_stock=focus,quality=dict(quality),
        rows=rows,limitations=["Stored RSI and MA factors are hash-bound but not independently validated against complete external price history.","Only events with both known factors enter any group; unknown factors are not negative cases.","ENV20 midline and ENV20_LOWER_TOUCH are distinct.","ALL_EVENTS has common nested cohorts; per-condition cooldown changes cohorts and is not a nested comparison.","Calendar, adjusted prices, fees and execution not verified. Holdout is chronological, not independent live validation."])
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for name in ("source","factors","output"):p.add_argument("--"+name,type=Path,required=True)
    a=p.parse_args();source=a.source.read_bytes();factors=a.factors.read_bytes();out=analyze(json.loads(source),json.loads(factors))
    out["source_sha256"]=hashlib.sha256(source).hexdigest()
    out["factors_sha256"]=hashlib.sha256(factors).hexdigest()
    a.output.write_text(json.dumps(out,ensure_ascii=False,allow_nan=False,indent=2)+"\n")
    selected=[dict(scope=r["scope"],base=r["base"],condition=r["condition"],**{k:r["all"][k] for k in ("n","up_pct","mean_pct")}) for r in out["rows"] if r["sampling"]=="ALL_EVENTS" and r["entry_basis"]=="NEXT_OPEN" and r["horizon"]==3 and r["condition"] in ("LONG_BULL","JOINT","LONG_BULL_NOT_JOINT")]
    print("BLUE_COMBINED_STUDY",json.dumps(dict(asof=out["asof"],audit_sessions=out["audit_sessions"],quality=out["quality"],three_day=selected)))

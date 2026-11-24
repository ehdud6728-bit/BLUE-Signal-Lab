"""Same-pattern advantage and downside tradeoffs on audited EOD observations.

Research only: fixed conditions, disjoint same-date controls, chronological
split, and complete outcome paths. Never a brokerage signal or execution.
"""
import argparse
import json
import math
import re
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import mean, median
from pattern_performance_audited import candle, market_regime

WINDOWS = (28, 60, 120, 250)
HORIZONS = (1, 3, 5, 10, 20)
TP, SL = 2.5, -4.5

def valid_price(x):
    return type(x) is int and x > 0

def valid_bar(b):
    return b is not None and all(valid_price(b.get(k)) for k in ("open","high","low","close")) and b["low"] <= min(b["open"],b["close"]) <= max(b["open"],b["close"]) <= b["high"]

def features(b, prior, breadth):
    """None means evidence missing; never treated as a negative control."""
    shape = candle(b)
    span = b["high"]-b["low"]
    pos = (b["close"]-b["low"])/span if span else None
    body = abs(b["close"]-b["open"])/span if span else None
    market = market_regime(breadth)
    ratios = {}
    for n in (5,20):
        a = [x.get("amount") if x else None for x in prior[-n:]]
        current = b.get("amount")
        ratios[n] = current*n/sum(a) if len(a)==n and all(type(x) is int and x>=0 for x in a) and sum(a)>0 and type(current) is int and current>=0 else None
    closes = [x["close"] if valid_bar(x) else None for x in prior]
    ma = {}
    for n in (5,10,20):
        # Last n observations include the signal-day close, not future prices.
        v = (closes+[b["close"]])[-n:]
        ma[n] = mean(v) if len(v)==n and all(x is not None for x in v) else None
    prev20 = prior[-20:]
    complete20 = len(prev20)==20 and all(valid_bar(x) for x in prev20)
    return {
        "BULL":shape=="BULL",
        "BULL_CLOSE_MID":shape=="BULL" and pos is not None and .33<=pos<.67,
        "BULL_BODY_30_50":shape=="BULL" and body is not None and .3<=body<.5,
        "LONG_BEAR":shape=="LONG_BEAR",
        "UPPER_WICK":shape=="UPPER_WICK",
        "AMOUNT_5_GE_2":None if ratios[5] is None else ratios[5]>=2,
        "AMOUNT_20_GE_2":None if ratios[20] is None else ratios[20]>=2,
        "AMOUNT_20_LT_1":None if ratios[20] is None else ratios[20]<1,
        "BULL_AMOUNT_20_GE_2":None if ratios[20] is None else shape=="BULL" and ratios[20]>=2,
        "BEAR_AMOUNT_20_LT_1":None if ratios[20] is None else shape in ("BEAR","LONG_BEAR") and ratios[20]<1,
        "MARKET_BROAD_UP":None if market=="UNKNOWN" else market=="BROAD_UP",
        "MARKET_BROAD_WEAK":None if market=="UNKNOWN" else market=="BROAD_WEAK",
        "BULL_AMOUNT_20_GE_2_MARKET_UP":None if ratios[20] is None or market=="UNKNOWN" else shape=="BULL" and ratios[20]>=2 and market=="BROAD_UP",
        **{"BELOW_MA_"+str(n):None if ma[n] is None else b["close"]<ma[n] for n in (5,10,20)},
        "PRIOR_20_HIGH_BREAK":None if not complete20 else b["close"]>max(x["high"] for x in prev20),
        "PRIOR_20_LOW_BREAK":None if not complete20 else b["close"]<min(x["low"] for x in prev20),
    }

def outcomes(entry, path):
    """Full path required; threshold observations are not fills.
    Both touched on one bar without a decisive opening gap => ambiguous.
    """
    if not path or not all(valid_bar(b) for b in path):
        return None
    target, stop = entry*(1+TP/100), entry*(1+SL/100)
    first = "NO_TOUCH"
    for b in path:
        if b["open"]>=target:
            first="TARGET";break
        if b["open"]<=stop:
            first="STOP";break
        up, down = b["high"]>=target, b["low"]<=stop
        if up or down:
            first="AMBIGUOUS" if up and down else "TARGET" if up else "STOP"
            break
    return (100*(path[-1]["close"]/entry-1), first)

def summarize(events):
    vals=[e[2][0] for e in events]
    n=len(vals)
    return dict(n=n,dates=len({e[0] for e in events}),stocks=len({e[1] for e in events}),
        up_pct=round(100*sum(v>0 for v in vals)/n,4) if n else None,
        mean_pct=round(mean(vals),4) if n else None,median_pct=round(median(vals),4) if n else None,
        loss5_pct=round(100*sum(v<=-5 for v in vals)/n,4) if n else None,
        first_target=sum(e[2][1]=="TARGET" for e in events),
        first_stop=sum(e[2][1]=="STOP" for e in events),
        ambiguous=sum(e[2][1]=="AMBIGUOUS" for e in events),
        no_touch=sum(e[2][1]=="NO_TOUCH" for e in events))

def compare(events, condition, horizon, start, end):
    true,false=defaultdict(list),defaultdict(list)
    unknown=missing=0
    for i,code,f,result in events:
        if not start<=i or i+horizon>=end:
            continue
        if f[condition] is None:
            unknown+=1;continue
        out=result[horizon]
        if out is None:
            missing+=1;continue
        (true if f[condition] else false)[i].append((i,code,out))
    common=sorted(true.keys() & false.keys())
    a=[x for i in common for x in true[i]]
    b=[x for i in common for x in false[i]]
    yes,no,base=summarize(a),summarize(b),summarize(a+b)
    def delta(x,y):
        return round(x-y,4) if x is not None and y is not None else None
    daily=[100*(sum(x[2][0]>0 for x in true[i])/len(true[i])-sum(x[2][0]>0 for x in false[i])/len(false[i])) for i in common]
    return dict(condition=yes,control=no,matched_baseline=base,matched_dates=len(common),
        unmatched_condition_n=sum(len(v) for i,v in true.items() if i not in common),
        unmatched_control_n=sum(len(v) for i,v in false.items() if i not in common),
        unknown_feature_n=unknown,missing_outcome_n=missing,
        uplift_vs_control_pp=delta(yes["up_pct"],no["up_pct"]),
        uplift_vs_baseline_pp=delta(yes["up_pct"],base["up_pct"]),
        equal_date_uplift_pp=round(mean(daily),4) if daily else None,
        loss5_delta_pp=delta(yes["loss5_pct"],no["loss5_pct"]),
        exclusion_tradeoff=dict(avoided_first_stop=yes["first_stop"],missed_first_target=yes["first_target"],
          ambiguous=yes["ambiguous"],unresolved=yes["no_touch"]))

def sufficient(x):
    return x["matched_dates"]>=5 and all(x[k]["n"]>=30 and x[k]["stocks"]>=10 for k in ("condition","control"))

def classify(x):
    if not sufficient(x):return "INSUFFICIENT"
    a=x["condition"]; d=x["equal_date_uplift_pp"]
    if a["up_pct"]>=70 and a["mean_pct"]>0 and a["median_pct"]>0 and d>=10 and x["uplift_vs_control_pp"]>=10:return "UPSIDE"
    if a["up_pct"]<=40 and a["mean_pct"]<0 and a["median_pct"]<0 and d<=-10 and x["uplift_vs_control_pp"]<=-10:return "DOWNSIDE"
    return "MIXED"

def research(source):
    if source.get("format")!="BLUE_TURSO_EXIT_SOURCE_V1" or source.get("audits_readback_verified") is not True:
        raise ValueError("audited source required")
    days=[date.fromisoformat(x["day"]).isoformat() for x in source["eod_days"]]
    if not days or days!=sorted(set(days)) or source["asof_day"]!=days[-1] or any(x["expected"]!=x["actual"] for x in source["eod_days"]):
        raise ValueError("invalid audited sessions")
    index={d:i for i,d in enumerate(days)}
    coverage=set(source["research_audited_dates"])
    if not coverage.issubset(index):raise ValueError("invalid signal coverage")
    bars={}
    for b in source["bars"]:
        k=(b["day"],b["code"])
        if k in bars or k[0] not in index or not valid_price(b.get("close")):
            raise ValueError("invalid audited bar")
        bars[k]=b
    breadth={}
    for b in source.get("market_breadth_by_day",[]):
        if b["scope"]=="ALL":
            if b["day"] in breadth:raise ValueError("duplicate breadth")
            breadth[b["day"]]=b
    groups=defaultdict(list)
    seen=set()
    for s in source["signals"]:
        d,c=s["day"],s["code"]; k=d,c
        if k in seen or d not in coverage or k not in bars or not re.fullmatch(r"[0-9A-Z]{6}",c):
            raise ValueError("invalid audited signal")
        seen.add(k)
        if not valid_bar(bars[k]):continue
        i=index[d];b=bars[k]
        f=features(b,[bars.get((day,c)) for day in days[max(0,i-20):i]],breadth.get(d))
        result={h:outcomes(b["close"],[bars.get((day,c)) for day in days[i+1:i+h+1]]) if i+h<len(days) else None for h in HORIZONS}
        for p in sorted(set(s["names"])):
            groups[p].append((i,c,f,result))
    rows=[]
    for w in WINDOWS:
        if len(days)<w:continue
        start=len(days)-w;split=start+int(w*.7)
        complete=all(d in coverage for d in days[start:])
        for pattern,es in sorted(groups.items()):
            for condition in es[0][2]:
                for h in HORIZONS:
                    train=compare(es,condition,h,start,split)
                    hold=compare(es,condition,h,split,len(days))
                    a,b=classify(train),classify(hold)
                    if a not in ("UPSIDE","DOWNSIDE"):continue
                    status=("INCOMPLETE_SIGNAL_COVERAGE" if not complete else "INSUFFICIENT_HOLDOUT" if b=="INSUFFICIENT" else "HOLDOUT_AGREES_EXPLORATORY" if a==b else "HOLDOUT_DISAGREES")
                    rows.append(dict(window=w,horizon=h,pattern=pattern,condition=condition,direction=a,status=status,
                        start=days[start],holdout_start=days[split],asof=days[-1],covered_sessions=sum(d in coverage for d in days[start:]),train=train,holdout=hold))
    return dict(schema="BLUE_SAME_PATTERN_ADVANTAGE_V1",status="RESEARCH_ONLY_NO_PRODUCTION_PROMOTION",asof=days[-1],
        available_sessions=len(days),audited_signal_sessions=len(coverage),
        windows=[w for w in WINDOWS if w<=len(days)],rows=rows,
        limits=["Calendar/corporate actions not independently verified; horizons count audited sessions.",
          "Same-date disjoint known-feature controls, not matched by stock, sector or causal exposure.",
          "Market-wide regime has no within-day variation; no matched-date inference is possible for regime alone.",
          "Historical holdout is exploratory, not prospective or independent; multiple comparisons and overlapping events.",
          "Signal close is a hypothetical entry; first threshold touches are not executions; ambiguous and no-touch remain separate.",
          "No Kiwoom blue-dot parity; no live recommendations or rule promotion."])

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--input",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    a.output.write_text(json.dumps(research(json.loads(a.input.read_text())),ensure_ascii=False,allow_nan=False,indent=2)+"\n")

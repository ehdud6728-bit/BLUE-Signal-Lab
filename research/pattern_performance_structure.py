"""Exploratory prior-rise box structure within existing audited signal cohorts.
Not a market-wide discovery scan or the user's exact envelope-upper setup.
"""
import argparse,json
from collections import defaultdict,Counter
from fractions import Fraction
from pathlib import Path
from pattern_performance_audited import candle,market_regime
from pattern_performance_market_regime import aggregate

def structure(history):
    # 11 prior/current bars: impulse close[-11] -> close[-6];
    # five pre-signal box bars [-5?] = indices 5..9 (end before signal).
    if len(history)!=11 or any(x is None for x in history):
        return "UNKNOWN"
    scope=history[-1]["market"]
    if any(b["market"]!=scope or any(type(b[k]) is not int or b[k]<=0 for k in ("open","high","low","close")) or not b["low"]<=min(b["open"],b["close"])<=max(b["open"],b["close"])<=b["high"] for b in history):
        return "UNKNOWN"
    first,anchor=history[0]["close"],history[5]["close"]
    prior_up=100*(anchor-first)>=5*first
    box=history[5:10]
    lo=min(b["low"] for b in box);hi=max(b["high"] for b in box)
    if 100*(hi-lo)>8*lo:
        return "OTHER"
    c=history[-1]["close"]
    prefix="PRIOR_RISE" if prior_up else "OTHER_PRIOR"
    return prefix+("_BREAKOUT" if c>hi else "_IN_BOX" if c>=lo else "_BREAKDOWN")

def study(source):
    if source.get("format")!="BLUE_TURSO_EXIT_SOURCE_V1" or source.get("audits_readback_verified") is not True:
        raise ValueError("AUDITED_SOURCE_REQUIRED")
    days=[d["day"] for d in source["eod_days"]]
    if not days or days!=sorted(set(days)) or any(d["expected"]!=d["actual"] for d in source["eod_days"]):
        raise ValueError("INVALID_AUDIT")
    index={d:i for i,d in enumerate(days)}
    bars={(b["day"],b["code"]):b for b in source["bars"]}
    if len(bars)!=len(source["bars"]):raise ValueError("DUPLICATE_BAR")
    covered=set(source["research_audited_dates"])
    breadth={(b["day"],b["scope"]):b for b in source.get("market_breadth_by_day",[])}
    groups=defaultdict(list);states=Counter();seen=set()
    split=len(days)*7//10
    for s in source["signals"]:
        d,c=s["day"],s["code"];i=index[d];k=(d,c)
        if d not in covered or k in seen or k not in bars:raise ValueError("INVALID_SIGNAL")
        seen.add(k)
        current=bars[k];scope=current["market"]
        state=structure([bars.get((x,c)) for x in days[max(0,i-10):i+1]])
        states[state]+=1
        if state=="UNKNOWN":continue
        shape=candle(current)
        regime=market_regime(breadth.get((d,scope)))
        for segment,end in (("ALL",len(days)),("EARLY" if i<split else "LATE",split if i<split else len(days))):
            for h in (3,5):
                outcome=None
                if i+h>=end:status="PENDING"
                else:
                    path=[bars.get((days[j],c)) for j in range(i+1,i+h+1)]
                    if any(b is None or b["market"]!=scope or type(b["close"]) is not int or b["close"]<=0 for b in path):status="MISSING_PATH"
                    else:status="OBSERVED";outcome=Fraction(100*(path[-1]["close"]-current["close"]),current["close"])
                for p in set(s["names"]):
                    # Separate basic and candle cohorts; don't count them as independent evidence.
                    for shape_key in ("ALL_CANDLES",shape):
                        groups[p,scope,regime,segment,h,state,shape_key].append((d,c,outcome,status))
    rows=[dict(pattern=p,market=m,breadth_regime=r,segment=s,horizon=h,structure=t,candle=c,**aggregate(events)) for (p,m,r,s,h,t,c),events in sorted(groups.items())]
    return dict(schema="BLUE_PRICE_STRUCTURE_READINESS_V1",status="EXPLORATORY_EXISTING_SIGNALS_ONLY",asof=days[-1],split_late_start=days[split] if split<len(days) else None,states=dict(states),rows=rows,
      definition="Fixed exploratory hypothesis: prior 5-observation rise >=5%; previous 5-bar high-low range <=8% of low; signal-day close in box, above box, or below box. Box excludes signal day. Other prior/other structure retained.",
      limits=["NOT_USER_ENVELOPE_UPPER_PULLBACK_DEFINITION","NOT_FULL_MARKET_DISCOVERY","FIXED_THRESHOLDS_UNVALIDATED","AUDITED_OBSERVATIONS_NOT_VERIFIED_CONSECUTIVE_SESSIONS","CORPORATE_ACTIONS_UNVERIFIED","NO_COSTS_OR_EXECUTION","NO_RECOMMENDATION_OR_OOS_CLAIM"])

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--input",type=Path,required=True);p.add_argument("--output",type=Path,required=True);a=p.parse_args()
    r=study(json.loads(a.input.read_text(encoding="utf-8")))
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,indent=2)+"\n",encoding="utf-8")
    print("BLUE_PRICE_STRUCTURE_READINESS",json.dumps({k:r[k] for k in ("asof","status","states")}))

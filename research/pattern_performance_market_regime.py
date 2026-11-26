"""Descriptive close-known breadth regimes; no selection/promotion or DB writes."""
import argparse
import json
import re
from collections import defaultdict, Counter
from datetime import date
from fractions import Fraction
from pathlib import Path
from statistics import median
from pattern_performance_audited import market_regime

HORIZONS=(1,2,3,5,10,20)
REGIMES=("BROAD_UP","MIXED","BROAD_WEAK","UNKNOWN")
SCOPES=("ALL","KOSPI","KOSDAQ")

def require(ok,message):
    if not ok:
        raise ValueError(message)

def aggregate(events):
    r=[x[2] for x in events if x[2] is not None]
    n=len(r)
    wins=[x for x in r if x>0]
    losses=[x for x in r if x<0]
    dates=len({x[0] for x in events if x[2] is not None})
    symbols=len({x[1] for x in events if x[2] is not None})
    return dict(events=len(events),sample_count=n,positive_count=len(wins),
        negative_count=len(losses),flat_count=n-len(wins)-len(losses),
        signal_dates=dates,symbols=symbols,
        pending=sum(x[3]=="PENDING" for x in events),
        missing_path=sum(x[3]=="MISSING_PATH" for x in events),
        positive_pct=round(100*len(wins)/n,2) if n else None,
        mean_pct=round(float(sum(r)/n),3) if n else None,
        median_pct=round(float(median(r)),3) if n else None,
        profit_factor=round(float(sum(wins)/-sum(losses)),3) if losses else None,
        descriptive_sample_sufficient=n>=30 and dates>=5 and symbols>=10)

def study(source):
    require(source.get("format")=="BLUE_TURSO_EXIT_SOURCE_V1" and source.get("audits_readback_verified") is True,"AUDITED_SOURCE_REQUIRED")
    eod=source["eod_days"]; days=[x["day"] for x in eod]
    require(bool(days) and days==sorted(set(days)) and source["asof_day"]==days[-1],"INVALID_DATES")
    require(all(date.fromisoformat(d).isoformat()==d for d in days),"INVALID_DATE")
    require(all(type(x["expected"]) is int and x["expected"]>=1700 and x["actual"]==x["expected"] for x in eod),"INVALID_AUDIT")
    idx={d:i for i,d in enumerate(days)}
    audited=source["research_audited_dates"]
    coverage=set(audited)
    require(len(coverage)==len(audited) and coverage.issubset(idx) and len(coverage)==source["research_audited_days"],"INVALID_SIGNAL_COVERAGE")
    breadth={}
    for x in source.get("market_breadth_by_day",[]):
        d,s=x["day"],x["scope"]
        require(d in idx and s in SCOPES and (d,s) not in breadth,"INVALID_BREADTH_KEY")
        keys=("universe","matched5","up5","down5")
        require(all(type(x[k]) is int and x[k]>=0 for k in keys),"INVALID_BREADTH_COUNT")
        require(0<x["universe"] and x["up5"]+x["down5"]<=x["matched5"]<=x["universe"],"INVALID_BREADTH_COUNT")
        require(idx[d]>=5 or x["matched5"]==0,"BREADTH_LOOKBACK_INVALID")
        breadth[d,s]=x
    regime={}
    for d in days:
        a=breadth.get((d,"ALL"))
        m=[breadth.get((d,s)) for s in SCOPES[1:]]
        if a is not None:
            require(a["universe"]==eod[idx[d]]["expected"],"BREADTH_UNIVERSE_MISMATCH")
        if a is not None and all(x is not None for x in m):
            require(all(a[k]==sum(x[k] for x in m) for k in ("universe","matched5","up5","down5")),"BREADTH_SCOPE_MISMATCH")
        for s in SCOPES:
            regime[d,s]=market_regime(breadth.get((d,s)))
    bars={}
    for x in source["bars"]:
        k=(x["day"],x["code"])
        require(k[0] in idx and isinstance(k[1],str) and re.fullmatch(r"[0-9A-Z]{6}",k[1]) and k not in bars and x["market"] in SCOPES[1:] and type(x["close"]) is int and x["close"]>0,"INVALID_BAR")
        bars[k]=x
    # Fixed time split; both signal and entire outcome path must stay in its segment.
    split=max(1,len(days)*7//10)
    groups=defaultdict(list); patterns=set(); seen=set()
    for s in source["signals"]:
        d,c=s["day"],s["code"]; k=(d,c)
        require(d in coverage and k in bars and k not in seen,"INVALID_SIGNAL")
        seen.add(k)
        names=s["names"]
        require(bool(names) and len(names)==len(set(names)) and all(isinstance(p,str) and re.fullmatch(r"[A-Z0-9_]{1,60}",p) for p in names),"INVALID_PATTERN")
        i=idx[d]; market=bars[k]["market"]; entry=bars[k]["close"]
        patterns.update(names)
        for segment,end in (("ALL",len(days)),("EARLY" if i<split else "LATE",split if i<split else len(days))):
            for h in HORIZONS:
                r=None
                if i+h>=end:
                    state="PENDING"
                else:
                    path=[bars.get((days[j],c)) for j in range(i+1,i+h+1)]
                    if any(x is None or x["market"]!=market for x in path):
                        state="MISSING_PATH"
                    else:
                        state="OBSERVED";r=Fraction(100*(path[-1]["close"]-entry),entry)
                for scope in ("ALL",market):
                    for p in names:
                        groups[p,scope,segment,h,regime[d,scope]].append((d,c,r,state))
    out=[]
    for p,scope,segment,h in sorted({k[:4] for k in groups}):
        values=[dict(regime=r,**aggregate(groups.get((p,scope,segment,h,r),[]))) for r in REGIMES]
        out.append(dict(pattern=p,scope=scope,segment=segment,horizon=h,groups=values))
    return dict(schema="BLUE_MARKET_REGIME_STUDY_V1",status="DESCRIPTIVE_ONLY_NO_PROMOTION",
        asof=days[-1],audited_sessions=len(days),signal_audited_sessions=len(coverage),
        split_late_start=days[split] if split<len(days) else None,
        regime_days={s:dict(Counter(regime[d,s] for d in days)) for s in SCOPES},
        signal_regime_days={s:dict(Counter(regime[d,s] for d in coverage)) for s in SCOPES},
        rows=out,definition="Existing 5 audited-observation breadth: >=60% up broad-up, <=40% broad-weak, otherwise mixed; matched coverage >=80%; unknown retained. Equal-weight breadth proxy, not official index trend.",
        return_definition="Signal close to Nth subsequent audited close; complete same-market price path required. Early/late outcomes cannot cross segment end.",
        limits=["TRADING_CALENDAR_UNVERIFIED","CORPORATE_ACTIONS_UNVERIFIED","CLOSE_KNOWN_NOT_PRE_CLOSE","NO_COSTS_OR_EXECUTION","NOT_INDEPENDENT_OUT_OF_SAMPLE_VALIDATION","BREADTH_FROM_EXISTING_EXPORT_NOT_INDEPENDENT_EXTERNAL_SOURCE","SAMPLE_THRESHOLDS_NOT_INVESTMENT_APPROVAL"])

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--input",type=Path,required=True);p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    result=study(json.loads(a.input.read_text(encoding="utf-8")))
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,allow_nan=False,indent=2)+"\n",encoding="utf-8")
    print("BLUE_MARKET_REGIME_STUDY",json.dumps({k:result[k] for k in ("asof","audited_sessions","signal_audited_sessions","split_late_start","regime_days","signal_regime_days")}))

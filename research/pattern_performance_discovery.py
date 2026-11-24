"""Exploratory compound discovery with chronological holdout and disjoint baseline."""
from collections import defaultdict
from statistics import median
from itertools import combinations
from pattern_performance_audited import candle, market_regime
import argparse,json
from pathlib import Path

def discover(source):
    if source.get("audits_readback_verified") is not True:
        raise ValueError("audited source required")
    days=[x["day"] for x in source["eod_days"]]
    if days!=sorted(set(days)) or any(x["expected"]!=x["actual"] for x in source["eod_days"]):
        raise ValueError("invalid sessions")
    idx={d:i for i,d in enumerate(days)}
    coverage=set(source["research_audited_dates"])
    raw={(b["day"],b["code"]):b for b in source["bars"]}
    breadth={b["day"]:b for b in source.get("market_breadth_by_day",[]) if b["scope"]=="ALL"}
    events=defaultdict(list)
    for s in source["signals"]:
        d,c=s["day"],s["code"]
        if d not in coverage: raise ValueError("unaudited signal")
        i=idx[d]; b=raw[d,c]
        features=[]
        if all(k in b for k in ("open","high","low")):
            shape=candle(b)
            if shape!="UNKNOWN": features.append(shape)
        regime=market_regime(breadth.get(d))
        if regime!="UNKNOWN": features.append(regime)
        prior=[raw.get((x,c),{}).get("amount") for x in days[max(0,i-5):i]]
        a=b.get("amount")
        if len(prior)==5 and all(type(x) is int and x>=0 for x in prior) and sum(prior)>0 and type(a) is int and a>=0:
            ratio=5*a/sum(prior)
            features.append("AMOUNT_5|"+("LT_0_5" if ratio<.5 else "0_5_1" if ratio<1 else "1_1_5" if ratio<1.5 else "1_5_2" if ratio<2 else "2_3" if ratio<3 else "GE_3"))
        for p in sorted(set(s["names"])):
            events[p].append((i,c))
            for k in range(1,len(features)+1):
                for group in combinations(features,k): events[p+"|"+"|".join(group)].append((i,c))
    def stats(es,h,lo,hi):
        values=[]
        for i,c in es:
            if not lo<=i or i+h>=hi: continue
            a=raw[days[i],c]["close"]; b=raw.get((days[i+h],c),{}).get("close")
            if a>0 and b and b>0: values.append((i,c,100*(b/a-1)))
        n=len(values)
        return dict(n=n,dates=len(set(x[0] for x in values)),stocks=len(set(x[1] for x in values)),up_pct=round(100*sum(x[2]>0 for x in values)/n,2) if n else None,median_pct=round(median(x[2] for x in values),3) if n else None,loss_5_pct=round(100*sum(x[2]<=-5 for x in values)/n,2) if n else None)
    out=[]
    seen=set()
    for w in (10,20,28,60,120,250):
        start=max(0,len(days)-w); split=start+int((len(days)-start)*.7)
        if start in seen: continue
        seen.add(start)
        complete=all(d in coverage for d in days[start:])
        for h in (1,2,3,5,10,20):
            candidates=[]
            for p,es in events.items():
                if "|" not in p: continue
                train=stats(es,h,start,split)
                if train["n"]<30 or train["dates"]<5 or train["stocks"]<10: continue
                control_events=set(events[p.split("|")[0]])-set(es)
                base=stats(control_events,h,start,split)
                if base["n"]<30: continue
                lift=train["up_pct"]-base["up_pct"]
                direction="UPSIDE" if train["up_pct"]>=70 and train["median_pct"]>0 and lift>=10 else "DOWNSIDE" if train["up_pct"]<=40 and train["median_pct"]<0 and lift<=-10 else None
                if direction: candidates.append((abs(lift),p,direction,train,base))
            for lift,p,direction,train,base in [x for direction in ("UPSIDE","DOWNSIDE") for x in sorted((v for v in candidates if v[2]==direction),key=lambda x:(-x[0],x[1]))[:30]]:
                hold=stats(events[p],h,split,len(days)); control=stats(set(events[p.split("|")[0]])-set(events[p]),h,split,len(days))
                sufficient=complete and hold["n"]>=30 and hold["dates"]>=5 and hold["stocks"]>=10 and control["n"]>=30
                delta=hold["up_pct"]-control["up_pct"] if hold["n"] and control["n"] else None
                agrees=sufficient and (delta>=10 and hold["up_pct"]>=70 and hold["median_pct"]>0 if direction=="UPSIDE" else delta<=-10 and hold["up_pct"]<=40 and hold["median_pct"]<0)
                out.append(dict(window=w,actual_sessions=len(days)-start,covered_sessions=sum(d in coverage for d in days[start:]),train_sessions=split-start,holdout_sessions=len(days)-split,horizon=h,pattern=p,direction=direction,train=train,train_base=base,holdout=hold,holdout_base=control,holdout_lift_pp=delta,status="HOLDOUT_AGREES_EXPLORATORY" if agrees else "HOLDOUT_DISAGREES" if sufficient else "INSUFFICIENT_HOLDOUT"))
    return dict(asof=source["asof_day"],available_sessions=len(days),rows=out,warning="Exploratory only; overlapping samples, multiple testing, unverified calendar and corporate actions. No automatic promotion. Baseline excludes subgroup; not matched by date or stock.")

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--input",type=Path,required=True);p.add_argument("--output",type=Path,required=True);a=p.parse_args()
    a.output.write_text(json.dumps(discover(json.loads(a.input.read_text())),ensure_ascii=False,allow_nan=False,indent=2)+"\n")

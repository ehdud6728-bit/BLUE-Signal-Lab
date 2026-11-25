"""High-return profiles within the SAME signal condition, using audited EOD only.
No future features; train selects profiles, chronological holdout checks them.
Returns are close-to-close or maximum subsequent high, NOT executable profits.
"""
import argparse,json,math
from collections import defaultdict
from statistics import median
from pathlib import Path
from pattern_performance_audited import candle,market_regime
HORIZONS=(1,2,3,5,10,20)
TARGETS=(10,20)
WINDOWS=(28,60)
def band(x,bounds,labels):
    return next((label for bound,label in zip(bounds,labels) if x<bound),labels[-1])
def features(b,i,c,days,raw,breadth):
    f={}
    shape=candle(b) if all(k in b for k in ("open","high","low")) else "UNKNOWN"
    if shape!="UNKNOWN":f["CANDLE"]=shape
    if shape=="BULL" and b["high"]>b["low"]:
        span=b["high"]-b["low"]
        f["BODY"]=band(abs(b["close"]-b["open"])/span,[.3,.5],["BODY_10_30","BODY_30_50","BODY_50_70"])
        f["CLOSE_POSITION"]=band((b["close"]-b["low"])/span,[.33,.67],["CLOSE_LOW","CLOSE_MID","CLOSE_HIGH"])
    regime=market_regime(breadth.get(days[i]))
    if regime!="UNKNOWN":f["MARKET"]=regime
    a=b.get("amount")
    if type(a) is int and a>=0:
        f["AMOUNT_ABSOLUTE"]=band(a,[500_000_000,5_000_000_000,20_000_000_000],["LT_5EOK","5_50EOK","50_200EOK","GE_200EOK"])
    for n in (5,10,20):
        prior=[raw.get((d,c),{}).get("amount") for d in days[max(0,i-n):i]]
        if type(a) is int and a>=0 and len(prior)==n and all(type(v) is int and v>=0 for v in prior) and sum(prior)>0:
            f["AMOUNT_"+str(n)]=band(a*n/sum(prior),[.5,1,1.5,2,3],["LT_0_5","0_5_1","1_1_5","1_5_2","2_3","GE_3"])
    for n in (1,5,10,20):
        p=raw.get((days[i-n],c),{}).get("close") if i>=n else None
        if p:
            ret=100*(b["close"]/p-1)
            if n==1:f["RETURN_1"]=band(ret,[0,2,5,10],["NEGATIVE","UP_0_2","UP_2_5","UP_5_10","UP_10_PLUS"])
            else:f["RETURN_"+str(n)]=band(ret,[-10,-3,0,5,10],["LT_NEG10","NEG10_NEG3","NEG3_0","0_5","5_10","GE_10"])
    prior=[raw.get((d,c)) for d in days[max(0,i-20):i]]
    if len(prior)==20 and all(x and x.get("high",0)>0 for x in prior):
        distance=100*(max(x["high"] for x in prior)/b["close"]-1)
        f["PRIOR_20_HIGH_GAP"]=band(distance,[0,3,8,15],["ABOVE_PRIOR_HIGH","GAP_0_3","GAP_3_8","GAP_8_15","GAP_GE_15"])
    return f
def conditions(p,f):
    """Predeclared families, not patterns selected using future outcomes."""
    s=f.get("CANDLE"); out=[(p,set())]
    if s:
        out.append((p+"|"+s,{"CANDLE"}))
        for k in ("RETURN_1","AMOUNT_5","AMOUNT_10","AMOUNT_20"):
            if k in f:out.append((p+"|"+s+"|"+(k+"|" if k.startswith("AMOUNT_") else "")+f[k],{"CANDLE",k}))
    if s=="BULL":
        for k in ("BODY","CLOSE_POSITION","MARKET"):
            if k in f:out.append((p+"|BULL|"+("MARKET_" if k=="MARKET" else "")+f[k],{"CANDLE",k}))
    for k in ("AMOUNT_5","AMOUNT_10","AMOUNT_20"):
        if k in f:out.append((p+"|"+k+"|"+f[k],{k}))
    if "MARKET" in f:out.append((p+"|"+f["MARKET"],{"MARKET"}))
    return out
def stats(rows,target):
    n=len(rows)
    return dict(n=n,dates=len({x[0] for x in rows}),stocks=len({x[1] for x in rows}),
        hits=sum(x[2]>=target for x in rows),
        hit_pct=round(100*sum(x[2]>=target for x in rows)/n,2) if n else None,
        median_return_pct=round(median(x[2] for x in rows),3) if n else None)
def enough(s,n=30):
    return s["n"]>=n and s["dates"]>=5 and s["stocks"]>=10
def compare(rows,key,value,target):
    # Unknown values are excluded from BOTH arms, not assigned to the control.
    matched=[x for x in rows if x[3].get(key)==value]
    control=[x for x in rows if key in x[3] and x[3][key]!=value]
    a,b=stats(matched,target),stats(control,target)
    lift=round(a["hit_pct"]-b["hit_pct"],2) if a["n"] and b["n"] else None
    return a,b,lift
def analyze(source):
    if source.get("format")!="BLUE_TURSO_EXIT_SOURCE_V1" or source.get("audits_readback_verified") is not True:raise ValueError("audited source required")
    days=[x["day"] for x in source["eod_days"]]
    if not days or days!=sorted(set(days)) or any(x["expected"]!=x["actual"] for x in source["eod_days"]):raise ValueError("invalid sessions")
    idx={d:i for i,d in enumerate(days)}
    coverage=set(source["research_audited_dates"])
    if not coverage.issubset(idx):raise ValueError("invalid audit days")
    raw={}
    for b in source["bars"]:
        key=b["day"],b["code"]
        if key in raw or key[0] not in idx or type(b["close"]) is not int or b["close"]<=0:raise ValueError("invalid bars")
        raw[key]=b
    breadth={b["day"]:b for b in source.get("market_breadth_by_day",[]) if b["scope"]=="ALL"}
    events=defaultdict(list);seen=set()
    for s in source["signals"]:
        d,c=s["day"],s["code"]
        if d not in coverage or (d,c) in seen or (d,c) not in raw:raise ValueError("invalid signals")
        seen.add((d,c));i=idx[d];b=raw[d,c];f=features(b,i,c,days,raw,breadth)
        for p in sorted(set(s["names"])):
            for pattern,used in conditions(p,f):
                # Fixed pattern membership cannot be rediscovered as its own explanatory factor.
                events[pattern].append((i,c,{k:v for k,v in f.items() if k not in used}))
    result=[];window_meta=[]
    for w in WINDOWS:
        start=max(0,len(days)-w);split=start+int((len(days)-start)*.7)
        complete=all(d in coverage for d in days[start:])
        window_meta.append(dict(window=w,actual_sessions=len(days)-start,covered_sessions=sum(d in coverage for d in days[start:]),train_sessions=split-start,holdout_sessions=len(days)-split))
        for h in HORIZONS:
            for outcome in ("CLOSE","HIGH"):
                # Reuse outcomes across overlapping pattern memberships.
                returns={}
                for p,es in events.items():
                    train=[];hold=[]
                    for i,c,f in es:
                        if i<start or i+h>=len(days) or (i<split and i+h>=split):continue
                        k=(i,c)
                        if k not in returns:
                            path=[raw.get((d,c)) for d in days[i+1:i+h+1]]
                            if any(not b for b in path) or len(path)!=h:
                                returns[k]=None
                            elif outcome=="HIGH" and any(not b.get("high") or b["high"]<b["close"] for b in path):
                                returns[k]=None
                            else:
                                v=path[-1]["close"] if outcome=="CLOSE" else max(b["high"] for b in path)
                                returns[k]=100*(v/raw[days[i],c]["close"]-1)
                        v=returns[k]
                        if v is not None:(train if i<split else hold).append((i,c,v,f))
                    if len(train)<60:continue
                    pairs=sorted({(k,v) for _,_,_,f in train for k,v in f.items()})
                    for target in TARGETS:
                        all_stats=stats(train,target)
                        if all_stats["hits"]<10 or all_stats["n"]-all_stats["hits"]<10:continue
                        candidates=[]
                        for k,v in pairs:
                            a,b,lift=compare(train,k,v,target)
                            if enough(a) and enough(b) and a["hits"]>=10 and lift is not None and lift>=10:
                                candidates.append((lift,k,v,a,b))
                        for lift,k,v,a,b in sorted(candidates,key=lambda x:(-x[0],x[1],x[2]))[:3]:
                            ah,bh,lh=compare(hold,k,v,target)
                            sufficient=complete and enough(ah) and enough(bh) and ah["hits"]>=10 and bh["n"]-bh["hits"]>=10
                            # Count association only. No independent live validation.
                            status="HOLDOUT_AGREES_EXPLORATORY" if sufficient and lh is not None and lh>=10 else "HOLDOUT_DISAGREES" if sufficient else "INSUFFICIENT_HOLDOUT"
                            result.append(dict(window=w,horizon=h,outcome=outcome,target_pct=target,pattern=p,feature=k,value=v,train=a,train_control=b,train_lift_pp=lift,holdout=ah,holdout_control=bh,holdout_lift_pp=lh,status=status))
    return dict(schema="BLUE_HIGH_RETURN_PROFILES_V1",asof=source["asof_day"],available_sessions=len(days),windows=window_meta,
        rows=result,warning="Same-pattern disjoint observed-feature controls; not date-matched. Multiple comparisons, overlapping samples, missing calendar/adjusted-price checks, no trading execution. High touches and closes are distinct. No automatic promotion.")
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for name in ("input","output"):p.add_argument("--"+name,type=Path,required=True)
    a=p.parse_args()
    a.output.write_text(json.dumps(analyze(json.loads(a.input.read_text())),ensure_ascii=False,allow_nan=False,indent=2)+"\n")

"""Exploratory matched daily OHLC scale-out scenarios, not execution or recommendations."""
from fractions import Fraction as F
from statistics import median
from collections import Counter
# Each target is in initial risk units R; weights are percentages of original position.
# Remainder is held to technical stop / lagged trail / time exit.
POLICIES={
    "FULL_1R":(((1,100),),"NONE"),
    "FULL_2R":(((2,100),),"NONE"),
    "HALF_1R_HOLD":(((1,50),),"NONE"),
    "HALF_1R_BREAKEVEN":(((1,50),),"BREAKEVEN"),
    "HALF_1R_ATR_TRAIL":(((1,50),),"ATR"),
    "40_30_30_ATR_TRAIL":(((1,40),(2,30)),"ATR"),
    "30_30_40_ATR_TRAIL":(((1,30),(2,30)),"ATR"),
}
METHODS=("ATR14_SMA_1_5","SIGNAL_LOW")

def simulate(path,initial_stop,atr,policy):
    """Known opening first; inside-open dual touch uses stop-first, flagged.
    Stops move only after close, effective next observation. No same-bar ratchet.
    Target gaps get limit price, stop gaps get open; remaining shares exit at
    final observed close. All prices hypothetical, no tick or cost assumptions."""
    if not path:raise ValueError("EMPTY_PATH")
    entry=F(path[0]["open"]);stop=F(initial_stop);atr=F(atr)
    if not 0<stop<entry or atr<=0:raise ValueError("INVALID_LEVELS")
    orders,trail=POLICIES[policy];risk=entry-stop
    targets=[(entry+r*risk,w) for r,w in orders]
    remaining=100;idx=0;proceeds=F(0);fills=[];ambiguous=0;peak=entry
    def sell(day,qty,price,reason):
        nonlocal remaining,proceeds
        if not 0<qty<=remaining:raise ValueError("INVALID_QTY")
        remaining-=qty;proceeds+=qty*price;fills.append((day,qty,price,reason))
    for day,b in enumerate(path,1):
        op,hi,lo,cl=map(F,(b["open"],b["high"],b["low"],b["close"]))
        if not 0<lo<=min(op,cl)<=max(op,cl)<=hi:raise ValueError("INVALID_OHLC")
        if op<=stop:
            sell(day,remaining,op,"STOP_GAP");break
        # At open, crossing any pre-existing targets is known before intraday low.
        while remaining and idx<len(targets) and op>=targets[idx][0]:
            price,qty=targets[idx];sell(day,qty,price,"TARGET");idx+=1
        if not remaining:break
        stop_hit=lo<=stop
        target_hit=idx<len(targets) and hi>=targets[idx][0]
        if stop_hit:
            if target_hit:ambiguous+=1
            sell(day,remaining,stop,"STOP_TOUCH");break
        while remaining and idx<len(targets) and hi>=targets[idx][0]:
            price,qty=targets[idx];sell(day,qty,price,"TARGET");idx+=1
        if not remaining:break
        peak=max(peak,hi)
        if day==len(path):
            sell(day,remaining,cl,"TIME_CLOSE");break
        if idx and trail=="BREAKEVEN":stop=max(stop,entry)
        elif idx and trail=="ATR":stop=max(stop,entry,peak-2*atr)
    if remaining or sum(x[1] for x in fills)!=100:raise ValueError("UNSETTLED_POSITION")
    ret=proceeds/entry-100 # weight percentages times price, percent return
    max_opportunity=100*(max(F(x["high"]) for x in path)-entry)/entry
    return dict(ret=ret,ambiguous=ambiguous,first_target=idx>0,target_legs=idx,
        peak=max_opportunity,exit_day=fills[-1][0],reason=fills[-1][3],
        gap_stop=any(x[3]=="STOP_GAP" for x in fills),
        capture=ret/max_opportunity*100 if max_opportunity>0 else None,
        fills=fills)

def case(path,candidates,stop_at_entry):
    atr,status=candidates["ATR14_SMA_1_5"]
    stops=stop_at_entry(candidates,path[0]["open"])
    out={}
    for method in METHODS:
        level,reason=stops[method]
        if status!="READY":out[method]=(None,"ATR_NOT_AVAILABLE")
        elif reason!="READY":out[method]=(None,reason)
        else:
            out[method]=({k:simulate(path,level,atr,k) for k in POLICIES},"READY")
    return out

def summarize(events,method):
    observed=[e for e in events if e[3]=="OBSERVED"]
    coverage=Counter(e[2][method][1] for e in observed)
    ready=[(d,c,v[method][0]) for d,c,v,_ in observed if v[method][1]=="READY"]
    n=len(ready);nd=len({x[0] for x in ready});ns=len({x[1] for x in ready})
    def rnd(x):return round(float(x),3)
    def avg(a):return rnd(sum(a)/len(a)) if a else None
    policies={}
    for k in POLICIES:
        results=[v[k] for _,_,v in ready];a=[v["ret"] for v in results]
        deltas=[v[k]["ret"]-v["FULL_1R"]["ret"] for _,_,v in ready]
        gain=sum(x for x in a if x>0);loss=-sum(x for x in a if x<0)
        tails=sorted(a)[:max(1,(n+19)//20)] if n else []
        captures=[v["capture"] for v in results if v["capture"] is not None]
        policies[k]=dict(mean_pct=avg(a),median_pct=rnd(median(a)) if n else None,
            positive_count=sum(x>0 for x in a),profit_factor=rnd(gain/loss) if loss else None,
            tail5_mean_pct=avg(tails),mean_peak_capture_pct=avg(captures),peak_capture_n=len(captures),
            first_target_count=sum(v["first_target"] for v in results),
            ambiguous_count=sum(v["ambiguous"]>0 for v in results),
            gap_stop_count=sum(v["gap_stop"] for v in results),
            mean_exit_day=avg([v["exit_day"] for v in results]),
            exit_reasons=dict(Counter(v["reason"] for v in results)),
            paired_delta_vs_full_1r_pp=avg(deltas),
            paired_better_count=sum(x>0 for x in deltas),paired_worse_count=sum(x<0 for x in deltas))
    return dict(events=len(events),observed=len(observed),available=n,signal_dates=nd,symbols=ns,
        sample_floor_met=n>=30 and nd>=5 and ns>=10,coverage=dict(coverage),
        pending=sum(e[3]=="PENDING" for e in events),missing_path=sum(e[3]=="MISSING_PATH" for e in events),
        policies=policies)

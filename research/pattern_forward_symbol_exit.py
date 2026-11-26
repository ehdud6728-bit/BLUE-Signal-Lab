"""Matched simple profit exits on frozen forward observations, not actual trades.
Exit rules added at settlement; not necessarily predeclared at original capture."""
from fractions import Fraction as F
from statistics import median
from collections import Counter
from pattern_performance_forward import history
VERSION="FORWARD_SYMBOL_EXIT_V1"
SCHEMA="BLUE_FORWARD_SYMBOL_SETTLEMENT_V1"
METHODS=("SIGNAL_LOW","ATR14_SMA_1_5")
TARGETS=(3,5)
def round_pct(x):return round(float(x),3)
def exits(path,stop,target):
    entry=F(path[0]["open"]);target_price=entry*(100+target)/100
    assert 0<stop<entry
    for i,b in enumerate(path,1):
        op,hi,lo=map(F,(b["open"],b["high"],b["low"]))
        if op<=stop:price,reason,amb=op,"STOP_GAP",False
        elif op>=target_price:price,reason,amb=target_price,"TARGET",False
        elif lo<=stop:price,reason,amb=stop,"STOP_TOUCH",hi>=target_price
        elif hi>=target_price:price,reason,amb=target_price,"TARGET",False
        else:continue
        return (100*(price/entry-1),i,reason,amb)
    return (100*(F(path[-1]["close"])/entry-1),len(path),"TIME_CLOSE",False)
def levels(s,r,bars,indexes,entry):
    d=s["source_day"];c=r["code"];scope=r["market"];past=[x for x in indexes[scope] if x<=d]
    b=bars.get((d,c));out={}
    if b is None or b["market"]!=scope:out["SIGNAL_LOW"]=(None,"SIGNAL_MISSING")
    elif b["low"]>=b["close"]:out["SIGNAL_LOW"]=(None,"NOT_BELOW_SIGNAL_CLOSE")
    else:out["SIGNAL_LOW"]=(F(b["low"]),"READY")
    # Only exact benchmark dates whose source hashes were fixed at capture.
    h=history(past,bars,c,scope,15)
    if not h or any(x["day"] not in s["source_hashes"] for x in h):
        out["ATR14_SMA_1_5"]=(None,"ATR_HISTORY_NOT_FROZEN")
    else:
        atr=F(sum(max(x["high"]-x["low"],abs(x["high"]-y["close"]),abs(x["low"]-y["close"])) for y,x in zip(h,h[1:])),14)
        out["ATR14_SMA_1_5"]=(F(entry)-F(3,2)*atr,"READY") if atr>0 else (None,"ZERO_ATR")
    for method,(p,reason) in list(out.items()):
        if p is not None and not 0<p<entry:out[method]=(None,"ENTRY_AT_OR_BELOW_STOP" if p>=entry else "NONPOSITIVE_STOP")
    return out
def evaluate(s,r,bars,indexes,path,opp):
    if opp is None:return dict(code=r["code"],market=r["market"],status="MISSING_PATH",opportunity=None,exits={})
    entry=path[0]["open"];tech=levels(s,r,bars,indexes,entry);out={}
    for method,(stop,status) in tech.items():
        out[method]=dict(status=status,risk_pct=100*(F(entry)-stop)/entry if stop is not None else None,
            targets={str(t):exits(path,stop,t) for t in TARGETS} if stop is not None else {})
    return dict(code=r["code"],market=r["market"],status="OBSERVED",opportunity=opp,exits=out)
def serialize(row):
    o=row["opportunity"]
    return dict(code=row["code"],market=row["market"],status=row["status"],
        opportunity=None if o is None else dict(high=round_pct(o["high"]),low=round_pct(o["low"]),close=round_pct(o["close"]),giveback=round_pct(o["giveback"]),peak_day=o["peak_day"],target_days={str(k):v for k,v in o["target_days"].items()}),
        exits={m:dict(status=v["status"],risk_pct=round_pct(v["risk_pct"]) if v["risk_pct"] is not None else None,
            targets={k:dict(return_pct=round_pct(x[0]),exit_day=x[1],reason=x[2],ambiguous=x[3]) for k,x in v["targets"].items()}) for m,v in row["exits"].items()})
def summarize(rows):
    observed=[r for r in rows if r["status"]=="OBSERVED"];out={}
    def avg(a):return round_pct(sum(a)/len(a)) if a else None
    for m in METHODS:
        counts=Counter(r["exits"][m]["status"] for r in observed)
        ready=[r["exits"][m] for r in observed if r["exits"][m]["status"]=="READY"]
        n=len(ready);result={}
        for t in TARGETS:
            a=[r["targets"][str(t)] for r in ready];ret=[x[0] for x in a]
            gain=sum(x for x in ret if x>0);loss=-sum(x for x in ret if x<0)
            result[str(t)]=dict(mean_pct=avg(ret),median_pct=round_pct(median(ret)) if ret else None,
                positive_count=sum(x>0 for x in ret),profit_factor=round_pct(gain/loss) if loss else None,
                mean_exit_day=avg([x[1] for x in a]),exit_reasons=dict(Counter(x[2] for x in a)),ambiguous_count=sum(x[3] for x in a),
                tail5_mean_pct=avg(sorted(ret)[:max(1,(n+19)//20)]) if n else None)
        deltas=[r["targets"]["5"][0]-r["targets"]["3"][0] for r in ready]
        out[m]=dict(available=n,coverage=dict(counts),mean_risk_pct=avg([r["risk_pct"] for r in ready]),targets=result,
            paired_5_minus_3_pp=avg(deltas),paired_5_better=sum(x>0 for x in deltas),paired_3_better=sum(x<0 for x in deltas))
    return dict(events=len(rows),observed=len(observed),missing_path=len(rows)-len(observed),methods=out)

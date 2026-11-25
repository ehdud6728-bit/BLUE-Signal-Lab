"""Independent same-source audit of basic and candle profitability aggregates.
No calls to the production profitability engine. Never publish individual
stock records. Exact audit-date offsets, not a verified exchange calendar.
"""
import argparse,hashlib,json,math
from collections import defaultdict
from fractions import Fraction
from pathlib import Path
from pattern_performance_high_returns_audit import candle_tags,SHAPES,DETAILS
HORIZONS=(1,2,3,5,10,20)
GROUPS=("rankings","candle_rankings","detail_rankings","turnover_rankings","market_rankings")

def supported(group,p):
    parts=p.split("|")
    return (group=="rankings" and len(parts)==1
        or group=="candle_rankings" and len(parts)==2 and parts[1] in SHAPES
        or group=="detail_rankings" and len(parts)==3 and parts[1]=="BULL" and parts[2] in DETAILS)

def metrics(items):
    n=len(items)
    returns=sorted(Fraction(100*(b-a),a) for _,_,a,b in items)
    wins=[v for v in returns if v>0];losses=[v for v in returns if v<0]
    def avg(v):return math.fsum(float(x) for x in v)/len(v) if v else None
    def rnd(v):return round(float(v),3) if v is not None else None
    gain,loss=avg(wins),avg(losses)
    tail=returns[:(n+19)//20]
    profile=dict(win_count=len(wins),loss_count=len(losses),flat_count=n-len(wins)-len(losses),
        mean_gain_pct=rnd(gain),mean_loss_pct=rnd(loss),
        payoff_ratio=rnd(gain/abs(loss) if gain is not None and loss is not None else None),
        profit_factor=rnd(math.fsum(float(x) for x in wins)/abs(math.fsum(float(x) for x in losses)) if losses else None),
        worst_5pct_mean_pct=rnd(avg(tail)),tail_count=len(tail))
    for t in (5,10,20):profile[f"target_{t}_pct"]=round(100*sum(v>=t for v in returns)/n,2)
    return dict(sample_count=n,distinct_signal_dates=len({d for d,_,_,_ in items}),distinct_stocks=len({c for _,c,_,_ in items}),
        positive_return_probability_pct=round(100*len(wins)/n,2),mean_return_pct=rnd(avg(returns)),
        median_return_pct=rnd((returns[(n-1)//2]+returns[n//2])/2),
        min_return_pct=rnd(returns[0]),max_return_pct=rnd(returns[-1]),return_profile=profile)

def verify(source,report,source_sha,report_sha):
    if source.get("format")!="BLUE_TURSO_EXIT_SOURCE_V1" or source.get("audits_readback_verified") is not True or report.get("schema")!="BLUE_PATTERN_PERFORMANCE_AUDITED_V1" or report["asof"]!=source["asof_day"]:raise ValueError("source/report mismatch")
    days=[x["day"] for x in source["eod_days"]]
    if not days or days!=sorted(set(days)) or days[-1]!=source["asof_day"] or any(x["expected"]!=x["actual"] for x in source["eod_days"]):raise ValueError("invalid audit dates")
    window=report["research_window_sessions"]
    if type(window) is not int or not 1<=window<=len(days) or report["research_window_start"]!=days[-window]:raise ValueError("window mismatch")
    indices={d:i for i,d in enumerate(days)};selected=set(days[-window:]);coverage=set(source["research_audited_dates"])
    if not coverage.issubset(indices):raise ValueError("invalid coverage")
    bars={}
    for b in source["bars"]:
        k=b["day"],b["code"]
        if k in bars or k[0] not in indices or type(b["close"]) is not int or b["close"]<=0:raise ValueError("invalid bar")
        bars[k]=b
    grouped=defaultdict(list);seen=set()
    for s in source["signals"]:
        d,c=s["day"],s["code"];k=d,c
        if k in seen or k not in bars or d not in coverage or len(set(s["names"]))!=len(s["names"]):raise ValueError("invalid signal")
        seen.add(k)
        if d not in selected:continue
        b=bars[k];tags=candle_tags(b) if all(x in b for x in ("open","high","low")) else {}
        for base in s["names"]:
            keys=[("rankings",base)]
            if tags:
                shape=tags["CANDLE"];keys.append(("candle_rankings",base+"|"+shape))
                if shape=="BULL":
                    keys.extend(("detail_rankings",base+"|BULL|"+tags[f]) for f in ("BODY","CLOSE_POSITION"))
            for h in HORIZONS:
                i=indices[d]+h
                if i>=len(days):continue
                end=bars.get((days[i],c))
                # Match the existing study's endpoint-only definition. Missing
                # intermediate bars and market changes are NOT thereby verified.
                if end is None:continue
                for group,p in keys:grouped[(group,p,h)].append((d,c,b["close"],end["close"]))
    rows={};unsupported=0
    for group in GROUPS:
        for r in report.get(group,[]):
            k=group,r["pattern"],r["horizon_trading_days"]
            if not supported(group,r["pattern"]):unsupported+=1;continue
            if k in rows:raise ValueError("duplicate report row")
            rows[k]=r
    failures=[];checks=[]
    for k in sorted(set(rows)|set(grouped)):
        if k not in rows or k not in grouped:
            failures.append({"key":list(k),"fields":["missing report or reconstructed cohort"]});continue
        actual=metrics(grouped[k]);orig=rows[k];errors=[]
        def compare(field,v,o):
            if v is None or o is None:
                if v!=o:errors.append(field)
            elif type(v) is int:
                if type(o) is not int or v!=o:errors.append(field)
            elif not isinstance(o,(int,float)) or not math.isfinite(o) or abs(v-o)>(.000001 if field.endswith("hit_pct") or field.endswith("probability_pct") or field.startswith("return_profile.target_") else .001001):
                errors.append(field)
        for field,v in actual.items():
            if field=="return_profile":
                for name,value in v.items():compare(field+"."+name,value,orig.get(field,{}).get(name))
            else:compare(field,v,orig.get(field))
        if errors:failures.append({"key":list(k),"fields":errors})
        else:checks.append(list(k))
    return dict(schema="BLUE_PROFITABILITY_AUDIT_V1",asof=report["asof"],sessions=window,source_sha256=source_sha,report_sha256=report_sha,checked=len(checks),unsupported=unsupported,failed=len(failures),failures=failures,checks=checks,scope="INDEPENDENT_CALCULATION_SAME_SOURCE_ONLY")

if __name__=="__main__":
    p=argparse.ArgumentParser()
    for name in ("source","report","output"):p.add_argument("--"+name,type=Path,required=True)
    a=p.parse_args();s=a.source.read_bytes();r=a.report.read_bytes()
    out=verify(json.loads(s),json.loads(r),hashlib.sha256(s).hexdigest(),hashlib.sha256(r).hexdigest())
    a.output.write_text(json.dumps(out,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n")
    print("BLUE_PROFITABILITY_AUDIT",json.dumps({k:out[k] for k in ("asof","sessions","checked","unsupported","failed","scope")}))
    if out["failed"]:
        print("BLUE_PROFITABILITY_MISMATCH",json.dumps(out["failures"][:20]))
        raise SystemExit("PROFITABILITY_RECOMPUTATION_MISMATCH")

"""Independent recomputation of selected high-return candle profiles.
Exact integer/rational comparisons; no imports from discovery implementation.
Checks same source only, not independent exchange data or execution.
"""
import argparse,hashlib,json,re
from pathlib import Path
from fractions import Fraction
from statistics import median

SHAPES={"FLAT","DOJI","LOWER_WICK","UPPER_WICK","LONG_BULL","LONG_BEAR","BULL","BEAR"}
DETAILS={"BODY_10_30","BODY_30_50","BODY_50_70","CLOSE_LOW","CLOSE_MID","CLOSE_HIGH"}
def candle_tags(b):
    o,h,l,c=[b[k] for k in ("open","high","low","close")]
    if not all(type(v) is int for v in (o,h,l,c)) or not 0<l<=min(o,c)<=max(o,c)<=h:raise ValueError("invalid OHLC")
    span=h-l;body=abs(c-o);lower=min(o,c)-l;upper=h-max(o,c)
    if span==0:shape="FLAT"
    elif 10*body<=span:shape="DOJI"
    elif 5*lower>=3*span and 20*upper<=3*span:shape="LOWER_WICK"
    elif 5*upper>=3*span and 20*lower<=3*span:shape="UPPER_WICK"
    elif 10*body>=7*span:shape="LONG_BULL" if c>o else "LONG_BEAR"
    else:shape="BULL" if c>o else "BEAR"
    tags={"CANDLE":shape}
    if shape=="BULL":
        tags["BODY"]="BODY_10_30" if 10*body<3*span else "BODY_30_50" if 2*body<span else "BODY_50_70"
        pos=100*(c-l)
        tags["CLOSE_POSITION"]="CLOSE_LOW" if pos<33*span else "CLOSE_MID" if pos<67*span else "CLOSE_HIGH"
    return tags

def supported(r):
    parts=r["pattern"].split("|")
    return r["feature"] in ("CANDLE","BODY","CLOSE_POSITION") and 1<=len(parts)<=3 and (len(parts)==1 or parts[1] in SHAPES) and (len(parts)<3 or parts[1]=="BULL" and parts[2] in DETAILS)

def stats(items,target):
    n=len(items); hits=sum(ret>=target for _,_,ret in items)
    return dict(n=n,dates=len({d for d,_,_ in items}),stocks=len({c for _,c,_ in items}),hits=hits,hit_pct=round(100*hits/n,2) if n else None,median_return_pct=round(float(median([v for _,_,v in items])),3) if n else None)
def key(r):
    return "|".join(str(r[k]) for k in ("window","horizon","outcome","target_pct","pattern","feature","value"))
def verify(source,report,source_sha):
    if source.get("format")!="BLUE_TURSO_EXIT_SOURCE_V1" or source.get("audits_readback_verified") is not True or source["asof_day"]!=report["asof"]:raise ValueError("source mismatch")
    days=[x["day"] for x in source["eod_days"]]
    if not days or days!=sorted(set(days)) or days[-1]!=source["asof_day"] or any(x["expected"]!=x["actual"] for x in source["eod_days"]):raise ValueError("invalid audit dates")
    indices={d:i for i,d in enumerate(days)}
    coverage=set(source["research_audited_dates"])
    if not coverage.issubset(indices):raise ValueError("invalid coverage")
    bars={}; tags={}; by_signal={}
    for b in source["bars"]:
        k=(b["day"],b["code"])
        if k in bars or k[0] not in indices:raise ValueError("duplicate or invalid bar")
        bars[k]=b
    seen=set()
    for s in source["signals"]:
        k=(s["day"],s["code"])
        if k in seen or k not in bars or k[0] not in coverage or len(set(s["names"]))!=len(s["names"]):raise ValueError("invalid signal")
        seen.add(k);tags[k]=candle_tags(bars[k])
        for p in s["names"]:by_signal.setdefault(p,[]).append(k)
    checks={};unsupported=0;failures=[]
    for r in report["rows"]:
        if not supported(r):
            unsupported+=1;continue
        k=key(r)
        if k in checks:raise ValueError("duplicate profile")
        start=max(0,len(days)-r["window"]);split=start+(len(days)-start)*7//10;h=r["horizon"]
        base,*conditions=r["pattern"].split("|")
        arms={x:[] for x in ("train","train_control","holdout","holdout_control")}
        for d,c in by_signal.get(base,[]):
            i=indices[d];f=tags[d,c]
            if i<start or i+h>=len(days) or (i<split<=i+h) or not all(cond in f.values() for cond in conditions) or r["feature"] not in f:continue
            path=[bars.get((j,c)) for j in days[i+1:i+h+1]]
            if any(b is None for b in path):continue
            if r["outcome"]=="HIGH" and any(b["high"]<b["close"] or b["high"]<=0 for b in path):continue
            price=path[-1]["close"] if r["outcome"]=="CLOSE" else max(b["high"] for b in path)
            close=bars[d,c]["close"]
            ret=Fraction(100*(price-close),close)
            arm=("train" if i<split else "holdout")+("" if f[r["feature"]]==r["value"] else "_control")
            arms[arm].append((d,c,ret))
        recomputed={a:stats(items,r["target_pct"]) for a,items in arms.items()}
        errors=[]
        for a,s in recomputed.items():
            for field,v in s.items():
                orig=r[a][field]
                if v is None or orig is None:
                    if v!=orig:errors.append(a+"."+field)
                elif abs(v-orig)>(.0011 if field=="median_return_pct" else .000001):errors.append(a+"."+field)
        # Only the reported aggregate is published. No raw stock/code/price evidence leaves the source.
        checks[k]={"status":"RECOMPUTED_MATCH" if not errors else "MISMATCH","arms":recomputed}
        if errors:failures.append({"key":k,"fields":errors})
    return dict(schema="BLUE_HIGH_RETURN_AUDIT_V1",asof=source["asof_day"],source_sha256=source_sha,checked=len(checks),unsupported=unsupported,failed=len(failures),failures=failures,checks=checks,
        scope="INDEPENDENT_CALCULATION_SAME_SOURCE_ONLY",calendar_verified=False,corporate_actions_verified=False,external_source_verified=False)
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for n in ("source","report","output"):p.add_argument("--"+n,type=Path,required=True)
    a=p.parse_args();raw=a.source.read_bytes()
    result=verify(json.loads(raw),json.loads(a.report.read_text()),hashlib.sha256(raw).hexdigest())
    a.output.write_text(json.dumps(result,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n")
    print("BLUE_HIGH_RETURN_AUDIT",json.dumps({k:result[k] for k in ("asof","checked","unsupported","failed","scope")}))
    if result["failed"]:raise SystemExit("HIGH_RETURN_RECOMPUTATION_MISMATCH")

"""Publish bounded, anonymous high-return aggregate profiles; no raw stock data."""
import argparse,json,re,math
from collections import defaultdict
from datetime import date
from pathlib import Path
STATES=("HOLDOUT_AGREES_EXPLORATORY","HOLDOUT_DISAGREES","INSUFFICIENT_HOLDOUT")
FEATURES={"CANDLE","BODY","CLOSE_POSITION","MARKET","AMOUNT_ABSOLUTE","AMOUNT_5","AMOUNT_10","AMOUNT_20","RETURN_1","RETURN_5","RETURN_10","RETURN_20","PRIOR_20_HIGH_GAP"}
CAP=30
def stat(s):
    n,d,k,h=(s[x] for x in ("n","dates","stocks","hits"))
    if not all(type(v) is int and 0<=v<=n for v in (n,d,k,h)) or (n and (not d or not k)):raise ValueError("invalid profile counts")
    rate=s["hit_pct"];median=s["median_return_pct"]
    if n==0:
        if rate is not None or median is not None:raise ValueError("empty profile")
    elif not all(type(v) in (int,float) and math.isfinite(v) for v in (rate,median)) or not 0<=rate<=100 or abs(rate-round(100*h/n,2))>.011:raise ValueError("invalid profile rates")
    return dict(n=n,dates=d,stocks=k,hits=h,hit_pct=rate,median_return_pct=median)
def convert(data,snapshot):
    if data.get("schema")!="BLUE_HIGH_RETURN_PROFILES_V1" or data["asof"]!=snapshot["asof"] or date.fromisoformat(data["asof"]).isoformat()!=data["asof"]:raise ValueError("profile date mismatch")
    avail=data["available_sessions"]
    if type(avail) is not int or not 1<=avail<=60:raise ValueError("invalid profile coverage")
    windows=[];seen=set()
    for w in data["windows"]:
        k,a,c,t,h=(w[x] for x in ("window","actual_sessions","covered_sessions","train_sessions","holdout_sessions"))
        if k not in (28,60) or k in seen or not all(type(v) is int and v>=0 for v in (a,c,t,h)) or a!=min(k,avail) or c>a or t+h!=a:raise ValueError("invalid profile window")
        seen.add(k);windows.append(dict(window=k,actual_sessions=a,covered_sessions=c,train_sessions=t,holdout_sessions=h))
    if seen!={28,60}:raise ValueError("missing windows")
    buckets=defaultdict(list);keys=set()
    for r in data["rows"]:
        w,h,o,t,p,f,v,s=(r[x] for x in ("window","horizon","outcome","target_pct","pattern","feature","value","status"))
        if w not in seen or h not in (1,2,3,5,10,20) or o not in ("CLOSE","HIGH") or t not in (10,20) or s not in STATES or f not in FEATURES or not isinstance(p,str) or len(p)>180 or not re.fullmatch(r"[A-Z0-9_]+(?:\|[A-Z0-9_]+)*",p) or not isinstance(v,str) or not re.fullmatch(r"[A-Z0-9_]{1,50}",v):raise ValueError("invalid profile identity")
        key=(w,h,o,t,p,f,v)
        if key in keys:raise ValueError("duplicate profile")
        keys.add(key)
        row=dict(window=w,horizon=h,outcome=o,target_pct=t,pattern=p,feature=f,value=v,status=s)
        for a,b,l in (("train","train_control","train_lift_pp"),("holdout","holdout_control","holdout_lift_pp")):
            x,y=stat(r[a]),stat(r[b]);delta=r[l]
            expected=round(x["hit_pct"]-y["hit_pct"],2) if x["n"] and y["n"] else None
            if delta!=expected:raise ValueError("invalid lift")
            row.update({a:x,b:y,l:delta})
        if row["train_lift_pp"] is None or row["train_lift_pp"]<10:raise ValueError("invalid discovery lift")
        buckets[(w,h,o,t,s)].append(row)
    rows=[];coverage=[]
    for (w,h,o,t,s),rs in sorted(buckets.items()):
        ranked=sorted(rs,key=lambda r:(-(r["holdout_lift_pp"] if s==STATES[0] and r["holdout_lift_pp"] is not None else r["train_lift_pp"]),-r["train"]["n"],r["pattern"],r["feature"],r["value"]))
        rows.extend(ranked[:CAP])
        coverage.append(dict(window=w,horizon=h,outcome=o,target_pct=t,status=s,total=len(rs),published=min(CAP,len(rs))))
    return dict(asof=data["asof"],available_sessions=avail,windows=windows,rows=rows,coverage=coverage,source_rows=len(data["rows"]),published_rows=len(rows),cap_per_group=CAP)
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for name in ("input","snapshot","output"):p.add_argument("--"+name,type=Path,required=True)
    a=p.parse_args()
    data=convert(json.loads(a.input.read_text()),json.loads(a.snapshot.read_text()))
    a.output.write_text("// Generated aggregate exploratory research; no production promotion.\nexport const HIGH_RETURN_PROFILES: unknown = "+json.dumps(data,ensure_ascii=False,allow_nan=False,separators=(",",":"))+";\n",encoding="utf-8")

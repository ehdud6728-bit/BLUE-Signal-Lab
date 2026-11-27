"""Landmark study on audited V6 cases. Descriptive, fixed strata, no fitting.
Feature information ends at the landmark close; outcome starts next open.
Separate original target not-yet-hit from continuation after an original hit."""
import argparse,json
from collections import defaultdict,Counter
from fractions import Fraction as F
from pathlib import Path
from env20_case_features import pct,rate
from env20_confluence_entry import stat
LANDMARKS=(1,2,3,5,10)
WINDOWS=(1,3,5,10)
TARGETS=(5,10,15,20)
def band_ratio(value,prior):
    if prior is None or prior<=0 or value is None or value<0:return "UNKNOWN"
    r=F(value,prior)
    return "LT_0_7" if r<F(7,10) else "0_7_TO_1_5" if r<F(3,2) else "GE_1_5"
def shape(b):
    o,h,l,c=(b[k] for k in ("open","high","low","close"))
    width=h-l;body=abs(c-o)
    if width==0:return "FLAT_RANGE"
    if 10*body<=width:return "DOJI"
    return ("LONG_" if 10*body>=6*width else "")+("BULL" if c>o else "BEAR")
def feature_at(case,seen):
    b=seen[-1];p=(case["pre_bars"]+seen)[-2]
    g=case.get("geometry") or {};stop=g.get("stop");res=g.get("resistance")
    side=lambda level: "UNKNOWN" if level is None else "CLOSE_BELOW" if b["close"]<level else "TOUCH_RECLAIM" if b["low"]<=level else "ABOVE"
    upper="UNKNOWN" if res is None else "CLOSE_ABOVE" if b["close"]>res else "TOUCH_REJECT" if b["high"]>=res else "BELOW"
    direction="UP" if b["close"]>p["close"] else "DOWN" if b["close"]<p["close"] else "FLAT"
    vol=band_ratio(b.get("volume"),p.get("volume"))
    amount=band_ratio(b.get("amount"),p.get("amount"))
    hist=case["pre_bars"]+seen
    f={"CANDLE":shape(b),"CLOSE_DIRECTION":direction,"VOLUME_VS_PREV":vol,"TURNOVER_VS_PREV":amount,"VOLUME_DIRECTION":direction+"|"+vol if vol!="UNKNOWN" else "UNKNOWN","TURNOVER_DIRECTION":direction+"|"+amount if amount!="UNKNOWN" else "UNKNOWN","FROZEN_SUPPORT":side(stop),"FROZEN_RESISTANCE":upper}
    for n in (5,10,20):
        if len(hist)<n+1:f["MA"+str(n)]="UNKNOWN";continue
        now=F(sum(z["close"] for z in hist[-n:]),n);prev=F(sum(z["close"] for z in hist[-n-1:-1]),n)
        f["MA"+str(n)]="CROSS_UP" if p["close"]<=prev and b["close"]>now else "CROSS_DOWN" if p["close"]>=prev and b["close"]<now else "ABOVE" if b["close"]>=now else "BELOW"
    return f
def metrics(rows):
    n=len(rows);hits=sum(z["hit"] for z in rows);days=len({z["day"] for z in rows});codes=len({z["code"] for z in rows})
    return dict(n=n,hit=hits,hit_pct=rate(hits,n),dates=days,symbols=codes,sample_floor=n>=30 and days>=5 and codes>=10,
      future_high_pct=stat([z["high"] for z in rows]),future_low_pct=stat([z["low"] for z in rows]),future_close_pct=stat([z["close"] for z in rows]),
      hold_vs_exit_next_open_pct=stat([z["close"] for z in rows]))
def study(report,cases,outcomes):
    if report["schema"]!="BLUE_ENV20_CASE_FEATURES_V6":raise ValueError("BAD_CASE_SOURCE")
    lookup={c["id"]:c for c in cases};results={o["id"]:o for o in outcomes}
    if len(lookup)!=len(cases) or len(results)!=len(outcomes) or set(lookup)!=set(results):raise ValueError("CASE_ID_MISMATCH")
    split=report["split_day"];coverage=Counter();groups=defaultdict(list);baseline=defaultdict(list)
    for id,c in lookup.items():
        o=results[id];pre=c["pre_bars"];path=o["post_bars"]
        if not pre or pre[-1]["day"]!=c["day"] or any(z["day"]>c["day"] for z in pre) or any(z["day"]<=c["day"] for z in path) or [z["day"] for z in path]!=sorted({z["day"] for z in path}):raise ValueError("TIME_ORDER")
        if not path:continue
        entry=path[0]["open"]
        for d in LANDMARKS:
            for h in WINDOWS:
                # Only complete path through the entire observation/future window.
                if len(path)<d+h:coverage[d,h,"NO_COMPLETE_PATH"]+=1;continue
                seen=path[:d];future=path[d:d+h];f=feature_at(c,seen);prior_high=max(z["high"] for z in seen);future_high=max(z["high"] for z in future)
                next_open=future[0]["open"]
                phase="TRAIN" if future[-1]["day"]<split else "HOLDOUT" if c["day"]>=split else "EMBARGO"
                coverage[d,h,"OBSERVED"]+=1
                for target in TARGETS:
                    if prior_high*100>=entry*(100+target):continue
                    # Continuation cohort has already hit the immediately preceding
                    # configured target; others remain below that earlier target.
                    prev=TARGETS[TARGETS.index(target)-1] if target!=5 else None
                    cohort="AFTER_PREVIOUS_TARGET" if prev is not None and prior_high*100>=entry*(100+prev) else "NOT_YET_TARGET"
                    z=dict(day=c["day"],code=c["code"],hit=future_high*100>=entry*(100+target),high=pct(future_high,next_open),low=pct(min(x["low"] for x in future),next_open),close=pct(future[-1]["close"],next_open))
                    for p in ("ALL",phase):
                        key=(d,h,target,cohort,p);baseline[key].append(z)
                        for k,v in f.items():groups[key+(k,v)].append(z)
    out=[]
    for key,a in sorted(baseline.items()):
        d,h,t,cohort,phase=key;out.append(dict(landmark=d,future_sessions=h,target_pct=t,cohort=cohort,phase=phase,feature="BASELINE",value="ALL",**metrics(a)))
    for key,a in sorted(groups.items()):
        d,h,t,cohort,phase,k,v=key;out.append(dict(landmark=d,future_sessions=h,target_pct=t,cohort=cohort,phase=phase,feature=k,value=v,**metrics(a)))
    return dict(schema="BLUE_ENV20_LANDMARK_V1",asof=report["asof"],split_day=split,case_count=len(cases),coverage=[dict(landmark=d,future_sessions=h,status=s,n=n) for (d,h,s),n in sorted(coverage.items())],rows=out,limits=["SAME_V6_SOURCE_NOT_INDEPENDENT","FUTURE_HIGH_NOT_REALIZED_RETURN","EXIT_NEXT_OPEN_VS_HOLD_CLOSE_NO_COSTS","NO_RECOMMENDATION","NO_INDEPENDENT_PRICE_OR_CORPORATE_ACTION_VALIDATION","MISSING_PATHS_NOT_ZERO","FIXED_STRATA_MULTIPLE_COMPARISONS","NOT_IMMUTABLE_FORWARD_CAPTURE","NO_INTRADAY_ORDER"])
def main():
    p=argparse.ArgumentParser()
    for k in ("report","cases","outcomes","out"):p.add_argument("--"+k,type=Path,required=True)
    a=p.parse_args();read=lambda p:json.loads(p.read_text());r=study(read(a.report),read(a.cases),read(a.outcomes))
    a.out.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n")
    base=[z for z in r["rows"] if z["feature"]=="BASELINE" and z["landmark"] in (1,3) and z["future_sessions"]==3 and z["target_pct"] in (5,10) and z["phase"] in ("ALL","HOLDOUT")]
    print("BLUE_ENV20_LANDMARK",json.dumps(dict(asof=r["asof"],cases=r["case_count"],rows=len(r["rows"]),baselines=base,coverage=r["coverage"])))
if __name__=="__main__":main()

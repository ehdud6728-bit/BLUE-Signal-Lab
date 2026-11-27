"""V6: case-level audited chart evidence and fixed signal-day feature contrasts.
No fitted filter, no recommendation, no exit return. All complete signals retained."""
import argparse,json,re,hashlib
from collections import Counter,defaultdict
from fractions import Fraction as F
from pathlib import Path
from env20_structural_entry import opportunity,HORIZONS
from env20_confluence_entry import support_levels,stat,ready
from env20_technical_room import resistance,geometry,room,order
from env20_pullback_context import categories,band
from pattern_performance_forward import indexed,history
from pattern_performance_full_universe import check
FROZEN_AFTER="2026-11-27"
PRIMARY=5
# Preserve the original V6 comparison boundary as source history expands.
# This is a previously inspected historical split, never fresh OOS.
FIXED_SPLIT_DAY="2026-11-09"
def comparison_split(value=FIXED_SPLIT_DAY):
    from datetime import date
    check(isinstance(value,str) and date.fromisoformat(value).isoformat()==value,"BAD_SPLIT_DAY")
    return value
def pct(p,q):return 100*(F(p)/q-1)
def direction(a,b):return "UP" if a>b else "DOWN" if a<b else "FLAT"
def pivots(a):
    return [i for i in range(2,len(a)-2) if all(a[i]["low"]<a[j]["low"] for j in (i-2,i-1,i+1,i+2))]
def features(b,x,h,signals,state,trend):
    c=b["close"];a=h(15)
    atr=F(sum(max(z["high"]-z["low"],abs(z["high"]-y["close"]),abs(z["low"]-y["close"])) for y,z in zip(a,a[1:])),14) if a else None
    if atr==0:atr=None
    f=categories(b,x,h(25),atr)
    f.update(MARKET_STATE=state,INDEX_TREND=trend)
    raw={"atr14":atr}
    for n in (3,5):
        a=h(n+1)
        f[f"DOWN_CLOSE_COUNT_{n}"]=str(sum(z["close"]<y["close"] for y,z in zip(a,a[1:]))) if a else "UNKNOWN"
    a=h(11)
    if a:
        prior=a[:-1];lo1=min(z["low"] for z in prior[:5]);lo2=min(z["low"] for z in prior[5:])
        f["PRIOR5_LOW_SHIFT"]=direction(lo2,lo1)
        f["SIGNAL_VS_PRIOR5_LOW"]="BREAK_CLOSE" if c<lo2 else "TOUCH_RECLAIM" if b["low"]<=lo2 else "ABOVE"
        old=pct(prior[5]["close"],prior[0]["close"]);new=pct(c,prior[5]["close"])
        f["DECLINE_CHANGE"]="SLOWING" if old<0 and new<0 and new>old else "ACCELERATING" if old<0 and new<old else "REBOUND" if old<0 and new>=0 else "OTHER"
        raw.update(prior5_low=lo2,older_return_pct=old,recent_return_pct=new)
    else:f.update(PRIOR5_LOW_SHIFT="UNKNOWN",SIGNAL_VS_PRIOR5_LOW="UNKNOWN",DECLINE_CHANGE="UNKNOWN")
    a=h(21)
    if a:
        ps=pivots(a);f["PIVOT_LOW_TREND"]=direction(a[ps[-1]]["low"],a[ps[-2]]["low"]) if len(ps)>=2 else "INSUFFICIENT_PIVOTS"
        if ps:
            i=ps[-1];p=a[i]["low"]
            # Reaction completed by signal close only.
            rebound=pct(max(z["high"] for z in a[i+1:]),p)
            raw.update(pivot_day=a[i]["day"],pivot_price=p,pivot_rebound_pct=rebound,pivot_distance_pct=pct(c,p))
            f["PIVOT_REACTION"]=band(rebound,(3,5,10),("LT3","3_5","5_10","GE10"))
            f["PIVOT_SIGNAL_POSITION"]="BELOW" if c<p else "RECLAIM" if b["low"]<=p else "ABOVE"
            if atr:
                # Count separate prior touch episodes after pivot confirmation,
                # excluding signal day. Not independent proof of support.
                touches=[abs(F(z["low"])-p)<=atr/4 and z["close"]>=p for z in a[i+3:-1]]
                episodes=sum(v and (j==0 or not touches[j-1]) for j,v in enumerate(touches))
                raw["pivot_retest_episodes"]=episodes
                f["PIVOT_RETESTS"]="2_PLUS" if episodes>=2 else str(episodes)
            else:f["PIVOT_RETESTS"]="UNKNOWN"
        else:f.update(PIVOT_REACTION="NO_PIVOT",PIVOT_SIGNAL_POSITION="NO_PIVOT",PIVOT_RETESTS="NO_PIVOT")
        ma=F(sum(z["close"] for z in a[-20:]),20);prev=F(sum(z["close"] for z in a[:20]),20)
        env=ma*F(4,5);prev_env=prev*F(4,5)
        raw["env_lower"]=env;raw["env_close_distance_pct"]=pct(c,env)
        f["ENV_REENTRY"]="REENTRY" if a[-2]["close"]<prev_env and c>=env else "BELOW" if c<env else "ABOVE"
        f["ENV_SIGNAL_LOW"]="TOUCH" if b["low"]<=env else "ABOVE"
    else:f.update(PIVOT_LOW_TREND="UNKNOWN",PIVOT_REACTION="UNKNOWN",PIVOT_SIGNAL_POSITION="UNKNOWN",PIVOT_RETESTS="UNKNOWN",ENV_REENTRY="UNKNOWN",ENV_SIGNAL_LOW="UNKNOWN")
    a=h(30)
    if a:
        m=lambda end:F(sum(z["close"] for z in a[end-20:end]),20)
        s1=pct(m(25),m(20));s2=pct(m(30),m(25))
        raw.update(ma20_older_slope_pct=s1,ma20_recent_slope_pct=s2)
        f["MA20_SLOPE_CHANGE"]="SLOWING" if s1<0 and s1<s2<0 else "ACCELERATING" if s1<0 and s2<s1 else "TURN_UP" if s1<0<=s2 else "OTHER"
    else:f["MA20_SLOPE_CHANGE"]="UNKNOWN"
    a=h(45)
    if a:
        m=lambda n,end:F(sum(z["close"] for z in a[end-n:end]),n)
        before=m(40,40)-m(20,40);after=m(40,45)-m(20,45)
        f["MA20_40_GAP_CHANGE"]=direction(after/m(40,45),before/m(40,40))
    else:f["MA20_40_GAP_CHANGE"]="UNKNOWN"
    a=h(6)
    if a:
        ups=[z["amount"] for y,z in zip(a,a[1:]) if z["close"]>y["close"]]
        downs=[z["amount"] for y,z in zip(a,a[1:]) if z["close"]<y["close"]]
        f["UP_DOWN_TURNOVER_5"]=direction(F(sum(ups),len(ups)),F(sum(downs),len(downs))) if ups and downs else "ONE_DIRECTION"
        f["SIGNAL_TURNOVER_VS_PRIOR5"]=band(F(5*b["amount"],sum(z["amount"] for z in a[:-1])),(1,F(3,2)),("LT1","1_1_5","GE1_5"))
    else:f.update(UP_DOWN_TURNOVER_5="UNKNOWN",SIGNAL_TURNOVER_VS_PRIOR5="UNKNOWN")
    # Existing saved signal names, not recomputed oscillator values or absence of a cross
    # from an unaudited payload. Exact list retained in cases; indicator tags
    # descriptive only, not a fabricated RSI/divergence.
    for key in ("RSI","SLOW","STOCH","MACD"):
        f["STORED_"+key+"_TAG"]="PRESENT" if any(key in s for s in signals) else "NOT_IN_SAVED_TAGS"
    return f,raw
def outcome(b,path,g,h):
    e=(0,F(path[0]["open"]),True);p=e[1]
    o=opportunity(path,e,F(b["close"]),b["close"],h,"SIGNAL_WINDOW")
    # Independently compute from integer prices for regression against shared V3.
    hit=any(100*z["high"]>=105*p for z in path)
    check(hit==(o["targets"][5][0] is not None) and o["peak_lower"]==pct(max(z["high"] for z in path),p),"HIGH_RECONCILIATION_FAILED")
    t=o["targets"][5][0];r=room(p,g)
    touch=order(path,e,h,"SIGNAL_WINDOW",g["stop"],p*F(105,100)) if r else "GEOMETRY_UNAVAILABLE"
    if not hit:label="MISS"
    elif touch=="TARGET_FIRST":label="TARGET_BEFORE_SUPPORT"
    elif touch=="SUPPORT_FIRST":label="SUPPORT_BEFORE_TARGET"
    elif touch=="AMBIGUOUS":label="ORDER_UNKNOWN"
    else:label="HIT_GEOMETRY_UNKNOWN"
    # Exact lower/upper bounds on worst adverse move before target using full
    # prior sessions and target-day low; if target at open, exclude target day.
    before=worst=None
    if t is not None:
        before=pct(min([p]+[z["low"] for z in path[:t-1]]),p)
        worst=before if path[t-1]["open"]>=p*F(105,100) else pct(min([p]+[z["low"] for z in path[:t]]),p)
    return dict(status="OBSERVED",entry_day=path[0]["day"],entry_price=p,peak_price=max(z["high"] for z in path),
        peak_day=path[o["peak_day"]-1]["day"],low_price=min(z["low"] for z in path),
        peak_pct=o["peak_lower"],trough_pct=o["trough"],hit5=hit,first5_day=path[t-1]["day"] if t else None,
        target_days={str(k):path[v[0]-1]["day"] if v[0] else None for k,v in o["targets"].items()},
        adverse_before_target_best_bound_pct=before,adverse_before_target_worst_bound_pct=worst,
        support_order=touch,label=label)
def rate(a,b):return round(100*a/b,3) if b else None
def aggregate(rows,base):
    n=len(rows);hits=sum(z["outcome"]["hit5"] for z in rows);bh=sum(z["outcome"]["hit5"] for z in base);bn=len(base)
    return dict(n=n,hits=hits,misses=n-hits,hit_pct=rate(hits,n),base_hit_pct=rate(bh,bn),coverage_pct=rate(n,bn),
        retained_hits_pct=rate(hits,bh),excluded_misses_pct=rate((bn-bh)-(n-hits),bn-bh),
        peak_pct=stat([z["outcome"]["peak_pct"] for z in rows]),trough_pct=stat([z["outcome"]["trough_pct"] for z in rows]),
        label_counts=dict(Counter(z["outcome"]["label"] for z in rows)),
        dates=len({z["day"] for z in rows}),symbols=len({z["code"] for z in rows}),
        sample_floor=n>=30 and len({z["day"] for z in rows})>=5 and len({z["code"] for z in rows})>=10)
def select_cases(rows):
    # Deterministic neutral sample per phase/label. No selecting biggest wins.
    groups=defaultdict(list)
    for z in rows:groups[z["phase"],z["outcome"]["label"]].append(z)
    selected=[]
    for (phase,label),a in sorted(groups.items()):
        used=set()
        for z in sorted(a,key=lambda z:hashlib.sha256(("V6_CASE_SAMPLE_V1|"+z["id"]).encode()).hexdigest()):
            if z["code"] in used:continue
            selected.append(dict(id=z["id"],phase=phase,label=label));used.add(z["code"])
            if len(used)==3:break
    return selected
def study(src,bench,factors,split_day=FIXED_SPLIT_DAY):
    days,meta,bars,indexes,states,old=indexed(src,bench)
    check(factors["schema"]=="BLUE_ENV20_PULLBACK_FACTORS_V1" and factors["cutoff"]==src["cutoff"],"BAD_FACTOR_SOURCE")
    wanted={k for k,v in old.items() if "ENV20_LOWER_TOUCH" in v};lookup={}
    for x in factors["rows"]:
        k=x["day"],x["code"];check(k in wanted and k not in lookup and re.fullmatch(r"[a-f0-9]{64}",x["record_sha256"]),"BAD_FACTOR_ROW");lookup[k]=x
    check(set(lookup)==wanted,"FACTOR_COUNT_MISMATCH")
    split=comparison_split(split_day);cases=[];outcomes=[];rows=[];coverage=Counter();cohort=0
    for (d,c),x in sorted(lookup.items()):
        if x["ma_down"] is not True or x["ma_chart_consistent"] is not True:continue
        cohort+=1;b=bars[d,c];market=b["market"];ds=indexes[market]
        if d not in ds:coverage["SIGNAL_DATE_UNALIGNED"]+=1;continue
        i=ds.index(d)
        def hist(n):
            a=history(ds[:i+1],bars,c,market,n)
            return a if a and [q for q in days if ds[i-n+1]<=q<=d]==ds[i-n+1:i+1] else None
        f,raw=features(b,x,hist,old[d,c],*states[market,d])
        lv=support_levels(b,hist);upper=resistance(b,hist,x);g=geometry(F(b["close"]),lv,upper)
        cid=d+"/"+c
        prior=[]
        for n in range(min(60,i+1),0,-1):
            a=hist(n)
            if a:prior=a;break
        check(bool(prior) and prior[-1]["day"]==d,"CASE_HISTORY_INVALID")
        def compact(z):return {k:z[k] for k in ("day","open","high","low","close","amount","volume") if k in z}
        cases.append(dict(id=cid,day=d,code=c,name=b.get("name") or None,market=market,signal_names=old[d,c],
            features=f,raw_features=raw,signal_ma={k:x.get(k) for k in ("ma20","ma40","ma60")},supply=x.get("supply"),
            support_levels=ready(lv),resistance_levels=upper,geometry=g,record_sha256=x["record_sha256"],
            pre_bars=[compact(z) for z in prior],source_hashes={z["day"]:meta[z["day"]]["sha256"] for z in prior}))
        by_h={};longest=[]
        for h in HORIZONS:
            seq=ds[i+1:i+1+h];path=[bars.get((q,c)) for q in seq]
            if len(seq)<h:status="PENDING"
            elif [q for q in days if d<q<=seq[-1]]!=seq:status="DATE_WINDOW_MISSING"
            elif any(z is None or z["market"]!=market for z in path):status="MISSING_PATH"
            elif any(abs(F(z["open"],y["close"])-1)>=F(2,5) for y,z in zip([b]+path,path)):status="DISCONTINUITY_REVIEW"
            else:status="OBSERVED"
            coverage[str(h),status]+=1
            by_h[str(h)]=outcome(b,path,g,h) if status=="OBSERVED" else dict(status=status)
            if status=="OBSERVED":
                longest=path
                if h==PRIMARY:
                    phase="TRAIN" if seq[-1]<split else "HOLDOUT" if d>=split else "EMBARGO"
                    rows.append(dict(id=cid,day=d,code=c,phase=phase,features=f,outcome=by_h[str(h)]))
        # Separate contiguous audited prefix for exact landmark windows. Preserve
        # original fixed-horizon post_bars and all V6 outcome denominators.
        exact=[];end_status="MAX_WINDOW"
        for q in sorted({q for q in days+ds if d<q<=days[-1]})[:20]:
            z=bars.get((q,c))
            if q not in ds or q not in meta:end_status="DATE_WINDOW_MISSING";break
            if z is None or z["market"]!=market:end_status="MISSING_PATH";break
            previous=exact[-1] if exact else b
            if abs(F(z["open"],previous["close"])-1)>=F(2,5):end_status="DISCONTINUITY_REVIEW";break
            exact.append(z)
        else:
            if len(exact)<20:end_status="PENDING"
        outcomes.append(dict(id=cid,landmark_path_version=1,
            landmark_bars=[compact(z) for z in exact],landmark_end_status=end_status,
            landmark_source_hashes={z["day"]:meta[z["day"]]["sha256"] for z in exact},
            horizons=by_h,post_bars=[compact(z) for z in longest],
            source_hashes={z["day"]:meta[z["day"]]["sha256"] for z in longest}))
    phase_rows={"ALL":rows,"TRAIN":[z for z in rows if z["phase"]=="TRAIN"],"HOLDOUT":[z for z in rows if z["phase"]=="HOLDOUT"],
        "POST_FREEZE_DATES":[z for z in rows if z["day"]>FROZEN_AFTER]}
    summary={};contrasts=[]
    for phase,base in phase_rows.items():
        summary[phase]=aggregate(base,base)
        groups=defaultdict(list)
        for z in base:
            for k,v in z["features"].items():groups[k,v].append(z)
        for (k,v),a in sorted(groups.items()):
            contrasts.append(dict(phase=phase,feature=k,value=v,**aggregate(a,base)))
    return dict(schema="BLUE_ENV20_CASE_FEATURES_V6",asof=days[-1],source_days=len(days),inverse_chart_match_signals=cohort,split_day=split,split_policy="FIXED_EXPLICIT_DAY",split_reference="HISTORICAL_V6_NOT_FRESH_OOS",post_freeze_after=FROZEN_AFTER,
        coverage=[dict(key=list(k) if isinstance(k,tuple) else [k],count=n) for k,n in sorted(coverage.items(),key=lambda x:str(x[0]))],summary=summary,contrasts=contrasts,representative_cases=select_cases(rows),
        limits=["HIGH_NOT_REALIZED_RETURN","ALL_SIGNAL_DAY_FEATURES","HISTORICAL_SPLIT_NOT_FRESH_OOS","POST_FREEZE_DATES_NOT_IMMUTABLE_FORWARD_CAPTURE","FIXED_SINGLE_FEATURE_STRATA_NOT_FITTED_FILTER","DEPENDENT_CASES_MULTIPLE_COMPARISONS","RAW_PRICES_CORPORATE_ACTIONS_UNVERIFIED","NO_LOWER_VOLUME_PROFILE","STORED_TAGS_NOT_RECOMPUTED_RSI_DIVERGENCE","NO_PROMOTION"]),cases,outcomes
def encode(x):
    if isinstance(x,F):return float(x)
    raise TypeError(type(x).__name__)
def main():
    p=argparse.ArgumentParser()
    for k in ("source","benchmark","factors","out"):p.add_argument("--"+k,type=Path,required=True)
    p.add_argument("--split-day",default=FIXED_SPLIT_DAY)
    a=p.parse_args();read=lambda p:json.loads(p.read_text())
    r,c,o=study(read(a.source),read(a.benchmark),read(a.factors),a.split_day)
    def write(p,x):p.write_text(json.dumps(x,ensure_ascii=False,allow_nan=False,default=encode,separators=(",",":"))+"\n")
    write(a.out,r);write(a.out.with_name("case-signals.json"),c);write(a.out.with_name("case-outcomes.json"),o)
    print("BLUE_ENV20_CASE_FEATURES",json.dumps({k:v for k,v in r.items() if k not in ("contrasts","representative_cases")},ensure_ascii=False))
    print("BLUE_ENV20_CASE_ARTIFACT",json.dumps(dict(cases=len(c),outcomes=len(o),contrasts=len(r["contrasts"]),representatives=len(r["representative_cases"]))))
if __name__=="__main__":main()

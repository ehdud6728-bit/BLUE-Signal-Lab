"""Tomato context pilot: fixed UI-equivalent selection, retrospective and current separated."""
import argparse,json
from statistics import median
from fractions import Fraction
from pathlib import Path
from collections import Counter,defaultdict
from pattern_performance_forward import indexed,history
from pattern_performance_full_universe import check,direction
from pattern_performance_audited import candle
from pattern_performance_structure import structure
import pattern_scaleout as scaleout
TARGETS=(3,5,10,15,20)
# Fixed research definitions, not fixed percentage stops or trade advice.
ORDER_TARGETS=(3,5,10)
STOP_METHODS=("ATR14_SMA_1_5","ATR14_SMA_2","SIGNAL_LOW","CONFIRMED_SWING_LOW_10","PRIOR_BOX_LOW","MA20_BELOW_SIGNAL","LOWER_VOLUME_PROFILE")
ORDER_STATES=("TARGET_FIRST","STOP_FIRST","SAME_DAY_UNKNOWN","NEITHER")
def technical_candidates(past,bars,code,scope):
    """Only observations through signal close; exact benchmark dates required."""
    h=lambda n:history(past,bars,code,scope,n)
    b=h(1)[-1]
    atr=None
    if (a:=h(15)):
        atr=Fraction(sum(max(x["high"]-x["low"],abs(x["high"]-y["close"]),abs(x["low"]-y["close"])) for y,x in zip(a,a[1:])),14)
    swing=None
    if (a:=h(11)):
        # Strict 2-left/2-right pivot, latest confirmed by signal close.
        for i in range(len(a)-3,1,-1):
            if all(a[i]["low"]<a[j]["low"] for j in (i-2,i-1,i+1,i+2)):
                swing=Fraction(a[i]["low"]);break
    box=None
    if (a:=h(11)) and structure(a) in ("PRIOR_RISE_IN_BOX","PRIOR_RISE_BREAKOUT","OTHER_PRIOR_IN_BOX","OTHER_PRIOR_BREAKOUT"):
        box=Fraction(min(x["low"] for x in a[5:10]))
    ma=None
    if (a:=h(20)):
        x=Fraction(sum(v["close"] for v in a),20)
        if x<b["close"]:ma=x
    def price(x,missing):
        if x is None:return (None,missing)
        if x>=b["close"]:return (None,"NOT_BELOW_SIGNAL_CLOSE")
        return (x,"READY")
    return {"ATR14_SMA_1_5":(atr,"READY" if atr and atr>0 else "INSUFFICIENT_OR_ZERO_ATR"),
            "ATR14_SMA_2":(atr,"READY" if atr and atr>0 else "INSUFFICIENT_OR_ZERO_ATR"),
            "SIGNAL_LOW":price(Fraction(b["low"]),"UNAVAILABLE"),
            "CONFIRMED_SWING_LOW_10":price(swing,"NO_CONFIRMED_PIVOT_OR_INSUFFICIENT_HISTORY"),
            "PRIOR_BOX_LOW":price(box,"NO_QUALIFYING_BOX_OR_INSUFFICIENT_HISTORY"),
            "MA20_BELOW_SIGNAL":price(ma,"MA_NOT_BELOW_CLOSE_OR_INSUFFICIENT_HISTORY"),
            # Existing stored supply profile is OVERHEAD only; verified 100+ prior
            # volume bars are not exported here. No fabricated lower support.
            "LOWER_VOLUME_PROFILE":(None,"LOWER_PROFILE_NOT_VERIFIED")}
def stop_at_entry(candidates,entry):
    out={}
    for k in STOP_METHODS:
        x,status=candidates[k]
        if status!="READY":out[k]=(None,status);continue
        if k.startswith("ATR14_"):
            x=Fraction(entry)-x*(Fraction(3,2) if k.endswith("1_5") else 2)
        if x<=0:out[k]=(None,"NONPOSITIVE_STOP")
        elif x>=entry:out[k]=(None,"ENTRY_AT_OR_BELOW_STOP")
        else:out[k]=(x,"READY")
    return out
def first_touch_order(path,target,stop_price):
    """Price level touch, not a fill model."""
    check(bool(path) and target>0 and 0<stop_price<path[0]["open"],"BAD_FIRST_TOUCH_INPUT")
    entry=path[0]["open"]
    upper=Fraction((100+target)*entry,100)
    for i,b in enumerate(path,1):
        if b["open"]>=upper:return ("TARGET_FIRST",i)
        if b["open"]<=stop_price:return ("STOP_FIRST",i)
        hit=b["high"]>=upper
        cut=b["low"]<=stop_price
        if hit and cut:return ("SAME_DAY_UNKNOWN",i)
        if hit:return ("TARGET_FIRST",i)
        if cut:return ("STOP_FIRST",i)
    return ("NEITHER",None)
def outcome(path,candidates=None):
    """Next observation open; exact daily high/low, not assumed fills."""
    check(bool(path),"EMPTY_OUTCOME_PATH")
    entry=path[0]["open"]
    peak=max(x["high"] for x in path)
    trough=min(x["low"] for x in path)
    close=path[-1]["close"]
    pct=lambda p: Fraction(100*(p-entry),entry)
    peak_i=next(i for i,x in enumerate(path,1) if x["high"]==peak)
    targets={}
    for t in TARGETS:
        i=next((i for i,x in enumerate(path,1) if 100*x["high"]>=(100+t)*entry),None)
        # Prior full sessions only. Within-hit-day low/high order is not known.
        targets[t]=None if i is None else dict(day=i,prior_full_days_low_pct=pct(min([entry]+[x["low"] for x in path[:i-1]])),hit_day_low_below_entry=path[i-1]["low"]<entry)
    stops=stop_at_entry(candidates,entry) if candidates is not None else {k:(None,"HISTORY_NOT_PROVIDED") for k in STOP_METHODS}
    technical={}
    for k,(level,status) in stops.items():
        technical[k]=dict(status=status,risk_pct=-pct(level) if level is not None else None,
            peak_r=Fraction(peak-entry,1)/(entry-level) if level is not None else None,
            touches={str(t):first_touch_order(path,t,level) for t in ORDER_TARGETS} if level is not None else {})
    return dict(peak=pct(peak),trough=pct(trough),close=pct(close),peak_day=peak_i,giveback=Fraction(100*(peak-close),entry),targets=targets,technical=technical)
def summarize_opportunity(events):
    observed=[e for e in events if e[3]=="OBSERVED"]
    check(all((e[2] is not None)==(e[3]=="OBSERVED") for e in events),"OUTCOME_STATUS_CONFLICT")
    vals=[e[2] for e in observed];n=len(vals)
    nd=len({e[0] for e in observed});ns=len({e[1] for e in observed})
    def stats(key):
        a=[v[key] for v in vals]
        return dict(mean=round(float(sum(a)/n),3) if n else None,median=round(float(median(a)),3) if n else None)
    targets={}
    for t in TARGETS:
        hits=[v["targets"][t] for v in vals if v["targets"][t] is not None]
        k=len(hits)
        targets[str(t)]=dict(hits=k,hit_pct=round(100*k/n,2) if n else None,
            mean_first_day=round(sum(x["day"] for x in hits)/k,3) if k else None,
            median_first_day=median(x["day"] for x in hits) if k else None,
            mean_prior_full_days_low_pct=round(float(sum(x["prior_full_days_low_pct"] for x in hits)/k),3) if k else None,
            hit_day_low_below_entry_count=sum(x["hit_day_low_below_entry"] for x in hits))
    order={}
    for method in STOP_METHODS:
        all_stops=[v["technical"][method] for v in vals]
        coverage=Counter(x["status"] for x in all_stops)
        usable=[x for x in all_stops if x["status"]=="READY"]
        k=len(usable)
        risk=[x["risk_pct"] for x in usable]
        peak_r=[x["peak_r"] for x in usable]
        item=dict(available=k,unavailable=n-k,status_counts=dict(sorted(coverage.items())),
            mean_risk_pct=round(float(sum(risk)/k),3) if k else None,
            median_risk_pct=round(float(median(risk)),3) if k else None,
            mean_unconstrained_peak_R=round(float(sum(peak_r)/k),3) if k else None,
            median_unconstrained_peak_R=round(float(median(peak_r)),3) if k else None,targets={})
        for t in ORDER_TARGETS:
            pairs=[x["touches"][str(t)] for x in usable]
            c=Counter(x[0] for x in pairs)
            check(sum(c.values())==k and set(c)<=set(ORDER_STATES),"FIRST_TOUCH_COUNT_MISMATCH")
            touched=[x[1] for x in pairs if x[1] is not None]
            item["targets"][str(t)]=dict(counts={st:c[st] for st in ORDER_STATES},
                target_first_lower_pct=round(100*c["TARGET_FIRST"]/k,2) if k else None,
                target_first_upper_pct=round(100*(c["TARGET_FIRST"]+c["SAME_DAY_UNKNOWN"])/k,2) if k else None,
                mean_first_touch_day=round(sum(touched)/len(touched),3) if touched else None)
        order[method]=item
    return dict(events=len(events),sample_count=n,signal_dates=nd,symbols=ns,technical_stop_order=order,
        pending=sum(e[3]=="PENDING" for e in events),missing_path=sum(e[3]=="MISSING_PATH" for e in events),
        sample_floor_met=n>=30 and nd>=5 and ns>=10,
        peak_high_pct={**stats("peak"),"above_entry_count":sum(v["peak"]>0 for v in vals),"above_entry_pct":round(100*sum(v["peak"]>0 for v in vals)/n,2) if n else None},
        target_high_reach=targets,trough_low_pct=stats("trough"),
        first_peak_observation=stats("peak_day"),
        peak_to_end_giveback_pp=stats("giveback"),
        terminal_close_pct={**stats("close"),"positive_count":sum(v["close"]>0 for v in vals),"positive_pct":round(100*sum(v["close"]>0 for v in vals)/n,2) if n else None})
def study(src,bench,tom):
    days,meta,bars,indexes,states,old=indexed(src,bench)
    check(tom.get("schema")=="BLUE_TOMATO_CONTEXT_SOURCE_V1" and tom["cutoff"]==src["cutoff"] and tom["floor"]==8 and tom["threshold"]==70,"TOMATO_SOURCE_REQUIRED")
    counts=Counter();groups=defaultdict(list);pooled=defaultdict(list);exit_groups=defaultdict(list);seen=set();dates=[]
    for a in tom["days"]:
        d=a["day"];check(d in meta and d not in seen,"BAD_TOMATO_DAY");seen.add(d)
        dates.append(dict(day=d,status=a["status"],records=len(a["rows"])))
        if a["status"]!="ORIGINAL_SIGNAL_PAYLOAD_HASH_MATCH":
            check(not a["rows"],"BAD_UNVERIFIED_ROWS");continue
        cohort="LATEST_UNFROZEN_CANDIDATE" if d==days[-1] else "RETROSPECTIVE"
        keys=set()
        for r in a["rows"]:
            c=r["code"];scope=r["market"];b=bars.get((d,c))
            check(b and b["market"]==scope and c not in keys and (d,c) in old,"BAD_TOMATO_ROW");keys.add(c)
            s=r["selection"];status=s["status"];counts[cohort,status]+=1
            if status not in ("TOMATO","BELOW_THRESHOLD"):continue
            ds=indexes[scope]
            if d not in ds:counts[cohort,"INDEX_DATE_MISSING"]+=1;continue
            p=ds.index(d);state,trend=states[scope,d];past=ds[:p+1]
            h7=history(past,bars,c,scope,7);h11=history(past,bars,c,scope,11);h21=history(past,bars,c,scope,21)
            context={"CANDLE":candle(b),"PRIOR_STOCK_DIRECTION":direction(h7[0]["close"],h7[-2]["close"]) if h7 else "UNKNOWN","BOX_STATE":structure(h11) if h11 else "UNKNOWN","STORED_MA_ARRAY":r["stored_ma_arrangement"]}
            context["AMOUNT_20_AUDITED"]="UNKNOWN" if h21 is None else "SURGE_1_5" if 40*b["amount"]>=3*sum(x["amount"] for x in h21[:-1]) else "BELOW_1_5"
            if h21:
                ma=sum(x["close"] for x in h21[-20:])/20
                context["MA20_POSITION"]="ABOVE" if b["close"]>ma else "BELOW" if b["close"]<ma else "EQUAL"
            else:context["MA20_POSITION"]="UNKNOWN"
            candidates=technical_candidates(past,bars,c,scope)
            # All candidates include baseline; evaluate positive/negative cases, no ranking.
            for horizon in (1,3,5,10,20):
                wanted=ds[p+1:p+horizon+1];ret=None;exit_case=None
                if cohort=="LATEST_UNFROZEN_CANDIDATE" or len(wanted)<horizon:out="PENDING"
                else:
                    path=[bars.get((x,c)) for x in wanted]
                    if any(x is None or x["market"]!=scope for x in path):out="MISSING_PATH"
                    else:
                        out="OBSERVED";ret=outcome(path,candidates)
                        if horizon in (1,3,5,10,20):exit_case=scaleout.case(path,candidates,stop_at_entry)
                if horizon in (1,3,5,10,20):
                    # Exact setup and first stored factor are separate views, not independent evidence.
                    for kind,value in (("ALL","ALL"),("EXACT_SETUP",s["setup"]),("FIRST_STORED_FACTOR",s["setup"].split("+")[0])):
                        exit_groups[cohort,status,horizon,kind,value].append((d,c,exit_case,out))
                    exit_groups[cohort,status,horizon,"FIRST_FACTOR_MARKET_STATE",s["setup"].split("+")[0]+"|"+state].append((d,c,exit_case,out))
                event=(d,c,ret,out)
                # One event per selected symbol/date/horizon.
                pooled[cohort,status,horizon].append(event)
                for f,v in [("BASELINE","ALL"),*context.items()]:
                    groups[cohort,scope,state,s["setup"],status,horizon,f,v].append(event)
    rows=[dict(cohort=g,market=m,market_state=s,setup=p,tomato_status=t,horizon=h,context=f,value=v,**summarize_opportunity(es)) for (g,m,s,p,t,h,f,v),es in sorted(groups.items())]
    return dict(schema="BLUE_TOMATO_CONTEXT_PILOT_V6",scaleout_basis="Gross hypothetical matched full-path scenarios, 1/3/5/10/20 observations. Initial technical stop ATR1.5, signal low or confirmed swing low separately, ATR14 required for all policies in each comparison. Preserve V5 risk-unit targets; V6 adds full +2/+3/+4/+5/+7%, 70% at +3% then 30% at +5%, 50% at +3% then ATR trail. All percent targets from entry, independent of stop. Fixed original-position fractions. Compare paired against FULL_3P and FULL_5P. Aggregate positive-peak capture is ratio of sums, legacy individual ratio diagnostic retained. After first partial, breakeven or lagged high minus 2ATR applies next observation only; ATR trail never below entry. Opening gaps known; intraday dual touch stop-first and flagged. Targets at limit, stops at level or adverse opening gap, remainder at final close. No execution proof, costs, tick/lot rounding, independence, selection or ranking. First stored factor is not a validated pattern family.",scaleout_rows=[dict(cohort=g,tomato_status=t,horizon=h,group=k,value=v,initial_stop=m,**scaleout.summarize(es,m)) for (g,t,h,k,v),es in sorted(exit_groups.items()) for m in scaleout.METHODS],pooled_rows=[dict(cohort=g,tomato_status=t,horizon=h,**summarize_opportunity(es)) for (g,t,h),es in sorted(pooled.items())],first_touch_basis="Exploratory +3/+5/+10 targets vs technical price levels. ATR14 simple mean true range through signal close, entry minus 1.5/2 ATR. Other levels fixed at signal close: signal low, latest strict 2-left/2-right pivot in 11-bar window, qualified prior box low, MA20 below signal close. Missing levels and entries at/below stop excluded with reasons. First daily OPEN crossing resolves gap direction; otherwise same-day dual touch UNKNOWN. Bounds over available full-window cases only; denominators differ. Peak R is unconstrained and not realized. Lower volume profile not verified; never substitute overhead. No fills, tick rounding, fees, or ranking.",status="EXPLORATORY_NO_PROMOTION",asof=days[-1],days=dates,selection_counts=[dict(cohort=g,status=s,rows=n) for (g,s),n in sorted(counts.items())],rows=rows,limits=["FIXED_RESEARCH_FLOOR_8_THRESHOLD_70_NOT_USER_UI_SETTING","SAVED_SELECTED_TOP12_ONLY_NOT_ALL_ATTEMPTED_COMBINATIONS","RETROSPECTIVE_NOT_FORWARD_CAPTURE","LATEST_UNFROZEN_CANDIDATE_NOT_PERSISTED","AT_MOST_3_MATURE_DATES_PLUS_LATEST","NO_FULL_UNIVERSE_NEGATIVE_CONTROL_FOR_ABSENT_SIGNAL_ROWS","STORED_MA_NOT_INDEPENDENTLY_RECALCULATED","NO_INDEPENDENT_CALENDAR_OR_CORPORATE_ACTION_PROOF","NO_COSTS_OR_EXECUTION","NO_AUTOMATIC_HIGHLIGHT_OR_STRATEGY_CHANGE"],return_basis="PRIMARY: highest daily HIGH within full N subsequent index observations / first OPEN - 1. Lowest LOW and Nth CLOSE separately; latest candidate never scored.", target_basis="High reaches 3/5/10/15/20% above first OPEN, exact integer comparison. Full window required; prior full sessions adverse low excludes hit day; intraday order and fills unknown.", selection_basis="Existing saved tomato selection unchanged: historical tenth CLOSE based up rate, fixed floor 8 and threshold 70. V4 evaluates this same cohort by HIGH; not a new high-selected tomato definition.", giveback_basis="Peak HIGH minus terminal CLOSE in percentage points of entry; not realized profit or maximum drawdown.")
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--out",type=Path,required=True);a=p.parse_args()
    read=lambda x:json.loads(Path(x).read_text())
    r=study(read("output/full-universe/source.json"),read("output/full-universe/benchmark.json"),read("output/tomato/source.json"))
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n")
    print("BLUE_TOMATO_CONTEXT",json.dumps({k:r[k] for k in ("asof","days","selection_counts")}))

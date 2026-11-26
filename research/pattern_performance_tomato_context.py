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
TARGETS=(3,5,10,15,20)
def outcome(path):
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
    return dict(peak=pct(peak),trough=pct(trough),close=pct(close),peak_day=peak_i,giveback=Fraction(100*(peak-close),entry),targets=targets)
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
    return dict(events=len(events),sample_count=n,signal_dates=nd,symbols=ns,
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
    counts=Counter();groups=defaultdict(list);seen=set();dates=[]
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
            # All candidates include baseline; evaluate positive/negative cases, no ranking.
            for horizon in (1,3,5,10,20):
                wanted=ds[p+1:p+horizon+1];ret=None
                if cohort=="LATEST_UNFROZEN_CANDIDATE" or len(wanted)<horizon:out="PENDING"
                else:
                    path=[bars.get((x,c)) for x in wanted]
                    if any(x is None or x["market"]!=scope for x in path):out="MISSING_PATH"
                    else:out="OBSERVED";ret=outcome(path)
                event=(d,c,ret,out)
                for f,v in [("BASELINE","ALL"),*context.items()]:
                    groups[cohort,scope,state,s["setup"],status,horizon,f,v].append(event)
    rows=[dict(cohort=g,market=m,market_state=s,setup=p,tomato_status=t,horizon=h,context=f,value=v,**summarize_opportunity(es)) for (g,m,s,p,t,h,f,v),es in sorted(groups.items())]
    return dict(schema="BLUE_TOMATO_CONTEXT_PILOT_V2",status="EXPLORATORY_NO_PROMOTION",asof=days[-1],days=dates,selection_counts=[dict(cohort=g,status=s,rows=n) for (g,s),n in sorted(counts.items())],rows=rows,limits=["FIXED_RESEARCH_FLOOR_8_THRESHOLD_70_NOT_USER_UI_SETTING","SAVED_SELECTED_TOP12_ONLY_NOT_ALL_ATTEMPTED_COMBINATIONS","RETROSPECTIVE_NOT_FORWARD_CAPTURE","LATEST_UNFROZEN_CANDIDATE_NOT_PERSISTED","AT_MOST_3_MATURE_DATES_PLUS_LATEST","NO_FULL_UNIVERSE_NEGATIVE_CONTROL_FOR_ABSENT_SIGNAL_ROWS","STORED_MA_NOT_INDEPENDENTLY_RECALCULATED","NO_INDEPENDENT_CALENDAR_OR_CORPORATE_ACTION_PROOF","NO_COSTS_OR_EXECUTION","NO_AUTOMATIC_HIGHLIGHT_OR_STRATEGY_CHANGE"],return_basis="PRIMARY: highest daily HIGH within full N subsequent index observations / first OPEN - 1. Lowest LOW and Nth CLOSE separately; latest candidate never scored.", target_basis="High reaches 3/5/10/15/20% above first OPEN, exact integer comparison. Full window required; prior full sessions adverse low excludes hit day; intraday order and fills unknown.", selection_basis="Existing saved tomato selection unchanged: historical tenth CLOSE based up rate, fixed floor 8 and threshold 70. V2 evaluates this same cohort by HIGH; not a new high-selected tomato definition.", giveback_basis="Peak HIGH minus terminal CLOSE in percentage points of entry; not realized profit or maximum drawdown.")
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--out",type=Path,required=True);a=p.parse_args()
    read=lambda x:json.loads(Path(x).read_text())
    r=study(read("output/full-universe/source.json"),read("output/full-universe/benchmark.json"),read("output/tomato/source.json"))
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n")
    print("BLUE_TOMATO_CONTEXT",json.dumps({k:r[k] for k in ("asof","days","selection_counts")}))

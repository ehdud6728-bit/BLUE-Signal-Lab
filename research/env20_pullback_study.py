"""ENV20 lower touch + stored MA20<MA40<MA60: pullback timing, exploratory.
No ranking/promotion. Common signal-relative horizon, missed trades included."""
import argparse,json,re
from collections import Counter,defaultdict
from fractions import Fraction as F
from statistics import median
from pathlib import Path
from pattern_performance_forward import indexed,history
from pattern_performance_full_universe import check
from env20_pullback_context import categories
DEPTHS=(1,2,3,5,7)
HORIZONS=(5,10,20)
TARGETS=(3,5)
STOPS=("SIGNAL_LOW","ATR14_SMA_1_5")
COST=F(3,10) # hypothetical round-trip percentage points, not actual broker fee
POLICIES=[("IMMEDIATE",0,0)]+[(mode,depth,wait) for mode in ("LIMIT","CONFIRM") for wait in (3,5) for depth in DEPTHS]
def rnd(x):return round(float(x),4)
def avg(xs):return rnd(sum(xs)/len(xs)) if xs else None
def entry_choice(path,signal_close,policy):
    mode,depth,wait=policy
    if mode=="IMMEDIATE":return (0,F(path[0]["open"]),True)
    limit=F(signal_close)*(100-depth)/100
    if mode=="LIMIT":
        for i,b in enumerate(path[:wait]):
            if b["open"]<=limit:return (i,F(b["open"]),True)
            if b["low"]<=limit:return (i,limit,False)
    else:
        # Confirmation: price touched depth (today or earlier in wait window),
        # bullish close at/above limit; enter strictly next session OPEN.
        touched=False
        for i,b in enumerate(path[:wait]):
            touched=touched or b["low"]<=limit
            if touched and b["close"]>b["open"] and b["close"]>=limit:
                return (i+1,F(path[i+1]["open"]),True) if i+1<len(path) else None
    return None
def simulate(path,signal_close,signal_low,atr,policy,method,target):
    e=entry_choice(path,signal_close,policy)
    if e is None:return dict(status="NO_ENTRY",ret=None)
    i,entry,opening=e
    stop=F(signal_low) if method=="SIGNAL_LOW" else entry-F(3,2)*atr if atr is not None else None
    if stop is None or not 0<stop<entry or method=="SIGNAL_LOW" and signal_low>=signal_close:
        return dict(status="STOP_UNAVAILABLE_OR_ENTRY_BELOW_STOP",ret=None)
    tp=entry*(100+target)/100
    for j in range(i,len(path)):
        b=path[j];op,hi,lo,cl=map(F,(b["open"],b["high"],b["low"],b["close"]))
        if j==i and not opening:
            # Intraday entry on low-touch: high may precede fill. Only close
            # at/above target proves post-entry target unless stop occurred.
            if lo<=stop:price,reason,amb=stop,"STOP_TOUCH",hi>=tp
            elif cl>=tp:price,reason,amb=tp,"TARGET",False
            else:continue
        elif op<=stop:price,reason,amb=op,"STOP_GAP",False
        elif op>=tp:price,reason,amb=tp,"TARGET",False
        elif lo<=stop:price,reason,amb=stop,"STOP_TOUCH",hi>=tp
        elif hi>=tp:price,reason,amb=tp,"TARGET",False
        else:continue
        return dict(status="TRADE",ret=100*(price/entry-1),reason=reason,ambiguous=amb,entry_day=i+1,exit_day=j+1,discount=100*(1-entry/signal_close),risk=100*(1-stop/entry))
    return dict(status="TRADE",ret=100*(F(path[-1]["close"])/entry-1),reason="TIME_CLOSE",ambiguous=False,entry_day=i+1,exit_day=len(path),discount=100*(1-entry/signal_close),risk=100*(1-stop/entry))
def summary(events):
    n=len(events);trades=[(d,c,v) for d,c,v in events if v["status"]=="TRADE"];rs=[v["ret"] for _,_,v in trades];net=[r-COST for r in rs];m=len(rs)
    def pf(vals):
        loss=-sum(x for x in vals if x<0);return rnd(sum(x for x in vals if x>0)/loss) if loss else None
    counts=Counter(v["status"] for _,_,v in events)
    dates=len({d for d,c,v in trades});stocks=len({c for d,c,v in trades})
    return dict(signals=n,filled=m,fill_pct=rnd(100*F(m,n)) if n else None,status_counts=dict(counts),
        signal_dates=len({d for d,c,v in events}),filled_dates=dates,filled_symbols=stocks,
        sample_floor_met=m>=30 and dates>=5 and stocks>=10,
        trade_mean_pct=avg(rs),trade_median_pct=rnd(median(rs)) if m else None,
        net_trade_mean_pct=avg(net),net_trade_median_pct=rnd(median(net)) if m else None,
        net_positive_pct=rnd(100*F(sum(r>0 for r in net),m)) if m else None,net_profit_factor=pf(net),
        gross_per_signal_pct=rnd(sum(rs)/n) if n else None,net_per_signal_pct=rnd(sum(net)/n) if n else None,
        net_tail5_mean_pct=avg(sorted(net)[:max(1,(m+19)//20)]) if m else None,
        mean_entry_day=avg([v["entry_day"] for _,_,v in trades]),mean_entry_discount_pct=avg([v["discount"] for _,_,v in trades]),
        mean_initial_risk_pct=avg([v["risk"] for _,_,v in trades]),exit_counts=dict(Counter(v["reason"] for _,_,v in trades)),
        ambiguous_count=sum(v["ambiguous"] for _,_,v in trades))
def study(src,bench,factors):
    days,meta,bars,indexes,states,old=indexed(src,bench)
    check(factors["schema"]=="BLUE_ENV20_PULLBACK_FACTORS_V1" and factors["cutoff"]==src["cutoff"],"BAD_FACTOR_SOURCE")
    wanted={k for k,v in old.items() if "ENV20_LOWER_TOUCH" in v}
    lookup={}
    for x in factors["rows"]:
        k=x["day"],x["code"];check(k in wanted and k not in lookup and re.fullmatch(r"[a-f0-9]{64}",x["record_sha256"]),"BAD_FACTOR_ROW");lookup[k]=x
    check(set(lookup)==wanted,"FACTOR_COUNT_MISMATCH")
    split=days[len(days)*7//10];groups=defaultdict(list);coverage=Counter();cohort_counts=Counter();context_counts=Counter()
    for (d,c),x in sorted(lookup.items()):
        b=bars[d,c];scope=b["market"];ds=indexes[scope]
        if x["ma_down"] is True and x["ma_chart_consistent"] is True:cohort="INVERSE_CHART_MATCH"
        elif x["ma_down"] is True:cohort="INVERSE_STORED_ONLY"
        elif x["ma_down"] is False and x["ma_chart_consistent"] is True:cohort="OTHER_MA_CHART_MATCH"
        else:cohort="MA_UNAVAILABLE_OR_OTHER"
        cohort_counts[cohort]+=1
        if cohort not in ("INVERSE_CHART_MATCH","INVERSE_STORED_ONLY","OTHER_MA_CHART_MATCH"):continue
        if d not in ds:coverage[cohort,"SIGNAL_DATE_UNALIGNED"]+=1;continue
        i=ds.index(d);state=states[scope,d][0]
        hist=history(ds[:i+1],bars,c,scope,15)
        # Require the complete audited history interval for ATR.
        if hist and [q for q in days if ds[i-14]<=q<=d]==ds[i-14:i+1]:
            atr=F(sum(max(z["high"]-z["low"],abs(z["high"]-y["close"]),abs(z["low"]-y["close"])) for y,z in zip(hist,hist[1:])),14)
            if atr<=0:atr=None
        else:atr=None
        context_keys=["ALL",state]
        if cohort=="INVERSE_CHART_MATCH":
            prior=history(ds[:i+1],bars,c,scope,25)
            if prior and [q for q in days if ds[i-24]<=q<=d]!=ds[i-24:i+1]:prior=None
            for feature,value in categories(b,x,prior,atr).items():
                context_counts[feature,value]+=1
                if value!="UNKNOWN":context_keys.append(feature+":"+value)
        for h in HORIZONS:
            seq=ds[i+1:i+1+h]
            if len(seq)<h:coverage[cohort,str(h),"PENDING"]+=1;continue
            if [q for q in days if d<q<=seq[-1]]!=seq:coverage[cohort,str(h),"DATE_WINDOW_MISSING"]+=1;continue
            path=[bars.get((q,c)) for q in seq]
            if any(v is None or v["market"]!=scope for v in path):coverage[cohort,str(h),"MISSING_PATH"]+=1;continue
            if any(abs(F(z["open"],y["close"])-1)>=F(2,5) for y,z in zip([b]+path,path)):
                coverage[cohort,str(h),"DISCONTINUITY_REVIEW"]+=1;continue
            # Purge train windows crossing split. No reuse of future data for selection.
            phase="TRAIN" if seq[-1]<split else "HOLDOUT" if d>=split else "EMBARGO"
            coverage[cohort,str(h),phase]+=1
            for method in STOPS:
                if method=="ATR14_SMA_1_5" and atr is None:coverage[cohort,str(h),"ATR_UNAVAILABLE"]+=1;continue
                for t in TARGETS:
                    for p in POLICIES:
                        v=simulate(path,b["close"],b["low"],atr,p,method,t)
                        for split_name in (["ALL",phase] if phase!="EMBARGO" else ["ALL"]):
                            for context in context_keys:
                                groups[cohort,split_name,context,h,method,t,*p].append((d,c,v))
    rows=[]
    for key,events in sorted(groups.items()):
        cohort,phase,context,h,method,t,mode,depth,wait=key
        base=groups[cohort,phase,context,h,method,t,"IMMEDIATE",0,0]
        check([(d,c) for d,c,v in events]==[(d,c) for d,c,v in base],"UNMATCHED_COMPARISON")
        def value(v):return v["ret"]-COST if v["status"]=="TRADE" else F(0)
        out=summary(events)
        out["paired_net_per_signal_delta_pp"]=avg([value(v)-value(b) for (_,_,v),(_,_,b) in zip(events,base)])
        # Missed immediate wins are explicitly counted; no-entry cash = 0.
        out["no_entry_missed_positive_immediate"]=sum(v["status"]=="NO_ENTRY" and b["status"]=="TRADE" and value(b)>0 for (_,_,v),(_,_,b) in zip(events,base))
        feature,value=context.split(":",1) if ":" in context else ("MARKET_STATE",context)
        rows.append(dict(cohort=cohort,phase=phase,market_state=context if feature=="MARKET_STATE" else "ALL",context_feature=feature,context_value=value,horizon=h,stop=method,target=t,entry=mode,depth_pct=depth,wait_days=wait,**out))
    return dict(schema="BLUE_ENV20_PULLBACK_STUDY_V2",context_counts=[dict(feature=f,value=v,count=n) for (f,v),n in sorted(context_counts.items())],asof=days[-1],source_days=len(days),signal_audit_days=sum(x["signal_status"]=="COUNT_AND_PAYLOAD_HASH_METADATA_MATCH" for x in meta.values()),split_day=split,cohorts=dict(cohort_counts),coverage=[dict(key=k,count=v) for k,v in sorted(coverage.items())],rows=rows,
        assumed_roundtrip_cost_pct=float(COST),limits=["STORED_SIGNAL_AND_MA_CHART_INTERNAL_CHECK_NOT_INDEPENDENT_MA_PROOF","EXACT_ALIGNED_AUDITED_PATHS_ONLY","FIXED_SIGNAL_RELATIVE_EXIT_HORIZON","NO_ENTRY_ZERO_CASH_NOT_TRADE_WIN","INTRADAY_LIMIT_FILL_HYPOTHETICAL_NO_QUEUE_OR_TICK","STOP_FIRST_AMBIGUITY","RAW_PRICES_CORPORATE_ACTIONS_UNVERIFIED","NO_PROMOTION","DEPENDENT_EVENTS_MULTIPLE_COMPARISONS","STORED_SUPPLY_ESTIMATE_NOT_INDEPENDENTLY_RECOMPUTED","UNKNOWN_CONTEXT_EXCLUDED_FROM_STRATA","CONTEXT_STRATA_NOT_MARKET_MATCHED"])
def main():
    p=argparse.ArgumentParser()
    for k in ("source","benchmark","factors","out"):p.add_argument("--"+k,type=Path,required=True)
    a=p.parse_args();read=lambda x:json.loads(x.read_text())
    r=study(read(a.source),read(a.benchmark),read(a.factors))
    a.out.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n")
    print("BLUE_ENV20_PULLBACK",json.dumps({k:r[k] for k in ("asof","source_days","signal_audit_days","split_day","cohorts","coverage")}))
    print("BLUE_ENV20_PULLBACK_SUMMARY",json.dumps([x for x in r["rows"] if x["cohort"]=="INVERSE_CHART_MATCH" and x["phase"]=="ALL" and x["context_feature"]=="MARKET_STATE" and x["market_state"]=="ALL" and x["horizon"]==10 and x["stop"]=="SIGNAL_LOW" and x["target"]==3 and x["wait_days"] in (0,3)],ensure_ascii=False))
if __name__=="__main__":main()

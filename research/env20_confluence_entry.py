"""V4: candle-conditioned entry and cross-family support confluence.
Primary outcome remains V3 HIGH opportunity, never terminal close return.
Rules chosen after V3, so historical splits are exploratory, not fresh OOS."""
import argparse,json,re
from collections import Counter,defaultdict
from fractions import Fraction as F
from pathlib import Path
from env20_structural_entry import levels,choose,opportunity,summarize,HORIZONS,WAIT
from env20_pullback_context import categories
from pattern_performance_forward import indexed,history
from pattern_performance_full_universe import check

# Related anchors are one family, not independent confirmations.
FAMILIES={"SIGNAL_LOW":"CANDLE","BULL_BODY_MID":"CANDLE","BULL_OPEN":"CANDLE",
 "PRIOR5_LOW":"PIVOT","PRIOR10_LOW":"PIVOT","CONFIRMED_SWING_LOW_10":"PIVOT","PRIOR_BOX_LOW":"PIVOT",
 "MA5":"MA","MA10":"MA","MA20":"MA","MA20_X_0_8":"MA"}
RULES=("IMMEDIATE","CANDLE_RULE","BODY_OR_OPEN_LIMIT","SIGNAL_LOW_LIMIT","PRIOR_LOW_LIMIT","ENV_LIMIT",
 "NEAREST_LIMIT","CONFLUENCE_LIMIT","CONFLUENCE_RECLAIM","CANDLE_RULE_NO_TRADE_BEAR")
def support_levels(b,h):
    lv=levels(b,h)
    lv["BULL_OPEN"]=(F(b["open"]),"READY") if b["open"]<b["close"] else (None,"NOT_BULL")
    return lv
def ready(lv):
    return {k:v for k,(v,s) in lv.items() if s=="READY"}
def cluster(lv,atr):
    """Fixed max cluster span <= 0.25 ATR14. No transitive chaining.
    At least two distinct families. Use actual highest anchor, not invented mean.
    Tie-break nearest to signal close, then family count, then lexical order."""
    if atr is None or atr<=0:return None
    pts=sorted(ready(lv).items(),key=lambda x:(x[1],x[0]))
    options=[]
    for i,(name,p) in enumerate(pts):
        group=[(k,v) for k,v in pts[i:] if v-p<=atr/4]
        families={FAMILIES[k] for k,v in group}
        if len(families)>=2:
            options.append((max(v for k,v in group),len(families),tuple(sorted(k for k,v in group)),min(v for k,v in group)))
    if not options:return None
    top,n,names,bottom=max(options)
    return dict(price=top,bottom=bottom,families=n,names=names)
def first(lv,names):
    return next(((k,lv[k][0]) for k in names if lv[k][1]=="READY"),None)
def rule_choice(rule,shape,lv,zone):
    def at(names,mode="LIMIT"):
        x=first(lv,names)
        return (mode,x[1],x[0]) if x else ("UNAVAILABLE",None,None)
    if rule=="IMMEDIATE":return "IMMEDIATE",None,None
    if rule=="BODY_OR_OPEN_LIMIT":return at(("BULL_BODY_MID","BULL_OPEN"))
    if rule=="SIGNAL_LOW_LIMIT":return at(("SIGNAL_LOW",))
    if rule=="PRIOR_LOW_LIMIT":return at(("CONFIRMED_SWING_LOW_10","PRIOR5_LOW","PRIOR10_LOW"))
    if rule=="ENV_LIMIT":return at(("MA20_X_0_8",))
    if rule=="NEAREST_LIMIT":
        r=ready(lv)
        if not r:return "UNAVAILABLE",None,None
        k=max(r,key=lambda k:(r[k],k));return "LIMIT",r[k],k
    if rule.startswith("CONFLUENCE"):
        return ("RECLAIM" if rule.endswith("RECLAIM") else "LIMIT",zone["price"],"CONFLUENCE") if zone else ("UNAVAILABLE",None,None)
    if rule in ("CANDLE_RULE","CANDLE_RULE_NO_TRADE_BEAR"):
        if shape=="BULL":return "IMMEDIATE",None,None
        if shape=="LONG_BULL":return at(("BULL_BODY_MID","BULL_OPEN"))
        if shape=="DOJI":return at(("SIGNAL_LOW","CONFIRMED_SWING_LOW_10"),"RECLAIM")
        if shape in ("BEAR","LONG_BEAR"):
            if rule=="CANDLE_RULE_NO_TRADE_BEAR":return "SKIP",None,None
            return at(("MA20_X_0_8","CONFIRMED_SWING_LOW_10","PRIOR5_LOW"),"RECLAIM" if shape=="LONG_BEAR" else "LIMIT")
        return "SKIP",None,None
    raise ValueError("UNKNOWN_RULE")
def before_target(path,e,h,basis,o):
    """Conservative adverse path before confirmed +5%: full preceding
    sessions plus target-day low as worst-order bound (not exact sequence)."""
    i,p,opening=e
    a=path[i:h if basis=="SIGNAL_WINDOW" else i+h]
    t=o["targets"][5][0]
    if t is None:return None
    low=min([p]+[F(b["low"]) for b in a[:t]])
    return 100*(low/p-1)
def stat(v):
    from statistics import median
    return {"mean":round(float(sum(v)/len(v)),4),"median":round(float(median(v)),4)} if v else {"mean":None,"median":None}
def summarize_rules(events):
    # All complete signals included in denominators; no-entry and missing
    # technical level distinct. No entry is no opportunity, not a losing trade.
    n=len(events);entered=[x for x in events if x[4] is not None]
    # V3 summary requires level discounts for all, so give it neutral temporary
    # placeholders then replace with statistics from actual defined levels.
    safe=[(d,c,discount if discount is not None else F(0),status,o,base) for d,c,discount,status,o,base,*_ in events]
    result=summarize(safe)
    result["level_discount_pct"]=stat([x[2] for x in events if x[2] is not None])
    result["level_defined_count"]=sum(x[2] is not None for x in events)
    result["selected_anchors"]=dict(Counter(x[6] for x in events if x[6] is not None))
    result["target5_worst_order_adverse_pct"]=stat([x[7] for x in entered if x[7] is not None])
    # No-entry contributes zero ONLY to opportunity hits; never assign an
    # invented return to skipped trades.
    result["target5_with_adverse_ge_5pct_count"]=sum(x[7] is not None and x[7]<=-5 for x in entered)
    result["target5_delta_pp"]=round(result["target_reach"]["5"]["confirmed_pct_of_eligible_signals"]-result["target_reach"]["5"]["immediate_pct_of_same_signals"],3) if n else None
    return result
def study(src,bench,factors):
    days,meta,bars,indexes,states,old=indexed(src,bench)
    check(factors["schema"]=="BLUE_ENV20_PULLBACK_FACTORS_V1" and factors["cutoff"]==src["cutoff"],"BAD_FACTOR_SOURCE")
    wanted={k for k,v in old.items() if "ENV20_LOWER_TOUCH" in v};lookup={}
    for x in factors["rows"]:
        k=x["day"],x["code"];check(k in wanted and k not in lookup and re.fullmatch(r"[a-f0-9]{64}",x["record_sha256"]),"BAD_FACTOR_ROW");lookup[k]=x
    check(set(lookup)==wanted,"FACTOR_COUNT_MISMATCH")
    split=days[len(days)*7//10];groups=defaultdict(list);coverage=Counter();zones=Counter();cohort=0
    for (d,c),x in sorted(lookup.items()):
        if x["ma_down"] is not True or x["ma_chart_consistent"] is not True:continue
        cohort+=1;b=bars[d,c];market=b["market"];ds=indexes[market]
        if d not in ds:coverage["SIGNAL_DATE_UNALIGNED"]+=1;continue
        i=ds.index(d)
        def hist(n):
            a=history(ds[:i+1],bars,c,market,n)
            return a if a and [q for q in days if ds[i-n+1]<=q<=d]==ds[i-n+1:i+1] else None
        a=hist(15)
        atr=F(sum(max(z["high"]-z["low"],abs(z["high"]-y["close"]),abs(z["low"]-y["close"])) for y,z in zip(a,a[1:])),14) if a else None
        if atr==0:atr=None
        lv=support_levels(b,hist);cat=categories(b,x,hist(25),atr);shape=cat["CANDLE"];zone=cluster(lv,atr)
        # Require all history used by fixed level families before claiming
        # absence of confluence. A confirmed cluster on partial history exists,
        # but cannot be ranked as the nearest possible cluster.
        complete=hist(20) is not None and atr is not None
        zstate="UNKNOWN_HISTORY" if not complete else "CLUSTER_"+str(zone["families"]) if zone else "NO_CLUSTER"
        if not complete:zone=None
        zones[zstate]+=1
        context=[("ALL","ALL"),("CANDLE",shape),("CONFLUENCE",zstate),("MARKET_STATE",states[market,d][0])]
        for k in ("SUPPLY_DISTANCE","MA20_SLOPE_5","MA20_60_GAP","TURNOVER_20","ATR_PCT"):
            if cat[k]!="UNKNOWN":context.append((k,cat[k]))
        for basis in ("SIGNAL_WINDOW","ENTRY_WINDOW"):
            for h in HORIZONS:
                reserve=h if basis=="SIGNAL_WINDOW" else h+WAIT
                seq=ds[i+1:i+1+reserve]
                def cov(s):coverage[basis,str(h),s]+=1
                if len(seq)!=reserve:cov("PENDING");continue
                if [q for q in days if d<q<=seq[-1]]!=seq:cov("DATE_WINDOW_MISSING");continue
                path=[bars.get((q,c)) for q in seq]
                if any(z is None or z["market"]!=market for z in path):cov("MISSING_PATH");continue
                if any(abs(F(z["open"],y["close"])-1)>=F(2,5) for y,z in zip([b]+path,path)):cov("DISCONTINUITY_REVIEW");continue
                phase="TRAIN" if seq[-1]<split else "HOLDOUT" if d>=split else "EMBARGO";cov(phase)
                base=opportunity(path,(0,F(path[0]["open"]),True),F(b["close"]),b["close"],h,basis)
                for rule in RULES:
                    mode,level,anchor=rule_choice(rule,shape,lv,zone)
                    if rule.startswith("CONFLUENCE") and not complete:mode="UNKNOWN_HISTORY"
                    if mode=="IMMEDIATE":
                        status="ENTERED";e=(0,F(path[0]["open"]),True);o=base
                    elif mode in ("LIMIT","RECLAIM"):
                        status,e=choose(path,level,mode);o=opportunity(path,e,level,b["close"],h,basis) if e is not None else None
                    else:status=mode;e=o=None
                    discount=100*(1-level/F(b["close"])) if level is not None else None
                    adverse=before_target(path,e,h,basis,o) if o is not None else None
                    # immediate/no anchor: support-specific counts are not interpreted.
                    for part in (["ALL",phase] if phase!="EMBARGO" else ["ALL"]):
                        for f,v in context:
                            groups[basis,h,part,f,v,rule].append((d,c,discount,status,o,base,anchor,adverse))
    rows=[]
    for (basis,h,phase,f,v,rule),events in sorted(groups.items()):
        base=groups[basis,h,phase,f,v,"IMMEDIATE"]
        check([(e[0],e[1]) for e in events]==[(e[0],e[1]) for e in base],"UNMATCHED_COMPARISON")
        rows.append(dict(basis=basis,horizon=h,phase=phase,context_feature=f,context_value=v,rule=rule,**summarize_rules(events)))
    return dict(schema="BLUE_ENV20_CONFLUENCE_HIGH_V4",asof=days[-1],source_days=len(days),inverse_chart_match_signals=cohort,split_day=split,wait_sessions=WAIT,
        cluster_counts=dict(zones),coverage=[dict(key=list(k) if isinstance(k,tuple) else [k],count=n) for k,n in sorted(coverage.items(),key=lambda x:str(x[0]))],rows=rows,
        limits=["HIGH_NOT_REALIZED_RETURN","V4_RULES_POST_V3_EXPLORATORY_EVEN_HISTORICAL_HOLDOUT","FIXED_0_25_ATR_CLUSTER_WIDTH_UNVALIDATED","RELATED_ANCHORS_ONE_FAMILY","UNKNOWN_HISTORY_NOT_NO_CLUSTER","ALL_COMPLETE_SIGNALS_DENOMINATOR","NO_LOWER_VOLUME_PROFILE","V3_ENTRY_HIGH_BOUNDS","TARGET_DAY_ADVERSE_WORST_ORDER_NOT_REALIZED","IMMEDIATE_SUPPORT_COUNTS_NOT_APPLICABLE","NO_PROMOTION"])
def main():
    p=argparse.ArgumentParser()
    for k in ("source","benchmark","factors","out"):p.add_argument("--"+k,type=Path,required=True)
    a=p.parse_args();read=lambda p:json.loads(p.read_text())
    r=study(read(a.source),read(a.benchmark),read(a.factors))
    a.out.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n")
    print("BLUE_ENV20_CONFLUENCE_HIGH",json.dumps({k:v for k,v in r.items() if k!="rows"},ensure_ascii=False))
    print("BLUE_ENV20_CONFLUENCE_SUMMARY",json.dumps([dict(rule=x["rule"],eligible=x["eligible_signals"],entered=x["entered"],peak=x["peak_high_lower_pct"],trough=x["trough_low_pct"],target5=x["target_reach"]["5"]["confirmed_pct_of_eligible_signals"],delta=x["target5_delta_pp"],adverse=x["target5_worst_order_adverse_pct"],floor=x["sample_floor_met"]) for x in r["rows"] if x["basis"]=="SIGNAL_WINDOW" and x["horizon"]==5 and x["phase"]=="ALL" and x["context_feature"]=="ALL"],ensure_ascii=False))
if __name__=="__main__":main()

"""Technical pullback opportunity, no exit profit claim. Preserve V2 separately."""
import argparse,json,re
from collections import Counter,defaultdict
from fractions import Fraction as F
from pathlib import Path
from statistics import median
from pattern_performance_forward import indexed,history
from pattern_performance_full_universe import check
from pattern_performance_structure import structure
from env20_pullback_context import categories
HORIZONS=(1,3,5,10,20)
TARGETS=(3,5,10,15,20)
WAIT=5
LEVELS=("SIGNAL_LOW","BULL_BODY_MID","PRIOR5_LOW","PRIOR10_LOW","CONFIRMED_SWING_LOW_10","PRIOR_BOX_LOW","MA5","MA10","MA20","MA20_X_0_8")
def levels(b,h):
    c=b["close"];o=b["open"]
    a=h(11);swing=box=None
    if a:
        for i in range(len(a)-3,1,-1):
            if all(a[i]["low"]<a[j]["low"] for j in (i-2,i-1,i+1,i+2)):
                swing=F(a[i]["low"]);break
        if structure(a) in ("PRIOR_RISE_IN_BOX","PRIOR_RISE_BREAKOUT","OTHER_PRIOR_IN_BOX","OTHER_PRIOR_BREAKOUT"):
            box=F(min(x["low"] for x in a[5:10]))
    out={"SIGNAL_LOW":F(b["low"]),"BULL_BODY_MID":F(o+c,2) if c>o else None,
         "CONFIRMED_SWING_LOW_10":swing,"PRIOR_BOX_LOW":box}
    for n in (5,10):
        p=h(n+1);out[f"PRIOR{n}_LOW"]=F(min(x["low"] for x in p[:-1])) if p else None
    for n in (5,10,20):
        p=h(n);out[f"MA{n}"]=F(sum(x["close"] for x in p),n) if p else None
    out["MA20_X_0_8"]=out["MA20"]*F(4,5) if out["MA20"] is not None else None
    return {k:(v,"READY") if v is not None and 0<v<c else (None,"NOT_BELOW_SIGNAL_CLOSE" if v is not None else "HISTORY_OR_STRUCTURE_UNAVAILABLE") for k,v in out.items()}
def choose(path,level,mode):
    if mode=="IMMEDIATE":return "ENTERED",(0,F(path[0]["open"]),True)
    if mode=="LIMIT":
        for i,b in enumerate(path[:WAIT]):
            if b["open"]<=level:return "ENTERED",(i,F(b["open"]),True)
            if b["low"]<=level:return "ENTERED",(i,level,False)
    elif mode=="RECLAIM":
        touched=False
        for i,b in enumerate(path[:WAIT]):
            touched=touched or b["low"]<=level
            if touched and b["close"]>=level and b["close"]>b["open"]:
                if i+1>=len(path):return "CONFIRMATION_TOO_LATE",None
                if path[i+1]["open"]<level:return "RECLAIM_GAP_BELOW_LEVEL",None
                return "ENTERED",(i+1,F(path[i+1]["open"]),True)
    return "NO_ENTRY",None
def opportunity(path,entry,level,signal_close,h,basis):
    i,p,opening=entry
    end=h if basis=="SIGNAL_WINDOW" else i+h
    a=path[i:end]
    check(bool(a) and (basis=="SIGNAL_WINDOW" or len(a)==h),"INCOMPLETE_ENTRY_PATH")
    hi=[F(b["high"]) for b in a]
    confirmed=hi.copy()
    if not opening:confirmed[0]=max(p,F(a[0]["close"]))
    lo=min([p]+[F(b["low"]) for b in a])
    high_lo=max(confirmed);high_hi=max(hi)
    pct=lambda v:100*(v/p-1)
    peak=confirmed.index(high_lo)
    return dict(peak_lower=pct(high_lo),peak_upper=pct(high_hi),trough=pct(lo),
        peak_day=peak+1,possible_peak_day=hi.index(high_hi)+1,
        prior_peak_adverse=pct(min([p]+[F(b["low"]) for b in a[:peak]])),
        entry_day=i+1,entry_discount=100*(1-p/F(signal_close)),level_discount=100*(1-level/F(signal_close)),
        entry_below_level=p<level,ambiguous=not opening and high_hi>high_lo,
        closes_below_level=any(F(b["close"])<level for b in a),
        targets={t:(next((j+1 for j,v in enumerate(confirmed) if pct(v)>=t),None),
                    next((j+1 for j,v in enumerate(hi) if pct(v)>=t),None)) for t in TARGETS})
def summarize(events):
    # Each event: day, code, level discount, status, opportunity, matched immediate
    n=len(events);entered=[e for e in events if e[4] is not None];m=len(entered)
    def avg(a):return round(float(sum(a)/len(a)),4) if a else None
    def med(a):return round(float(median(a)),4) if a else None
    def rate(k,d):return round(100*k/d,3) if d else None
    def stat(k):
        a=[e[4][k] for e in entered];return dict(mean=avg(a),median=med(a))
    d=len({e[0] for e in entered});s=len({e[1] for e in entered})
    targets={}
    for t in TARGETS:
        lower=[e[4]["targets"][t][0] for e in entered if e[4]["targets"][t][0] is not None]
        upper=sum(e[4]["targets"][t][1] is not None for e in entered)
        baseline=sum(e[5]["targets"][t][0] is not None for e in events)
        missed=sum(e[4] is None and e[5]["targets"][t][0] is not None for e in events)
        targets[str(t)]=dict(confirmed_hits=len(lower),possible_hits=upper,confirmed_pct_of_entries=rate(len(lower),m),possible_pct_of_entries=rate(upper,m),
            confirmed_pct_of_eligible_signals=rate(len(lower),n),possible_pct_of_eligible_signals=rate(upper,n),
            immediate_pct_of_same_signals=rate(baseline,n),missed_immediate_target_due_to_no_entry=missed,mean_confirmed_first_day=avg(lower))
    return dict(eligible_signals=n,entered=m,entry_pct=rate(m,n),status_counts=dict(Counter(e[3] for e in events)),
        entered_dates=d,entered_symbols=s,sample_floor_met=m>=30 and d>=5 and s>=10,
        level_discount_pct=dict(mean=avg([e[2] for e in events]),median=med([e[2] for e in events])),
        entry_discount_pct=stat("entry_discount"),entry_day=stat("entry_day"),
        peak_high_lower_pct=stat("peak_lower"),peak_high_upper_pct=stat("peak_upper"),trough_low_pct=stat("trough"),
        first_confirmed_peak_day=stat("peak_day"),first_possible_peak_day=stat("possible_peak_day"),prior_full_days_adverse_before_confirmed_peak_pct=stat("prior_peak_adverse"),
        entry_below_level_count=sum(e[4]["entry_below_level"] for e in entered),close_below_level_count=sum(e[4]["closes_below_level"] for e in entered),
        ambiguous_peak_count=sum(e[4]["ambiguous"] for e in entered),
        immediate_all_peak_mean_pct=avg([e[5]["peak_lower"] for e in events]),
        immediate_same_entered_peak_mean_pct=avg([e[5]["peak_lower"] for e in entered]),
        paired_peak_lower_delta_pp=avg([e[4]["peak_lower"]-e[5]["peak_lower"] for e in entered]),
        paired_peak_upper_delta_pp=avg([e[4]["peak_upper"]-e[5]["peak_lower"] for e in entered]),target_reach=targets)
def study(src,bench,factors):
    days,meta,bars,indexes,states,old=indexed(src,bench)
    check(factors["schema"]=="BLUE_ENV20_PULLBACK_FACTORS_V1" and factors["cutoff"]==src["cutoff"],"BAD_FACTOR_SOURCE")
    lookup={}
    wanted={k for k,v in old.items() if "ENV20_LOWER_TOUCH" in v}
    for x in factors["rows"]:
        k=x["day"],x["code"];check(k in wanted and k not in lookup and re.fullmatch(r"[a-f0-9]{64}",x["record_sha256"]),"BAD_FACTOR_ROW");lookup[k]=x
    check(set(lookup)==wanted,"FACTOR_COUNT_MISMATCH")
    split=days[len(days)*7//10];groups=defaultdict(list);coverage=Counter();level_counts=Counter();cohort=0
    for (d,c),x in sorted(lookup.items()):
        if x["ma_down"] is not True or x["ma_chart_consistent"] is not True:continue
        cohort+=1;b=bars[d,c];market=b["market"];ds=indexes[market]
        if d not in ds:coverage["SIGNAL_DATE_UNALIGNED"]+=1;continue
        i=ds.index(d)
        def hist(n):
            a=history(ds[:i+1],bars,c,market,n)
            return a if a and [q for q in days if ds[i-n+1]<=q<=d]==ds[i-n+1:i+1] else None
        a=hist(15);atr=F(sum(max(z["high"]-z["low"],abs(z["high"]-y["close"]),abs(z["low"]-y["close"])) for y,z in zip(a,a[1:])),14) if a else None
        if atr==0:atr=None
        lv=levels(b,hist);check(set(lv)==set(LEVELS),"BAD_LEVELS")
        for k,(_,status) in lv.items():level_counts[k,status]+=1
        context=[("ALL","ALL"),("MARKET_STATE",states[market,d][0])]
        context.extend((k,v) for k,v in categories(b,x,hist(25),atr).items() if v!="UNKNOWN")
        # Each level has its own availability. Immediate is matched within level,
        # never compare selected trade-only means across different denominators.
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
                phase="TRAIN" if seq[-1]<split else "HOLDOUT" if d>=split else "EMBARGO"
                cov(phase)
                for name,(level,st) in lv.items():
                    if st!="READY":continue
                    discount=100*(1-level/F(b["close"]))
                    base=opportunity(path,(0,F(path[0]["open"]),True),level,b["close"],h,basis)
                    for mode in ("IMMEDIATE","LIMIT","RECLAIM"):
                        status,e=choose(path,level,mode)
                        obs=opportunity(path,e,level,b["close"],h,basis) if e is not None else None
                        for part in (["ALL",phase] if phase!="EMBARGO" else ["ALL"]):
                            for f,v in context:
                                groups[basis,h,part,f,v,name,mode].append((d,c,discount,status,obs,base))
    rows=[]
    for (basis,h,part,f,v,name,mode),events in sorted(groups.items()):
        base=groups[basis,h,part,f,v,name,"IMMEDIATE"]
        check([(e[0],e[1]) for e in events]==[(e[0],e[1]) for e in base],"UNMATCHED_COMPARISON")
        rows.append(dict(basis=basis,horizon=h,phase=part,context_feature=f,context_value=v,level=name,entry=mode,**summarize(events)))
    return dict(schema="BLUE_ENV20_STRUCTURAL_HIGH_V3",asof=days[-1],source_days=len(days),inverse_chart_match_signals=cohort,split_day=split,wait_sessions=WAIT,
        level_coverage=[dict(level=k,status=s,count=n) for (k,s),n in sorted(level_counts.items())],
        coverage=[dict(key=k if isinstance(k,tuple) else [k],count=n) for k,n in sorted(coverage.items(),key=lambda x:str(x[0]))],
        rows=rows,limits=["HIGH_OPPORTUNITY_NOT_REALIZED_RETURN","LEVELS_FROZEN_AT_SIGNAL_CLOSE","ENTRY_WINDOW_REQUIRES_COMMON_H_PLUS_5_FULL_PATH","INTRADAY_ENTRY_HIGH_BOUNDED","NO_STOP_OR_COST_IN_OPPORTUNITY","STORED_MA_CHART_NOT_INDEPENDENT_PROOF","NO_VERIFIED_LOWER_VOLUME_PROFILE","STORED_OVERHEAD_ESTIMATE_CONTEXT_ONLY","NO_CORPORATE_ACTION_OR_INDEPENDENT_CALENDAR_PROOF","DEPENDENT_EVENTS_MULTIPLE_COMPARISONS","NO_PROMOTION"])
def main():
    p=argparse.ArgumentParser()
    for k in ("source","benchmark","factors","out"):p.add_argument("--"+k,type=Path,required=True)
    a=p.parse_args();read=lambda p:json.loads(p.read_text())
    r=study(read(a.source),read(a.benchmark),read(a.factors))
    a.out.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n")
    print("BLUE_ENV20_STRUCTURAL_HIGH",json.dumps({k:v for k,v in r.items() if k!="rows"},ensure_ascii=False))
    print("BLUE_ENV20_STRUCTURAL_HIGH_SUMMARY",json.dumps([dict(level=x["level"],entry=x["entry"],eligible=x["eligible_signals"],entered=x["entered"],peak_lower=x["peak_high_lower_pct"],peak_upper=x["peak_high_upper_pct"],target5=x["target_reach"]["5"],delta=x["paired_peak_lower_delta_pp"]) for x in r["rows"] if x["basis"]=="ENTRY_WINDOW" and x["horizon"]==10 and x["phase"]=="ALL" and x["context_feature"]=="ALL"],ensure_ascii=False))
if __name__=="__main__":main()

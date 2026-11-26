"""V5 technical room and first-touch order, not realized trading returns.
Fixed signal-day anchors; no fitted rule or post-entry rebasing."""
import argparse,json,re
from collections import Counter,defaultdict
from fractions import Fraction as F
from pathlib import Path
from env20_structural_entry import choose,opportunity,HORIZONS,TARGETS,WAIT
from env20_confluence_entry import support_levels,ready,stat
from env20_pullback_context import categories
from pattern_performance_forward import indexed,history
from pattern_performance_full_universe import check
RULES=("IMMEDIATE","IMMEDIATE_RR1","IMMEDIATE_RR2","NEAREST_LIMIT","NEAREST_LIMIT_RR1","NEAREST_LIMIT_RR2","NEAREST_RECLAIM","NEAREST_RECLAIM_RR2")
STOP_NAMES=("SIGNAL_LOW","PRIOR5_LOW","PRIOR10_LOW","CONFIRMED_SWING_LOW_10","PRIOR_BOX_LOW","MA5","MA10","MA20","MA20_X_0_8")
def resistance(b,h,x):
    out={"SIGNAL_HIGH":F(b["high"])}
    for n in (5,10):
        a=h(n+1)
        if a:out[f"PRIOR{n}_HIGH"]=F(max(z["high"] for z in a[:-1]))
    a=h(11)
    if a:
        for i in range(len(a)-3,1,-1):
            if all(a[i]["high"]>a[j]["high"] for j in (i-2,i-1,i+1,i+2)):
                out["CONFIRMED_SWING_HIGH_10"]=F(a[i]["high"]);break
    for n in (5,10,20):
        a=h(n)
        if a:out[f"MA{n}"]=F(sum(z["close"] for z in a),n)
    s=x.get("supply") or {}
    if s.get("status")=="STORED_ESTIMATE":
        try:p=F(str(s.get("reference_price")))
        except (ValueError,ZeroDivisionError,TypeError):p=None
        if p is not None and p>b["close"]:out["STORED_UPPER_SUPPLY"]=p
    # Only levels above the original signal close are resistance candidates.
    return {k:v for k,v in out.items() if v>b["close"]}
def geometry(reference,lv,upper):
    # Stop is a strictly lower structural level, not entry-level contact.
    lower={k:v for k,v in ready(lv).items() if k in STOP_NAMES and v<reference}
    if not lower or not upper:return None
    sk=max(lower,key=lambda k:(lower[k],k));rk=min(upper,key=lambda k:(upper[k],k))
    return dict(stop=lower[sk],resistance=upper[rk],stop_name=sk,resistance_name=rk)
def room(price,g):
    if not g or not g["stop"]<price<g["resistance"]:return None
    risk=price-g["stop"];reward=g["resistance"]-price
    return dict(risk_pct=100*risk/price,room_pct=100*reward/price,rr=reward/risk)
def ratio_band(r):
    return "UNKNOWN" if r is None else "LT1" if r["rr"]<1 else "1_TO_2" if r["rr"]<2 else "GE2"
def order(path,e,h,basis,stop,target):
    """First-touch evidence; not an execution model. Entry-day high may precede
    an intraday limit fill; track its possibility until resolved."""
    i,p,opening=e
    if not stop<p<target:return "INVALID_GEOMETRY"
    a=path[i:h if basis=="SIGNAL_WINDOW" else i+h]
    possible=False
    for j,b in enumerate(a):
        op,hi,lo,cl=(F(b[k]) for k in ("open","high","low","close"))
        if j or opening:
            if op>=target:return "TARGET_FIRST"
            if op<=stop:return "AMBIGUOUS" if possible else "SUPPORT_FIRST"
            if hi>=target and lo<=stop:return "AMBIGUOUS"
            if hi>=target:return "TARGET_FIRST"
            if lo<=stop:return "AMBIGUOUS" if possible else "SUPPORT_FIRST"
        else:
            # Order at the entry bar is not known from OHLC.
            if lo<=stop:return "AMBIGUOUS" if hi>=target else "SUPPORT_FIRST"
            if cl>=target:return "TARGET_FIRST"
            if hi>=target:possible=True
    return "POSSIBLE_TARGET_ONLY" if possible else "NEITHER"
def plan(rule,b,lv,upper,complete):
    is_immediate=rule.startswith("IMMEDIATE")
    mode="IMMEDIATE" if is_immediate else "RECLAIM" if "RECLAIM" in rule else "LIMIT"
    supports=ready(lv)
    if not is_immediate and not supports:return mode,None,None,"NO_ENTRY_LEVEL"
    reference=F(b["close"]) if is_immediate else max(supports.values())
    g=geometry(reference,lv,upper)
    threshold=2 if rule.endswith("RR2") else 1 if rule.endswith("RR1") else None
    if threshold is not None:
        if not complete or g is None:return mode,reference,g,"GEOMETRY_UNAVAILABLE"
        r=room(reference,g)
        if r is None or r["rr"]<threshold:return mode,reference,g,"PLANNED_RR_BELOW_GATE"
    return mode,reference,g,"READY"
def evaluate(rule,path,b,lv,upper,complete,h,basis):
    mode,reference,g,status=plan(rule,b,lv,upper,complete)
    out=dict(status=status,op=None,geometry=None,orders={},entry=None)
    if status!="READY":return out
    status,e=choose(path,reference,mode)
    out["status"]=status
    if e is None:return out
    i,p,opening=e
    r=room(p,g)
    threshold=2 if rule.endswith("RR2") else 1 if rule.endswith("RR1") else None
    if threshold is not None and (r is None or r["rr"]<threshold):
        out["status"]="ENTRY_GEOMETRY_INVALID" if r is None else "ENTRY_RR_BELOW_GATE"
        return out
    out["entry"]=e
    out["op"]=opportunity(path,e,reference,b["close"],h,basis)
    # Ungated baseline stays in all signals; geometry unavailable is explicit.
    if r is not None:
        out["geometry"]={**r,"stop_name":g["stop_name"],"resistance_name":g["resistance_name"]}
        for t in TARGETS:out["orders"][str(t)]=order(path,e,h,basis,g["stop"],p*(100+t)/100)
        out["orders"]["RESISTANCE"]=order(path,e,h,basis,g["stop"],g["resistance"])
    return out
def pct(n,d):return round(100*n/d,3) if d else None
def summarize(events):
    n=len(events);entered=[z for z in events if z[2]["op"] is not None]
    m=len(entered);valid=[z for z in entered if z[2]["geometry"] is not None]
    k=len(valid);nd=len({z[0] for z in valid});ns=len({z[1] for z in valid})
    def opstat(field):return stat([z[2]["op"][field] for z in entered])
    targets={}
    for t in TARGETS:
        lower=sum(z[2]["op"]["targets"][t][0] is not None for z in entered)
        upper=sum(z[2]["op"]["targets"][t][1] is not None for z in entered)
        base=sum(z[3]["op"]["targets"][t][0] is not None for z in events)
        targets[str(t)]=dict(confirmed_hits=lower,possible_hits=upper,confirmed_pct_of_signals=pct(lower,n),possible_pct_of_signals=pct(upper,n),confirmed_pct_of_entries=pct(lower,m),immediate_pct_of_signals=pct(base,n),
            missed_immediate_due_no_entry=sum(z[2]["op"] is None and z[3]["op"]["targets"][t][0] is not None for z in events))
    orders={}
    for t in [str(t) for t in TARGETS]+["RESISTANCE"]:
        counts=Counter(z[2]["orders"][t] for z in valid)
        orders[t]=dict(counts=dict(counts),valid_geometry=k,target_first_pct_of_valid=pct(counts["TARGET_FIRST"],k),target_first_pct_of_all_signals=pct(counts["TARGET_FIRST"],n),ambiguous_or_possible_pct_of_valid=pct(counts["AMBIGUOUS"]+counts["POSSIBLE_TARGET_ONLY"],k))
    return dict(signals=n,entered=m,entry_pct=pct(m,n),valid_geometry=k,geometry_unavailable_entries=m-k,geometry_dates=nd,geometry_symbols=ns,
        geometry_sample_floor=k>=30 and nd>=5 and ns>=10,status_counts=dict(Counter(z[2]["status"] for z in events)),
        peak_high_lower_pct=opstat("peak_lower"),peak_high_upper_pct=opstat("peak_upper"),trough_low_pct=opstat("trough"),peak_day=opstat("peak_day"),entry_day=opstat("entry_day"),
        matched_immediate_trough_pct=stat([z[3]["op"]["trough"] for z in entered]),
        paired_peak_delta_pp=stat([z[2]["op"]["peak_lower"]-z[3]["op"]["peak_lower"] for z in entered]),
        technical_risk_pct=stat([z[2]["geometry"]["risk_pct"] for z in valid]),technical_room_pct=stat([z[2]["geometry"]["room_pct"] for z in valid]),technical_rr=stat([z[2]["geometry"]["rr"] for z in valid]),
        stop_names=dict(Counter(z[2]["geometry"]["stop_name"] for z in valid)),resistance_names=dict(Counter(z[2]["geometry"]["resistance_name"] for z in valid)),targets=targets,first_touch=orders)
def study(src,bench,factors):
    days,meta,bars,indexes,states,old=indexed(src,bench)
    check(factors["schema"]=="BLUE_ENV20_PULLBACK_FACTORS_V1" and factors["cutoff"]==src["cutoff"],"BAD_FACTOR_SOURCE")
    wanted={k for k,v in old.items() if "ENV20_LOWER_TOUCH" in v};lookup={}
    for x in factors["rows"]:
        k=x["day"],x["code"];check(k in wanted and k not in lookup and re.fullmatch(r"[a-f0-9]{64}",x["record_sha256"]),"BAD_FACTOR_ROW");lookup[k]=x
    check(set(lookup)==wanted,"FACTOR_COUNT_MISMATCH")
    split=days[len(days)*7//10];groups=defaultdict(list);coverage=Counter();diagnostics=Counter();cohort=0
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
        lv=support_levels(b,hist);upper=resistance(b,hist,x)
        # Gates require full 20-session history for the candidate set plus
        # known stored supply status; still not an exhaustive real order book.
        supply=(x.get("supply") or {}).get("status")
        complete=hist(20) is not None and (supply=="NO_UPPER_CONCENTRATION" or "STORED_UPPER_SUPPLY" in upper)
        diagnostics["COMPLETE_CANDIDATE_SET" if complete else "PARTIAL_CANDIDATE_SET"]+=1
        g=geometry(F(b["close"]),lv,upper);r=room(F(b["close"]),g)
        diagnostics["SIGNAL_GEOMETRY_"+ratio_band(r)]+=1
        cat=categories(b,x,hist(25),atr)
        context=[("ALL","ALL"),("CANDLE",cat["CANDLE"]),("MARKET_STATE",states[market,d][0]),("SIGNAL_RR",ratio_band(r) if complete else "UNKNOWN"),("GEOMETRY_INPUTS","COMPLETE" if complete else "PARTIAL")]
        for f in ("SUPPLY_DISTANCE","MA20_SLOPE_5","MA20_60_GAP","TURNOVER_20","ATR_PCT"):
            if cat[f]!="UNKNOWN":context.append((f,cat[f]))
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
                base=evaluate("IMMEDIATE",path,b,lv,upper,complete,h,basis)
                for rule in RULES:
                    val=base if rule=="IMMEDIATE" else evaluate(rule,path,b,lv,upper,complete,h,basis)
                    for part in (["ALL",phase] if phase!="EMBARGO" else ["ALL"]):
                        for f,v in context:groups[basis,h,part,f,v,rule].append((d,c,val,base))
    rows=[]
    for (basis,h,phase,f,v,rule),events in sorted(groups.items()):
        base=groups[basis,h,phase,f,v,"IMMEDIATE"]
        check([(e[0],e[1]) for e in events]==[(e[0],e[1]) for e in base],"UNMATCHED_COMPARISON")
        rows.append(dict(basis=basis,horizon=h,phase=phase,context_feature=f,context_value=v,rule=rule,**summarize(events)))
    return dict(schema="BLUE_ENV20_TECHNICAL_ROOM_HIGH_V5",asof=days[-1],source_days=len(days),inverse_chart_match_signals=cohort,split_day=split,wait_sessions=WAIT,
        diagnostics=dict(diagnostics),coverage=[dict(key=list(k) if isinstance(k,tuple) else [k],count=n) for k,n in sorted(coverage.items(),key=lambda x:str(x[0]))],rows=rows,
        limits=["HIGH_NOT_REALIZED_RETURN","V5_POST_V4_EXPLORATORY_NOT_FRESH_OOS","STATIC_SIGNAL_DAY_CANDIDATE_LEVELS","RR_GATES_1_AND_2_EXPLORATORY","GATED_ENTRY_AT_MODELED_PRICE_ASSUMES_CONDITIONAL_EXECUTION","PARTIAL_GEOMETRY_DESCRIPTIVE_ONLY","NO_LOWER_VOLUME_PROFILE","STORED_UPPER_ESTIMATE_NOT_ORDER_BOOK","INTRADAY_ENTRY_HIGH_BOUNDED","SAME_DAY_ORDER_AMBIGUOUS","NO_COSTS_OR_STOP_FILL_SIMULATION","NO_CORPORATE_ACTION_OR_INDEPENDENT_CALENDAR_PROOF","NO_PROMOTION"])
def main():
    p=argparse.ArgumentParser()
    for k in ("source","benchmark","factors","out"):p.add_argument("--"+k,type=Path,required=True)
    a=p.parse_args();read=lambda p:json.loads(p.read_text())
    r=study(read(a.source),read(a.benchmark),read(a.factors))
    a.out.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n")
    print("BLUE_ENV20_TECHNICAL_ROOM",json.dumps({k:v for k,v in r.items() if k!="rows"},ensure_ascii=False))
    print("BLUE_ENV20_TECHNICAL_ROOM_SUMMARY",json.dumps([dict(rule=x["rule"],signals=x["signals"],entered=x["entered"],geometry=x["valid_geometry"],peak=x["peak_high_lower_pct"],trough=x["trough_low_pct"],target5=x["targets"]["5"],first5=x["first_touch"]["5"],resistance=x["first_touch"]["RESISTANCE"],rr=x["technical_rr"]) for x in r["rows"] if x["basis"]=="SIGNAL_WINDOW" and x["horizon"]==5 and x["phase"]=="ALL" and x["context_feature"]=="ALL"],ensure_ascii=False))
if __name__=="__main__":main()

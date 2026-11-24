"""Paired entry timing and bounded daily-bar exit scenarios, research only."""
from collections import defaultdict
from statistics import mean, median

def first_touch(entry, path, target, stop):
    tp=entry*(1+target/100)
    sl=entry*(1-stop/100)
    for b in path:
        o,h,l=b["open"],b["high"],b["low"]
        if o<=sl: return "STOP",100*(o/entry-1),100*(o/entry-1)
        if o>=tp: return "TARGET",100*(o/entry-1),100*(o/entry-1)
        if h>=tp and l<=sl: return "AMBIGUOUS",-stop,target
        if l<=sl: return "STOP",-stop,-stop
        if h>=tp: return "TARGET",target,target
    r=100*(path[-1]["close"]/entry-1)
    return "TIME",r,r

def study(source, days, raw_bars, candle):
    groups=defaultdict(list)
    exits=defaultdict(list)
    index={d:i for i,d in enumerate(days)}
    for s in source["signals"]:
        d,c=s["day"],s["code"]
        i=index[d]
        b=raw_bars[d,c]
        if not all(k in b for k in ("open","high","low")): continue
        shape=candle(b)
        keys=list(s["names"])+[p+"|"+shape for p in s["names"]]
        if shape=="BULL" and b["high"]>b["low"] and 0.33<=(b["close"]-b["low"])/(b["high"]-b["low"])<0.67:
            keys += [p+"|BULL|CLOSE_MID" for p in s["names"]]
        for n in (1,2,3,5):
            path=[raw_bars.get((day,c)) for day in days[i:i+n+3]]
            if len(path)!=n+3 or any(not x or not all(k in x for k in ("open","high","low","close")) for x in path): continue
            entries={"D0_CLOSE":(0,path[0]["close"]),"D1_OPEN":(1,path[1]["open"]),"D1_CLOSE":(1,path[1]["close"]),"D2_CLOSE":(2,path[2]["close"])}
            for mode in ("SAME_EXIT","SAME_HOLD"):
                for name,(offset,entry) in entries.items():
                    end=n+2 if mode=="SAME_EXIT" else offset+n
                    # For open entry include the entry session in risk path.
                    start=offset if name=="D1_OPEN" else offset+1
                    risk=path[start:end+1]
                    r=100*(path[end]["close"]/entry-1)
                    for key in keys:
                        groups[key,n,mode,name].append((d,r))
                        for tp,sl in ((3,2),(5,3),(5,5),(7,3),(7,5),(10,5)):
                            exits[key,n,mode,name,tp,sl].append(first_touch(entry,risk,tp,sl))
    return {"entry_rankings":[{"pattern":p,"horizon":n,"mode":m,"entry":e,"sample_count":len(v),"distinct_signal_dates":len(set(d for d,r in v)),"positive_pct":round(100*sum(r>0 for d,r in v)/len(v),2),"mean_pct":round(mean(r for d,r in v),3),"median_pct":round(median(r for d,r in v),3)} for (p,n,m,e),v in sorted(groups.items())],
    "exit_rankings":[{"pattern":p,"horizon":n,"mode":m,"entry":e,"target":t,"stop":s,"sample_count":len(v),"counts":{k:sum(x[0]==k for x in v) for k in ("TARGET","STOP","AMBIGUOUS","TIME")},"mean_lower_pct":round(mean(x[1] for x in v),3),"mean_upper_pct":round(mean(x[2] for x in v),3)} for (p,n,m,e,t,s),v in sorted(exits.items())],
    "warning":"Paired complete paths only. SAME_EXIT exits signal+n+2; SAME_HOLD exits entry session+n (D1_OPEN includes entry session). D0 close hypothetical, signal availability unverified. Gap open fills assumed; same-bar ambiguity bounded; no costs, corporate action adjustment or independent validation."}

"""Compare compound patterns in disjoint, equally matured audited windows."""
from collections import defaultdict
from statistics import median,mean
from pattern_performance_audited import candle,market_regime
import argparse,json
from pathlib import Path

WINDOWS=(3,5,10,20,28,60)
HORIZONS=(1,2,3,5,10,20)

def monitor(source):
    days=sorted(x["day"] for x in source["eod_days"])
    if len(days)!=len(set(days)):
        raise ValueError("duplicate sessions")
    idx={d:i for i,d in enumerate(days)}
    coverage=set(source.get("research_audited_dates",[]))
    if not coverage.issubset(idx):
        raise ValueError("unknown audited signal date")
    raw={(b["day"],b["code"]):b for b in source["bars"]}
    bars={k:b["close"] for k,b in raw.items()}
    breadth={b["day"]:b for b in source.get("market_breadth_by_day",[]) if b["scope"]=="ALL"}
    events=defaultdict(list)
    for s in source["signals"]:
        d,c=s["day"],s["code"]
        i=idx[d]
        b=raw[d,c]
        shape=candle(b) if all(k in b for k in ("open","high","low")) else None
        regime=market_regime(breadth.get(d))
        suffixes={""}
        if shape:
            suffixes.add("|"+shape)
        if regime!="UNKNOWN":
            suffixes.add("|"+regime)
        if shape=="BULL":
            span=b["high"]-b["low"]
            body=abs(b["close"]-b["open"])/span
            pos=(b["close"]-b["low"])/span
            suffixes.update(["|BULL|"+("BODY_10_30" if body<.3 else "BODY_30_50" if body<.5 else "BODY_50_70"),"|BULL|"+("CLOSE_LOW" if pos<.33 else "CLOSE_MID" if pos<.67 else "CLOSE_HIGH")])
            if regime!="UNKNOWN":
                suffixes.add("|BULL|MARKET_"+regime)
        prev=bars.get((days[i-1],c)) if i>0 else None
        if shape and prev:
            change=100*(b["close"]/prev-1)
            band="NEGATIVE" if change<0 else "UP_0_2" if change<2 else "UP_2_5" if change<5 else "UP_5_10" if change<10 else "UP_10_PLUS"
            suffixes.add("|"+shape+"|"+band)
        for n in (5,10,20):
            prior=[raw.get((day,c),{}).get("amount") for day in days[max(0,i-n):i]]
            a=b.get("amount")
            if len(prior)==n and all(type(x) is int and x>=0 for x in prior) and sum(prior)>0 and type(a) is int and a>=0:
                ratio=a*n/sum(prior)
                band="LT_0_5" if ratio<.5 else "0_5_1" if ratio<1 else "1_1_5" if ratio<1.5 else "1_5_2" if ratio<2 else "2_3" if ratio<3 else "GE_3"
                suffixes.add(f"|AMOUNT_{n}|{band}")
                if shape:
                    suffixes.add(f"|{shape}|AMOUNT_{n}|{band}")
        for p in set(s["names"]):
            for suffix in suffixes:
                events[p+suffix].append((i,c))
    def perf(es,h,end):
        returns=[]
        for i,c in es:
            if i+h>=end: continue
            a,b=bars.get((days[i],c)),bars.get((days[i+h],c))
            if a and b and a>0 and b>0:
                returns.append(100*(b/a-1))
        return dict(horizon=h,sample_count=len(returns),unobserved=len(es)-len(returns),positive_pct=round(100*sum(r>0 for r in returns)/len(returns),2) if returns else None,median_pct=round(median(returns),3) if returns else None,mean_pct=round(mean(returns),3) if returns else None)
    out=[]
    for w in WINDOWS:
        start=max(0,len(days)-w)
        actual=len(days)-start
        prior_start=max(0,start-w)
        prior_n=start-prior_start
        current_covered=sum(d in coverage for d in days[start:])
        prior_covered=sum(d in coverage for d in days[prior_start:start])
        complete=actual==w and prior_n==w and current_covered==w and prior_covered==w
        rows=[]
        for p,es in sorted(events.items()):
            current=[(i,c) for i,c in es if i>=start]
            prior=[(i,c) for i,c in es if prior_start<=i<start]
            if not current and not prior: continue
            performance=[]
            for h in HORIZONS:
                now=perf(current,h,len(days))
                old=perf(prior,h,start)
                comparable=complete and now["sample_count"]>=30 and old["sample_count"]>=30
                now.update(prior=old,rate_delta_pp=round(now["positive_pct"]-old["positive_pct"],2) if comparable else None,median_delta_pct=round(now["median_pct"]-old["median_pct"],3) if comparable else None)
                performance.append(now)
            rows.append(dict(pattern=p,events=len(current),prior_events=len(prior),events_per_session=round(len(current)/current_covered,3) if current_covered else None,prior_events_per_session=round(len(prior)/prior_covered,3) if prior_covered else None,frequency_delta=round((len(current)-len(prior))/w,3) if complete else None,performance=performance))
        out.append(dict(requested_sessions=w,actual_sessions=actual,prior_sessions=prior_n,current_covered=current_covered,prior_covered=prior_covered,start=days[start] if actual else None,rows=rows))
    return dict(asof=source["asof_day"],windows=out,warning="Descriptive compound patterns; outcomes truncated at each window end; comparisons require full signal coverage and 30 outcomes per period; no independent validation.")

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--input",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    a.output.write_text(json.dumps(monitor(json.loads(a.input.read_text())),ensure_ascii=False,allow_nan=False,indent=2)+"\n")

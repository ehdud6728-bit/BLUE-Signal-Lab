"""Descriptive multi-window monitoring, with exact audited-session outcomes."""
from collections import Counter, defaultdict
from statistics import median
import argparse,json
from pathlib import Path

WINDOWS=(3,5,10,20,28,60)
HORIZONS=(1,2,3,5,10,20)

def monitor(source):
    days=sorted(x["day"] for x in source["eod_days"])
    if len(days)!=len(set(days)):
        raise ValueError("duplicate sessions")
    idx={d:i for i,d in enumerate(days)}
    bars={(b["day"],b["code"]):b["close"] for b in source["bars"]}
    events=defaultdict(list)
    for s in source["signals"]:
        for p in set(s["names"]):
            events[p].append((idx[s["day"]],s["code"]))
    out=[]
    for w in WINDOWS:
        start=max(0,len(days)-w)
        actual=len(days)-start
        prior_start=max(0,start-w)
        prior_n=start-prior_start
        rows=[]
        for p,es in sorted(events.items()):
            current=[(i,c) for i,c in es if i>=start]
            prior=sum(prior_start<=i<start for i,c in es)
            if not current and not prior:
                continue
            perf=[]
            for h in HORIZONS:
                returns=[]
                for i,c in current:
                    if i+h>=len(days):
                        continue
                    a,b=bars.get((days[i],c)),bars.get((days[i+h],c))
                    if a and b and a>0 and b>0:
                        returns.append(100*(b/a-1))
                perf.append(dict(horizon=h,sample_count=len(returns),unobserved=len(current)-len(returns),positive_pct=round(100*sum(r>0 for r in returns)/len(returns),2) if returns else None,median_pct=round(median(returns),3) if returns else None))
            rows.append(dict(pattern=p,events=len(current),prior_events=prior,events_per_session=round(len(current)/actual,3) if actual else None,prior_events_per_session=round(prior/prior_n,3) if prior_n else None,frequency_delta=round(len(current)/actual-prior/prior_n,3) if actual==w and prior_n==w else None,performance=perf))
        out.append(dict(requested_sessions=w,actual_sessions=actual,prior_sessions=prior_n,start=days[start] if actual else None,rows=rows))
    return dict(asof=source["asof_day"],windows=out,warning="Descriptive base-pattern frequency and matured outcomes only; incomplete windows and overlapping samples; no independent validation.")

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--input",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    a.output.write_text(json.dumps(monitor(json.loads(a.input.read_text())),ensure_ascii=False,allow_nan=False,indent=2)+"\n")

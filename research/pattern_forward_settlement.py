"""Seal mature, date-proven forward opportunity cohorts; no DB access.
Persist aggregates, never stock-price rows. Missing symbol paths are explicit,
not treated as losses or filled by later bars. No automatic recommendation."""
import argparse,hashlib,json
from collections import defaultdict,Counter
from pathlib import Path
from datetime import datetime
from pattern_performance_forward import indexed,observe_high,summarize_high,VERSION,HORIZONS,KST,OPPORTUNITY_VERSION
from pattern_performance_full_universe import check
SCHEMA="BLUE_FORWARD_SETTLEMENT_V1"
def settlements(src,bench,ledger):
    days,meta,bars,indexes,states,old=indexed(src,bench)
    records=[];reasons=Counter();seen=set()
    for s in ledger:
        check(s["schema"]=="BLUE_FORWARD_CANDIDATE_V1" and s["rule_version"]==VERSION,"BAD_SNAPSHOT")
        at=datetime.fromisoformat(s["captured_at"].replace("Z","+00:00"))
        check(at.tzinfo is not None,"BAD_CAPTURE_TIME")
        captured=at.astimezone(KST).date().isoformat();d=s["source_day"]
        check(d<captured and captured==s["capture_day"] and d not in seen,"BAD_CAPTURE_DATE_OR_DUPLICATE")
        seen.add(d)
        check(len({r["code"] for r in s["rows"]})==len(s["rows"]),"DUPLICATE_FORWARD_SYMBOL")
        check(all(meta[x]["sha256"]==h for x,h in s["source_hashes"].items() if x in meta),"SOURCE_HASH_CHANGED")
        check(s["rows"],"EMPTY_SNAPSHOT")
        for n in HORIZONS:
            # Do not infer a window when the capture anchor has rolled out.
            if d not in meta or any(x not in meta for x in s["source_hashes"]) or any(not ds or d not in ds or ds[0]>captured for ds in indexes.values()):
                reasons["ANCHOR_OR_SOURCE_PROOF_OUTSIDE_WINDOW"]+=1;continue
            a,b=([x for x in indexes[m] if x>captured][:n] for m in ("KOSPI","KOSDAQ"))
            if len(a)<n or len(b)<n:
                reasons["PENDING"]+=1;continue
            # Check both exchanges and the entire audited date interval, including
            # intervening sessions before entry. A missing EOD or index day blocks sealing.
            end=a[-1]
            span=[x for x in days if d<x<=end]
            if a!=b or any([x for x in ds if d<x<=end]!=span for ds in indexes.values()) or any(x not in meta for x in a):
                reasons["DATE_ALIGNMENT_BLOCKED"]+=1;continue
            groups=defaultdict(list);events=[];counts=Counter()
            for r in s["rows"]:
                c=r["code"];scope=r["market"]
                check(scope in indexes,"BAD_MARKET")
                path=[bars.get((x,c)) for x in a]
                if any(x is None or x["market"]!=scope for x in path):
                    status="MISSING_PATH";opp=None
                else:status="OBSERVED";opp=observe_high(path)
                evt=(d,c,opp,status);events.append(evt);counts[status]+=1
                keys=set([("BASELINE","ALL"),("LEGACY",r["legacy"]),*((k,str(v)) for k,v in r["features"].items() if v is not None),*(("LEGACY_PATTERN",x) for x in r["legacy_names"])])
                for k,v in keys:groups[scope,r["state"],r["prior"],k,v].append(evt)
            if not counts["OBSERVED"]:
                reasons["NO_OBSERVED_SYMBOLS"]+=1;continue
            # Sealed payload stable across repeated reads; no run time/asof inside.
            rec=dict(schema=SCHEMA,rule_version=VERSION,outcome_version=OPPORTUNITY_VERSION,source_day=d,
                captured_at=s["captured_at"],rule_commit=s["rule_commit"],horizon=n,entry_day=a[0],maturity_day=end,
                snapshot_rows=len(s["rows"]),source_hashes=s["source_hashes"],benchmark_state_sha256=s["benchmark_state_sha256"],
                outcome_hashes={x:meta[x]["sha256"] for x in span},observation_days=a,
                coverage="COMPLETE_SYMBOL_PATHS" if not counts["MISSING_PATH"] else "PARTIAL_SYMBOL_PATHS",
                pooled=summarize_high(events),
                groups=[dict(market=m,market_state=st,prior_direction=p,feature=k,value=v,**summarize_high(es)) for (m,st,p,k,v),es in sorted(groups.items())])
            records.append(rec);reasons["ELIGIBLE_COMPLETE" if not counts["MISSING_PATH"] else "ELIGIBLE_PARTIAL"]+=1
    return dict(schema="BLUE_FORWARD_SETTLEMENT_BATCH_V1",asof=days[-1],records=records,diagnostics=dict(reasons))
def main():
    p=argparse.ArgumentParser()
    for k in ("source","benchmark","ledger","out"):p.add_argument("--"+k,type=Path,required=True)
    a=p.parse_args();read=lambda p:json.loads(p.read_text())
    r=settlements(read(a.source),read(a.benchmark),read(a.ledger))
    a.out.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,sort_keys=True,separators=(",",":"))+"\n")
    print("BLUE_FORWARD_SETTLEMENT_PLAN",json.dumps(dict(asof=r["asof"],eligible=len(r["records"]),diagnostics=r["diagnostics"])))
if __name__=="__main__":main()

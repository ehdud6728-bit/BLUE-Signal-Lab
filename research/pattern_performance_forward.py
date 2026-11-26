"""Forward-only observation candidate and outcome report; no tuning/promotion."""
import argparse,hashlib,json,re
from collections import Counter,defaultdict
from fractions import Fraction
from statistics import median
from datetime import date,datetime,timezone,timedelta
from pathlib import Path
from pattern_performance_full_universe import check,direction,summarize,SCOPES,STATES
from pattern_performance_audited import candle
from pattern_performance_structure import structure
VERSION="FORWARD_V1"
HORIZONS=(1,3,5,10,20)
KST=timezone(timedelta(hours=9))
def valid_day(d):
    return isinstance(d,str) and date.fromisoformat(d).isoformat()==d
def indexed(src,bench):
    check(src.get("schema")=="BLUE_FULL_UNIVERSE_SOURCE_V1" and src.get("original_eod_hashes_recomputed") is True and bench.get("schema")=="BLUE_BENCHMARK_DAILY_STATES_V1" and src["cutoff"]==bench["cutoff"],"SOURCE_PROOF_REQUIRED")
    days=[x["day"] for x in src["days"]]
    check(bool(days) and days==sorted(set(days)) and all(valid_day(d) and d<=src["cutoff"] for d in days),"BAD_DATES")
    meta={x["day"]:x for x in src["days"]}
    check(all(re.fullmatch(r"[a-f0-9]{64}",x["sha256"]) and x["source"] in ("KRX_PYKRX_EXACT_DAY_VERIFIED","KRX_OPENAPI_EXACT_DAY_VERIFIED") for x in meta.values()),"BAD_SOURCE_HASH")
    bars={};counts=Counter()
    for b in src["bars"]:
        k=(b["day"],b["code"])
        check(k not in bars and k[0] in meta and re.fullmatch(r"[0-9A-Z]{6}",k[1]) and b["market"] in SCOPES and all(type(b[x]) is int and b[x]>0 for x in ("open","high","low","close","amount")) and b["low"]<=min(b["open"],b["close"])<=max(b["open"],b["close"])<=b["high"],"BAD_BAR")
        bars[k]=b;counts[k[0]]+=1
    check(all(counts[d]==meta[d]["rows"] for d in days),"BAD_UNIVERSE_COUNT")
    indexes={};states={}
    for m in bench["markets"]:
        scope=m["market"];ds=[x["day"] for x in m["days"]]
        check(scope in SCOPES and scope not in indexes and ds==sorted(set(ds)) and all(valid_day(d) and d<=bench["cutoff"] for d in ds),"BAD_BENCHMARK")
        indexes[scope]=ds
        for x in m["days"]:
            check(x["state"] in STATES and x["index_trend"] in ("UP","DOWN","MIXED","UNKNOWN"),"BAD_STATE")
            states[scope,x["day"]]=(x["state"],x["index_trend"])
    check(set(indexes)==set(SCOPES),"MISSING_SCOPE")
    old={}
    for s in src["signals"]:
        k=(s["day"],s["code"])
        check(k in bars and k not in old and meta[k[0]]["signal_status"]=="COUNT_AND_PAYLOAD_HASH_METADATA_MATCH","BAD_SIGNAL")
        old[k]=s["names"]
    return days,meta,bars,indexes,states,old
def history(days,bars,c,scope,n):
    if len(days)<n:return None
    h=[bars.get((d,c)) for d in days[-n:]]
    return h if all(b is not None and b["market"]==scope for b in h) else None
def candidate(src,bench,commit):
    check(re.fullmatch(r"[a-f0-9]{40}",commit),"BAD_RULE_COMMIT")
    days,meta,bars,indexes,states,old=indexed(src,bench)
    d=days[-1]
    check(all(ds and ds[-1]==d for ds in indexes.values()),"LATEST_BENCHMARK_EOD_MISMATCH")
    rows=[];coverage=Counter();diagnostics=[]
    for scope,ds in indexes.items():
        missing=[x for x in ds if days[0]<=x<=d and x not in meta]
        extra=[x for x in days if ds[0]<=x<=d and x not in ds]
        tail=0
        for a,b in zip(reversed(days),reversed(ds)):
            if a!=b:break
            tail+=1
        diagnostics.append(dict(market=scope,missing_krx_eod_dates=missing,missing_kis_index_dates=extra,aligned_trailing_dates=tail))
    for (day,c),b in sorted(bars.items()):
        if day!=d:continue
        scope=b["market"];ds=indexes[scope]
        h=lambda n:history(ds,bars,c,scope,n)
        f={"CANDLE":candle(b),"UP_DAY":None,"PREV_HIGH_BREAK":None,"PRIOR5_HIGH_BREAK":None,"MA20_FIRST_CROSS":None,"AMOUNT_SURGE_1_5":None,"BOX_STATE":None}
        prior="UNKNOWN"
        if (a:=h(2)):
            f["UP_DAY"]=b["close"]>a[-2]["close"]
            f["PREV_HIGH_BREAK"]=b["close"]>a[-2]["high"]
        if (a:=h(6)):f["PRIOR5_HIGH_BREAK"]=b["close"]>max(x["high"] for x in a[:-1])
        if (a:=h(7)):prior=direction(a[0]["close"],a[-2]["close"])
        if (a:=h(11)):f["BOX_STATE"]=structure(a)
        if (a:=h(21)):
            f["MA20_FIRST_CROSS"]=20*b["close"]>sum(x["close"] for x in a[1:]) and 20*a[-2]["close"]<=sum(x["close"] for x in a[:-1])
            f["AMOUNT_SURGE_1_5"]=40*b["amount"]>=3*sum(x["amount"] for x in a[:-1])
        prior_status=meta[d]["signal_status"]
        legacy="UNAVAILABLE" if prior_status!="COUNT_AND_PAYLOAD_HASH_METADATA_MATCH" else "PRESENT" if (d,c) in old else "NO_STORED_ROW"
        state,trend=states[scope,d]
        rows.append(dict(code=c,market=scope,state=state,trend=trend,prior=prior,features=f,legacy=legacy,legacy_names=old.get((d,c),[])))
        for k,v in f.items():coverage[k]+=v is not None
        coverage["PRIOR_DIRECTION"]+=prior!="UNKNOWN"
    check(len(rows)==meta[d]["rows"],"CANDIDATE_COUNT_MISMATCH")
    proof={x:meta[x]["sha256"] for x in days[-21:]}
    return dict(schema="BLUE_FORWARD_CANDIDATE_V1",rule_version=VERSION,rule_commit=commit,source_day=d,cutoff=src["cutoff"],source_hashes=proof,benchmark_state_sha256=hashlib.sha256(json.dumps(bench,sort_keys=True,separators=(",",":")).encode()).hexdigest(),rows=rows,coverage=dict(coverage),date_diagnostics=diagnostics)
OPPORTUNITY_VERSION="FORWARD_HIGH_V2"
HIGH_TARGETS=(3,5,10,15,20)
def observe_high(path):
    entry=path[0]["open"]
    hi=max(b["high"] for b in path)
    lo=min(b["low"] for b in path)
    pct=lambda x: Fraction(100*(x-entry),entry)
    return dict(high=pct(hi),low=pct(lo),close=pct(path[-1]["close"]),
        giveback=Fraction(100*(hi-path[-1]["close"]),entry),
        peak_day=next(i for i,b in enumerate(path,1) if b["high"]==hi),
        target_days={t:next((i for i,b in enumerate(path,1) if 100*b["high"]>=(100+t)*entry),None) for t in HIGH_TARGETS})
def summarize_high(events):
    observed=[e for e in events if e[3]=="OBSERVED"]
    check(all((e[2] is not None)==(e[3]=="OBSERVED") for e in events),"HIGH_STATUS_MISMATCH")
    vals=[e[2] for e in observed];n=len(vals);dates=len({e[0] for e in observed});symbols=len({e[1] for e in observed})
    def avg(a):return round(float(sum(a)/len(a)),3) if a else None
    def stat(k):
        a=[v[k] for v in vals]
        return dict(mean=avg(a),median=round(float(median(a)),3) if a else None)
    targets={}
    for t in HIGH_TARGETS:
        hits=[v["target_days"][t] for v in vals if v["target_days"][t] is not None]
        targets[str(t)]=dict(hits=len(hits),hit_pct=round(100*len(hits)/n,2) if n else None,
                             mean_first_day=avg(hits))
    return dict(events=len(events),sample_count=n,signal_dates=dates,symbols=symbols,
        pending=sum(e[3]=="PENDING" for e in events),missing_path=sum(e[3]=="MISSING_PATH" for e in events),
        sample_floor_met=n>=30 and dates>=5 and symbols>=10,
        peak_high_pct=stat("high"),trough_low_pct=stat("low"),terminal_close_pct=stat("close"),
        peak_to_end_giveback_pp=stat("giveback"),first_peak_observation=stat("peak_day"),target_high_reach=targets)
def score(src,bench,ledger):
    days,meta,bars,indexes,states,old=indexed(src,bench)
    groups=defaultdict(list);high_groups=defaultdict(list);pooled=defaultdict(list);by_snapshot=defaultdict(list);statuses=Counter();snapshots=[];seen=set()
    for s in ledger:
        check(s["rule_version"]==VERSION and s["schema"]=="BLUE_FORWARD_CANDIDATE_V1","BAD_SNAPSHOT")
        at=datetime.fromisoformat(s["captured_at"].replace("Z","+00:00"))
        check(at.tzinfo is not None,"BAD_CAPTURE_TIME")
        captured=at.astimezone(KST).date().isoformat()
        check(s["source_day"]<captured and s["capture_day"]==captured,"BAD_CAPTURE_DATE")
        check(all(meta[d]["sha256"]==h for d,h in s["source_hashes"].items() if d in meta),"SOURCE_HASH_CHANGED")
        check(s["source_day"] not in seen,"DUPLICATE_FORWARD_SNAPSHOT");seen.add(s["source_day"])
        snapshots.append(dict(source_day=s["source_day"],captured_at=s["captured_at"],rows=len(s["rows"])))
        seen_codes=set()
        for r in s["rows"]:
            check(r["code"] not in seen_codes,"DUPLICATE_FORWARD_SYMBOL");seen_codes.add(r["code"])
            scope=r["market"];ds=indexes[scope];future=[d for d in ds if d>captured]
            keys=[("BASELINE","ALL"),("LEGACY",r["legacy"])]
            keys.extend((k,str(v)) for k,v in r["features"].items() if v is not None)
            keys.extend(("LEGACY_PATTERN",x) for x in r["legacy_names"])
            for n in HORIZONS:
                ret=None;opp=None
                if not ds or ds[0]>captured:status="MISSING_PATH"
                elif len(future)<n:status="PENDING"
                else:
                    wanted=future[:n];path=[bars.get((d,r["code"])) for d in wanted]
                    if any(b is None or b["market"]!=scope for b in path):status="MISSING_PATH"
                    else:status="OBSERVED";ret=100*(path[-1]["close"]/path[0]["open"]-1);opp=observe_high(path)
                statuses[status]+=1
                evt=(s["source_day"],r["code"],opp,status)
                pooled[n].append(evt)
                by_snapshot[s["source_day"],n].append(evt)
                for k,v in keys:
                    group=scope,r["state"],r["prior"],n,k,v
                    groups[group].append((s["source_day"],r["code"],ret,status))
                    high_groups[group].append(evt)
    return dict(schema="BLUE_FORWARD_REPORT_V2",outcome_version=OPPORTUNITY_VERSION,opportunity_basis="First open strictly after KST capture day; max HIGH and min LOW over full benchmark observation window. Fixed high target touches, not actual fills or returns. Existing rows retain V1 terminal CLOSE basis.",pooled_opportunity_rows=[dict(horizon=n,**summarize_high(es)) for n,es in sorted(pooled.items())],snapshot_opportunity_rows=[dict(source_day=d,horizon=n,**summarize_high(es)) for (d,n),es in sorted(by_snapshot.items())],opportunity_rows=[dict(market=m,market_state=s,prior_direction=d,horizon=h,feature=f,value=v,**summarize_high(es)) for (m,s,d,h,f,v),es in sorted(high_groups.items())],asof=days[-1],snapshot_count=len(snapshots),snapshots=snapshots,outcome_status=dict(statuses),rows=[dict(market=m,market_state=s,prior_direction=d,horizon=h,feature=f,value=v,**summarize(es)) for (m,s,d,h,f,v),es in sorted(groups.items())],limits=["FIRST_KIS_OBSERVED_SESSION_STRICTLY_AFTER_KST_CAPTURE_DAY","CLOSE_KNOWN_NO_SAME_DAY_ENTRY","NO_INDEPENDENT_CALENDAR_OR_CORPORATE_ACTION_PROOF","NO_EXECUTION_OR_COSTS","NO_STRATEGY_PROMOTION","LATEST_30_STORED_SNAPSHOTS_ONLY","DEPENDENT_EVENTS"])
def main():
    p=argparse.ArgumentParser();p.add_argument("--phase",choices=["candidate","score"],required=True);p.add_argument("--commit",default="");p.add_argument("--source",type=Path,required=True);p.add_argument("--benchmark",type=Path,required=True);p.add_argument("--ledger",type=Path);p.add_argument("--out",type=Path,required=True);a=p.parse_args()
    src=json.loads(a.source.read_text());bench=json.loads(a.benchmark.read_text())
    if a.phase=="candidate":
        r=candidate(src,bench,a.commit);log={k:r[k] for k in ("source_day","rule_version","coverage","date_diagnostics")};log["rows"]=len(r["rows"])
    else:
        r=score(src,bench,json.loads(a.ledger.read_text()));log={k:r[k] for k in ("asof","snapshot_count","outcome_status")}
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n")
    print("BLUE_FORWARD_"+a.phase.upper(),json.dumps(log))
if __name__=="__main__":main()

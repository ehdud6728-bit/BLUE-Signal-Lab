"""Read-only market change / frequency / frozen forward performance report.
No tuning, trading signals, forecasts, or raw symbol rows in report."""
import argparse,json
from collections import Counter,defaultdict
from fractions import Fraction as F
from statistics import median
from pathlib import Path
from pattern_performance_forward import indexed,observe_high,summarize_high,HORIZONS
from pattern_performance_full_universe import check
SCOPES=("KOSPI","KOSDAQ")
AUDITED="COUNT_AND_PAYLOAD_HASH_METADATA_MATCH"
def pct(n,d):return round(float(100*F(n,d)),3) if d else None
def avg(v):return round(float(sum(v)/len(v)),3) if v else None
def aligned(days,indexes,scope,start,end):
    return [d for d in days if start<=d<=end]==[d for d in indexes[scope] if start<=d<=end]
def market_report(days,meta,bars,indexes,states,old):
    by=defaultdict(dict);sig=defaultdict(Counter)
    for (d,c),b in bars.items():by[b["market"],d][c]=b["close"]
    for (d,c),names in old.items():
        for name in set(names):sig[bars[d,c]["market"],d][name]+=1
    asof=days[-1];out=[]
    for m in SCOPES:
        ds=indexes[m];i=ds.index(asof) if asof in ds else -1
        breadth=[]
        for h in HORIZONS:
            if i<h or not aligned(days,indexes,m,ds[i-h],asof):
                breadth.append(dict(horizon=h,status="DATE_WINDOW_UNAVAILABLE"));continue
            a,b=by[m,ds[i-h]],by[m,asof];codes=a.keys()&b.keys()
            if not codes or 5*len(codes)<4*len(b):
                breadth.append(dict(horizon=h,status="LOW_MATCH_COVERAGE",matched=len(codes),universe=len(b)));continue
            up=sum(b[c]>a[c] for c in codes);down=sum(b[c]<a[c] for c in codes)
            breadth.append(dict(horizon=h,status="OBSERVED",from_day=ds[i-h],matched=len(codes),universe=len(b),up=up,down=down,flat=len(codes)-up-down,up_pct=pct(up,len(codes)),down_pct=pct(down,len(codes)),median_stock_change_pct=round(float(median([100*F(b[c]-a[c],a[c]) for c in codes])),3)))
        # Compare two nonoverlapping five-observation windows. Missing audit is
        # not zero occurrences, and numerator counts symbol-day not unique stock.
        freq=dict(status="INSUFFICIENT_ALIGNED_SIGNAL_DATES",rows=[])
        if i>=9:
            wanted=ds[i-9:i+1]
            if aligned(days,indexes,m,wanted[0],asof) and all(meta.get(d,{}).get("signal_status")==AUDITED for d in wanted):
                prior,recent=wanted[:5],wanted[5:]
                den=[sum(len(by[m,d]) for d in w) for w in (prior,recent)]
                if min(den)>0:
                    counts=[sum((sig[m,d] for d in w),Counter()) for w in (prior,recent)]
                    rows=[]
                    for name in sorted(counts[0].keys()|counts[1].keys()):
                        a,b=[counts[j][name] for j in (0,1)]
                        rows.append(dict(pattern=name,prior_events=a,recent_events=b,prior_rate_pct=pct(a,den[0]),recent_rate_pct=pct(b,den[1]),delta_pp=round(float(100*(F(b,den[1])-F(a,den[0]))),3)))
                    freq=dict(status="OBSERVED",prior_days=prior,recent_days=recent,prior_symbol_days=den[0],recent_symbol_days=den[1],rows=rows)
        timeline=[dict(day=d,state=states[m,d][0],index_trend=states[m,d][1]) for d in ds[max(0,i-19):i+1]] if i>=0 else []
        out.append(dict(market=m,asof=asof,state=states.get((m,asof),("UNKNOWN","UNKNOWN"))[0],timeline=timeline,breadth=breadth,frequency=freq))
    return out
def performance(batch,archive):
    check(batch["schema"]=="BLUE_FORWARD_SYMBOL_SETTLEMENT_BATCH_V1" and archive["schema"]=="BLUE_FORWARD_SYMBOL_SETTLEMENT_REPORT_V1" and batch["asof"]==archive["asof"],"BAD_FORWARD_BASIS")
    # Stored and calculated-but-unsealed cohorts remain separate. No double counting.
    sealed={(r["source_day"],r["horizon"]):r for r in archive["recent_rows"]}
    check(len(sealed)==len(archive["recent_rows"]),"DUPLICATE_SEALED")
    conflicts={(r["source_day"],r["horizon"]) for r in archive["conflicts"]}
    fresh={}
    for r in batch["records"]:
        k=(r["source_day"],r["horizon"]);check(k not in fresh,"DUPLICATE_CANDIDATE")
        fresh[k]=r
    def view(records):
        grouped=defaultdict(list)
        for r in records:
            check(r["outcome_version"]=="FORWARD_SYMBOL_EXIT_V1" and r["maturity_day"]<=batch["asof"],"BAD_MATURE_BASIS")
            # One row per frozen signal day/group/horizon; compare same market/state/prior.
            seen=set()
            for g in r["exit_groups"]:
                if g["feature"] not in ("LEGACY_PATTERN","BASELINE"):continue
                key=(g["market"],g["market_state"],g["prior_direction"],r["horizon"],g["feature"],g["value"])
                check(key not in seen,"DUPLICATE_EXIT_GROUP");seen.add(key)
                grouped[key].append((r["source_day"],r["maturity_day"],g))
        rows=[]
        for (m,state,prior,h,feature,value),es in sorted(grouped.items()):
            for method in ("SIGNAL_LOW","ATR14_SMA_1_5"):
                valid=[(d,end,g["methods"][method]) for d,end,g in sorted(es) if g["methods"][method]["available"]>0]
                # Require five mature source days on each side, nonoverlapping source dates.
                # The observation windows can still overlap; descriptive not independent.
                result=dict(market=m,market_state=state,prior_direction=prior,horizon=h,feature=feature,value=value,method=method,mature_days=len(valid),status="INSUFFICIENT_MATURE_DAYS")
                if len(valid)>=10:
                    a,b=valid[-10:-5],valid[-5:]
                    def section(x):
                        n=sum(z["available"] for _,_,z in x)
                        return dict(source_days=[d for d,_,_ in x],last_maturity_day=max(end for _,end,_ in x),matched_events=n,
                            equal_day_mean_3_pct=avg([z["targets"]["3"]["mean_pct"] for _,_,z in x]),
                            equal_day_mean_5_pct=avg([z["targets"]["5"]["mean_pct"] for _,_,z in x]),
                            equal_day_paired_5_minus_3_pp=avg([z["paired_5_minus_3_pp"] for _,_,z in x]))
                    p,q=section(a),section(b)
                    result.update(status="DESCRIPTIVE_CHANGE" if min(p["matched_events"],q["matched_events"])>=30 else "LOW_EVENT_COUNT",previous=p,recent=q,delta_3_pp=round(q["equal_day_mean_3_pct"]-p["equal_day_mean_3_pct"],3),delta_5_pp=round(q["equal_day_mean_5_pct"]-p["equal_day_mean_5_pct"],3))
                rows.append(result)
        return rows
    return dict(sealed_cohorts=len(sealed),sealed_total=archive["total"],unsealed_cohorts=sum(k not in sealed for k in fresh),conflicts=len(conflicts),
        sealed_changes=view([r for k,r in sealed.items() if k not in conflicts]),
        unsealed_changes=view([r for k,r in fresh.items() if k not in sealed and k not in conflicts]),
        basis="Equal weight per mature signal day, rounded cohort means; same frozen market/state/prior and stop; 5 vs preceding 5 mature days; windows can overlap; no inference or automatic promotion.")
def rotation_report(days,meta,bars,indexes,rot):
    check(rot["schema"]=="BLUE_ROTATION_FROZEN_SOURCE_V1","BAD_ROTATION_SOURCE")
    grouped=defaultdict(list);receipts=[];seen=set();duplicates=0;role_overlap=0;status_counts=Counter()
    for a in rot["archives"]:
        d=a["recorded_day"];check(d not in seen and a["source_day"]<=d,"BAD_ROTATION_RECEIPT");seen.add(d)
        roles=defaultdict(set)
        for c in a["candidates"]:
            check(c["market"] in SCOPES and c["role"] in ("LEADER","FOLLOWER"),"BAD_ROTATION_ROLE")
            roles[c["market"],c["code"]].add(c["role"])
        role_overlap+=sum(len(v)>1 for v in roles.values())
        unique={(c["market"],c["role"],c["code"]) for c in a["candidates"]}
        duplicates+=len(a["candidates"])-len(unique)
        receipts.append(dict(recorded_day=d,source_day=a["source_day"],mapping_status=a["mapping_status"],unique_role_symbols=len(unique),source_sha256=a["source_sha256"]))
        for m,role,code in sorted(unique):
            ds=indexes[m];future=[x for x in ds if x>d]
            for h in HORIZONS:
                opp=None
                if not ds or ds[0]>d or days[0]>d:status="MISSING_PATH"
                elif len(future)<h:status="PENDING"
                else:
                    wanted=future[:h]
                    # Cross-check every expected date with audited EOD, including
                    # any intervening sessions; no use of older receipt prices.
                    span=[x for x in days if d<x<=wanted[-1]]
                    if span!=wanted:status="MISSING_PATH"
                    else:
                        path=[bars.get((x,code)) for x in wanted]
                        if any(x is None or x["market"]!=m for x in path):status="MISSING_PATH"
                        else:status="OBSERVED";opp=observe_high(path)
                status_counts[status]+=1
                grouped[m,role,h].append((d,code,opp,status))
    return dict(status=rot["status"],receipts=receipts,duplicate_sector_memberships_removed=duplicates,cross_role_overlaps=role_overlap,
        outcome_status=dict(status_counts),rows=[dict(market=m,role=role,horizon=h,**summarize_high(es)) for (m,role,h),es in sorted(grouped.items())],
        basis="Frozen rotation receipt only; first open strictly after recorded KST day; full audited benchmark window. Same stock/role/market dedup per receipt, cross-role overlap reported. Distinct from existing rotation close-to-close report. No retroactive capture.")
def report(src,bench,batch,archive,rot):
    days,meta,bars,indexes,states,old=indexed(src,bench)
    check(batch["asof"]==days[-1],"BAD_ASOF")
    return dict(schema="BLUE_ADAPTIVE_MARKET_BUNDLE_V1",asof=days[-1],market=market_report(days,meta,bars,indexes,states,old),forward_performance=performance(batch,archive),rotation=rotation_report(days,meta,bars,indexes,rot),
        limits=["FREQUENCY_NOT_WIN_RATE","BREADTH_NOT_INDEX_RETURN","READ_ONLY_NO_PROMOTION","DEPENDENT_EVENTS","NO_INDEPENDENT_CALENDAR_OR_CORPORATE_ACTION_PROOF","NO_EXECUTION_COSTS","ROLLING_SOURCE_AND_ARCHIVE_WINDOW","ROTATION_MEMBERSHIP_PARTIAL_WHERE_REPORTED"])
def main():
    p=argparse.ArgumentParser()
    for k in ("source","benchmark","batch","archive","rotation","out"):p.add_argument("--"+k,type=Path,required=True)
    a=p.parse_args();read=lambda x:json.loads(x.read_text())
    r=report(read(a.source),read(a.benchmark),read(a.batch),read(a.archive),read(a.rotation))
    a.out.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,separators=(",",":"))+"\n")
    f=r["forward_performance"];print("BLUE_ADAPTIVE_MARKET",json.dumps(dict(asof=r["asof"],markets=[dict(market=m["market"],state=m["state"],breadth_observed=sum(x["status"]=="OBSERVED" for x in m["breadth"]),frequency_status=m["frequency"]["status"],frequency_patterns=len(m["frequency"]["rows"])) for m in r["market"]],sealed=f["sealed_cohorts"],unsealed=f["unsealed_cohorts"],rotation_receipts=len(r["rotation"]["receipts"]),rotation_status=r["rotation"]["outcome_status"])))
if __name__=="__main__":main()

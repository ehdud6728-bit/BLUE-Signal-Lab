"""Private evidence bundle using exact cohorts selected by combined study.
No source rows or individual stock names may be uploaded to public artifacts.
"""
import argparse,hashlib,json,math
from collections import defaultdict
from fractions import Fraction
from pathlib import Path
from pattern_performance_combined import analyze,HORIZONS
from pattern_performance_profitability_audit import metrics
PAGE=20

def digest(b):return hashlib.sha256(b).hexdigest()
def pack(x):return json.dumps(x,ensure_ascii=False,allow_nan=False,separators=(",",":"))
def rsi_recompute(prices):
    """Wilder-style EWM adjust=False, first observed change seed, 9 RSI SMA.
    Finite-window initialization is approximate, not the original full-history seed.
    """
    if len(prices)<120:return None
    g=l=None;rs=[]
    for i in range(1,len(prices)):
        d=prices[i]-prices[i-1];gain=max(d,0);loss=max(-d,0)
        g=gain if g is None else (13*g+gain)/14
        l=loss if l is None else (13*l+loss)/14
        rs.append((50 if g==0 else 100) if l==0 else 100-100/(1+g/l))
    return rs[-1],sum(rs[-9:])/9,rs[-2],sum(rs[-10:-1])/9

def independent_rsi(days,bars,i,c,f):
    path=[bars.get((d,c)) for d in days[max(0,i-249):i+1]]
    if len(path)<120 or any(x is None for x in path) or len({x["market"] for x in path})!=1:
        return {"status":"INSUFFICIENT_AUDITED_HISTORY"}
    v=rsi_recompute([b["close"] for b in path])
    observed=[f.get(k) for k in ("rsi_value","rsi_signal","prior_rsi","prior_rsi_signal")]
    if any(x is None for x in observed):return {"status":"STORED_VALUES_MISSING"}
    current,signal,prior,prior_signal=v
    gc=prior<=prior_signal and current>signal
    near=min(abs(prior-prior_signal),abs(current-signal))<=.05
    match=max(abs(a-b) for a,b in zip(v,observed))<=.05
    state="APPROX_BOUNDARY_UNCERTAIN" if near else "APPROX_MATCH" if match and gc==f["rsi_gc"] else "APPROX_DIFFERENCE"
    return {"status":state,"rsi":round(current,5),"signal":round(signal,5),"prior_rsi":round(prior,5),"prior_signal":round(prior_signal,5),"observations":len(path)}

def compare(items,s):
    if len(items)!=s["n"]:raise ValueError("case count mismatch")
    if not items:return
    v=metrics(items)
    mapping={"n":"sample_count","dates":"distinct_signal_dates","stocks":"distinct_stocks","up_pct":"positive_return_probability_pct","mean_pct":"mean_return_pct","median_pct":"median_return_pct","min_pct":"min_return_pct"}
    def eq(a,b,tol):
        return a==b if a is None or b is None else abs(a-b)<=tol
    for a,b in mapping.items():
        if not eq(s[a],v[b],.001001 if a.endswith("_pct") and a!="up_pct" else 1e-8):raise ValueError("case metric mismatch "+a)
    for k,x in v["return_profile"].items():
        if not eq(x,s["profile"][k],.001001 if k.endswith("_pct") or k.endswith("_ratio") or k=="profit_factor" else 1e-8):raise ValueError("case profile mismatch "+k)

def bucket(kind,v):
    if v is None:return "UNKNOWN"
    if kind=="RSI":return "LT30" if v<30 else "30_40" if v<40 else "40_50" if v<50 else "50_60" if v<60 else "60_70" if v<70 else "GE70"
    if kind=="GAP":return "LE0" if v<=0 else "0_2" if v<2 else "GE2"
    if kind=="PRIOR5_MIN":return "LT30" if v<30 else "30_40" if v<40 else "GE40"
    return "LE0" if v<=0 else "0_5" if v<5 else "GE5"
BANDS={"RSI":["LT30","30_40","40_50","50_60","60_70","GE70","UNKNOWN"],"DELTA3":["LE0","0_5","GE5","UNKNOWN"],"DELTA5":["LE0","0_5","GE5","UNKNOWN"],"GAP":["LE0","0_2","GE2","UNKNOWN"],"PRIOR5_MIN":["LT30","30_40","GE40","UNKNOWN"]}
FIELDS={"RSI":"rsi_value","DELTA3":"rsi_delta3","DELTA5":"rsi_delta5","GAP":"rsi_gap","PRIOR5_MIN":"rsi_prior5_min"}

def brief(items):
    if not items:return dict(n=0,dates=0,stocks=0,up_pct=None,mean_pct=None,median_pct=None,payoff=None,pf=None,tail=None)
    v=metrics(items);p=v["return_profile"]
    return dict(n=v["sample_count"],dates=v["distinct_signal_dates"],stocks=v["distinct_stocks"],up_pct=v["positive_return_probability_pct"],mean_pct=v["mean_return_pct"],median_pct=v["median_return_pct"],payoff=p["payoff_ratio"],pf=p["profit_factor"],tail=p["worst_5pct_mean_pct"])

def build(source,evidence,source_hash,factor_hash):
    selected={}
    report=analyze(source,evidence,case_sink=lambda b,g,rows:selected.__setitem__((b,g),rows))
    days=[d["day"] for d in source["eod_days"]];split=len(days)*7//10
    bars={(b["day"],b["code"]):b for b in source["bars"]}
    factors={(f["day"],f["code"]):f for f in evidence["rows"]}
    names={(s["day"],s["code"]):s.get("stock_name_at_signal") for s in source["signals"]}
    report_map={(r["base"],r["condition"],r["entry_basis"],r["horizon"]):r for r in report["rows"] if r["scope"]=="MARKET" and r["sampling"]=="ALL_EVENTS"}
    groups=[];pages=[];audit_cache={}
    for (base,group),cohort in sorted(selected.items()):
        rows=[];outcomes=defaultdict(list);counts=defaultdict(int);research=defaultdict(list)
        for i,c in sorted(cohort,key=lambda x:(-x[0],x[1])):
            d=days[i];b=bars[d,c];f=factors[d,c]
            if (i,c) not in audit_cache:audit_cache[i,c]=independent_rsi(days,bars,i,c,f)
            indicators={k:f.get(k) for k in ("rsi_gc","ma_down","rsi_value","rsi_signal","prior_rsi","prior_rsi_signal","rsi_delta3","rsi_delta5","rsi_gap","rsi_prior5_min","rsi_value_chart_consistent","rsi_cross_value_consistent","ma_chart_consistent","rsi_chart_consistent","ma20","ma40","ma60","amount_ratio20","record_sha256")}
            row=dict(code=c,name=names.get((d,c)),day=d,market=b["market"],ohlc={k:b[k] for k in ("open","high","low","close")},indicators=indicators,rsi_audit=audit_cache[i,c],outcomes={})
            for h in HORIZONS:
                future=days[i+h] if i+h<len(days) else None
                path=[bars.get((x,c)) for x in days[i:i+h+1]] if future else []
                state="PENDING" if not future else "MISSING" if any(x is None for x in path) or len({x["market"] for x in path})!=1 else "COMPLETE"
                counts[h,state]+=1
                out=dict(status=state,end_day=future,entry_day=days[i+1] if future else None,entry_open=None,end_close=None,next_open_return=None,signal_close_return=None)
                if state=="COMPLETE":
                    o,z=path[1]["open"],path[-1]["close"]
                    out.update(entry_open=o,end_close=z,next_open_return=round(float(Fraction(100*(z-o),o)),4),signal_close_return=round(float(Fraction(100*(z-b["close"]),b["close"])),4))
                    for basis,entry in (("NEXT_OPEN",o),("SIGNAL_CLOSE",b["close"])):
                        item=(d,c,entry,z)
                        for arm in ["all"]+(["train"] if i+h<split else ["holdout"] if i>=split else []):
                            outcomes[h,basis,arm].append(item)
                            if basis=="NEXT_OPEN" and group!="LONG_BULL_NOT_JOINT":
                                for k,field in FIELDS.items():research[h,k,bucket(k,f.get(field)),arm].append(item)
                row["outcomes"][str(h)]=out
            rows.append(row)
        horizons={}
        for h in HORIZONS:
            refs={}
            for basis in ("NEXT_OPEN","SIGNAL_CLOSE"):
                r=report_map[base,group,basis,h]
                if r["total_signals"]!=len(rows) or r["pending"]!=counts[h,"PENDING"] or r["missing"]!=counts[h,"MISSING"]:raise ValueError("case coverage mismatch")
                for arm in ("all","train","holdout"):compare(outcomes[h,basis,arm],r[arm])
                refs[basis]={k:r[k] for k in ("all","train","holdout","research_status")}
            bands={}
            if group!="LONG_BULL_NOT_JOINT":
                for kind,bs in BANDS.items():
                    bands[kind]=[dict(band=b,**{arm:brief(research[h,kind,b,arm]) for arm in ("all","train","holdout")}) for b in bs]
                    for arm in ("all","train","holdout"):
                        if sum(x[arm]["n"] for x in bands[kind])!=len(outcomes[h,"NEXT_OPEN",arm]):raise ValueError("RSI partition mismatch")
            horizons[str(h)]=dict(complete=counts[h,"COMPLETE"],pending=counts[h,"PENDING"],missing=counts[h,"MISSING"],stats=refs,bands=bands)
        hashes=[]
        for j in range(0,len(rows),PAGE):
            raw=pack(rows[j:j+PAGE]);hashes.append(digest(raw.encode()))
            pages.append(dict(base=base,group=group,page=j//PAGE,payload=raw,sha256=hashes[-1]))
        groups.append(dict(base=base,group=group,total=len(rows),page_hashes=hashes,horizons=horizons))
    quality=dict(report["quality"])
    for x in audit_cache.values():
        k="rsi_audit_"+x["status"].lower();quality[k]=quality.get(k,0)+1
    manifest=dict(schema="BLUE_PRIVATE_COMBINED_CASES_V1",asof=report["asof"],source_sha256=source_hash,factors_sha256=factor_hash,audit_sessions=len(days),signal_audit_sessions=report["signal_audit_sessions"],page_size=PAGE,quality=quality,groups=groups,scope="EXACT_COHORT_RECONSTRUCTION_STORED_INDICATORS_EXPLORATORY")
    return dict(manifest=pack(manifest),pages=pages)
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for n in ("source","factors","output"):p.add_argument("--"+n,type=Path,required=True)
    a=p.parse_args();s=a.source.read_bytes();f=a.factors.read_bytes()
    out=build(json.loads(s),json.loads(f),digest(s),digest(f))
    a.output.write_text(pack(out)+"\n")
    m=json.loads(out["manifest"])
    print("BLUE_PRIVATE_CASE_RECONSTRUCTION",json.dumps(dict(asof=m["asof"],quality=m["quality"],groups=[dict(base=g["base"],group=g["group"],total=g["total"],mature_3=g["horizons"]["3"]["complete"]) for g in m["groups"]],pages=len(out["pages"])),ensure_ascii=False))

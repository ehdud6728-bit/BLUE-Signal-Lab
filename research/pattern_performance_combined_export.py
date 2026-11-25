"""Validate and publish aggregate-only combined study. No recommendation promotion."""
import argparse,json,math,re,hashlib
from pathlib import Path
from itertools import product
from pattern_performance_combined import BASES,HORIZONS,GROUPS

def check(ok,reason):
    if not ok:raise ValueError(reason)
def nonneg(v):return type(v) is int and v>=0
def finite(v):return type(v) in (float,int) and math.isfinite(v)
def stat(s):
    keys=("n","dates","stocks","up_pct","mean_pct","median_pct","min_pct","profile")
    check(set(s)==set(keys),"invalid stats shape")
    n=s["n"];check(nonneg(n) and all(nonneg(s[k]) and s[k]<=n for k in ("dates","stocks")),"invalid counts")
    if not n:
        check(s["dates"]==s["stocks"]==0 and all(s[k] is None for k in keys[3:]),"invalid empty stats")
        return s
    check(s["dates"]>0 and s["stocks"]>0 and all(finite(s[k]) for k in keys[3:-1]) and 0<=s["up_pct"]<=100 and s["min_pct"]<=s["median_pct"] and s["min_pct"]<=s["mean_pct"],"invalid returns")
    p=s["profile"];fields=("win_count","loss_count","flat_count","mean_gain_pct","mean_loss_pct","payoff_ratio","profit_factor","worst_5pct_mean_pct","tail_count","target_5_pct","target_10_pct","target_20_pct")
    check(isinstance(p,dict) and set(p)==set(fields),"invalid profile")
    check(all(nonneg(p[k]) for k in fields[:3]) and sum(p[k] for k in fields[:3])==n and abs(s["up_pct"]-round(100*p["win_count"]/n,2))<1e-8,"invalid outcome counts")
    check(all(v is None or finite(v) for v in p.values()) and p["tail_count"]==(n+19)//20 and p["worst_5pct_mean_pct"] is not None,"invalid profile metrics")
    check(0<=p["target_20_pct"]<=p["target_10_pct"]<=p["target_5_pct"]<=s["up_pct"],"invalid target rates")
    return s

def convert(report,snapshot):
    check(report.get("schema")=="BLUE_COMBINED_PATTERN_STUDY_V1" and report["asof"]==snapshot["asof"],"combined snapshot date mismatch")
    check(all(re.fullmatch(r"[0-9a-f]{64}",report.get(k,"")) for k in ("source_sha256","factors_sha256")),"missing source provenance")
    days=report["audit_sessions"];covered=report["signal_audit_sessions"]
    check(type(days) is int and 1<=days<=120 and type(covered) is int and 0<=covered<=days,"invalid coverage")
    q=report["quality"];check(all(nonneg(v) for v in q.values()) and q.get("known_factor_stock_days",0)<=q.get("target_signal_stock_days",0),"invalid factor coverage")
    expected=set(product(("MARKET","FOCUS_STOCK"),BASES,GROUPS,("ALL_EVENTS","COOLDOWN_10_PER_CONDITION"),("SIGNAL_CLOSE","NEXT_OPEN"),HORIZONS))
    rows={}
    for r in report["rows"]:
        k=tuple(r[x] for x in ("scope","base","condition","sampling","entry_basis","horizon"))
        check(k in expected and k not in rows,"unexpected or duplicate cohort")
        a,t,h=(stat(r[x]) for x in ("all","train","holdout"))
        check(all(nonneg(r[x]) for x in ("total_signals","pending","missing")) and a["n"]+r["pending"]+r["missing"]==r["total_signals"] and t["n"]+h["n"]<=a["n"],"cohort count mismatch")
        check(r["research_status"] in ("NO_MATURED_CASES","SMALL_SAMPLE","DESCRIPTIVE_ONLY"),"invalid status")
        rows[k]=r
    check(set(rows)==expected,"missing cohort")
    for scope,base,basis,h in product(("MARKET","FOCUS_STOCK"),BASES,("SIGNAL_CLOSE","NEXT_OPEN"),HORIZONS):
        get=lambda g:rows[(scope,base,g,"ALL_EVENTS",basis,h)]
        for field in ("total_signals","pending","missing"):
            check(get("LONG_BULL")[field]==get("JOINT")[field]+get("LONG_BULL_NOT_JOINT")[field],"partition mismatch")
        for arm in ("all","train","holdout"):
            a,b,c=(get(g)[arm] for g in ("LONG_BULL","JOINT","LONG_BULL_NOT_JOINT"))
            check(a["n"]==b["n"]+c["n"],"partition sample mismatch")
            if a["n"]:
                for field in ("win_count","loss_count","flat_count"):
                    check(a["profile"][field]==sum(x["profile"][field] if x["n"] else 0 for x in (b,c)),"partition outcome mismatch")
                check(abs(a["mean_pct"]-sum(x["n"]*(x["mean_pct"] or 0) for x in (b,c))/a["n"])<=.00101,"partition mean mismatch")
    # Individual stock results remain in the Actions report; static site receives market aggregates only.
    allowed=("scope","base","condition","sampling","entry_basis","horizon","total_signals","pending","missing","all","train","holdout","research_status")
    return dict(schema="BLUE_COMBINED_WEB_V1",asof=report["asof"],audit_sessions=days,signal_audit_sessions=covered,
        source_sha256=report["source_sha256"],factors_sha256=report["factors_sha256"],quality=q,
        scope="STORED_FACTOR_EXPLORATORY_PARTITION_CHECKED",rows=[{k:r[k] for k in allowed} for r in rows.values() if r["scope"]=="MARKET"])
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for n in ("input","snapshot","output"):p.add_argument("--"+n,type=Path,required=True)
    a=p.parse_args();raw=a.input.read_bytes();out=convert(json.loads(raw),json.loads(a.snapshot.read_text()));out["report_sha256"]=hashlib.sha256(raw).hexdigest()
    a.output.write_text("// Generated aggregate joint study. No trade recommendation.\nexport const COMBINED_DATA: unknown = "+json.dumps(out,ensure_ascii=False,separators=(",",":"),allow_nan=False)+";\n")

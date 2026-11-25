"""Publish bounded aggregate profitability rows aligned to the existing snapshot."""
import argparse,json,math,re
from datetime import date
from pathlib import Path
GROUPS=("rankings","candle_rankings","detail_rankings","turnover_rankings","market_rankings")
def convert(report,snapshot):
    if report.get("schema")!="BLUE_PATTERN_PERFORMANCE_AUDITED_V1" or report.get("status")!="RESEARCH_ONLY_NO_PRODUCTION_PROMOTION" or report["asof"]!=snapshot["asof"]:
        raise ValueError("profitability source mismatch")
    if date.fromisoformat(report["asof"]).isoformat()!=report["asof"] or report["research_window_sessions"]!=snapshot["audited_sessions"]:raise ValueError("profitability window mismatch")
    rows=[];seen=set()
    for group in GROUPS:
        for r in report.get(group,[]):
            p,h,n,d,s=(r[k] for k in ("pattern","horizon_trading_days","sample_count","distinct_signal_dates","distinct_stocks"))
            if not isinstance(p,str) or not re.fullmatch(r"[A-Z0-9_]+(?:\|[A-Z0-9_]+)*",p) or h not in (1,2,3,5,10,20):raise ValueError("invalid condition")
            if (group,p,h) in seen:raise ValueError("duplicate condition")
            seen.add((group,p,h))
            if not all(type(v) is int for v in (n,d,s)) or not 1<=d<=n or not 1<=s<=n:raise ValueError("invalid counts")
            if n<30 or d<5 or s<10 or any(x=="UNKNOWN" or x.endswith("_UNKNOWN") for x in p.split("|")):continue
            profile=r["return_profile"]
            counts=[profile[k] for k in ("win_count","loss_count","flat_count")]
            if not all(type(v) is int and v>=0 for v in counts) or sum(counts)!=n:raise ValueError("invalid outcome counts")
            row=dict(group=group,pattern=p,horizon=h,n=n,dates=d,stocks=s,
                up_pct=r["positive_return_probability_pct"],mean_pct=r["mean_return_pct"],median_pct=r["median_return_pct"],min_pct=r["min_return_pct"],**profile)
            if any(v is not None and not isinstance(v,str) and (type(v) not in (int,float) or not math.isfinite(v)) for v in row.values()):raise ValueError("invalid metrics")
            if not 0<=row["target_20_pct"]<=row["target_10_pct"]<=row["target_5_pct"]<=row["up_pct"]<=100:raise ValueError("invalid targets")
            rows.append(row)
    if len(rows)>12000:raise ValueError("profitability export exceeds bound")
    return dict(asof=report["asof"],sessions=report["research_window_sessions"],rows=rows)
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for name in ("input","snapshot","output"):p.add_argument("--"+name,type=Path,required=True)
    a=p.parse_args()
    data=convert(json.loads(a.input.read_text()),json.loads(a.snapshot.read_text()))
    a.output.write_text("// Generated audited descriptive research; no production promotion.\nexport const PROFITABILITY_DATA: unknown = "+json.dumps(data,ensure_ascii=False,allow_nan=False,separators=(",",":"))+";\n",encoding="utf-8")

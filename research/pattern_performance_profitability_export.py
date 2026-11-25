"""Publish bounded aggregate profitability rows aligned to the existing snapshot."""
import argparse,json,math,re,hashlib
from datetime import date
from pathlib import Path
from pattern_performance_profitability_audit import supported
GROUPS=("rankings","candle_rankings","detail_rankings","turnover_rankings","market_rankings")
def convert(report,snapshot,audit=None):
    checks=set()
    if audit is not None:
        if audit.get('schema')!='BLUE_PROFITABILITY_AUDIT_V1' or audit.get('asof')!=report['asof'] or audit.get('sessions')!=report['research_window_sessions'] or audit.get('failed')!=0 or not re.fullmatch(r'[a-f0-9]{64}',audit.get('source_sha256','')):raise ValueError('profitability audit mismatch')
        checks={tuple(k) for k in audit['checks']}
        expected={(g,r['pattern'],r['horizon_trading_days']) for g in GROUPS for r in report.get(g,[]) if supported(g,r['pattern'])}
        if checks!=expected or audit['checked']!=len(checks) or audit['unsupported']+len(checks)!=sum(len(report.get(g,[])) for g in GROUPS):raise ValueError('profitability audit coverage mismatch')
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
            row['calculation_audit']='RECOMPUTED_MATCH' if (group,p,h) in checks else 'NOT_CHECKED'
            rows.append(row)
    if len(rows)>12000:raise ValueError("profitability export exceeds bound")
    return dict(asof=report["asof"],sessions=report["research_window_sessions"],rows=rows,audit={k:audit[k] for k in ('source_sha256','report_sha256','checked','unsupported','failed','scope')} if audit is not None else None)
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for name in ("input","snapshot","output"):p.add_argument("--"+name,type=Path,required=True)
    p.add_argument("--audit",type=Path,required=True)
    a=p.parse_args()
    raw=a.input.read_bytes();audit=json.loads(a.audit.read_text())
    if hashlib.sha256(raw).hexdigest()!=audit.get("report_sha256"):raise ValueError("profitability report hash mismatch")
    data=convert(json.loads(raw),json.loads(a.snapshot.read_text()),audit)
    a.output.write_text("// Generated audited descriptive research; no production promotion.\nexport const PROFITABILITY_DATA: unknown = "+json.dumps(data,ensure_ascii=False,allow_nan=False,separators=(",",":"))+";\n",encoding="utf-8")

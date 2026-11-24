import argparse
import json
import math
import re
from datetime import date
from pathlib import Path

def convert(report):
    if report.get("schema") != "BLUE_PATTERN_PERFORMANCE_AUDITED_V1" or report.get("status") != "RESEARCH_ONLY_NO_PRODUCTION_PROMOTION":
        raise ValueError("unexpected research report")
    day = report["asof"]
    if date.fromisoformat(day).isoformat() != day:
        raise ValueError("invalid date")
    sessions = report.get("research_window_sessions",report["audited_sessions"])
    if type(sessions) is not int or not 1 <= sessions <= 60:
        raise ValueError("not a short-window report")
    rows = {}
    seen = set()
    for r in report["rankings"]:
        p = r["pattern"]
        h,n,d = (r[k] for k in ("horizon_trading_days","sample_count","distinct_signal_dates"))
        values = [r[k] for k in ("positive_return_probability_pct","mean_return_pct","median_return_pct")]
        if not re.fullmatch(r"[A-Z0-9_]+",p) or h not in (1,2,3,5,10,20) or (p,h) in seen:
            raise ValueError("invalid pattern/horizon")
        if type(n) is not int or type(d) is not int or not 1 <= d <= min(n,sessions) or not all(type(v) in (int,float) and math.isfinite(v) for v in values) or not 0 <= values[0] <= 100:
            raise ValueError("invalid statistics")
        seen.add((p,h))
        rows.setdefault(p,[]).append([h,n,d,*values])
    if not rows:
        raise ValueError("empty snapshot")
    for rs in rows.values():
        rs.sort()
    return {"asof":day,"audited_sessions":sessions,"window_start":report.get("research_window_start"),"rows":rows}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    result=convert(json.loads(a.input.read_text(encoding="utf-8")))
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+"\n",encoding="utf-8")

if __name__=="__main__":
    main()

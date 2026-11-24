import argparse
import json
import math
import re
from datetime import date
from pathlib import Path

def recommendations(report):
    result = []
    for group in ("rankings", "candle_rankings", "detail_rankings", "turnover_rankings", "market_rankings"):
        for r in report.get(group, []):
            p = r["pattern"]
            h = r["horizon_trading_days"]
            n, d, stocks = (r[k] for k in ("sample_count", "distinct_signal_dates", "distinct_stocks"))
            rate, mean, median = (r[k] for k in ("positive_return_probability_pct", "mean_return_pct", "median_return_pct"))
            if not re.fullmatch(r"[A-Z0-9_]+(?:\\|[A-Z0-9_]+)*", p) or h not in (1,2,3,5,10,20):
                raise ValueError("invalid recommendation condition")
            if not all(type(x) is int for x in (n,d,stocks)) or not 1 <= d <= n or not 1 <= stocks <= n:
                raise ValueError("invalid recommendation counts")
            if not all(type(x) in (int,float) and math.isfinite(x) for x in (rate,mean,median)) or not 0 <= rate <= 100:
                raise ValueError("invalid recommendation returns")
            if rate >= 70 and mean > 0 and median > 0:
                result.append({**r, "group":group, "tier":"SHORT_RECOMMENDATION" if n>=30 and d>=5 and stocks>=10 else "WATCH", "validation":"IN_SAMPLE_ONLY"})
    return sorted(result, key=lambda r:(r["tier"]!="SHORT_RECOMMENDATION",-r["positive_return_probability_pct"],-r["sample_count"],r["pattern"],r["horizon_trading_days"]))

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
    return {"asof":day,"audited_sessions":sessions,"window_start":report.get("research_window_start"),"rows":rows,"recommendations":recommendations(report),"recommendation_policy":{"min_rate":70,"min_samples":30,"min_dates":5,"min_stocks":10,"positive_mean_and_median":True,"independent_of_long_term":True}}

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

#!/usr/bin/env python3
"""Research-only pattern performance from a signal CSV. Never modifies production."""
import argparse
import csv
import json
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import mean, median
from math import ceil

HORIZONS = (3, 5, 10, 20)
REQUIRED = {"code", "signal_date", "pattern", "close", "forward_3d", "forward_5d", "forward_10d", "forward_20d"}

def load(path):
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames or not REQUIRED.issubset(reader.fieldnames):
            raise ValueError("CSV required columns: " + ", ".join(sorted(REQUIRED)))
        rows = []
        seen = set()
        for line, row in enumerate(reader, 2):
            try:
                code = row["code"].strip().zfill(6)
                day = date.fromisoformat(row["signal_date"].strip())
                pattern = row["pattern"].strip()
                close = float(row["close"])
                if not code.isdigit() or len(code) != 6 or not pattern or close <= 0:
                    raise ValueError("invalid signal")
                key = (code, day.isoformat(), pattern)
                if key in seen:
                    raise ValueError("duplicate signal")
                seen.add(key)
                future = {}
                for n in HORIZONS:
                    raw = (row["forward_%dd" % n] or "").strip()
                    future[n] = float(raw) if raw else None
                    if future[n] is not None and future[n] <= 0:
                        raise ValueError("invalid future close")
                rows.append((code, day, pattern, close, future))
            except (ValueError, TypeError, OverflowError) as e:
                raise ValueError("CSV line %d: %s" % (line, e)) from e
    return rows

def return_profile(returns):
    """Gross close-to-close observations, not executable strategy P/L."""
    wins=[r for r in returns if r>0]
    losses=[r for r in returns if r<0]
    gain=mean(wins) if wins else None
    loss=mean(losses) if losses else None
    tail=sorted(returns)[:max(1,ceil(len(returns)*.05))]
    def rnd(v):return round(v,3) if v is not None else None
    return dict(win_count=len(wins),loss_count=len(losses),flat_count=len(returns)-len(wins)-len(losses),
        mean_gain_pct=rnd(gain),mean_loss_pct=rnd(loss),
        payoff_ratio=rnd(gain/abs(loss) if gain is not None and loss is not None else None),
        profit_factor=rnd(sum(wins)/abs(sum(losses)) if losses else None),
        worst_5pct_mean_pct=rnd(mean(tail)),tail_count=len(tail),
        target_5_pct=round(100*sum(r>=5-1e-9 for r in returns)/len(returns),2),
        target_10_pct=round(100*sum(r>=10-1e-9 for r in returns)/len(returns),2),
        target_20_pct=round(100*sum(r>=20-1e-9 for r in returns)/len(returns),2))

def summarize(rows):
    groups = defaultdict(list)
    for code, day, pattern, close, future in rows:
        for horizon, price in future.items():
            if price is not None:
                groups[(pattern, horizon)].append((code, day, (price / close - 1) * 100))
    result = []
    for (pattern, horizon), items in groups.items():
        returns = [r for _, _, r in items]
        result.append({
            "pattern": pattern, "horizon_trading_days": horizon,
            "sample_count": len(items),
            "distinct_stocks": len(set(x[0] for x in items)),
            "distinct_signal_dates": len(set(x[1] for x in items)),
            "positive_return_probability_pct": round(100 * sum(r > 0 for r in returns) / len(returns), 2),
            "mean_return_pct": round(mean(returns), 3),
            "median_return_pct": round(median(returns), 3),
            "min_return_pct": round(min(returns), 3),
            "max_return_pct": round(max(returns), 3),
            "return_profile": return_profile(returns),
            "warning": "DESCRIPTIVE_ONLY_NOT_VALIDATED_WIN_RATE"
        })
    return sorted(result, key=lambda x: (x["horizon_trading_days"], -x["positive_return_probability_pct"], -x["sample_count"], x["pattern"]))

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", required=True, type=Path)
    p.add_argument("--output", required=True, type=Path)
    a = p.parse_args()
    rows = load(a.input)
    result = {
        "schema": "BLUE_PATTERN_PERFORMANCE_RESEARCH_V1",
        "status": "RESEARCH_ONLY_NO_PRODUCTION_PROMOTION",
        "definition": "close-to-future-close, positive if return > 0, no fees, no execution",
        "signal_rows": len(rows),
        "caveats": [
            "Input forward prices must be from trading-day-indexed historical data, never calendar-day offsets.",
            "Recent incomplete horizons are excluded, not counted as failures.",
            "Overlapping signals are not independent observations.",
            "No out-of-sample validation, benchmark adjustment, transaction costs, MAE/MFE or intraday stop/take execution.",
            "Pattern selection and forward-return data must not leak future information."
        ],
        "rankings": summarize(rows)
    }
    a.output.parent.mkdir(parents=True, exist_ok=True)
    a.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Research report:", a.output, "rows:", len(rows), "rankings:", len(result))

if __name__ == "__main__":
    main()

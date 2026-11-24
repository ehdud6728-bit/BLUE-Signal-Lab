"""Build reviewable web data and compare consecutive audited snapshots."""
import argparse
import json
from pathlib import Path
from datetime import date

def index(snapshot):
    result = {}
    for r in snapshot["recommendations"]:
        if r["tier"] != "SHORT_RECOMMENDATION":
            continue
        key = (r["group"], r["pattern"], r["horizon_trading_days"])
        if key in result:
            raise ValueError("duplicate recommendation")
        result[key] = r
    return result

def compare(previous, current):
    if date.fromisoformat(previous["asof"]) >= date.fromisoformat(current["asof"]):
        raise ValueError("comparison requires an earlier snapshot")
    old, new = index(previous), index(current)
    changes = []
    for key in sorted(old.keys() | new.keys()):
        a, b = old.get(key), new.get(key)
        delta = None if a is None or b is None else round(b["positive_return_probability_pct"] - a["positive_return_probability_pct"], 3)
        status = "NEW" if a is None else "REMOVED" if b is None else "STRENGTHENED" if delta >= 5 else "WEAKENED" if delta <= -5 else "MAINTAINED"
        changes.append(dict(group=key[0], pattern=key[1], horizon=key[2], status=status, rate_delta_pp=delta, previous=a, current=b))
    return dict(previous_asof=previous["asof"], asof=current["asof"], changes=changes, interpretation="DESCRIPTIVE_ONLY")

def typescript(snapshot):
    index(snapshot)
    def dump(value):
        return json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2)
    return "// Generated from audited research; not independently validated.\n" + "export const RECENT_ASOF=" + dump(snapshot["asof"]) + ";\nexport const RECENT_SESSIONS=" + dump(snapshot["audited_sessions"]) + ";\nexport const RECENT_ROWS:Record<string,number[][]>=" + dump(snapshot["rows"]) + ";\nexport const RECENT_RECOMMENDATIONS=" + dump(snapshot["recommendations"]) + ";\n"

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", type=Path, required=True)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--previous", type=Path)
    p.add_argument("--changes", type=Path)
    a = p.parse_args()
    if bool(a.previous) != bool(a.changes):
        p.error("--previous and --changes must be paired")
    current = json.loads(a.input.read_text(encoding="utf-8"))
    generated = typescript(current)
    if a.previous:
        changes = compare(json.loads(a.previous.read_text(encoding="utf-8")), current)
        a.changes.write_text(json.dumps(changes, ensure_ascii=False, allow_nan=False, indent=2)+"\n", encoding="utf-8")
    a.output.write_text(generated, encoding="utf-8")

if __name__ == "__main__":
    main()

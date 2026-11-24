"""Convert audited Turso exit-source JSON to descriptive pattern performance.
No database writes; exact audited-session offsets, not per-stock offsets.
"""
import argparse
import json
import re
from pathlib import Path
from pattern_performance_phase1 import HORIZONS, summarize
from datetime import date

def analyze(source):
    if source.get("format") != "BLUE_TURSO_EXIT_SOURCE_V1" or source.get("audits_readback_verified") is not True:
        raise ValueError("audited source required")
    days = [d["day"] for d in source["eod_days"]]
    if days != sorted(set(days)) or any(d["expected"] != d["actual"] for d in source["eod_days"]):
        raise ValueError("incomplete audited sessions")
    index = {d:i for i,d in enumerate(days)}
    bars = {}
    for b in source["bars"]:
        key = (b["day"], b["code"])
        if key in bars or key[0] not in index or type(b["close"]) is not int or b["close"] <= 0:
            raise ValueError("invalid bar")
        bars[key] = b["close"]
    rows = []
    seen = set()
    missing = {n:0 for n in HORIZONS}
    for s in source["signals"]:
        d,c = s["day"],s["code"]
        if not re.fullmatch(r"[0-9A-Z]{6}",c) or (d,c) not in bars or (d,c) in seen:
            raise ValueError("invalid signal")
        seen.add((d,c))
        future = {n:bars.get((days[index[d]+n],c)) if index[d]+n<len(days) else None for n in HORIZONS}
        for p in s["names"]:
            rows.append((c,date.fromisoformat(d),p,bars[d,c],future))
            for n in HORIZONS:
                missing[n] += future[n] is None
    return {"schema":"BLUE_PATTERN_PERFORMANCE_AUDITED_V1",
            "status":"RESEARCH_ONLY_NO_PRODUCTION_PROMOTION",
            "asof":source["asof_day"],"audited_sessions":len(days),
            "research_audited_days":source["research_audited_days"],
            "excluded_research_days":source["research_excluded_days"],
            "signal_events":len(rows),"missing_by_horizon":missing,
            "trading_calendar_verified":False,"corporate_actions_verified":False,
            "definition":"positive close-to-close return after N audited EOD sessions; missing outcomes excluded",
            "rankings":summarize(rows)}

if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--input",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    result=analyze(json.loads(a.input.read_text(encoding="utf-8")))
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

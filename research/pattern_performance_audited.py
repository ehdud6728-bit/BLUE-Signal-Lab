"""Convert audited Turso exit-source JSON to descriptive pattern performance.
No database writes; exact audited-session offsets, not per-stock offsets.
"""
import argparse
import json
import re
from pathlib import Path
from pattern_performance_phase1 import summarize
HORIZONS = (1, 2, 3, 5, 10, 20)
from datetime import date

def candle(b):
    o,h,l,c = (b[k] for k in ("open","high","low","close"))
    if not (0 < l <= min(o,c) <= max(o,c) <= h):
        raise ValueError("invalid OHLC")
    span=h-l
    if not span: return "FLAT"
    body=abs(c-o)/span
    lower=(min(o,c)-l)/span
    upper=(h-max(o,c))/span
    if body<=0.1: return "DOJI"
    if lower>=0.6 and upper<=0.15: return "LOWER_WICK"
    if upper>=0.6 and lower<=0.15: return "UPPER_WICK"
    if body>=0.7: return "LONG_BULL" if c>o else "LONG_BEAR"
    return "BULL" if c>o else "BEAR"

def market_regime(b):
    if not b or b["matched5"] < 0.8*b["universe"] or not b["matched5"]:
        return "UNKNOWN"
    ratio=b["up5"]/b["matched5"]
    return "BROAD_UP" if ratio>=0.6 else "BROAD_WEAK" if ratio<=0.4 else "MIXED"

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
    candles, markets, details = [], [], []
    raw_bars = {(b['day'],b['code']):b for b in source['bars']}
    breadth = {b['day']:b for b in source.get('market_breadth_by_day',[]) if b['scope']=='ALL'}
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
            bar=raw_bars[d,c]
            shape=candle(bar) if all(k in bar for k in ("open","high","low")) else "UNKNOWN"
            regime=market_regime(breadth.get(d))
            candles.append((c,date.fromisoformat(d),p+"|"+shape,bars[d,c],future))
            markets.append((c,date.fromisoformat(d),p+"|"+regime,bars[d,c],future))
            if shape != "UNKNOWN":
                span=bar["high"]-bar["low"]
                if span:
                    body=abs(bar["close"]-bar["open"])/span
                    position=(bar["close"]-bar["low"])/span
                    body_bin="BODY_10_30" if body<0.3 else "BODY_30_50" if body<0.5 else "BODY_50_70" if body<0.7 else "BODY_70_PLUS"
                    pos_bin="CLOSE_LOW" if position<0.33 else "CLOSE_MID" if position<0.67 else "CLOSE_HIGH"
                    if shape=="BULL":
                        for feature in (body_bin,pos_bin,"MARKET_"+regime):
                            details.append((c,date.fromisoformat(d),p+"|BULL|"+feature,bars[d,c],future))
                prev=bars.get((days[index[d]-1],c)) if index[d]>0 else None
                if prev:
                    change=100*(bars[d,c]/prev-1)
                    band="NEGATIVE" if change<0 else "UP_0_2" if change<2 else "UP_2_5" if change<5 else "UP_5_10" if change<10 else "UP_10_PLUS"
                    details.append((c,date.fromisoformat(d),p+"|"+shape+"|"+band,bars[d,c],future))
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
            "rankings":summarize(rows),
            "candle_rankings":summarize(candles),
            "market_rankings":summarize(markets),
            "detail_rankings":summarize(details),
            "subgroup_warning":"Exploratory only; small and overlapping samples; same-day close-known features; no independent holdout or corporate action adjustment."}

if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--input",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    result=analyze(json.loads(a.input.read_text(encoding="utf-8")))
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

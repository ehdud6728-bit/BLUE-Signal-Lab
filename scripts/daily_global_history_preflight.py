"""Read-only preflight: compare legacy and corrected market classification."""
from __future__ import annotations
import argparse
from datetime import date
import json
from pathlib import Path
import pandas as pd
from market_scan import load_marcap, normalise, enrich
from market_scan_r11 import merge_verified_days
from market_scan_r08_diagnostics import scan_r08
from corporate_actions import adjust_verified_actions
from turso_history_replay_source import load_verified_day
from daily_global_history_scope import project_daily_global

TARGETS=("2026-11-16","2026-11-17","2026-11-19","2026-11-23","2026-11-27")
CASES={"2026-11-19":"096530","2026-11-23":"006730"}
FIELDS=("open","high","low","close","volume","amount")

def compare_history(code, day, clean, previous_days, official):
    hist=clean.loc[clean.code.eq(code)&clean.date.le(day)]
    dates=hist.date.dt.strftime("%Y-%m-%d").tolist()
    wanted=previous_days+[day]
    actual=hist.set_index(hist.date.dt.strftime("%Y-%m-%d"))
    refs=[official[d].get(code) for d in wanted]
    missing=[d for d,ref in zip(wanted,refs) if ref is not None and d not in actual.index]
    no_trade=sum(ref is None for ref in refs)
    mismatch=0
    for d,ref in zip(wanted,refs):
        if ref is not None and d in actual.index:
            row=actual.loc[d]
            if any(row[f]!=ref[f] for f in FIELDS):
                mismatch+=1
    exact=not missing and not no_trade and not mismatch and dates[-21:]==wanted
    return {"history_bars":len(hist),"missing_official_traded_days":len(missing),
            "official_no_usable_trade_rows":no_trade,"value_mismatch_days":mismatch,
            "last21_session_match":dates[-21:]==wanted,"prior20_exact_krx":exact}

def run(root):
    raw,hashes=load_marcap([2025,2026])
    sessions=sorted(p.name for p in Path(root).iterdir() if p.is_dir())
    official={}
    for d in sessions:
        f,_=load_verified_day(Path(root)/d,date.fromisoformat(d))
        official[d]={r.code:{k:getattr(r,k) for k in FIELDS} for r in normalise(f).itertuples(index=False)}
    reports=[]
    for day in TARGETS:
        target=date.fromisoformat(day)
        idx=sessions.index(day)
        if idx<20: raise ValueError("GLOBAL_PREFLIGHT_INSUFFICIENT_SESSIONS")
        previous=sessions[idx-20:idx]
        verified,_=load_verified_day(Path(root)/day,target)
        projected,scope=project_daily_global(raw,verified,target)
        codes=set(scope.pop("codes"))
        if not codes: raise ValueError("GLOBAL_PREFLIGHT_NO_PROJECTED_ROWS")
        # Source and repaired paths are identical except this bounded classification.
        # All affected active symbols are compared, not just the two known cases.
        def restrict(frame):
            return frame.loc[frame.Code.astype(str).str.replace(r"\.0$","",regex=True).str.zfill(6).isin(codes)].copy()
        frame=raw.reset_index() if "Date" not in raw.columns and raw.index.name=="Date" else raw
        v=verified.loc[verified.Code.isin(codes)]
        old=merge_verified_days(restrict(frame),target,[v],[day])
        new=merge_verified_days(restrict(projected),target,[v],[day])
        old_clean,new_clean=normalise(old),normalise(new)
        old_adjusted,_=adjust_verified_actions(old,target)
        new_adjusted,_=adjust_verified_actions(new,target)
        old_rows,old_audit=scan_r08(old_adjusted,day)
        new_rows,new_audit=scan_r08(new_adjusted,day)
        before={x["code"]:x["signals"] for x in old_rows}
        after={x["code"]:x["signals"] for x in new_rows}
        changes={"added":len(after.keys()-before.keys()),"removed":len(before.keys()-after.keys()),"changed":sum(before[k]!=after[k] for k in before.keys()&after.keys())}
        pairs=[(compare_history(c,day,old_clean,previous,official),compare_history(c,day,new_clean,previous,official)) for c in sorted(codes)]
        result={"day":day,**scope,"legacy":old_audit,"candidate":new_audit,"signal_changes":changes,
                "legacy_exact_prior20":sum(a["prior20_exact_krx"] for a,b in pairs),
                "candidate_exact_prior20":sum(b["prior20_exact_krx"] for a,b in pairs),
                "legacy_missing_traded_rows":sum(a["missing_official_traded_days"] for a,b in pairs),
                "candidate_missing_traded_rows":sum(b["missing_official_traded_days"] for a,b in pairs),
                "candidate_mismatch_days":sum(b["value_mismatch_days"] for a,b in pairs)}
        if day in CASES:
            c=CASES[day]
            result["known_case"]={"in_scope":c in codes,
                "legacy":compare_history(c,day,old_clean,previous,official),
                "candidate":compare_history(c,day,new_clean,previous,official),
                "legacy_signal_present":c in before,"candidate_signal_present":c in after,
                "signal_unchanged":c in before and c in after and before[c]==after[c]}
        reports.append(result)
        print("BLUE_GLOBAL_PREFLIGHT_DAY",json.dumps({k:result[k] for k in ("day","changed_codes","legacy_exact_prior20","candidate_exact_prior20","signal_changes")}),flush=True)
    return {"schema":"BLUE_DAILY_GLOBAL_PREFLIGHT_V1","source_sha256_by_year":hashes,"results":reports,
            "scope":"only target KRX KOSDAQ members with explicit GLOBAL history; current MARCAP, not historical archived bytes",
            "limitations":["No production or database changes. Past snapshots remain immutable.","No-trade or missing official rows are not classified as errors.","Current MARCAP source may differ from original archived source.","No adjustment parity asserted; unadjusted source rows compared before indicator adjustment."],"writes":0}

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--root",default="output/global-preflight/private-eod")
    p.add_argument("--out",default="output/global-preflight/report.json")
    a=p.parse_args()
    result=run(a.root)
    path=Path(a.out);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

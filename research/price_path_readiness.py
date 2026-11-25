"""Price-path research stage 1: audited sample readiness, not a forecast.

Never compute or publish live prediction values from an unverified trading
calendar or corporate-action basis. Reuse the existing read-only export;
no DB writes, no new data provider, no retired-pattern reactivation.
"""
import argparse
from collections import Counter
from datetime import date
from hashlib import sha256
import json
from pathlib import Path
import re
from statistics import mean

PATTERN = "ENV20_LOWER_TOUCH"
HORIZONS = (1, 3, 5, 10, 20)
MIN_TRAIN, MIN_TEST = 100, 50
MIN_TRAIN_DAYS, MIN_TEST_DAYS = 20, 10
QUANTILES = (.10, .50, .90)

def check(ok, msg):
    if not ok:
        raise ValueError(msg)

def valid_day(s):
    try:
        return isinstance(s, str) and re.fullmatch(r"20\d\d-\d\d-\d\d", s) and date.fromisoformat(s).isoformat()==s
    except ValueError:
        return False

def quantile(values, q):
    """Linear sample quantile (Type 7). For offline synthetic validation."""
    from math import isfinite
    check(bool(values) and all(isfinite(x) for x in values) and 0 <= q <= 1, "INVALID_QUANTILE")
    a=sorted(values)
    x=(len(a)-1)*q
    i=int(x)
    return a[i]+(a[min(i+1,len(a)-1)]-a[i])*(x-i)

def evaluate_fixed_distribution(train_returns, test_returns):
    """Synthetic/offline core only. Return-space baseline and interval score.
    Callers must have independently verified input, embargo and held-out dates.
    This function is NOT invoked by the production readiness workflow.
    """
    from math import isfinite, sqrt
    check(bool(test_returns) and all(isfinite(x) for x in test_returns), "INVALID_TEST")
    lo,mid,hi=[quantile(train_returns,q) for q in QUANTILES]
    errors=[abs(x-mid) for x in test_returns]
    return dict(p10=lo,p50=mid,p90=hi, n=len(test_returns),
        mae_pp=mean(errors),rmse_pp=sqrt(mean(e*e for e in errors)),
        zero_return_mae_pp=mean(abs(x) for x in test_returns),
        direction_accuracy=mean((mid>0 and x>0) or (mid<0 and x<0) or (mid==0 and x==0) for x in test_returns),
        interval_coverage=mean(lo<=x<=hi for x in test_returns),
        interval_width_pp=hi-lo,
        interval_score_pp=mean((hi-lo)+10*max(lo-x,0)+10*max(x-hi,0) for x in test_returns))

def readiness(source):
    check(source.get("format")=="BLUE_TURSO_EXIT_SOURCE_V1" and source.get("storage")=="TURSO" and source.get("audits_readback_verified") is True,"INVALID_SOURCE")
    ledger=source["eod_days"]
    days=[r["day"] for r in ledger]
    check(1<=len(days)<=520 and all(valid_day(d) for d in days) and days==sorted(set(days)) and source.get("asof_day")==days[-1],"INVALID_SESSIONS")
    check(all(type(r["expected"]) is int and 1700<=r["expected"]<=10000 and r["actual"]==r["expected"] for r in ledger),"INCOMPLETE_LEDGER")
    ix={d:i for i,d in enumerate(days)}
    audited=source["research_audited_dates"]
    check(audited==sorted(set(audited)) and set(audited)<=set(days) and len(audited)==source["research_audited_days"],"INVALID_SIGNAL_DATES")
    excluded=source.get("research_excluded_days",[])
    excluded_days=[r["day"] for r in excluded]
    check(len(set(excluded_days))==len(excluded_days) and set(excluded_days)<=set(days) and not set(excluded_days)&set(audited),"INVALID_EXCLUSIONS")
    check(len(source["bars"])<=350000 and len(source["signals"])<=100000,"SOURCE_LIMIT")
    bars=set()
    for b in source["bars"]:
        key=(b["day"],b["code"])
        p=[b[k] for k in ("open","high","low","close")]
        check(key[0] in ix and re.fullmatch(r"[0-9A-Z]{6}",key[1]) and key not in bars and all(type(x) is int and x>0 for x in p) and p[2]<=min(p[0],p[3])<=max(p[0],p[3])<=p[1],"INVALID_BAR")
        bars.add(key)
    seen=set()
    events=[]
    for s in source["signals"]:
        key=(s["day"],s["code"])
        names=s["names"]
        check(key not in seen and key in bars and key[0] in audited and isinstance(names,list) and bool(names) and all(isinstance(t,str) and re.fullmatch(r"[A-Z0-9_]{2,60}",t) for t in names) and names==sorted(set(names)),"INVALID_SIGNAL")
        seen.add(key)
        if PATTERN in names:
            events.append(key)
    # Fixed chronological split across all audited EOD dates, not picked by returns.
    # Training outcome MUST end strictly before the first holdout session.
    cut=max(1,int(len(days)*.75))
    split=days[cut] if cut<len(days) else None
    report=[]
    for h in HORIZONS:
        counts=Counter()
        cohorts={"train":[],"holdout":[]}
        for d,c in events:
            i=ix[d]
            end=i+h
            if end>=len(days):
                counts["pending"]+=1
            elif any((x,c) not in bars for x in days[i:end+1]):
                counts["missing_path"]+=1
            elif end<cut:
                cohorts["train"].append((d,c))
            elif i>=cut:
                cohorts["holdout"].append((d,c))
            else:
                counts["embargo"]+=1
        row=dict(horizon_audited_observations=h,events=len(events),pending=counts["pending"],
                 missing_path=counts["missing_path"],embargo=counts["embargo"])
        for k,v in cohorts.items():
            row[k]=dict(n=len(v),signal_days=len({d for d,c in v}),symbols=len({c for d,c in v}))
        check(sum(row[k]["n"] for k in cohorts)+row["pending"]+row["missing_path"]+row["embargo"]==len(events),"COUNT_MISMATCH")
        row["sample_floor_met"]=(row["train"]["n"]>=MIN_TRAIN and row["train"]["signal_days"]>=MIN_TRAIN_DAYS and row["holdout"]["n"]>=MIN_TEST and row["holdout"]["signal_days"]>=MIN_TEST_DAYS)
        report.append(row)
    # The current exporter does not supply independent proof. Even a true
    # flag is not sufficient to turn on live forecasts in this first stage.
    return dict(schema="BLUE_PRICE_PATH_READINESS_V1",asof=days[-1],first_day=days[0],
        audited_eod_dates=len(days),audited_signal_dates=len(audited),excluded_signal_dates=excluded,
        pattern=PATTERN,holdout_start=split,source_bar_count=len(bars),signal_stock_days=len(seen),
        sample_policy=dict(train=MIN_TRAIN,train_days=MIN_TRAIN_DAYS,holdout=MIN_TEST,holdout_days=MIN_TEST_DAYS),
        training_quantiles=list(QUANTILES),reference_basis="SIGNAL_DAY_CLOSE_NOT_EXECUTED_ENTRY",
        status="READINESS_ONLY",calendar_verified=source.get("trading_calendar_verified") is True,
        corporate_actions_verified=source.get("corporate_actions_verified") is True,
        forecast_enabled=False,report=report,
        limitations=["AUDITED_OBSERVATION_OFFSETS_NOT_PROVEN_CONSECUTIVE_SESSIONS","INDEPENDENT_CORPORATE_ACTION_PROOF_REQUIRED","SAME_DAY_AND_SYMBOL_EVENTS_DEPENDENT","SIGNAL_UNIVERSE_CODE_PARITY_UNVERIFIED","SAMPLE_FLOORS_NOT_STATISTICAL_SIGNIFICANCE","NO_REAL_FORECAST_OR_ACCURACY_ESTIMATE"])

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--source",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    raw=a.source.read_bytes()
    result=readiness(json.loads(raw))
    result["source_sha256"]=sha256(raw).hexdigest()
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False)+"\n")
    print("BLUE_PRICE_PATH_READINESS",json.dumps(result,ensure_ascii=False,separators=(",",":")))

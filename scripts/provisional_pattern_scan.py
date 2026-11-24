"""Offline provisional scan using the production R1.1 calculation stack.
Input history must be independently verified by the caller. Never publish to
confirmed EOD or research tables. No network or database operations.
"""
import argparse,json
from pathlib import Path
import pandas as pd
from market_scan_r08 import COLS
from corporate_actions import adjust_verified_actions
from market_scan import normalise
from turso_parallel_pattern_scan import scan_r08_parallel

def scan_provisional(history, quotes, day, reference, now, workers=1):
    target=pd.Timestamp(day)
    clock=pd.Timestamp(now)
    if clock.tzinfo is None or clock.tz_convert("Asia/Seoul").date()!=target.date() or target.weekday()>=5:
        raise ValueError("invalid target clock")
    if pd.Timestamp(reference)>=target: raise ValueError("invalid reference")
    clean=normalise(history)
    if clean.empty or clean.date.max()!=pd.Timestamp(reference): raise ValueError("history must end at reference")
    ref=clean[clean.date.eq(pd.Timestamp(reference))].set_index("code")
    rows=[]; times={}; excluded=0
    for q in quotes:
        code=q["code"]
        if code in times: raise ValueError("duplicate quote")
        times[code]=q["observed_at_utc"]
        at=pd.Timestamp(times[code])
        if at.tzinfo is None or at.tz_convert("Asia/Seoul").date()!=target.date() or at>clock: raise ValueError("invalid quote timestamp")
        if q["day"]!=day or q["reference_day"]!=reference or code not in ref.index: raise ValueError("invalid quote reference")
        if q["source"] not in ("KIS_REST_INQUIRE_PRICE_PROVISIONAL","KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL"): raise ValueError("invalid quote source")
        o,h,l,c,v,a=(q.get(k) for k in ("open","high","low","close","volume","amount"))
        if any(type(x) is not int for x in (o,h,l,c,v,a)) or not 0<l<=min(o,c)<=max(o,c)<=h or v<=0 or a<=0:
            excluded+=1;continue
        rows.append(dict(Date=target,Code=code,Name=q.get("name") or code,Market=q["market"],Open=o,High=h,Low=l,Close=c,Volume=v,Amount=a))
    if not rows: return dict(day=day,status="KIS_PROVISIONAL",observed=len(quotes),eligible=0,excluded=excluded,items=[])
    base=history.reset_index() if "Date" not in history.columns and history.index.name=="Date" else history.copy()
    base=base.loc[base.Code.astype(str).str.zfill(6).isin([r["Code"] for r in rows])]
    combined=pd.concat([base[COLS],pd.DataFrame(rows,columns=COLS)],ignore_index=True)
    adjusted,_=adjust_verified_actions(normalise(combined),day)
    # The shared scanner accepts the original provider column schema.
    # Preserve action status columns and adjusted OHLC via the normalised aliases.
    for upper,lower in zip(("Date","Code","Open","High","Low","Close","Volume","Amount"),("date","code","open","high","low","close","volume","amount")):
        if lower in adjusted: adjusted[upper]=adjusted[lower]
    matches,audit=scan_r08_parallel(adjusted,day,workers=workers)
    for r in matches:
        r.update(provisional=True,pattern_confirmed=False,observed_at_utc=times[r["code"]],source="KIS_PROVISIONAL",data_frequency="PROVISIONAL_DAILY")
    return dict(day=day,status="KIS_PROVISIONAL",observed=len(quotes),eligible=audit["eligible_stocks"],excluded=excluded,items=matches,audit=audit)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    for k in ("history","quotes","day","reference","now","output"):p.add_argument("--"+k,required=True)
    a=p.parse_args()
    history=pd.read_csv(a.history,dtype={"Code":str})
    result=scan_provisional(history,json.loads(Path(a.quotes).read_text()),a.day,a.reference,a.now)
    Path(a.output).write_text(json.dumps(result,ensure_ascii=False,default=str,allow_nan=False))

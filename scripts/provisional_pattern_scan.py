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
    rows=[]; times={}; seen=set(); missing_amount=set()
    excluded_reference=excluded_ohlcv=0
    for q in quotes:
        code=q["code"]
        if code in seen: raise ValueError("duplicate quote")
        seen.add(code)
        at=pd.Timestamp(q["observed_at_utc"])
        if at.tzinfo is None or at.tz_convert("Asia/Seoul").date()!=target.date() or at>clock: raise ValueError("invalid quote timestamp")
        if q["day"]!=day: raise ValueError("invalid quote day")
        if q["source"] not in ("KIS_REST_INQUIRE_PRICE_PROVISIONAL","KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL"): raise ValueError("invalid quote source")
        if q["reference_day"]!=reference or code not in ref.index:
            excluded_reference+=1;continue
        o,h,l,c,v,a=(q.get(k) for k in ("open","high","low","close","volume","amount"))
        if any(type(x) is not int for x in (o,h,l,c,v)) or not 0<l<=min(o,c)<=max(o,c)<=h or v<=0:
            excluded_ohlcv+=1;continue
        # The shared R1.1 normaliser requires a numeric Amount. Its signal
        # selection uses OHLCV, not amount. Use a private placeholder only
        # for calculation and remove all derived current-turnover values
        # before returning any item; never represent missing amount as zero.
        if type(a) is not int or a<=0:
            missing_amount.add(code)
            a=0
        times[code]=q["observed_at_utc"]
        rows.append(dict(Date=target,Code=code,Name=q.get("name") or code,Market=str(ref.loc[code,"market"]),Open=o,High=h,Low=l,Close=c,Volume=v,Amount=a))
    excluded=excluded_reference+excluded_ohlcv
    coverage=dict(excluded_reference=excluded_reference,excluded_ohlcv=excluded_ohlcv,
                  accepted_quotes=len(rows),turnover_available_quotes=len(rows)-len(missing_amount),
                  turnover_missing_quotes=len(missing_amount))
    if not rows: return dict(day=day,status="KIS_PROVISIONAL",observed=len(quotes),eligible=0,excluded=excluded,items=[],**coverage)
    base=history.reset_index() if "Date" not in history.columns and history.index.name=="Date" else history.copy()
    base=base.loc[base.Code.astype(str).str.replace(r"\.0$", "", regex=True).str.zfill(6).isin([r["Code"] for r in rows])]
    combined=pd.concat([base[COLS],pd.DataFrame(rows,columns=COLS)],ignore_index=True)
    adjusted,_=adjust_verified_actions(combined,target.date())
    matches,audit=scan_r08_parallel(adjusted,day,workers=workers)
    for r in matches:
        r.update(provisional=True,pattern_confirmed=False,observed_at_utc=times[r["code"]],source="KIS_PROVISIONAL",data_frequency="PROVISIONAL_DAILY",turnover_available=r["code"] not in missing_amount)
        if not r["turnover_available"]:
            r["traded_amount_krw"]=None
            r["amount_ratio20"]=None
    return dict(day=day,status="KIS_PROVISIONAL",observed=len(quotes),eligible=audit["eligible_stocks"],excluded=excluded,items=matches,audit=audit,**coverage)

if __name__=="__main__":
    p=argparse.ArgumentParser()
    for k in ("history","quotes","day","reference","now","output"):p.add_argument("--"+k,required=True)
    a=p.parse_args()
    history=pd.read_csv(a.history,dtype={"Code":str})
    result=scan_provisional(history,json.loads(Path(a.quotes).read_text()),a.day,a.reference,a.now)
    Path(a.output).write_text(json.dumps(result,ensure_ascii=False,default=str,allow_nan=False))

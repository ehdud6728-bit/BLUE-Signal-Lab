"""Prepare prior-session history using the existing R1.1 provider stack.
Marcap baseline is not represented as independently audited KRX history.
"""
import argparse,json,os
from pathlib import Path
from datetime import date
import pandas as pd
from market_scan import load_marcap,normalise
from market_scan_r08 import COLS
from market_scan_r11 import upgraded_history,selected_provider

def prepare(raw,reference,provider,key,upgrade=upgraded_history):
    ref=pd.Timestamp(reference)
    base=raw.reset_index() if "Date" not in raw.columns and raw.index.name=="Date" else raw.copy()
    base=base.loc[pd.to_datetime(base.Date).dt.normalize().le(ref)].copy()
    combined,added,source=upgrade(base,ref.date(),False,provider,key,force_exact_day=True,allow_verified_fallback=True)
    clean=normalise(combined)
    if clean.empty or clean.date.max()!=ref or clean.date.nunique()<225:
        raise ValueError("INSUFFICIENT_PRIOR_HISTORY")
    if len(clean[clean.date.eq(ref)])<1700:
        raise ValueError("INCOMPLETE_REFERENCE")
    return combined,dict(reference=reference,sessions=int(clean.date.nunique()),krx_added_days=added,reference_source=source,calendar_verified=False,baseline="MARCAP")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--reference",required=True)
    p.add_argument("--output",required=True)
    p.add_argument("--local-data-dir",default=None)
    a=p.parse_args()
    ref=date.fromisoformat(a.reference)
    raw,hashes=load_marcap([ref.year-1,ref.year],a.local_data_dir)
    key=os.getenv("KRX_AUTH_KEY","")
    provider=selected_provider("auto",key,bool(os.getenv("KRX_DATA_ID") and os.getenv("KRX_DATA_PW")))
    history,meta=prepare(raw,a.reference,provider,key)
    if "Date" not in history.columns: history=history.reset_index()
    history[COLS].to_csv(a.output,index=False)
    Path(a.output+".meta.json").write_text(json.dumps(dict(meta,baseline_hashes=hashes),ensure_ascii=False))
if __name__=="__main__":main()

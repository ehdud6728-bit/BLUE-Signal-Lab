"""Candidate daily scope repair. Copy-only; no change to v1/v2 legacy scanner."""
from __future__ import annotations
import pandas as pd

def project_daily_global(raw, verified, target):
    """Only exact target KRX KOSDAQ members; no future or fuzzy labels."""
    target=pd.Timestamp(target).normalize()
    frame=raw.reset_index() if "Date" not in raw.columns and raw.index.name=="Date" else raw.copy()
    if not {"Date","Code","Market"}.issubset(frame.columns) or not {"Date","Code","Market"}.issubset(verified.columns):
        raise ValueError("GLOBAL_SCOPE_SCHEMA")
    stamps=pd.to_datetime(frame.Date,errors="raise").dt.normalize()
    proof_dates=pd.to_datetime(verified.Date,errors="raise").dt.normalize()
    if not proof_dates.eq(target).all() or verified.empty or verified.Code.duplicated().any():
        raise ValueError("GLOBAL_SCOPE_TARGET_PROOF")
    proof_codes=verified.Code.astype(str)
    if not proof_codes.str.fullmatch("[0-9A-Z]{6}").all() or not verified.Market.isin(["KOSPI","KOSDAQ"]).all():
        raise ValueError("GLOBAL_SCOPE_MARKET_PROOF")
    codes=frame.Code.astype(str).str.replace(r"\.0$","",regex=True).str.zfill(6)
    kosdaq=set(proof_codes[verified.Market.eq("KOSDAQ")])
    changed=stamps.le(target)&frame.Market.eq("KOSDAQ GLOBAL")&codes.isin(kosdaq)
    # A duplicate date/code must fail the existing normaliser after projection.
    frame.loc[changed,"Market"]="KOSDAQ"
    return frame,{"scope":"DAILY_KRX_TARGET_KOSDAQ_GLOBAL_COPY_V1","changed_rows":int(changed.sum()),"changed_codes":len(set(codes[changed])),"codes":sorted(set(codes[changed]))}

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


def prepare_verified_daily_scope(upgraded, verified, target):
    """Project only an already proved KRX target; assert exact target values.

    This also covers the stale-MARCAP multi-day repair branch. A discrepancy
    between its target fetch and the independently audited target is a blocker,
    never silently papered over. Original raw/verified frames stay immutable.
    """
    from market_scan import normalise
    target=pd.Timestamp(target).normalize()
    before=normalise(upgraded)
    expected=normalise(verified)
    cols=["code","market","open","high","low","close","volume","amount"]
    actual=before.loc[before.date.eq(target),cols].sort_values("code").reset_index(drop=True)
    exact=expected.loc[expected.date.eq(target),cols].sort_values("code").reset_index(drop=True)
    if len(exact)!=len(verified) or len(exact)<1700 or not actual.equals(exact):
        # pandas dtypes may differ after combining yearly parquet files.
        if len(exact)!=len(verified) or len(exact)<1700 or len(actual)!=len(exact):
            raise ValueError("GLOBAL_SCOPE_TARGET_PARITY")
        try:
            pd.testing.assert_frame_equal(actual,exact,check_dtype=False,check_exact=True)
        except AssertionError:
            raise ValueError("GLOBAL_SCOPE_TARGET_PARITY") from None
    projected,scope=project_daily_global(upgraded,verified,target)
    after=normalise(projected)
    now=after.loc[after.date.eq(target),cols].sort_values("code").reset_index(drop=True)
    try:
        pd.testing.assert_frame_equal(now,exact,check_dtype=False,check_exact=True)
    except AssertionError:
        raise ValueError("GLOBAL_SCOPE_PROJECTED_TARGET_PARITY") from None
    affected=set(scope.pop("codes"))
    prior=before.loc[before.date.lt(target)]
    repaired=after.loc[after.date.lt(target)]
    # No change outside the verified affected code set.
    pd.testing.assert_frame_equal(prior.loc[~prior.code.isin(affected)].reset_index(drop=True),
        repaired.loc[~repaired.code.isin(affected)].reset_index(drop=True),check_dtype=False,check_exact=True)
    scope.update({"target_rows":len(exact),"target_ohlcva_exact":True,
                  "unaffected_history_exact":True,
                  "valid_prior_rows_restored":len(repaired)-len(prior)})
    return projected,scope

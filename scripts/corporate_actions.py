"""Audited price-history normalization for documented share consolidations.

The registry is deliberately small. A large jump alone is never evidence of a
split, and a known action is not blindly applied to already-adjusted sources.
Original vendor OHLCV must remain available in the upstream frame.
"""
from __future__ import annotations

from datetime import date

import pandas as pd


# Company IR: https://www.lksamyang.com/ko/company/ir/1512
# Approved 2026-08-20, effective 2026-09-05; first resumed session 2026-09-28.
# Five old shares became one new share. Amount (KRW) does not change.
VERIFIED_ACTIONS = (
    {
        "code": "225190",
        "first_session": "2026-09-28",
        "old_shares_per_new_share": 5,
        "source": "LK Samyang company IR 2026-08-20",
    },
)

ADJUSTED = "VERIFIED_CORPORATE_ACTION_ADJUSTED"
ALREADY_ADJUSTED = "VERIFIED_SOURCE_ALREADY_ADJUSTED"
REVIEW = "CORPORATE_ACTION_REVIEW_REQUIRED"


def adjust_verified_actions(frame: pd.DataFrame, asof: str | date) -> tuple[pd.DataFrame, list[dict]]:
    """Return a new frame and per-event audit; never modify input.

    Recognizes original marcap/KRX column case and normalised analysis case.
    A before/after price ratio consistent with the *documented* event is needed
    before rewriting historical prices. Indeterminate histories stay untouched.
    """
    out = frame.copy()
    if "Date" not in out and "date" not in out and out.index.name == "Date":
        out = out.reset_index()
    upper = "Code" in out.columns
    names = (["Code", "Date", "Open", "High", "Low", "Close", "Volume"] if upper
             else ["code", "date", "open", "high", "low", "close", "volume"])
    if not set(names).issubset(out.columns):
        raise ValueError("Missing OHLCV columns for corporate action check")
    code_col, day_col, *_ = names
    cutoff = pd.Timestamp(asof)
    days = pd.to_datetime(out[day_col]).dt.normalize()
    codes = out[code_col].astype(str).str.replace(r"\.0$", "", regex=True).str.zfill(6)
    if "ActionAdjustmentStatus" not in out.columns:
        out["ActionAdjustmentStatus"] = ""
    if "PriceAdjusted" not in out.columns:
        out["PriceAdjusted"] = False
    audit: list[dict] = []
    for action in VERIFIED_ACTIONS:
        first = pd.Timestamp(action["first_session"])
        if first > cutoff:
            continue  # an as-of request may not borrow a future action
        affected = codes.eq(action["code"]) & days.le(cutoff)
        if not affected.any():
            continue
        pre = affected & days.lt(first)
        post = affected & days.ge(first)
        historical_status = out.loc[affected, "ActionAdjustmentStatus"].astype(str)
        if historical_status.isin((ADJUSTED, ALREADY_ADJUSTED, REVIEW)).all():
            continue  # idempotent for frames already prepared by the scanner
        before = out.loc[pre].sort_values(day_col).tail(1)
        after = out.loc[post].sort_values(day_col).head(1)
        status = REVIEW
        ratio = None
        factor = int(action["old_shares_per_new_share"])
        if not before.empty and not after.empty:
            prior = float(before.iloc[0][names[5]])
            following = float(after.iloc[0][names[5]])
            if prior > 0 and following > 0:
                ratio = following / prior
                if factor * .7 <= ratio <= factor * 1.3:
                    # Same economic units as post-consolidation shares.
                    for column in names[2:6]:
                        out.loc[pre, column] = pd.to_numeric(out.loc[pre, column]) * factor
                    out.loc[pre, names[6]] = pd.to_numeric(out.loc[pre, names[6]]) / factor
                    out.loc[pre, "PriceAdjusted"] = True
                    status = ADJUSTED
                elif .7 <= ratio <= 1.3:
                    # Source is likely already on a consistent price basis.
                    status = ALREADY_ADJUSTED
        out.loc[affected, "ActionAdjustmentStatus"] = status
        audit.append({"code": action["code"], "first_session": action["first_session"],
                      "factor": factor, "status": status,
                      "observed_raw_price_ratio": round(ratio, 4) if ratio is not None else None,
                      "source": action["source"]})
    return out, audit

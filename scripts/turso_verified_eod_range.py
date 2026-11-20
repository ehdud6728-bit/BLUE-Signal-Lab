#!/usr/bin/env python3
"""Export a bounded, exact-date KRX EOD range for Turso (never touches D1).

Unlike the signal scanner, this path never accepts an older marcap snapshot
as a substitute for exchange-date proof. Any unverified weekday stops the run
before a data file is published or a DB writer is invoked.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json
import os
from pathlib import Path
import re

import pandas as pd
import requests

from market_scan_r08 import API as KRX_APIS, KRX as KRX_BASE, SourcePending
from market_scan_r11 import (
    ensure_eod_request, pykrx_verified_day,
    selected_provider,
)

KST = timezone(timedelta(hours=9))
FIELDS = ("Open", "High", "Low", "Close", "Volume", "Amount")
MAX_CALENDAR_DAYS = 10
MIN_DAY_ROWS = 1700
MAX_DAY_ROWS = 10000
LIMIT = (1 << 63) - 1
PENDING_CODE = re.compile(r"\A([A-Z][A-Z0-9_]+)(?::|\Z)")
PROVIDER_PAIR = re.compile(
    r"\AKRX_BOTH_PROVIDERS_PENDING: (?P<day>\d{4}-\d{2}-\d{2}) "
    r"primary=(?P<primary>.+); alternate=(?P<alternate>.+)\Z"
)


def safe_block_reason(exc: Exception) -> str:
    """Print only in-repository error codes, never vendor response bodies/keys.

    The former uppercase-only output filter silently hid the actual combined
    KRX error because its labels were lowercase `primary=` and `alternate=`.
    The code-only projection retains both failing providers without leaking
    raw exception arguments, transport URLs or account information.
    """
    def code(raw: str) -> str:
        match = PENDING_CODE.match(raw)
        if not match:
            return "UNCLASSIFIED_SOURCE_FAILURE"
        market = re.search(r"\b(KOSPI|KOSDAQ|KOSPI_INDEX)\b", raw)
        return match.group(1) + (":" + market.group(1) if market else "")

    if not isinstance(exc, (SourcePending, ValueError)):
        return type(exc).__name__
    message = str(exc)
    both = PROVIDER_PAIR.fullmatch(message)
    if both:
        return (f"KRX_BOTH_PROVIDERS_PENDING DAY={both.group('day')} "
                f"PRIMARY={code(both.group('primary'))} "
                f"ALTERNATE={code(both.group('alternate'))}")
    return code(message)


def target_dates(start: date, end: date, now: datetime) -> list[date]:
    if end < start or (end - start).days + 1 > MAX_CALENDAR_DAYS:
        raise ValueError("RANGE_OUT_OF_BOUNDS")
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)
            if (start + timedelta(days=i)).weekday() < 5]
    if not days:
        raise ValueError("NO_WEEKDAY_IN_RANGE")
    for day in days:
        ensure_eod_request(day, now)
    return days


def _positive_int(value: object, field: str, allow_zero: bool = False) -> int:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise ValueError(f"INVALID_{field.upper()}") from exc
    if not (number.is_finite() and number == number.to_integral_value() and
            0 <= number <= LIMIT and (allow_zero or number > 0)):
        raise ValueError(f"INVALID_{field.upper()}")
    return int(number)


def canonical_day(frame: pd.DataFrame, day: date, source: str) -> list[dict]:
    if not isinstance(frame, pd.DataFrame) or not set(("Date", "Code", "Market", *FIELDS)).issubset(frame.columns):
        raise ValueError("BAD_KRX_DAILY_COLUMNS")
    if not MIN_DAY_ROWS <= len(frame) <= MAX_DAY_ROWS:
        raise ValueError("INCOMPLETE_KRX_DAILY")
    records = []
    seen = set()
    market_counts = {"KOSPI": 0, "KOSDAQ": 0}
    for row in frame.to_dict("records"):
        code = str(row["Code"]).strip().upper()
        market = str(row["Market"]).strip().upper()
        if not re.fullmatch(r"[0-9A-Z]{6}", code) or market not in market_counts:
            raise ValueError("BAD_TICKER_OR_MARKET")
        if pd.Timestamp(row["Date"]).date() != day or code in seen:
            raise ValueError("DATE_OR_TICKER_MISMATCH")
        seen.add(code)
        volume = _positive_int(row["Volume"], "Volume", allow_zero=True)
        amount = _positive_int(row["Amount"], "Amount", allow_zero=True)
        # Open API may include suspended, zero-trade securities. Preserve the
        # fact they were not traded by omitting candles, as the pykrx adapter does.
        if volume == 0 and amount == 0:
            continue
        if volume == 0 or amount == 0:
            raise ValueError("INVALID_VOLUME_AMOUNT_PAIR")
        numbers = {field.lower(): _positive_int(row[field], field) for field in FIELDS[:4]}
        numbers.update(volume=volume, amount=amount)
        market_counts[market] += 1
        if not (numbers["low"] <= min(numbers["open"], numbers["close"]) and
                numbers["high"] >= max(numbers["open"], numbers["close"], numbers["low"])):
            raise ValueError("INVALID_DAILY_OHLC")
        records.append({
            "trade_day": day.isoformat(), "code": code, "market": market,
            "name": str(row.get("Name") or "").strip()[:100],
            **{key: str(value) for key, value in numbers.items()},
            "source": source,
        })
    if min(market_counts.values()) < 400:
        raise ValueError("INCOMPLETE_KRX_MARKET")
    if len(records) < MIN_DAY_ROWS:
        raise ValueError("INCOMPLETE_KRX_DAILY")
    return sorted(records, key=lambda row: row["code"])


def openapi_full_day(day: date, key: str, session=requests) -> pd.DataFrame:
    """Exact-date KRX API cross sections including alphanumeric preferred shares.

    The legacy research Open API adapter drops non-numeric short codes. Do not
    use that narrower adapter for a full-market EOD persistence source.
    """
    if not key:
        raise SourcePending("KRX_AUTH_KEY_MISSING")
    columns = {"TDD_OPNPRC": "Open", "TDD_HGPRC": "High", "TDD_LWPRC": "Low",
               "TDD_CLSPRC": "Close", "ACC_TRDVOL": "Volume", "ACC_TRDVAL": "Amount"}
    result = []
    for market, endpoint in KRX_APIS:
        try:
            response = session.get(KRX_BASE + endpoint, params={"basDd": day.strftime("%Y%m%d")},
                                   headers={"AUTH_KEY": key}, timeout=30)
            response.raise_for_status()
            payload = response.json()
        except (requests.RequestException, ValueError) as exc:
            raise SourcePending(f"KRX_OPENAPI_UNAVAILABLE: {market} {type(exc).__name__}") from exc
        if not isinstance(payload, dict) or payload.get("respCode") not in (None, "", "0", "00", "000", "0000", 0):
            raise SourcePending(f"KRX_OPENAPI_ERROR: {market}")
        data = payload.get("OutBlock_1")
        if not isinstance(data, list) or len(data) < 400:
            raise SourcePending(f"KRX_DATE_NOT_AVAILABLE: {day} {market}")
        for row in data:
            if not isinstance(row, dict) or str(row.get("BAS_DD") or "").replace("-", "") != day.strftime("%Y%m%d"):
                raise SourcePending(f"KRX_EXACT_DAY_UNVERIFIED: {market}")
            code = str(row.get("ISU_CD") or "").strip().upper()
            if not re.fullmatch(r"[0-9A-Z]{6}", code):
                raise SourcePending(f"KRX_BAD_TICKER: {market}")
            nums = {dest: str(row.get(origin) if row.get(origin) not in (None, "", "-") else "0").replace(",", "")
                    for origin, dest in columns.items()}
            result.append({"Date": pd.Timestamp(day), "Code": code,
                           "Name": str(row.get("ISU_NM") or "").strip(),
                           "Market": market, **nums})
    frame = pd.DataFrame(result)
    if frame.duplicated(["Date", "Code"]).any():
        raise SourcePending("KRX_DUPLICATE_TICKERS")
    return frame


def fetch_verified_day(day: date, provider: str, key: str):
    if provider == "pykrx":
        try:
            return pykrx_verified_day(day), "KRX_PYKRX_EXACT_DAY_VERIFIED"
        except SourcePending as primary:
            if not key:
                raise
            # Independent KRX Open API is the only fallback, never prior-day bars.
            try:
                return openapi_full_day(day, key), "KRX_OPENAPI_EXACT_DAY_VERIFIED"
            except SourcePending as alternative:
                raise SourcePending(
                    f"KRX_BOTH_PROVIDERS_PENDING: {day.isoformat()} "
                    f"primary={primary}; alternate={alternative}"
                ) from alternative
    return openapi_full_day(day, key), "KRX_OPENAPI_EXACT_DAY_VERIFIED"


def build_range(start: date, end: date, now: datetime, provider: str,
                key: str, fetch=fetch_verified_day):
    days = target_dates(start, end, now)
    content = []
    audit_days = []
    for day in days:
        frame, source = fetch(day, provider, key)
        records = canonical_day(frame, day, source)
        encoded = "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
                          for row in records).encode("utf-8")
        content.append(encoded)
        audit_days.append({"day": day.isoformat(), "rows": len(records),
                           "source": source, "sha256": hashlib.sha256(encoded).hexdigest()})
    payload = b"".join(content)
    manifest = {"format": "BLUE_TURSO_VERIFIED_EOD_RANGE_V1",
                "start_day": start.isoformat(), "end_day": end.isoformat(),
                "days": audit_days, "total_rows": sum(x["rows"] for x in audit_days),
                "data_sha256": hashlib.sha256(payload).hexdigest(),
                "prepared_at_kst": now.astimezone(KST).isoformat(timespec="seconds")}
    return manifest, payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--provider", choices=("auto", "pykrx", "openapi"), default="auto")
    parser.add_argument("--out", default="output/turso_eod_range")
    args = parser.parse_args()
    key = os.getenv("KRX_AUTH_KEY", "").strip()
    has_account = bool((os.getenv("KRX_DATA_ID") or os.getenv("KRX_ID")) and
                       (os.getenv("KRX_DATA_PW") or os.getenv("KRX_PW")))
    provider = selected_provider(args.provider, key, has_account)
    manifest, payload = build_range(date.fromisoformat(args.start), date.fromisoformat(args.end),
                                    datetime.now(timezone.utc), provider, key)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "daily.jsonl").write_bytes(payload)
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                       encoding="utf-8")
    print("BLUE_TURSO_EOD_RANGE_PREPARED", manifest["start_day"], manifest["end_day"],
          "verified_days=" + str(len(manifest["days"])),
          "rows=" + str(manifest["total_rows"]),
          "sha256=" + manifest["data_sha256"])
    for audit in manifest["days"]:
        print("BLUE_TURSO_EOD_DAY_VERIFIED", audit["day"], audit["rows"], audit["source"])


if __name__ == "__main__":
    try:
        main()
    except (SourcePending, ValueError, OSError) as exc:
        # Report precise classified provider reasons without untrusted text.
        print("BLUE_TURSO_EOD_RANGE_BLOCKED", safe_block_reason(exc))
        raise SystemExit(1) from None

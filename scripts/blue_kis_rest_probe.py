#!/usr/bin/env python3
"""BLUE KIS read-only REST smoke test (no trading and no D1 writes).

Requires KIS_APP_KEY and KIS_APP_SECRET from the runtime environment.
Never logs API keys, tokens, request headers, or raw HTTP responses.
"""
import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import error, parse, request

BASE_URL = "https://openapi.koreainvestment.com:9443"
KST = timezone(timedelta(hours=9))
TICKERS = (("005930", "삼성전자"), ("000660", "SK하이닉스"), ("006400", "삼성SDI"))


class ProbeFailure(Exception):
    """A sanitized failure with no secrets or raw response content."""


def now_kst():
    return datetime.now(KST).isoformat(timespec="seconds")


def safe_code(value):
    value = str(value or "")
    return value if re.fullmatch(r"[A-Za-z0-9_-]{1,40}", value) else "UNKNOWN"


def _request_json(method, path, headers, payload=None, params=None):
    url = BASE_URL + path
    if params:
        url += "?" + parse.urlencode(params)
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = request.Request(url, data=data, headers=headers, method=method)
    try:
        with request.urlopen(req, timeout=20) as response:
            raw = response.read(2_000_000)
    except error.HTTPError as exc:
        # Only expose an allowlisted API error code, never the raw server response.
        try:
            body = json.loads(exc.read(4096).decode("utf-8"))
            code = safe_code(body.get("msg_cd"))
        except (UnicodeError, ValueError, AttributeError):
            code = "UNKNOWN"
        raise ProbeFailure("HTTP_%s_%s" % (exc.code, code)) from None
    except (error.URLError, TimeoutError, OSError):
        raise ProbeFailure("NETWORK_ERROR") from None
    try:
        result = json.loads(raw.decode("utf-8"))
    except (UnicodeError, ValueError):
        raise ProbeFailure("INVALID_JSON") from None
    if not isinstance(result, dict):
        raise ProbeFailure("INVALID_RESPONSE")
    return result


def get_token(appkey, appsecret):
    body = _request_json(
        "POST",
        "/oauth2/tokenP",
        {"Content-Type": "application/json", "Accept": "application/json"},
        {"grant_type": "client_credentials", "appkey": appkey, "appsecret": appsecret},
    )
    token = body.get("access_token")
    if not isinstance(token, str) or not token:
        raise ProbeFailure("TOKEN_MISSING_" + safe_code(body.get("msg_cd")))
    return token


def parse_quote(ticker, name, body, requested_at, received_at):
    if str(body.get("rt_cd", "")) != "0":
        raise ProbeFailure("QUOTE_REJECTED_" + safe_code(body.get("msg_cd")))
    output = body.get("output")
    if not isinstance(output, dict):
        raise ProbeFailure("QUOTE_OUTPUT_MISSING")
    try:
        current = int(output["stck_prpr"])
        volume = int(output["acml_vol"])
        opening = int(output.get("stck_oprc") or 0)
        high = int(output.get("stck_hgpr") or 0)
        low = int(output.get("stck_lwpr") or 0)
    except (ValueError, TypeError, KeyError):
        raise ProbeFailure("QUOTE_FIELDS_INVALID") from None
    if current <= 0 or volume < 0:
        raise ProbeFailure("QUOTE_VALUES_INVALID")
    return {
        "ticker": ticker,
        "name": name,
        "market": "KRX",
        "current_price": current,
        "accumulated_volume": volume,
        "open": opening,
        "high": high,
        "low": low,
        "request_started_at_kst": requested_at,
        "response_received_at_kst": received_at,
        "quote_exchange_timestamp_verified": False,
    }


def get_quote(appkey, appsecret, token, ticker, name):
    headers = {
        "Content-Type": "application/json", "Accept": "application/json",
        "authorization": "Bearer " + token,
        "appkey": appkey, "appsecret": appsecret,
        "tr_id": "FHKST01010100", "custtype": "P",
    }
    requested_at = now_kst()
    body = _request_json(
        "GET", "/uapi/domestic-stock/v1/quotations/inquire-price", headers,
        params={"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": ticker},
    )
    return parse_quote(ticker, name, body, requested_at, now_kst())


def run(out_dir):
    appkey = os.environ.get("KIS_APP_KEY", "").strip()
    appsecret = os.environ.get("KIS_APP_SECRET", "").strip()
    if not appkey or not appsecret:
        raise ProbeFailure("MISSING_KIS_SECRETS")
    token = get_token(appkey, appsecret)
    rows = []
    for ticker, name in TICKERS:
        rows.append(get_quote(appkey, appsecret, token, ticker, name))
        time.sleep(0.35)
    report = {
        "mode": "RESEARCH_ONLY",
        "provider": "KIS_REST",
        "source_endpoint": "inquire-price",
        "market": "KRX",
        "data_phase": "REST_QUOTE_SNAPSHOT_NOT_EOD",
        "intraday_verified": False,
        "snapshot_observed_at_kst": now_kst(),
        "quotes": rows,
        "note": "Response time is not the exchange trade time. Off-hours quotes may be stale.",
    }
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "AUDIT.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print("BLUE_KIS_REST_PROBE_OK quotes=%s mode=RESEARCH_ONLY" % len(rows))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="output/kis_probe")
    args = parser.parse_args()
    try:
        run(Path(args.out))
    except ProbeFailure as exc:
        print("BLUE_KIS_REST_PROBE_FAILED code=" + str(exc), file=sys.stderr)
        return 1
    except Exception:
        # Never expose traceback, HTTP objects or exceptions that might contain credentials.
        print("BLUE_KIS_REST_PROBE_FAILED code=UNEXPECTED_ERROR", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

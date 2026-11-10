#!/usr/bin/env python3
"""BLUE Signal Lab: Toss Securities price-universe research probe.

Read-only: only POST /oauth2/token, GET /api/v1/stocks/all, GET /api/v1/prices.
Does not contact D1, Stock-Hunter, order endpoints or trading APIs.

Official spec: https://openapi.tossinvest.com/openapi-docs/latest/openapi.json
Mock mode is synthetic and NEVER evidence of a working provider connection.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any

import requests

KST = timezone(timedelta(hours=9))
BASE = "https://openapi.tossinvest.com"
CODE_RE = re.compile(r"^[0-9A-Z]{6}$")
MARKETS = ("KOSPI", "KOSDAQ")
# Excludes ETFs/ETNs/warrants; counts need not match KRX market-wide OHLCV.
EQUITY_TYPES = frozenset({"STOCK", "FOREIGN_STOCK", "DEPOSITARY_RECEIPT", "INFRASTRUCTURE_FUND", "REIT"})
MAX_BATCH = 200


class ProbeError(Exception):
    """Source failed. No secret or response body is exposed."""


def now_kst():
    return datetime.now(KST)


def sanitize_code(value: Any) -> str:
    v = str(value).strip().upper()
    if not CODE_RE.fullmatch(v):
        raise ProbeError("INVALID_STOCK_CODE")
    return v


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    values = sorted(values)
    i = (len(values)-1)*q
    lower = int(i)
    upper = min(lower+1, len(values)-1)
    return round(values[lower]*(upper-i)+values[upper]*(i-lower), 3)


def batches(values, size=MAX_BATCH):
    if size < 1 or size > MAX_BATCH:
        raise ValueError("Batch size must be between 1 and 200")
    for i in range(0, len(values), size):
        yield values[i:i+size]


def parse_market_items(payload: dict, market: str) -> tuple[dict[str,dict], int]:
    items = payload.get("result")
    if not isinstance(items, list):
        raise ProbeError("UNIVERSE_SCHEMA_INVALID")
    stocks: dict[str,dict] = {}
    excluded = 0
    for item in items:
        if not isinstance(item, dict):
            raise ProbeError("UNIVERSE_SCHEMA_INVALID")
        code = sanitize_code(item.get("symbol", ""))
        typ = str(item.get("securityType", "")).upper()
        if not typ:
            raise ProbeError("UNIVERSE_SECURITY_TYPE_MISSING")
        if typ not in EQUITY_TYPES:
            excluded += 1
            continue
        if code in stocks:
            raise ProbeError("UNIVERSE_DUPLICATE")
        stocks[code] = {"code":code,"name":str(item.get("name") or ""),"market":market,"type":typ}
    return stocks, excluded


def parse_price_items(payload: dict, wanted: list[str], captured_at: datetime, max_age_seconds: int):
    items = payload.get("result")
    if not isinstance(items, list):
        raise ProbeError("PRICE_SCHEMA_INVALID")
    accepted: dict[str, dict] = {}
    wanted_set = set(wanted)
    for item in items:
        if not isinstance(item, dict):
            raise ProbeError("PRICE_SCHEMA_INVALID")
        code = sanitize_code(item.get("symbol", ""))
        if code not in wanted_set:
            raise ProbeError("UNREQUESTED_PRICE_CODE")
        if code in accepted:
            raise ProbeError("DUPLICATE_PRICE_CODE")
        try:
            price = float(str(item["lastPrice"]))
        except (ValueError, TypeError, KeyError) as exc:
            raise ProbeError("PRICE_NONNUMERIC") from exc
        if not (0 < price < float("inf")):
            raise ProbeError("PRICE_NONPOSITIVE_OR_NONFINITE")
        try:
            quote_at = datetime.fromisoformat(str(item["timestamp"]).replace("Z", "+00:00"))
            if quote_at.tzinfo is None:
                raise ValueError()
        except (ValueError, TypeError, KeyError) as exc:
            raise ProbeError("QUOTE_TIMESTAMP_INVALID") from exc
        age = round((captured_at - quote_at.astimezone(KST)).total_seconds(), 3)
        status = "FRESH" if -15 <= age <= max_age_seconds else ("FUTURE_TIMESTAMP" if age < -15 else "STALE")
        accepted[code] = {"code":code,"last_price":price,
                          "quoted_at_kst":quote_at.astimezone(KST).isoformat(timespec="milliseconds"),
                          "age_seconds":age,"quality":status}
    return accepted


@dataclass
class ApiReply:
    status_code: int
    headers: dict
    payload: dict
    elapsed_seconds: float


class TossReadOnlyAPI:
    def __init__(self, client_id: str, secret: str, session=None, sleep=time.sleep, monotonic=time.monotonic,
                 pace_seconds:float=0.25):
        if not client_id or not secret:
            raise ProbeError("TOSS_CREDENTIALS_MISSING")
        self.client_id = client_id
        self.secret = secret
        self.session = session or requests.Session()
        self.sleep, self.monotonic = sleep, monotonic
        self.pace_seconds = pace_seconds
        self.token: str | None = None
        self.next_call = 0.0
        self.issued_calls = 0
        self.rate_limit_429 = 0

    def _call(self, method: str, path: str, *, params=None, form=None) -> ApiReply:
        if (method, path) not in {("POST", "/oauth2/token"), ("GET", "/api/v1/stocks/all"), ("GET", "/api/v1/prices")}:
            raise ProbeError("FORBIDDEN_ENDPOINT")
        for attempt in range(4):
            gap = self.next_call - self.monotonic()
            if gap > 0:
                self.sleep(gap)
            self.next_call = self.monotonic() + self.pace_seconds
            headers = {"Accept":"application/json"}
            if path != "/oauth2/token":
                if not self.token:
                    raise ProbeError("TOKEN_NOT_READY")
                headers["Authorization"] = f"Bearer {self.token}"
            start = self.monotonic()
            try:
                response = self.session.request(method, BASE + path, params=params, data=form, headers=headers,
                                                timeout=(5, 20), allow_redirects=False)
            except requests.RequestException as exc:
                # Do not print original exception; it may contain URL or headers.
                raise ProbeError("TOSS_NETWORK_ERROR_" + type(exc).__name__) from None
            seconds = self.monotonic() - start
            self.issued_calls += 1
            code = int(response.status_code)
            if code == 429:
                self.rate_limit_429 += 1
                try:
                    backoff = float(response.headers.get("Retry-After", ""))
                except ValueError:
                    backoff = 2**attempt
                self.sleep(min(16, max(0.5, backoff)))
                continue
            if code in (401, 403):
                raise ProbeError("TOSS_AUTH_OR_IP_DENIED_HTTP_"+str(code))
            if code != 200:
                raise ProbeError("TOSS_HTTP_"+str(code))
            try:
                data = response.json()
            except ValueError:
                raise ProbeError("TOSS_JSON_INVALID") from None
            if not isinstance(data, dict):
                raise ProbeError("TOSS_ENVELOPE_INVALID")
            return ApiReply(code, dict(response.headers), data, seconds)
        raise ProbeError("TOSS_RATE_LIMIT_RETRY_EXHAUSTED")

    def auth(self):
        reply = self._call("POST", "/oauth2/token", form={
            "grant_type":"client_credentials", "client_id":self.client_id, "client_secret":self.secret})
        token = reply.payload.get("access_token")
        if not isinstance(token, str) or not token:
            raise ProbeError("TOSS_TOKEN_RESPONSE_INVALID")
        self.token = token  # never written to disk or logs

    def universe(self, market:str):
        return self._call("GET", "/api/v1/stocks/all", params={"market":market,"status":"ACTIVE"})

    def prices(self, symbols):
        return self._call("GET", "/api/v1/prices", params={"symbols":",".join(symbols)})


class MockAPI:
    """Deterministic simulation. No network; no vendor credentials."""
    def __init__(self, market_sizes=(936,1832)):
        self.market_sizes = market_sizes
        self.issued_calls = 0
        self.rate_limit_429 = 0
    def auth(self):
        pass
    def universe(self, market):
        self.issued_calls += 1
        start, size = (100000,self.market_sizes[0]) if market == "KOSPI" else (300000,self.market_sizes[1])
        items = [{"symbol":f"{start+i:06d}","name":f"SIM-{i}","securityType":"STOCK"} for i in range(size)]
        return ApiReply(200, {}, {"result":items}, 0.007)
    def prices(self, symbols):
        self.issued_calls += 1
        stamp=now_kst().isoformat(timespec="milliseconds")
        return ApiReply(200, {}, {"result":[{"symbol":s,"lastPrice":str(10000+int(s[-3:])*10),
                                   "timestamp":stamp,"currency":"KRW"} for s in symbols]},0.011)


def is_close_window(now:datetime)->bool:
    t=now.astimezone(KST)
    hhmm=t.hour*60+t.minute
    return t.weekday()<5 and (14*60+30) <= hhmm < (15*60+20)


def probe(api, *, mode: str, out_dir: Path, now_fn=now_kst,
          max_age_seconds: int=90, batch_size:int=200, coverage_threshold:float=0.98,
          fresh_threshold:float=0.98):
    """A single market sweep. Fail-closed on structural data errors, write sanitized reports."""
    if batch_size<1 or batch_size>MAX_BATCH:
        raise ValueError("batch size outside 1..200")
    if not 0 < coverage_threshold <= 1 or not 0 < fresh_threshold <= 1:
        raise ValueError("threshold outside (0,1]")
    before=now_fn()
    t0=time.monotonic()
    requested: dict[str,dict] = {}
    excluded = {}
    latencies=[]
    summary = {"schema":"BLUE_TOSS_MARKET_PROBE_R12_V1","mode":mode,"source":"TOSS" if mode=="live" else "SIMULATED",
               "research_only":True,"orders_placed":0,"d1_written":False,
               "market_window":is_close_window(before),"capture_started_kst":before.isoformat(timespec="seconds"),
               "provider_coverage_not_equal_krx":True,"requested_universe":0,
               "quote_count":0,"fresh_count":0,"missing_count":0,
               "status":"NOT_RUN"}
    rows=[]
    try:
        api.auth()
        by_market={}
        for market in MARKETS:
            reply=api.universe(market)
            latencies.append(reply.elapsed_seconds)
            items, n_excluded = parse_market_items(reply.payload, market)
            excluded[market]=n_excluded
            if len(items)<1:
                raise ProbeError("UNIVERSE_EMPTY_"+market)
            by_market[market]=len(items)
            for code, info in items.items():
                if code in requested:
                    raise ProbeError("CROSS_MARKET_DUPLICATE")
                requested[code]=info
        summary["by_market"]=by_market
        summary["excluded_non_equities_by_market"]=excluded
        summary["requested_universe"]=len(requested)
        quotes={}
        clock_ages=[]
        for group in batches(list(sorted(requested)),batch_size):
            reply=api.prices(group)
            latencies.append(reply.elapsed_seconds)
            captured=now_fn()
            found=parse_price_items(reply.payload,group,captured,max_age_seconds)
            quotes.update(found)
            clock_ages.extend(v["age_seconds"] for v in found.values())
        for code, info in sorted(requested.items()):
            quote=quotes.get(code)
            if quote:
                rows.append({**info, **quote})
            else:
                rows.append({**info,"last_price":"","quoted_at_kst":"","age_seconds":"","quality":"MISSING"})
        total=len(requested)
        fresh=sum(x["quality"]=="FRESH" for x in rows)
        observed=len(quotes)
        summary.update({
            "quote_count":observed,"fresh_count":fresh,"missing_count":total-observed,
            "stale_count":sum(x["quality"]=="STALE" for x in rows),
            "future_timestamp_count":sum(x["quality"]=="FUTURE_TIMESTAMP" for x in rows),
            "coverage_ratio":round(observed/total,6),
            "fresh_ratio":round(fresh/total,6),
            "latency_ms_p50":percentile([v*1000 for v in latencies],0.5),
            "latency_ms_p95":percentile([v*1000 for v in latencies],0.95),
            "quote_age_seconds_p95":percentile(clock_ages,0.95),
            "requests_sent":api.issued_calls,"http_429_count":api.rate_limit_429,
            "expected_price_batches":len(list(batches(list(requested),batch_size))),
            "capture_finished_kst":now_fn().isoformat(timespec="seconds"),
            "duration_seconds":round(time.monotonic()-t0,3),
            "universe_sha256":hashlib.sha256("\n".join(sorted(requested)).encode()).hexdigest(),
        })
        if mode=="mock":
            summary["status"]="SIMULATION_PASS" if observed==total else "SIMULATION_INCOMPLETE"
        elif not summary["market_window"]:
            summary["status"]="OUTSIDE_CLOSE_WINDOW_NOT_VERIFIED"
        elif summary["coverage_ratio"]<coverage_threshold or summary["fresh_ratio"]<fresh_threshold:
            summary["status"]="LIVE_DATA_INCOMPLETE_OR_STALE"
        else:
            summary["status"]="LIVE_CLOSE_WINDOW_QUOTES_VERIFIED"
    except (ProbeError, ValueError) as exc:
        summary["status"]="PROVIDER_ERROR"
        summary["error_code"]=str(exc) if isinstance(exc, ProbeError) else "INVALID_CONFIGURATION"
        summary["requests_sent"]=api.issued_calls
        summary["http_429_count"]=api.rate_limit_429
        summary["capture_finished_kst"]=now_fn().isoformat(timespec="seconds")
    out_dir.mkdir(parents=True,exist_ok=True)
    with (out_dir/"METADATA.json").open("w",encoding="utf-8") as f:
        json.dump(summary,f,indent=2,ensure_ascii=False)
        f.write("\n")
    if rows:
        fields=["code","name","market","type","last_price","quoted_at_kst","age_seconds","quality"]
        with (out_dir/"PRICES.csv").open("w",encoding="utf-8-sig",newline="") as f:
            writer=csv.DictWriter(f,fieldnames=fields)
            writer.writeheader();writer.writerows({k:r.get(k,"") for k in fields} for r in rows)
    return summary


def main(argv=None):
    p=argparse.ArgumentParser(description="BLUE Toss market quote probe (READ-ONLY)")
    p.add_argument("--mode",choices=["mock","live"],default="mock")
    p.add_argument("--out",default="output/toss_probe")
    p.add_argument("--batch-size",type=int,default=200)
    p.add_argument("--max-age-seconds",type=int,default=90)
    p.add_argument("--coverage-threshold",type=float,default=0.98)
    p.add_argument("--fresh-threshold",type=float,default=0.98)
    args=p.parse_args(argv)
    if args.mode=="live":
        try:
            api=TossReadOnlyAPI(os.environ.get("TOSS_CLIENT_ID",""),os.environ.get("TOSS_CLIENT_SECRET",""))
        except ProbeError as exc:
            print("PROBE_FAILED",str(exc),file=sys.stderr)
            return 2
    else:
        api=MockAPI()
    summary=probe(api,mode=args.mode,out_dir=Path(args.out),batch_size=args.batch_size,
                  max_age_seconds=args.max_age_seconds,coverage_threshold=args.coverage_threshold,
                  fresh_threshold=args.fresh_threshold)
    print("BLUE_TOSS_PROBE",json.dumps({k:summary.get(k) for k in ["mode","status","requested_universe","quote_count",
        "fresh_count","missing_count","coverage_ratio","fresh_ratio","requests_sent","http_429_count","error_code"]},ensure_ascii=False))
    if summary["status"] not in ("SIMULATION_PASS","LIVE_CLOSE_WINDOW_QUOTES_VERIFIED"):
        return 2
    return 0


if __name__=="__main__":
    sys.exit(main())

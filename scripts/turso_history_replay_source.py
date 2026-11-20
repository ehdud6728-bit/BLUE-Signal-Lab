"""Reuse the already verified KRX EOD range in a historical R1.1 scan.

The bounded history workflow validated this immutable payload with the Turso
EOD importer before this reader runs. Recheck its per-day and total digests so
research never silently falls back to a smaller marcap target-day universe.
"""
from __future__ import annotations

from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import re

import pandas as pd


SOURCES = {'KRX_PYKRX_EXACT_DAY_VERIFIED', 'KRX_OPENAPI_EXACT_DAY_VERIFIED'}
FIELDS = {'open': 'Open', 'high': 'High', 'low': 'Low', 'close': 'Close',
          'volume': 'Volume', 'amount': 'Amount'}
CODE = re.compile(r'[0-9A-Z]{6}\Z')
HASH = re.compile(r'[0-9a-f]{64}\Z')
MAX_INT = (1 << 63) - 1


def can_reuse_verified_target(source_latest: date, target: date) -> bool:
    """Avoid losing intervening bars when marcap lags more than one weekday.

    If marcap already reaches the target, replacing that single audited day is
    safe. Otherwise, when more than one weekday is absent, retain the original
    verified multi-day KRX repair path. This is not an exchange holiday
    calendar or permission to invent missing EOD rows.
    """
    if source_latest >= target:
        return True
    weekdays = pd.bdate_range(source_latest + timedelta(days=1), target)
    return len(weekdays) <= 1


def daily_legacy_source_label(verified_source: str, account_available: bool) -> str:
    """Preserve pre-optimization research provenance string/hash semantics."""
    if verified_source == 'KRX_PYKRX_EXACT_DAY_VERIFIED':
        return 'KRX pykrx verified account daily'
    if verified_source == 'KRX_OPENAPI_EXACT_DAY_VERIFIED':
        return ('KRX Open API exact-date verified fallback' if account_available
                else 'KRX Open API verified daily')
    raise ValueError('UNRECOGNIZED_KRX_VERIFIED_SOURCE')


def load_verified_day(directory: str | Path, target: date) -> tuple[pd.DataFrame, str]:
    """Read the exact target-day candles from the same hashed EOD writer input."""
    root = Path(directory)
    manifest = json.loads((root / 'manifest.json').read_text(encoding='utf-8'))
    payload = (root / 'daily.jsonl').read_bytes()
    if (manifest.get('format') != 'BLUE_TURSO_VERIFIED_EOD_RANGE_V1' or
            not HASH.fullmatch(str(manifest.get('data_sha256', ''))) or
            hashlib.sha256(payload).hexdigest() != manifest['data_sha256'] or
            not payload.endswith(b'\n') or len(payload) > 16_000_000 or
            not isinstance(manifest.get('days'), list) or
            not isinstance(manifest.get('total_rows'), int)):
        raise ValueError('HISTORY_KRX_EOD_SOURCE_INVALID')
    lines = payload.splitlines(keepends=True)
    if len(lines) != manifest['total_rows'] or not lines:
        raise ValueError('HISTORY_KRX_EOD_ROW_COUNT_MISMATCH')
    offset = 0
    selected = None
    source = ''
    audited_days = set()
    for audit in manifest['days']:
        day = audit.get('day') if isinstance(audit, dict) else None
        count = audit.get('rows') if isinstance(audit, dict) else None
        if (not isinstance(day, str) or not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', day) or
                date.fromisoformat(day).isoformat() != day or day in audited_days or
                not isinstance(count, int) or not 1700 <= count <= 10000 or
                audit.get('source') not in SOURCES or
                not HASH.fullmatch(str(audit.get('sha256', '')))):
            raise ValueError('HISTORY_KRX_EOD_DAY_AUDIT_INVALID')
        audited_days.add(day)
        chunk = lines[offset:offset + count]
        if (len(chunk) != count or
                hashlib.sha256(b''.join(chunk)).hexdigest() != audit['sha256']):
            raise ValueError('HISTORY_KRX_EOD_DAY_HASH_MISMATCH')
        if day == target.isoformat():
            selected = chunk
            source = audit['source']
        offset += count
    if offset != len(lines) or selected is None:
        raise ValueError('HISTORY_KRX_EOD_DATE_NOT_VERIFIED')
    records = []
    seen = set()
    markets = {'KOSPI': 0, 'KOSDAQ': 0}
    for line in selected:
        row = json.loads(line)
        code, market = row.get('code'), row.get('market')
        if (row.get('trade_day') != target.isoformat() or
                not isinstance(code, str) or not CODE.fullmatch(code) or
                code in seen or market not in markets or row.get('source') != source or
                not isinstance(row.get('name'), str)):
            raise ValueError('HISTORY_KRX_EOD_ROW_INVALID')
        seen.add(code)
        markets[market] += 1
        numbers = {}
        for lower, upper in FIELDS.items():
            value = row.get(lower)
            if not isinstance(value, str) or not re.fullmatch(r'[1-9]\d*', value):
                raise ValueError('HISTORY_KRX_EOD_PRICE_INVALID')
            number = int(value)
            if number > MAX_INT:
                raise ValueError('HISTORY_KRX_EOD_PRICE_INVALID')
            numbers[upper] = number
        if (numbers['Low'] > min(numbers['Open'], numbers['Close']) or
                numbers['High'] < max(numbers['Open'], numbers['Close'], numbers['Low'])):
            raise ValueError('HISTORY_KRX_EOD_OHLC_INVALID')
        records.append({'Date': pd.Timestamp(target), 'Code': code,
                        'Name': row['name'], 'Market': market, **numbers})
    if min(markets.values()) < 400:
        raise ValueError('HISTORY_KRX_EOD_MARKET_INCOMPLETE')
    return pd.DataFrame(records), source

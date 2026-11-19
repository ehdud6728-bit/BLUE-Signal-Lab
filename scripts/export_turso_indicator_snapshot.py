#!/usr/bin/env python3
"""Export ALL observed symbols' as-of technical research values for Turso.

The existing scanner has already enriched every historical symbol. Reuse its
in-memory, same-day values; never download the market a second time. The
manifest is tied to the audited scanner source but does not itself write DB.
"""
import hashlib
import json
from pathlib import Path
import re


DAY = re.compile(r'20\d{2}-\d{2}-\d{2}\Z')
CODE = re.compile(r'[0-9A-Z]{6}\Z')
ELIGIBILITY = {'ELIGIBLE', 'INSUFFICIENT_HISTORY', 'SUSPICIOUS_GAP'}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def export_indicator_snapshot(rows, audit, destination):
    day = audit.get('asof')
    if (not isinstance(day, str) or not DAY.fullmatch(day) or
            audit.get('intraday_verified') is not False or
            audit.get('data_phase') not in ('SAME_DAY_EOD_VERIFIED', 'HISTORICAL_EOD') or
            not str(audit.get('target_day_source', '')).startswith('KRX') or
            not isinstance(audit.get('source_sha256_by_year'), dict) or
            not audit['source_sha256_by_year'].get(day[:4]) or
            not isinstance(audit.get('observed_stocks'), int) or
            not 1700 <= audit['observed_stocks'] <= 10000 or
            len(rows) != audit['observed_stocks']):
        raise ValueError('INVALID_ALL_MARKET_INDICATOR_AUDIT')
    # Analysis rows are deliberately distinct from signal-only records:
    # every traded symbol has one daily technical state, including those with
    # insufficient lookback or no matched pattern.
    ordered = sorted(rows, key=lambda row: row['code'])
    prev = ''
    matched = 0
    for row in ordered:
        code = row.get('code')
        if (not isinstance(code, str) or not CODE.fullmatch(code) or code <= prev or
                row.get('trade_day') != day or row.get('market') not in ('KOSPI', 'KOSDAQ') or
                type(row.get('close_price')) is not int or row['close_price'] <= 0 or
                type(row.get('history_bars')) is not int or row['history_bars'] < 1 or
                row.get('eligibility') not in ELIGIBILITY or
                not isinstance(row.get('indicators'), dict) or
                not isinstance(row.get('crosses'), dict) or
                not isinstance(row.get('signal_names'), list) or
                any(type(v) not in (int, float, type(None)) for v in row['indicators'].values()) or
                any(type(v) is not bool for v in row['crosses'].values()) or
                any(not re.fullmatch(r'[A-Z0-9_]{2,60}', s) for s in row['signal_names']) or
                row['signal_names'] != sorted(set(row['signal_names'])) or
                (row['eligibility'] != 'ELIGIBLE' and row['signal_names'])):
            raise ValueError('INVALID_ALL_MARKET_INDICATOR_RECORD')
        prev = code
        matched += bool(row['signal_names'])
    if matched != audit.get('matched_stocks'):
        raise ValueError('INDICATOR_SIGNAL_COUNT_MISMATCH')
    content = ''.join(json.dumps(row, ensure_ascii=False, sort_keys=True,
                                 allow_nan=False, separators=(',', ':')) + '\n'
                      for row in ordered).encode('utf-8')
    stable_audit = {key: value for key, value in audit.items()
                    if key != 'source_verified_at_kst'}
    audit_sha = sha(json.dumps(stable_audit, ensure_ascii=False, sort_keys=True,
                              allow_nan=False, separators=(',', ':')).encode('utf-8'))
    manifest = {'format': 'BLUE_TURSO_ALL_MARKET_INDICATORS_V1',
                'day': day, 'row_count': len(ordered),
                'matched_stocks': matched,
                'source': audit['target_day_source'],
                'source_audit_sha256': audit_sha,
                'payload_sha256': sha(content)}
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'manifest.json').write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (destination / 'records.jsonl').write_bytes(content)
    return manifest

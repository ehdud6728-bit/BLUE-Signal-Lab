#!/usr/bin/env python3
"""Export the SAME verified R1.1 research artifacts used for D1 to Turso.

No network or DB writes. Existing csv_to_d1.py and signal algorithms are unchanged.
"""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import re

try:
    from csv_to_d1 import FIELDS, pattern_highlights
except ModuleNotFoundError:  # imported as scripts.export_turso_signal_snapshot in tests
    from scripts.csv_to_d1 import FIELDS, pattern_highlights

DAY = re.compile(r"20\d{2}-\d{2}-\d{2}\Z")
CODE = re.compile(r"[0-9A-Z]{6}\Z")
SIGNAL = re.compile(r"[A-Z0-9_]{2,60}\Z")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def precise_number(raw, label):
    if raw is None or str(raw).strip().lower() in ('', 'none', 'nan', 'null'):
        return None
    value = float(raw)
    if not math.isfinite(value):
        raise ValueError('INVALID_' + label)
    return value


def export_snapshot(source, destination):
    source, destination = Path(source), Path(destination)
    audit_bytes = (source / 'AUDIT.json').read_bytes()
    csv_bytes = (source / 'signals.csv').read_bytes()
    chart_bytes = (source / 'chart_snapshots.jsonl').read_bytes()
    audit = json.loads(audit_bytes)
    day = str(audit.get('asof', ''))
    if (not DAY.fullmatch(day) or audit.get('intraday_verified') is not False or
            audit.get('data_phase') not in ('SAME_DAY_EOD_VERIFIED', 'HISTORICAL_EOD') or
            not 1700 <= audit.get('observed_stocks', 0) <= 10000 or
            not 0 <= audit.get('matched_stocks', -1) <= audit.get('eligible_stocks', -1) <= audit['observed_stocks'] or
            not isinstance(audit.get('source_sha256_by_year'), dict) or
            not audit['source_sha256_by_year'].get(day[:4]) or
            not audit.get('target_day_source')):
        raise ValueError('INVALID_SIGNAL_SOURCE_AUDIT')
    if audit.get('same_day_eod'):
        if audit['data_phase'] != 'SAME_DAY_EOD_VERIFIED' or 'KRX' not in audit['target_day_source']:
            raise ValueError('UNVERIFIED_SAME_DAY_SIGNAL_AUDIT')

    rows = list(csv.DictReader(csv_bytes.decode('utf-8-sig').splitlines()))
    if not set(FIELDS).issubset(set(rows[0]) if rows else set(csv_bytes.decode('utf-8-sig').splitlines()[0].split(','))):
        raise ValueError('INVALID_SIGNAL_CSV_HEADER')
    if len(rows) != audit['matched_stocks']:
        raise ValueError('SIGNAL_AUDIT_COUNT_MISMATCH')

    charts = {}
    for line in chart_bytes.decode('utf-8').splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        code = item.get('code')
        chart = item.get('chart')
        bars = chart.get('bars') if isinstance(chart, dict) else None
        if (not isinstance(code, str) or not CODE.fullmatch(code) or
                item.get('day') != day or code in charts or
                not isinstance(bars, list) or not bars or
                chart.get('asof') != day or chart.get('version') != 'R10_CHART_V1' or
                bars[-1].get('t') != day or any(not isinstance(b, dict) or
                not isinstance(b.get('t'), str) or b['t'] > day for b in bars) or
                not isinstance(item.get('stats'), dict)):
            raise ValueError('INVALID_SIGNAL_CHART_EVIDENCE')
        charts[code] = item
    if len(charts) != len(rows):
        raise ValueError('SIGNAL_CHART_COUNT_MISMATCH')

    highlights = pattern_highlights(source)  # Exactly the same D1 highlighting rules.
    normalized = []
    events = 0
    for r in rows:
        code = r['code']
        names = sorted(set(x.strip().upper() for x in r['signals'].split(',') if x.strip()))
        close = precise_number(r['close'], 'SIGNAL_PRICE')
        if (not CODE.fullmatch(code) or r['date'] != day or not names or
                any(not SIGNAL.fullmatch(n) for n in names) or
                close is None or close <= 0 or not close.is_integer() or code not in charts):
            raise ValueError('INVALID_SIGNAL_ROW')
        extras = {k: v for k, v in r.items() if k not in FIELDS and v is not None}
        extras.update(highlights.get((code, day), {}))
        record = {
            'trade_day': day, 'code': code,
            'run_id': 'blue_market_' + day.replace('-', ''),
            'signal_names': ','.join(names), 'close_price': int(close),
            'supply_distance_pct': precise_number(r['distance_to_nearest_supply_pct'], 'SIGNAL_DISTANCE'),
            'extras': extras, 'chart': charts[code]['chart'], 'stats': charts[code]['stats'],
        }
        normalized.append(record)
        events += len(names)
    normalized.sort(key=lambda r: r['code'])
    if (len({r['code'] for r in normalized}) != len(normalized) or
            events != audit.get('signal_events')):
        raise ValueError('INVALID_SIGNAL_DUPLICATE_OR_EVENT_COUNT')

    payload = ''.join(json.dumps(r, ensure_ascii=False, separators=(',', ':'), sort_keys=True,
                                 allow_nan=False) + '\n' for r in normalized).encode('utf-8')
    # The scanner records the time of its verification. Rechecking the same
    # immutable market inputs later must not change the logical source digest:
    # a timestamp-only difference would otherwise make safe retries conflict.
    # Keep the original AUDIT.json artifact for full provenance, and retain all
    # market/date/provider/coverage/hash fields in this stable digest.
    stable_audit = {key: value for key, value in audit.items()
                    if key != 'source_verified_at_kst'}
    stable_audit_bytes = json.dumps(stable_audit, ensure_ascii=False, sort_keys=True,
                                    separators=(',', ':'), allow_nan=False).encode('utf-8')
    manifest = {
        'format': 'BLUE_TURSO_SIGNAL_SNAPSHOT_V1', 'day': day,
        'run_id': 'blue_market_' + day.replace('-', ''),
        'observed_stocks': audit['observed_stocks'], 'signal_events': events,
        'matched_stocks': len(normalized), 'source': audit['target_day_source'],
        'source_audit_sha256': digest(stable_audit_bytes),
        'signals_csv_sha256': digest(csv_bytes),
        'chart_snapshots_sha256': digest(chart_bytes), 'payload_sha256': digest(payload),
    }
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False,
                                             indent=2) + '\n', encoding='utf-8')
    (destination / 'records.jsonl').write_bytes(payload)
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-dir', default='output')
    parser.add_argument('--out', default='output/turso_signals')
    args = parser.parse_args()
    result = export_snapshot(args.input_dir, args.out)
    print('BLUE_DUALDB_SIGNAL_SNAPSHOT_READY', result['day'], result['matched_stocks'], result['payload_sha256'])

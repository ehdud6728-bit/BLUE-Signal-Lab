"""Deterministic, bounded parallel R1.1 EOD scan; no provider or DB calls.

The same independently verified, adjusted input is partitioned by symbol. Each
worker runs the UNCHANGED scan_r08 stack. Merge in original symbol order and
reject partial/inconsistent results before the immutable exporter sees them.
"""
from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor

import pandas as pd

from market_scan import normalise
from market_scan_r08_diagnostics import scan_r08


SUM_FIELDS = frozenset({
    'observed_stocks', 'insufficient_history', 'suspicious_gap_excluded',
    'eligible_stocks', 'matched_stocks', 'signal_events', 'names_found',
    'supply_proxy_computed', 'r08_diagnostics_rows',
})


def partition_codes(raw: pd.DataFrame, asof: str, chunk_size: int = 500) -> list[list[str]]:
    """Partition active target-date symbols only; never create empty chunks."""
    if not isinstance(chunk_size, int) or not 1 <= chunk_size <= 1000:
        raise ValueError('INVALID_PATTERN_CHUNK_SIZE')
    clean = normalise(raw)
    target = pd.Timestamp(asof)
    if clean.empty or target > clean.date.max():
        raise ValueError('PATTERN_DATE_NOT_AVAILABLE')
    codes = clean.loc[clean.date.eq(target), 'code'].tolist()
    if not codes:
        raise ValueError('PATTERN_DATE_NOT_AVAILABLE')
    if len(codes) != len(set(codes)):
        raise ValueError('PATTERN_DUPLICATE_TARGET_CODES')
    return [codes[i:i + chunk_size] for i in range(0, len(codes), chunk_size)]


def _scan_partition(frame: pd.DataFrame, asof: str, include_indicators: bool):
    sink = [] if include_indicators else None
    rows, audit = scan_r08(frame, asof, indicator_sink=sink)
    return rows, audit, sink


def scan_r08_parallel(raw: pd.DataFrame, asof: str, *, workers: int = 2,
                      chunk_size: int = 500, indicator_sink=None):
    """Return byte-for-byte equivalent row/audit payloads to scan_r08.

    `workers=1` is the original exact serial path. No writes are performed
    until all partitions complete and the audit/coverage checks pass.
    """
    if not isinstance(workers, int) or not 1 <= workers <= 4:
        raise ValueError('INVALID_PATTERN_WORKER_COUNT')
    if workers == 1:
        return scan_r08(raw, asof, indicator_sink=indicator_sink)

    chunks = partition_codes(raw, asof, chunk_size)
    frame = raw.reset_index() if 'Date' not in raw.columns and raw.index.name == 'Date' else raw
    if 'Code' not in frame.columns:
        raise ValueError('PATTERN_SOURCE_CODE_MISSING')
    source_codes = frame.Code.astype(str).str.replace(r'\.0$', '', regex=True).str.zfill(6)
    jobs = [(frame.loc[source_codes.isin(codes)].copy(), asof,
             indicator_sink is not None) for codes in chunks]
    # Future results are consumed in source-code order, not completion order.
    with ProcessPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(_scan_partition, *args) for args in jobs]
        results = [future.result() for future in futures]

    rows = []
    merged = None
    all_indicators = []
    for part_rows, part_audit, part_indicators in results:
        if merged is None:
            merged = {k: (0 if k in SUM_FIELDS else v) for k, v in part_audit.items()}
        if part_audit.keys() != merged.keys():
            raise ValueError('PATTERN_PARTITION_AUDIT_SCHEMA_MISMATCH')
        for key, value in part_audit.items():
            if key in SUM_FIELDS:
                if not isinstance(value, int) or value < 0:
                    raise ValueError('PATTERN_PARTITION_AUDIT_INVALID_COUNT')
                merged[key] += value
            elif key != 'source_latest_date' and value != merged[key]:
                raise ValueError('PATTERN_PARTITION_AUDIT_MISMATCH')
        rows.extend(part_rows)
        if part_indicators is not None:
            all_indicators.extend(part_indicators)

    assert merged is not None
    merged['source_latest_date'] = str(normalise(raw).date.max().date())
    expected = sum(map(len, chunks))
    if (merged['observed_stocks'] != expected or
            merged['matched_stocks'] != len(rows) or
            merged['eligible_stocks'] + merged['insufficient_history'] +
            merged['suspicious_gap_excluded'] != expected or
            [r['code'] for r in rows] != sorted(r['code'] for r in rows) or
            len({r['code'] for r in rows}) != len(rows) or
            (indicator_sink is not None and
             (len(all_indicators) != expected or
              [r['code'] for r in all_indicators] != sorted(r['code'] for r in all_indicators)))):
        raise ValueError('PATTERN_PARTITION_COVERAGE_MISMATCH')
    if indicator_sink is not None:
        indicator_sink.extend(all_indicators)
    print(f'BLUE_PATTERN_PARALLEL_SCAN workers={workers} chunks={len(chunks)} symbols={expected}')
    return rows, merged

#!/usr/bin/env python3
"""Compare historic R1.1 universe counts with a fresh FinanceData/marcap day.

This is a read-only *candidate* reconstruction. The old R1.1 audit stores the
observed count and matched signals, not the complete source ticker inventory.
Even a matching count cannot prove the exact 50 historic missing memberships.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

SOURCE_FORMAT = 'BLUE_RESEARCH_UNIVERSE_GAP_SOURCE_V1'
REPORT_FORMAT = 'BLUE_RESEARCH_UNIVERSE_GAP_REPORT_V1'
HASH = re.compile(r'[0-9a-f]{64}\Z')
CODE = re.compile(r'[0-9A-Z]{6}\Z')
EXPECTED_DAYS = ('2026-11-10', '2026-11-13', '2026-11-16', '2026-11-17')


def compare_day(day, marcap_codes: set[str]) -> dict:
    """Pure comparison: do not imply that a current snapshot is the old input."""
    if not isinstance(day, dict) or day.get('day') not in EXPECTED_DAYS:
        raise ValueError('UNIVERSE_GAP_DAY_INVALID')
    rows = day.get('eod_codes')
    if not isinstance(rows, list):
        raise ValueError('UNIVERSE_GAP_EOD_CODES_MISSING')
    if (not isinstance(marcap_codes, set) or
            any(not isinstance(c, str) or not CODE.fullmatch(c) for c in marcap_codes)):
        raise ValueError('UNIVERSE_GAP_MARCAP_CODES_INVALID')
    audited = day.get('eod_count')
    observed = day.get('research_observed_count')
    if (type(audited) is not int or type(observed) is not int or
            audited < 1700 or audited > 10000 or audited - observed != 50 or
            len(rows) != audited or
            not HASH.fullmatch(str(day.get('eod_audit_sha256', ''))) or
            not HASH.fullmatch(str(day.get('research_audit_sha256', '')))):
        raise ValueError('UNIVERSE_GAP_SOURCE_INVALID')
    codes = []
    for item in rows:
        if (not isinstance(item, dict) or
                not isinstance(item.get('code'), str) or
                not CODE.fullmatch(item['code']) or
                item.get('market') not in ('KOSPI', 'KOSDAQ') or
                not isinstance(item.get('name'), str)):
            raise ValueError('UNIVERSE_GAP_EOD_CODES_INVALID')
        codes.append(item['code'])
    if codes != sorted(set(codes)):
        raise ValueError('UNIVERSE_GAP_EOD_DUPLICATES_OR_ORDER')
    missing = [item for item in rows if item['code'] not in marcap_codes]
    surplus = sorted(marcap_codes - set(codes))
    count_matches = len(marcap_codes) == observed
    net_reconciles = len(missing) - len(surplus) == 50
    exact_50_candidates = count_matches and net_reconciles and len(missing) == 50 and not surplus
    return {
        'day': day['day'], 'eod_count': audited,
        'old_research_observed_count': observed,
        'fresh_marcap_count': len(marcap_codes),
        'eod_only_count': len(missing), 'marcap_only_count': len(surplus),
        'net_count_gap': audited - observed,
        'fresh_source_count_matches_old_audit': count_matches,
        'fresh_source_net_gap_matches_old_audit': net_reconciles,
        'status': ('EXACTLY_50_FRESH_SOURCE_CANDIDATES_NOT_ORIGINAL_PROOF'
                   if exact_50_candidates else 'HISTORIC_MEMBERSHIP_UNRESOLVED'),
        'eod_only_candidates': missing,
        'marcap_only_codes': surplus,
        'eod_audit_sha256': day['eod_audit_sha256'],
        'research_audit_sha256': day['research_audit_sha256'],
    }


def diagnose(source: dict, marcap_by_day: dict[str, set[str]], marcap_sha256: str) -> dict:
    if (not isinstance(source, dict) or source.get('format') != SOURCE_FORMAT or
            source.get('turso_read_only') is not True or
            not isinstance(source.get('days'), list) or
            tuple(d.get('day') for d in source['days'] if isinstance(d, dict)) != EXPECTED_DAYS or
            len(source['days']) != len(EXPECTED_DAYS) or
            not HASH.fullmatch(marcap_sha256)):
        raise ValueError('UNIVERSE_GAP_SOURCE_INVALID')
    results = [compare_day(day, marcap_by_day.get(day['day'], set()))
               for day in source['days']]
    return {
        'format': REPORT_FORMAT,
        'marcap_year': 2026,
        'fresh_marcap_parquet_sha256': marcap_sha256,
        'days': results,
        'all_four_exactly_50_candidates': all(
            d['status'].startswith('EXACTLY_50_') for d in results),
        'historical_missing_codes_proven': False,
        'historical_research_repaired': False,
        'writes': 0,
        'limitations': [
            'Original research stored only counts and matched signals, not every observed ticker.',
            'Fresh FinanceData/marcap parquet may differ from the exact historic source revision.',
            'Ticker candidates do not authorize overwriting v1 records or publishing exit recommendations.',
        ],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--local-data-dir', default=None)
    args = parser.parse_args()
    import pandas as pd
    from market_scan import load_marcap, normalise

    source = json.loads(Path(args.source).read_text(encoding='utf8'))
    if source.get('format') != SOURCE_FORMAT:
        raise ValueError('UNIVERSE_GAP_SOURCE_INVALID')
    marcap, hashes = load_marcap([2026], args.local_data_dir)
    frame = marcap.reset_index() if 'Date' not in marcap.columns and marcap.index.name == 'Date' else marcap
    selected = frame.loc[pd.to_datetime(frame['Date']).dt.strftime('%Y-%m-%d').isin(EXPECTED_DAYS)].copy()
    clean = normalise(selected)
    universe = {day: set(clean.loc[clean.date.eq(pd.Timestamp(day)), 'code'])
                for day in EXPECTED_DAYS}
    report = diagnose(source, universe, hashes['2026'])
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
    for day in report['days']:
        print('BLUE_RESEARCH_UNIVERSE_GAP',
              f"day={day['day']} eod={day['eod_count']} old={day['old_research_observed_count']}",
              f"fresh_marcap={day['fresh_marcap_count']}",
              f"eod_only={day['eod_only_count']} marcap_only={day['marcap_only_count']}",
              f"status={day['status']}")
    print('BLUE_RESEARCH_UNIVERSE_GAP_READ_ONLY', 'writes=0', 'original_research_repaired=false')


if __name__ == '__main__':
    main()

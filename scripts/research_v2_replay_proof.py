#!/usr/bin/env python3
"""Bind a fresh historical R1.1 research snapshot to the original KRX EOD hash.

No network/DB access. Proof v2 is separate from the old research v1 audit.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re

HASH = re.compile(r'[a-f0-9]{64}\Z')
DAYS = {'2026-11-10', '2026-11-13', '2026-11-16', '2026-11-17'}
SOURCES = {'KRX_PYKRX_EXACT_DAY_VERIFIED', 'KRX_OPENAPI_EXACT_DAY_VERIFIED'}


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def replay_proof(audit: dict, eod: dict, snapshot: dict, coverage: dict) -> dict:
    day = audit.get('asof')
    if (day not in DAYS or eod.get('format') != 'BLUE_TURSO_VERIFIED_EOD_RANGE_V1' or
            eod.get('start_day') != day or eod.get('end_day') != day or
            eod.get('total_rows') is None or eod.get('data_sha256') is None or
            not isinstance(eod.get('days'), list) or len(eod['days']) != 1 or
            snapshot.get('format') != 'BLUE_TURSO_SIGNAL_SNAPSHOT_V1' or
            snapshot.get('day') != day or audit.get('intraday_verified') is not False):
        raise ValueError('V2_REPLAY_BAD_SOURCE')
    exact = eod['days'][0]
    count = exact.get('rows')
    years = audit.get('source_sha256_by_year')
    if (exact.get('day') != day or exact.get('source') not in SOURCES or
            not isinstance(count, int) or not 1700 <= count <= 10000 or
            eod['total_rows'] != count or
            eod['data_sha256'] != exact.get('sha256') or
            not HASH.fullmatch(str(exact.get('sha256', ''))) or
            audit.get('observed_stocks') != count or
            audit.get('supplemental_rows') != count or
            audit.get('target_day_source') != exact.get('source') or
            audit.get('supplemental_dates') != [day] or
            audit.get('data_phase') != 'HISTORICAL_EOD' or
            not isinstance(years, dict) or
            not all(HASH.fullmatch(str(years.get(year, ''))) for year in ('2025', '2026')) or
            snapshot.get('observed_stocks') != count or
            snapshot.get('matched_stocks') != audit.get('matched_stocks') or
            snapshot.get('signal_events') != audit.get('signal_events') or
            snapshot.get('source') != exact.get('source') or
            not HASH.fullmatch(str(snapshot.get('payload_sha256', ''))) or
            not HASH.fullmatch(str(snapshot.get('source_audit_sha256', '')))):
        raise ValueError('V2_REPLAY_MARKET_OR_PROVENANCE_MISMATCH')
    stable = {key: value for key, value in audit.items()
              if key != 'source_verified_at_kst'}
    audit_hash = sha(json.dumps(stable, ensure_ascii=False, sort_keys=True,
                                separators=(',', ':'), allow_nan=False).encode('utf8'))
    if audit_hash != snapshot['source_audit_sha256']:
        raise ValueError('V2_REPLAY_SIGNAL_AUDIT_HASH_MISMATCH')
    if (coverage.get('format') != 'BLUE_RESEARCH_V2_HISTORY_COVERAGE_V1' or
            coverage.get('day') != day or coverage.get('status') != 'PASS' or
            coverage.get('all_50_have_250_valid_bars') is not True or
            coverage.get('candidate_count') != 50 or
            not isinstance(coverage.get('min_candidate_bars'), int) or
            coverage['min_candidate_bars'] < 250 or
            coverage.get('eod_day_sha256') != exact['sha256'] or
            coverage.get('verified_source') != exact['source'] or
            coverage.get('eod_count') != count or
            coverage.get('source_sha256_by_year') != years or
            not isinstance(coverage.get('missing_candidates'), list) or
            len(coverage['missing_candidates']) != 50 or
            any(not isinstance(r, dict) or r.get('meets_250_bar_threshold') is not True or
                not isinstance(r.get('history_bars'), int) or r['history_bars'] < 250
                for r in coverage['missing_candidates'])):
        raise ValueError('V2_REPLAY_50_HISTORY_INCOMPLETE')
    coverage_hash = sha(json.dumps(coverage, ensure_ascii=False, sort_keys=True,
                                   separators=(',', ':'), allow_nan=False).encode('utf8'))
    return {
        'format': 'BLUE_RESEARCH_REPLAY_V2_PROOF_V1', 'day': day,
        'verified_eod_source': exact['source'],
        'eod_day_sha256': exact['sha256'], 'eod_row_count': count,
        'research_payload_sha256': snapshot['payload_sha256'],
        'research_source_audit_sha256': audit_hash,
        'source_marcap_sha256_2025': years['2025'],
        'source_marcap_sha256_2026': years['2026'],
        'history_50_coverage_sha256': coverage_hash,
        'all_50_histories_ready': True,
        'v1_original_unchanged': True,
        'source': 'IMMUTABLE_KRX_EOD_HASH_MATCH_RESCAN',
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--audit', required=True)
    parser.add_argument('--eod-manifest', required=True)
    parser.add_argument('--snapshot-manifest', required=True)
    parser.add_argument('--coverage', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    audit = json.loads(Path(args.audit).read_text(encoding='utf8'))
    eod = json.loads(Path(args.eod_manifest).read_text(encoding='utf8'))
    snapshot = json.loads(Path(args.snapshot_manifest).read_text(encoding='utf8'))
    coverage = json.loads(Path(args.coverage).read_text(encoding='utf8'))
    proof = replay_proof(audit, eod, snapshot, coverage)
    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(proof, ensure_ascii=False, sort_keys=True, indent=2)+'\n',
                      encoding='utf8')
    print('BLUE_V2_RESEARCH_PROOF',f"day={proof['day']}",
          f"observed={proof['eod_row_count']}",
          f"eod_sha256={proof['eod_day_sha256']}",'V1_UNCHANGED=true')


if __name__ == '__main__':
    main()

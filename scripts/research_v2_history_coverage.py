#!/usr/bin/env python3
"""Prove the 50 missing-in-MARCAP target codes have usable 250-bar histories.

Reproduces the scanner's normalise + verified-target merge policy. Counts only
positive/date-valid daily bars; 50 target candles alone do NOT repair research.
No KRX/KIS queries or database writes.
"""
from __future__ import annotations

import argparse
from datetime import date
import json
from pathlib import Path


def evaluate_candidates(day: str,old_codes: set[str],eod_codes: set[str],
                        counts: dict[str,int],hashes: dict) -> dict:
    missing = sorted(eod_codes-old_codes)
    surplus = sorted(old_codes-eod_codes)
    if len(missing) != 50 or surplus or len(eod_codes) < 1700:
        raise ValueError('V2_COVERAGE_SOURCE_UNIVERSE_CHANGED')
    details = [{'code':code,'history_bars':int(counts.get(code,0)),
                'meets_250_bar_threshold':int(counts.get(code,0))>=250} for code in missing]
    ready = all(d['meets_250_bar_threshold'] for d in details)
    return {'format':'BLUE_RESEARCH_V2_HISTORY_COVERAGE_V1',
            'day':day,'eod_count':len(eod_codes),
            'old_source_count':len(old_codes),
            'source_sha256_by_year':hashes,
            'missing_candidates':details,
            'candidate_count':len(details),
            'min_candidate_bars':min(d['history_bars'] for d in details),
            'all_50_have_250_valid_bars':ready,
            'status':'PASS' if ready else 'BLOCKED_INSUFFICIENT_HISTORY',
            'original_v1_modified':False,'writes':0}


def measure_coverage(raw, verified, day: date, hashes: dict) -> dict:
    from market_scan import normalise
    from market_scan_r11 import merge_verified_days
    target=day.isoformat()
    base=normalise(raw)
    old_codes=set(base.loc[base.date.eq(target),'code'])
    eod_codes=set(verified['Code'])
    missing=eod_codes-old_codes
    patched=merge_verified_days(raw,day,[verified],[target])
    clean=normalise(patched)
    counts=clean.loc[(clean.date.le(target)) & clean.code.isin(missing)] \
        .groupby('code').size().to_dict()
    return evaluate_candidates(target,old_codes,eod_codes,counts,hashes)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--date',required=True)
    parser.add_argument('--local-data-dir',required=True)
    parser.add_argument('--verified-eod-dir',required=True)
    parser.add_argument('--out',required=True)
    args=parser.parse_args()
    target=date.fromisoformat(args.date)
    if target.isoformat() not in ('2026-11-10','2026-11-13','2026-11-16','2026-11-17'):
        raise ValueError('V2_COVERAGE_DAY_NOT_ALLOWED')
    from market_scan import load_marcap
    from turso_history_replay_source import load_verified_day
    raw,hashes=load_marcap([2025,2026],args.local_data_dir)
    verified,source=load_verified_day(args.verified_eod_dir,target)
    report=measure_coverage(raw,verified,target,hashes)
    eod_manifest=json.loads((Path(args.verified_eod_dir)/'manifest.json').read_text())
    report['eod_day_sha256']=eod_manifest['days'][0]['sha256']
    report['verified_source']=source
    output=Path(args.out)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,sort_keys=True,indent=2)+'\n',
                      encoding='utf8')
    print('BLUE_V2_REPLAY_HISTORY_COVERAGE',f"day={report['day']}",
          f"candidates={report['candidate_count']}",
          f"min_bars={report['min_candidate_bars']}",
          f"status={report['status']}")


if __name__=='__main__':
    main()

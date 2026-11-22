#!/usr/bin/env python3
"""Offline BB(20/30,2) 26-session shifted-line chart-parity research.

The user's *named* blue-dot indicator formula/plot is NOT verified by its
three numerical settings alone. This study explicitly compares both possible
shifted Bollinger lines, distinguishes the existing scanner's strict cross
from a plain OHLC cross, and never ranks/recommends securities.

FinanceData/marcap is pinned and unadjusted; not independently audited KRX,
not verified brokerage chart settings, and not a record of actual executions.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

try:
    from scripts.env20_rebound_comparison import (
        MIN_HISTORY, evaluate,
    )
    from scripts.market_scan import load_marcap, normalise
    from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES
except ModuleNotFoundError:
    from env20_rebound_comparison import MIN_HISTORY, evaluate
    from market_scan import load_marcap, normalise
    from research_v2_targeted_history import EXACT_MARCAP_HASHES


STAGES = {
    'U20': 'BLUE20_SHIFT26_UPPER_SCANNER_STRICT',
    'U30': 'BLUE30_SHIFT26_UPPER_SCANNER_STRICT',
    'G20': 'BLUE20_SHIFT26_UPPER_GEOMETRY_ONLY',
    'G30': 'BLUE30_SHIFT26_UPPER_GEOMETRY_ONLY',
    'L20': 'BLUE20_SHIFT26_LOWER_GEOMETRY_CONTROL',
    'L30': 'BLUE30_SHIFT26_LOWER_GEOMETRY_CONTROL',
    'D': 'BLUE20_AND30_UPPER_SCANNER_STRICT',
}


def build_blue_signals(raw: pd.DataFrame, *, min_history=MIN_HISTORY):
    """Vectorized equivalent of market_scan.enrich's shifted BB20/30 paths.

    No forward data, no fill across missing market bars, no label derived from
    later TP/SL results. The geometric variant purposely omits the scanner's
    three stricter body-size filters so the difference remains measurable.
    """
    d = normalise(raw)
    if d.empty:
        raise ValueError('EMPTY_BLUE_DOT_SOURCE')
    days = sorted(pd.Timestamp(day) for day in d.date.unique())
    indices = {day: i for i, day in enumerate(days)}
    d['session_index'] = d.date.map(indices).astype('int32')
    group = d.groupby('code', sort=False)
    history = group.cumcount() + 1
    prior_close = group.close.shift(1)
    d['prior_close'] = prior_close
    prior_session = group.session_index.shift(1)
    valid = (history.ge(min_history) &
             prior_session.eq(d.session_index - 1) &
             prior_close.gt(0) &
             ((d.open / prior_close - 1).abs() < .4))
    body = d.close - d.open
    strict_body = ((body / d.open * 100).ge(.5) &
                   ((d.close - d.open).gt(0)))

    for n in (20, 30):
        rolling_mean = group.close.transform(
            lambda x: x.rolling(n, min_periods=n).mean())
        rolling_std = group.close.transform(
            lambda x: x.rolling(n, min_periods=n).std(ddof=0))
        for kind, sign in (('UPPER', 1), ('LOWER', -1)):
            # .shift(26) means today's drawn line value was calculated
            # using historical bars ending 26 issuer sessions earlier.
            line = (rolling_mean + sign*2*rolling_std).groupby(d.code).shift(26)
            prior_line = line.groupby(d.code).shift(1)
            falling = line.lt(prior_line)
            crosses = (valid & line.gt(0) & prior_line.gt(0) & falling &
                       prior_close.le(prior_line) &
                       d.open.lt(line) & d.close.gt(line) & body.gt(0))
            geometry = crosses.fillna(False)
            d[f'BB{n}_{kind}_SHIFT26'] = line
            if kind == 'UPPER':
                strong_cross = (geometry & strict_body &
                                ((line-d.open)/body).ge(.2) &
                                ((d.close-line)/body).ge(.2)).fillna(False)
                d[f'U{n}'] = strong_cross
                d[f'G{n}'] = geometry
            else:
                d[f'L{n}'] = geometry
    d['D'] = d.U20 & d.U30
    return d, days


def _chart_checks(d: pd.DataFrame):
    dates = {'285800': '2026-11-12', '001780': '2026-11-11',
             '010120': '2026-11-10'}
    result = []
    for code, day in dates.items():
        found = d.loc[d.code.eq(code) & d.date.eq(pd.Timestamp(day))]
        if len(found) != 1:
            raise ValueError('MISSING_PRIOR_REPORTED_BLUE_DOT_EXAMPLE')
        row = found.iloc[0]
        result.append({
            'code': code, 'name_at_date': str(row.Name),
            'prior_reported_signal_day': day,
            'old_env20_reclaim_is_not_evidence_of_blue_line_cross': True,
            'close_krw': float(row.close),
            'blue_upper20_line': round(float(row.BB20_UPPER_SHIFT26), 2),
            'blue_upper30_line': round(float(row.BB30_UPPER_SHIFT26), 2),
            'blue_lower20_line': round(float(row.BB20_LOWER_SHIFT26), 2),
            'blue_lower30_line': round(float(row.BB30_LOWER_SHIFT26), 2),
            'upper20_strict_cross': bool(row.U20),
            'upper30_strict_cross': bool(row.U30),
            'upper20_geometry_cross': bool(row.G20),
            'upper30_geometry_cross': bool(row.G30),
            'lower20_geometry_cross': bool(row.L20),
            'lower30_geometry_cross': bool(row.L30),
        })
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=('plan', 'study'), default='plan')
    parser.add_argument('--source-dir', default='output/blue_dot_2026/sources')
    parser.add_argument('--out', default='output/blue_dot_2026/report.json')
    args = parser.parse_args()
    if args.mode == 'plan':
        print('BLUE_DOT_RESEARCH_PLAN', json.dumps({
            'public_data_years': [2025, 2026],
            'expected_sha256': EXACT_MARCAP_HASHES,
            'blue_settings': [[20, 2, 26], [30, 2, 26]],
            'chart_formula_parity_verified': False,
            'offline_no_secrets_no_db_no_trades': True}))
        return
    raw, hashes = load_marcap([2025, 2026], local_dir=args.source_dir)
    if hashes != EXACT_MARCAP_HASHES:
        raise ValueError('BLUE_DOT_SOURCE_SHA_MISMATCH')
    d, sessions = build_blue_signals(raw)
    definitions = {
        STAGES['U20']: 'BB(20,2) upper shifted +26; falling; '
                       'prior close<=prior line; bullish body crosses; '
                       '0.5pct body and >=20pct body above/below line',
        STAGES['U30']: 'BB(30,2) upper shifted +26; same strict scanner filters',
        STAGES['G20']: 'BB(20,2) upper +26; falling; prior close<=line; open<line<close',
        STAGES['G30']: 'BB(30,2) upper +26; same geometry without strict body filters',
        STAGES['L20']: 'Alternative BB(20,2) lower +26 hypothesis; geometry only',
        STAGES['L30']: 'Alternative BB(30,2) lower +26 hypothesis; geometry only',
        STAGES['D']: 'Both BB(20,2) and BB(30,2) shifted upper strict crosses on same day',
    }
    report = evaluate(
        d, sessions, stage_flags=STAGES,
        output_schema='BLUE_DOTTED_20_30_2_26_UNVERIFIED_CHART_EXPLORATORY_V1',
        pattern_definitions=definitions)
    report.update({
        'requested_chart_settings': [[20, 2, 26], [30, 2, 26]],
        'user_custom_indicator_source_formula_and_visible_line_verified': False,
        'line_candidates': 'upper and lower Bollinger(20/30,2) shifted 26 issuer sessions',
        'upper_strict_parity_with_existing_blue_market_scanner': True,
        'shift_amount_source': 'market_scan.py existing signal calculation',
        'prior_env20_A_B_C_are_not_user_blue_dot_signals': True,
        'prior_reported_three_stocks_chart_candidate_checks': _chart_checks(d),
    })
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n',
                      encoding='utf8')
    print('BLUE_DOT_RESEARCH_STUDY',
          'market_sessions='+str(report['studied_market_sessions']),
          'D1_SQL=0', 'TURSO_SQL=0', 'KIS_CALLS=0', 'TRADES=0',
          'CHART_FORMULA_VERIFIED=FALSE')


if __name__ == '__main__':
    main()

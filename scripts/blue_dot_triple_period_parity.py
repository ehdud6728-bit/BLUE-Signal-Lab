#!/usr/bin/env python3
"""Read-only 20/30/40×2×26 blue-dot chart geometry audit.

Compare close/HLC3 and Bollinger upper/lower without presuming the user's
visible Kiwoom line is one particular BBandsUp/BBandsDown expression. Broker
observations exist only for one 30/2/26 ticker; no candidate is validated.
MARCAP is unadjusted, while the broker's adjustment setting is unverified.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

try:
    from scripts.blue_dot_broker_parity import classify_cross
    from scripts.market_scan import load_marcap, normalise
    from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES
except ModuleNotFoundError:
    from blue_dot_broker_parity import classify_cross
    from market_scan import load_marcap, normalise
    from research_v2_targeted_history import EXACT_MARCAP_HASHES


PERIODS = (20, 30, 40)
MULTIPLIER = 2.0
SHIFT = 26
OBSERVATIONS = (Path(__file__).resolve().parents[1] /
                'research/blue_dot_speko_30_2_26_observations.json')


def audit_triple_periods(raw: pd.DataFrame, observations: dict) -> dict:
    """Report numeric lines and slope-aware crossings, never trade signals."""
    if tuple(observations['reported_settings']) != (30, 2, 26):
        raise ValueError('UNEXPECTED_BROKER_SETTINGS')
    items = observations['observations']
    dates = [pd.Timestamp(x['date']) for x in items]
    if len(dates) < 3 or dates != sorted(set(dates)):
        raise ValueError('THREE_ORDERED_BROKER_DAYS_REQUIRED')
    if any(not (0 < float(x['blue_line_krw']) < 1e10) or
           not pd.notna(float(x['blue_line_krw'])) for x in items):
        raise ValueError('INVALID_BROKER_LINE')

    d = normalise(raw)
    code = str(observations['ticker_code']).zfill(6)
    stock = d.loc[d.code.eq(code)].reset_index(drop=True)
    if stock.empty:
        raise ValueError('BROKER_TICKER_NOT_IN_SOURCE')
    market_days = sorted(d.date.unique())
    market_positions = {day: i for i, day in enumerate(market_days)}
    lookup = {day: i for i, day in enumerate(stock.date)}
    try:
        positions = [lookup[date] for date in dates]
    except KeyError as exc:
        raise ValueError('BROKER_DATE_NOT_IN_SOURCE') from exc
    # Includes the previous shifted value and all contributing source bars;
    # issuer suspensions/invalid bars must not silently carry a line forward.
    lookback = max(PERIODS) + SHIFT
    for i in positions:
        if i < lookback:
            raise ValueError('INSUFFICIENT_CONTIGUOUS_HISTORY')
        history = stock.date.iloc[i-lookback:i+1]
        indices = [market_positions[date] for date in history]
        if any(b != a+1 for a, b in zip(indices, indices[1:])):
            raise ValueError('NONCONTIGUOUS_ISSUER_HISTORY')

    observed = {date.strftime('%Y-%m-%d'): float(item['blue_line_krw'])
                for date, item in zip(dates, items)}
    scenarios = []
    for basis in ('close', 'hlc3'):
        source = (stock.close if basis == 'close' else
                  (stock.high+stock.low+stock.close)/3)
        for n in PERIODS:
            roll = source.rolling(n, min_periods=n)
            mean, deviation = roll.mean(), roll.std(ddof=0)
            for band, sign in (('upper', +1), ('lower', -1)):
                line = (mean+sign*MULTIPLIER*deviation).shift(SHIFT)
                days = []
                for date, i in zip(dates, positions):
                    prior, current = stock.iloc[i-1], stock.iloc[i]
                    last, today = float(line.iloc[i-1]), float(line.iloc[i])
                    if not (pd.notna(last) and pd.notna(today)):
                        raise ValueError('MODELED_LINE_MISSING')
                    result = classify_cross(
                        float(current.open), float(current.close),
                        float(prior.close), last, today)
                    price_cross = (result['prior_close_below_prior_line'] and
                                   result['open_below_line'] and
                                   result['close_above_line'] and
                                   float(current.close) > float(current.open))
                    key = date.strftime('%Y-%m-%d')
                    days.append({
                        'date': key,
                        'model_line_krw': round(today, 3),
                        'prior_model_line_krw': round(last, 3),
                        'slope_krw': round(today-last, 3),
                        'line_direction': ('falling' if today < last else
                                           'rising' if today > last else 'flat'),
                        'price_cross_from_below_ignoring_slope': bool(price_cross),
                        'falling_line_geometry_cross': result['geometry_cross'],
                        'nonfalling_line_price_cross': bool(price_cross and today >= last),
                        'scanner_strict_cross': result['scanner_strict_cross'],
                        'user_reported_broker_line_krw': (observed[key] if n == 30
                                                          else None),
                        'model_minus_broker_krw': (round(today-observed[key], 3)
                                                   if n == 30 else None),
                    })
                scenarios.append({'price_basis': basis, 'period': n,
                                  'multiplier': MULTIPLIER, 'shift': SHIFT,
                                  'band': band, 'days': days})
    return {
        'schema': 'BLUE_DOT_TRIPLE_PERIOD_PARITY_DIAGNOSTIC_V1',
        'ticker': {'code': code, 'name': observations['ticker_name']},
        'periods': list(PERIODS), 'multiplier': MULTIPLIER, 'shift': SHIFT,
        'broker_observation_source': observations['source'],
        'broker_reported_settings': observations['reported_settings'],
        'broker_observations': observed,
        'broker_adjusted_prices_setting_verified': False,
        'source_formula_to_visible_line_mapping_verified': False,
        'research_source': 'PINNED_FINANCEDATA_MARCAP_UNADJUSTED_KRX_EOD',
        'price_bases_are_hypotheses': ['close', 'hlc3'],
        'zero_broker_samples_for_20_and_40': True,
        'broker_numeric_line_parity_verified': False,
        'broker_signal_verified': False,
        'trade_performance_or_recommendation_allowed': False,
        'production_scanner_unchanged': True,
        'scenarios': scenarios,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=('plan', 'study'), default='plan')
    parser.add_argument('--source-dir', default='output/blue_dot_triple/sources')
    parser.add_argument('--observations', default=str(OBSERVATIONS))
    parser.add_argument('--out', default='output/blue_dot_triple/report.json')
    args = parser.parse_args()
    if args.mode == 'plan':
        print('BLUE_DOT_TRIPLE_PERIOD_PLAN', json.dumps({
            'periods': PERIODS, 'multiplier': MULTIPLIER, 'shift': SHIFT,
            'price_bases': ['close', 'hlc3'], 'bands': ['upper', 'lower'],
            'broker_parity_verified': False, 'no_market_download_or_db_write': True}))
        return
    raw, hashes = load_marcap([2025, 2026], local_dir=args.source_dir)
    if hashes != EXACT_MARCAP_HASHES:
        raise ValueError('SOURCE_SHA_MISMATCH')
    obs = json.loads(Path(args.observations).read_text(encoding='utf-8'))
    report = audit_triple_periods(raw, obs)
    report['source_sha256'] = hashes
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n',
                    encoding='utf-8')
    print('BLUE_DOT_TRIPLE_PERIOD_DIAGNOSTIC_COMPLETE',
          'scenarios', len(report['scenarios']), 'broker_verified', False)


if __name__ == '__main__':
    main()

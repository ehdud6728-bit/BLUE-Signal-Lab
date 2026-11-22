#!/usr/bin/env python3
"""Read-only audit of a user-supplied Kiwoom shifted upper Bollinger line.

The numeric values are user-reported, not authenticated broker exports.  The
study uses pinned *unadjusted* KRX EOD bars while the broker screenshot had
"adjusted prices" checked.  Never promote two visually checked days into a
validated scanner, candidate ranking, alert, or executable trade rule.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

try:
    from scripts.market_scan import load_marcap, normalise
    from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES
except ModuleNotFoundError:
    from market_scan import load_marcap, normalise
    from research_v2_targeted_history import EXACT_MARCAP_HASHES


SAMPLE_FILE = Path(__file__).resolve().parents[1] / 'research/blue_dot_broker_samples.json'
BASES = ('close', 'hlc3')


def _finite_price(value, label):
    price = float(value)
    if not (0 < price < 1e10 and pd.notna(price)):
        raise ValueError(f'INVALID_BROKER_SAMPLE_{label}')
    return price


def classify_cross(open_price, close_price, prior_close, previous_line, line):
    """Compare the user's geometric rule to the extra scanner-only 20/20 rule."""
    body = close_price - open_price
    descending = line < previous_line
    prior_below = prior_close <= previous_line
    opens_below = open_price < line
    closes_above = close_price > line
    geometry = (descending and prior_below and opens_below and
                closes_above and body > 0)
    below_body_pct = 100 * (line - open_price) / body if body > 0 else None
    above_body_pct = 100 * (close_price - line) / body if body > 0 else None
    strict = (geometry and body / open_price >= .005 and
              below_body_pct >= 20 and above_body_pct >= 20)
    return {'falling_line': descending, 'prior_close_below_prior_line': prior_below,
            'open_below_line': opens_below, 'close_above_line': closes_above,
            'geometry_cross': geometry, 'scanner_strict_cross': strict,
            'scanner_extra_filter_is_not_user_original_rule': True,
            'bullish_body_pct': round(100 * body / open_price, 3),
            'body_below_line_pct': (round(below_body_pct, 3)
                                    if below_body_pct is not None else None),
            'body_above_line_pct': (round(above_body_pct, 3)
                                    if above_body_pct is not None else None)}


def audit_broker_samples(raw: pd.DataFrame, sample: dict):
    """Compare both basis hypotheses without manufacturing a parity PASS."""
    obs = sample['observations']
    if len(obs) != 2 or obs[0]['date'] >= obs[1]['date']:
        raise ValueError('BROKER_AUDIT_REQUIRES_TWO_ORDERED_DAYS')
    if sample['formula'] != 'SHIFT(BBandsUp(Period,D1),shift)':
        raise ValueError('UNEXPECTED_BROKER_FORMULA')
    n, k, shift = (int(sample['period']), float(sample['multiplier']),
                   int(sample['shift']))
    if n < 2 or shift < 1 or k <= 0:
        raise ValueError('INVALID_BROKER_PARAMETERS')
    observed = {pd.Timestamp(x['date']): _finite_price(x['blue_line_krw'],
                x['date']) for x in obs}
    if len(observed) != 2:
        raise ValueError('DUPLICATE_BROKER_DAYS')

    code = str(sample['ticker_code']).zfill(6)
    ticker_raw = raw.loc[raw['Code'].astype(str).str.zfill(6).eq(code)].copy()
    if ticker_raw.empty:
        raise ValueError('BROKER_TICKER_MISSING_FROM_SOURCE')
    d = normalise(ticker_raw)
    d = d.sort_values('date').reset_index(drop=True)
    dates = list(observed)
    rows = []
    for date in dates:
        matches = d.index[d.date.eq(date)].tolist()
        if len(matches) != 1:
            raise ValueError('BROKER_DATE_MISSING_OR_DUPLICATE_' + date.strftime('%Y%m%d'))
        rows.append(int(matches[0]))
    if rows[1] != rows[0] + 1:
        raise ValueError('BROKER_DATES_NOT_CONSECUTIVE_TICKER_BARS')

    # Compare 62 consecutive market sessions for (35, 2, 26), including the
    # prior shifted value.  A suspended ticker must never inherit a stale line.
    market_dates = sorted(pd.Timestamp(x) for x in pd.to_datetime(raw['Date']).unique())
    market_positions = {day: i for i, day in enumerate(market_dates)}
    needed = n + shift
    if rows[0] < needed:
        raise ValueError('BROKER_SAMPLE_HISTORY_TOO_SHORT')
    history = d.date.iloc[rows[0]-needed:rows[1]+1]
    positions = [market_positions[x] for x in history]
    continuous = all(b == a + 1 for a, b in zip(positions, positions[1:]))
    if not continuous:
        raise ValueError('BROKER_SAMPLE_HAS_MISSING_ISSUER_SESSIONS')

    previous, current = d.iloc[rows[0]], d.iloc[rows[1]]
    observed_classification = classify_cross(
        float(current.open), float(current.close), float(previous.close),
        observed[dates[0]], observed[dates[1]])
    scenarios = {}
    for basis in BASES:
        values = (d.close if basis == 'close' else
                  (d.high + d.low + d.close) / 3)
        roll = values.rolling(n, min_periods=n)
        upper = (roll.mean() + k*roll.std(ddof=0)).shift(shift)
        predicted = [float(upper.iloc[i]) for i in rows]
        if not all(pd.notna(x) for x in predicted):
            raise ValueError('BROKER_PREDICTED_LINE_MISSING')
        scenarios[basis] = {
            'model_line_krw_by_day': {str(day.date()): round(pred, 3)
                                       for day, pred in zip(dates, predicted)},
            'model_minus_broker_krw_by_day': {
                str(day.date()): round(pred-observed[day], 3)
                for day, pred in zip(dates, predicted)},
            'model_classification': classify_cross(
                float(current.open), float(current.close), float(previous.close),
                predicted[0], predicted[1])}

    return {
        'schema': 'BLUE_DOT_BROKER_PARITY_DIAGNOSTIC_V1',
        'source': sample['source'],
        'price_session': sample['price_session'],
        'broker_adjusted_prices_checked': bool(sample['broker_adjusted_prices_checked']),
        'research_source_adjusted_prices_verified': False,
        'ticker': {'code': code, 'name': sample['ticker_name']},
        'formula': sample['formula'],
        'parameters': {'period': n, 'multiplier': k, 'shift': shift},
        'broker_line_krw_by_day': {str(day.date()): observed[day] for day in dates},
        'source_ohlc_krw_on_signal_day': {
            'open': float(current.open), 'high': float(current.high),
            'low': float(current.low), 'close': float(current.close),
            'prior_close': float(previous.close)},
        'broker_line_delta_krw': round(observed[dates[1]] - observed[dates[0]], 3),
        'broker_line_vs_source_ohlc_classification': observed_classification,
        'price_basis_hypotheses': scenarios,
        'prior_history_contiguous_against_market_dates': continuous,
        'broker_numeric_line_parity_verified': False,
        'two_samples_cannot_verify_corporate_actions_or_live_fills': True,
        'selected_rule': None,
        'recommendation_or_production_change_allowed': False,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', default='output/blue_dot_tuning/sources')
    parser.add_argument('--out', default='output/blue_dot_tuning/parity.json')
    parser.add_argument('--samples', default=str(SAMPLE_FILE))
    args = parser.parse_args()
    sample = json.loads(Path(args.samples).read_text(encoding='utf-8'))
    raw, hashes = load_marcap([2025, 2026], local_dir=args.source_dir)
    if hashes != EXACT_MARCAP_HASHES:
        raise ValueError('BLUE_DOT_BROKER_AUDIT_SOURCE_SHA_MISMATCH')
    report = audit_broker_samples(raw, sample)
    report['source_sha256'] = hashes
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n',
                      encoding='utf-8')
    print('BLUE_DOT_BROKER_PARITY_DIAGNOSTIC',
          'same_basis_parity_not_claimed', 'production_unchanged')


if __name__ == '__main__':
    main()

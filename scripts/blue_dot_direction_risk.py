#!/usr/bin/env python3
"""Exploratory A/B slope-direction risk audit for BB 20/30/40, 2, shift 26.

A = declining line + confirmed upward candle cross from below.
B = rising or flat line + the SAME confirmed cross from below.
Both CLOSE/HLC3 source hypotheses and upper/lower bands remain separate.
All events are model hypotheses, not verified Kiwoom signals or trades.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

try:
    from scripts.blue_dot_broker_parity import classify_cross
    from scripts.blue_dot_2026_research import build_blue_signals
    from scripts.blue_dot_parameter_sweep import contiguous_lookback
    from scripts.env20_rebound_comparison import MIN_HISTORY, evaluate
    from scripts.market_scan import load_marcap
    from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES
except ModuleNotFoundError:
    from blue_dot_broker_parity import classify_cross
    from blue_dot_2026_research import build_blue_signals
    from blue_dot_parameter_sweep import contiguous_lookback
    from env20_rebound_comparison import MIN_HISTORY, evaluate
    from market_scan import load_marcap
    from research_v2_targeted_history import EXACT_MARCAP_HASHES


PERIODS = (20, 30, 40)
BASES = ('close', 'hlc3')
BANDS = ('upper', 'lower')
DIRECTIONS = ('A_FALLING', 'B_NONFALLING')
SHIFT = 26
MULTIPLIER = 2.0
POLICIES = ((2.5, 4.5), (5.0, 3.0))
HORIZONS = (5, 20)
PRIMARY = (5, 2.5, 4.5)


def flags_and_specs():
    specs = []
    for n in PERIODS:
        for basis in BASES:
            for band in BANDS:
                for direction in DIRECTIONS:
                    flag = (f'DIR_{n}_' + ('C' if basis == 'close' else 'H') +
                            ('_U_' if band == 'upper' else '_L_') +
                            ('A' if direction == 'A_FALLING' else 'B'))
                    specs.append({'flag': flag, 'period': n, 'basis': basis,
                                  'band': band, 'direction': direction,
                                  'multiplier': MULTIPLIER, 'shift': SHIFT})
    if len(specs) != 24 or len({x['flag'] for x in specs}) != 24:
        raise ValueError('DIRECTION_SPEC_COLLISION')
    return specs


def build_direction_signals(raw: pd.DataFrame, *, min_history=MIN_HISTORY):
    """Calculate only causal lines, rejecting any missing issuer market day.

    The user's geometric rule is used without the scanner's extra 0.5% body
    and 20/20 position filters; those are distinct study hypotheses.
    """
    d, sessions = build_blue_signals(raw, min_history=min_history)
    by_code = d.groupby('code', sort=False)
    history = by_code.cumcount()+1
    prior_session = by_code.session_index.shift(1)
    valid = (history.ge(min_history) &
             prior_session.eq(d.session_index-1) &
             d.prior_close.gt(0) &
             ((d.open/d.prior_close-1).abs() < .4))
    bullish = d.close.gt(d.open)
    values = {'close': d.close,
              'hlc3': (d.high+d.low+d.close)/3}
    specs = flags_and_specs()
    for basis, value in values.items():
        grouped = value.groupby(d.code, sort=False)
        for n in PERIODS:
            roll_mean = grouped.transform(
                lambda x: x.rolling(n, min_periods=n).mean())
            roll_std = grouped.transform(
                lambda x: x.rolling(n, min_periods=n).std(ddof=0))
            contiguous = contiguous_lookback(d.session_index, d.code, n+SHIFT)
            for band, sign in (('upper', +1), ('lower', -1)):
                line = (roll_mean+sign*MULTIPLIER*roll_std).groupby(
                    d.code, sort=False).shift(SHIFT)
                previous = line.groupby(d.code, sort=False).shift(1)
                common = (valid & contiguous & line.gt(0) & previous.gt(0) &
                          d.prior_close.le(previous) & d.open.lt(line) &
                          d.close.gt(line) & bullish)
                prefix = (f'DIR_{n}_' + ('C' if basis == 'close' else 'H') +
                          ('_U_' if band == 'upper' else '_L_'))
                d[prefix+'A'] = (common & line.lt(previous)).fillna(False)
                d[prefix+'B'] = (common & line.ge(previous)).fillna(False)
    definitions = {
        s['flag']: (f"BB({s['period']},2) {s['band']} shifted +26; "
                    f"price basis hypothesis={s['basis']}; "
                    f"line direction={s['direction']}; "
                    'prior close<=prior line, open<line<close, bullish; '
                    'complete issuer sessions; no strict 0.5%/20% filters')
        for s in specs}
    return d, sessions, specs, definitions


def compact_risk_report(full: dict, specs: list[dict]) -> dict:
    """Preserve counts and tail risk, never select a winning rule."""
    studies = full['results']
    primary = [s for s in studies if (
        s['observation_sessions_not_forced_holding'],
        s['take_profit_pct'], s['stop_loss_pct']) == PRIMARY]
    if len(primary) != 1:
        raise ValueError('PRIMARY_STUDY_MISSING_OR_DUPLICATED')
    primary_patterns = primary[0]['patterns']
    model_results = []
    for s in specs:
        p = primary_patterns[s['flag']]
        model_results.append({**s, 'signal_events': p['signal_events'],
            'excluded_events': p['exclusions'],
            'train': p['train'], 'holdout': p['holdout'],
            'holdout_market_1d': p['holdout_by_market_1d'],
            'holdout_market_5d': p['holdout_by_market_5d'],
            'chart_check_take_examples': p['holdout_latest_first_take_examples'],
            'chart_check_stop_examples': p['holdout_latest_first_stop_examples'],
            'chart_check_stop_gap_examples': p['holdout_latest_stop_gap_examples'],
            'chart_check_severe_loss_examples':
                p['holdout_latest_severe_loss_examples'],
            'broker_signal_verified': False})
    sensitivities = []
    for s in studies:
        key = (s['observation_sessions_not_forced_holding'],
               s['take_profit_pct'], s['stop_loss_pct'])
        if key == PRIMARY:
            continue
        sensitivities.append({'observation_sessions_not_forced_holding': key[0],
            'take_profit_pct': key[1], 'stop_loss_pct': key[2],
            'patterns': {flag: {'train': p['train'], 'holdout': p['holdout']}
                         for flag, p in s['patterns'].items()}})
    return {
        'schema': 'BLUE_DOT_DIRECTION_20_30_40_RISK_EXPLORATORY_V1',
        'source': full['source'], 'source_sha256': full['source_2025_2026_hashes'],
        'study_start': full['study_start'], 'study_end': full['study_end'],
        'studied_market_sessions': full['studied_market_sessions'],
        'train_end_before_holdout_start': full['train_end_before_holdout_start'],
        'holdout_start': full['holdout_start'],
        'periods': list(PERIODS), 'multiplier': MULTIPLIER, 'shift': SHIFT,
        'model_cohorts': model_results, 'policy_sensitivity': sensitivities,
        'primary_policy_not_optimized': {'observation_sessions_not_forced_holding':
            PRIMARY[0], 'take_profit_pct': PRIMARY[1], 'stop_loss_pct': PRIMARY[2]},
        'entry': 'ASSUMED_SIGNAL_DAY_CLOSE_WITH_UNVERIFIED_AFTER_HOURS_FILL',
        'take_and_stop_are_FIRST_TOUCH_NOT_FORCED_HOLD_EXIT': True,
        'same_bar_take_stop_order_unknown_assumed_stop_first': True,
        'gap_stop_uses_later_open_not_a_pre_entry_filter': True,
        'unresolved_no_touch_is_not_a_realized_return': True,
        'train_and_holdout_are_not_independent_future_evidence': True,
        'overlapping_ticker_day_signals_across_variants_not_independent': True,
        'price_basis_and_broker_visible_line_mapping_unverified': True,
        'broker_confirmed_signal_count': 0,
        'user_supplied_20_40_broker_prices_missing': True,
        'automated_best_candidate_selected': False,
        'recommendation_or_production_change_allowed': False,
    }


def annotate_chart_examples(report: dict, d: pd.DataFrame) -> None:
    """Attach same-source prior/current line prices to all modeled examples.

    Kept separate from the full-universe engine so the heavy line re-calculation
    covers only examples' issuers. A chart-review sample is NOT broker verified.
    """
    categories = ('chart_check_take_examples', 'chart_check_stop_examples',
                  'chart_check_stop_gap_examples',
                  'chart_check_severe_loss_examples')
    selected = {case['code'] for spec in report['model_cohorts']
                for cat in categories for case in spec[cat]}
    if not selected:
        return
    stock = d.loc[d.code.isin(selected)].sort_values(
        ['code', 'date']).reset_index(drop=True)
    if stock.duplicated(['code', 'date']).any():
        raise ValueError('DIRECTION_CHART_DUPLICATE_BAR')
    lookup = {(row.code, row.date.strftime('%Y-%m-%d')): i
              for i, row in enumerate(stock.itertuples(index=False))}
    values = {'close': stock.close,
              'hlc3': (stock.high+stock.low+stock.close)/3}
    for spec in report['model_cohorts']:
        period = spec['period']
        grouped = values[spec['basis']].groupby(stock.code, sort=False)
        rolling = grouped.transform(
            lambda x: x.rolling(period, min_periods=period).mean() +
            (1 if spec['band'] == 'upper' else -1)*MULTIPLIER *
            x.rolling(period, min_periods=period).std(ddof=0))
        line = rolling.groupby(stock.code, sort=False).shift(SHIFT)
        prior_line = line.groupby(stock.code, sort=False).shift(1)
        contiguous = contiguous_lookback(stock.session_index, stock.code,
                                         period+SHIFT)
        for category in categories:
            for case in spec[category]:
                idx = lookup.get((case['code'], case['signal_day']))
                if idx is None or not bool(contiguous.iloc[idx]) or not bool(
                        stock.iloc[idx][spec['flag']]):
                    raise ValueError('DIRECTION_CHART_SAMPLE_NOT_VALID_SIGNAL')
                row = stock.iloc[idx]
                earlier, now = float(prior_line.iloc[idx]), float(line.iloc[idx])
                classified = classify_cross(
                    float(row.open), float(row.close), float(row.prior_close),
                    earlier, now)
                crossing_without_slope = (classified['prior_close_below_prior_line']
                    and classified['open_below_line'] and
                    classified['close_above_line'] and float(row.close) > float(row.open))
                falling = now < earlier
                if not crossing_without_slope or (falling !=
                        (spec['direction'] == 'A_FALLING')):
                    raise ValueError('DIRECTION_CHART_GEOMETRY_MISMATCH')
                case.update({
                    'model_line_previous_day_krw': round(earlier, 3),
                    'model_line_signal_day_krw': round(now, 3),
                    'model_line_direction': 'falling' if falling else 'nonfalling',
                    'source_ohlc_krw': {
                        'prior_close': float(row.prior_close),
                        'open': float(row.open), 'high': float(row.high),
                        'low': float(row.low), 'close': float(row.close)},
                    'plain_cross_model_verified': bool(crossing_without_slope),
                    'source_line_contiguous_full_market_sessions': True,
                    'broker_signal_verified': False,
                    'chart_validation_status': 'MODEL_ONLY_NOT_KIWOOM_VERIFIED',
                })


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=('plan', 'study'), default='plan')
    parser.add_argument('--source-dir', default='output/blue_dot_direction/sources')
    parser.add_argument('--out', default='output/blue_dot_direction/report.json')
    args = parser.parse_args()
    specs = flags_and_specs()
    if args.mode == 'plan':
        print('BLUE_DOT_DIRECTION_RISK_PLAN', json.dumps({
            'periods': PERIODS, 'A': 'falling', 'B': 'rising_or_flat',
            'bases': BASES, 'bands': BANDS, 'cohorts': len(specs),
            'source_sha256': EXACT_MARCAP_HASHES,
            'no_download_no_db_no_orders': True}))
        return
    raw, hashes = load_marcap([2025, 2026], local_dir=args.source_dir)
    if hashes != EXACT_MARCAP_HASHES:
        raise ValueError('BLUE_DOT_DIRECTION_SOURCE_SHA_MISMATCH')
    d, sessions, specs, definitions = build_direction_signals(raw)
    full = evaluate(d, sessions,
        stage_flags={x['flag']: x['flag'] for x in specs},
        pattern_definitions=definitions, policies=POLICIES, horizons=HORIZONS,
        expose_risk_examples=True,
        output_schema='BLUE_DOT_DIRECTION_UNVALIDATED_FULL_STUDY_V1')
    report = compact_risk_report(full, specs)
    annotate_chart_examples(report, d)
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n',
                    encoding='utf-8')
    print('BLUE_DOT_DIRECTION_RISK_STUDY',
          'cohorts='+str(len(specs)),
          'market_sessions='+str(report['studied_market_sessions']),
          'BROKER_VERIFIED=FALSE', 'BEST_SELECTED=FALSE',
          'D1_WRITES=0', 'TURSO_WRITES=0', 'KIS_CALLS=0', 'TRADES=0')


if __name__ == '__main__':
    main()

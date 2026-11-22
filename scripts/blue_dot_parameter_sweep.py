#!/usr/bin/env python3
"""Read-only sensitivity study of the user's shifted BBandsUp blue-dot line.

The user supplied the original chart expression:
    SHIFT(BBandsUp(Period, D1), shift)
and confirmed that the visible blue line is the upper (second) formula.
Kiwoom's positive SHIFT direction is rightward; today's displayed value
therefore comes from an earlier bar. This script does NOT assert that the
broker's BBandsUp price basis, adjustment, or volatility denominator matches
our independently calculated values. Both CLOSE and HLC3 are hypotheses.

Candidates are frozen before THIS sweep, but chosen after earlier baseline
results were seen. Only one parameter varies from each baseline at a time,
avoiding a large outcome-chasing search. Results are descriptive, not
ranked/optimized trading rules. The 2026 holdout was already inspected in
prior research and is NOT pristine; future forward evidence is required.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

try:
    from scripts.blue_dot_2026_research import build_blue_signals
    from scripts.blue_dot_broker_parity import classify_cross
    from scripts.env20_rebound_comparison import MIN_HISTORY, evaluate
    from scripts.market_scan import load_marcap
    from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES
except ModuleNotFoundError:
    from blue_dot_2026_research import build_blue_signals
    from blue_dot_broker_parity import classify_cross
    from env20_rebound_comparison import MIN_HISTORY, evaluate
    from market_scan import load_marcap
    from research_v2_targeted_history import EXACT_MARCAP_HASHES


BASELINES = ((20, 2.0, 26), (30, 2.0, 26))
PRICE_BASES = ('close', 'hlc3')
STYLES = ('strict', 'geometry')
PRIMARY_POLICY = (5, 2.5, 4.5)
ALL_POLICIES = ((2.5, 4.5), (5.0, 3.0))
ALL_HORIZONS = (5, 20)
# Fixed for *chart checking*, not selected by realized returns. The 35-day
# sample is the user's own inspected Kiwoom setting; 20/39 tests shift risk.
CHART_CHECK_FLAGS = ('T_H_20_20_26_G', 'T_H_30_20_26_G',
                     'T_H_35_20_26_G', 'T_H_20_20_39_G')
CHART_CHECK_CATEGORIES = (
    ('take', 'holdout_latest_first_take_examples'),
    ('stop', 'holdout_latest_first_stop_examples'),
    ('stop_gap', 'holdout_latest_stop_gap_examples'),
    ('severe_loss', 'holdout_latest_severe_loss_examples'),
)
CHART_DISPUTES_FILE = (Path(__file__).resolve().parents[1] /
                       'research/blue_dot_chart_disputes.json')


def frozen_parameters():
    """Small pre-registered one-factor-at-a-time perturbations, not a grid fit."""
    triples = set(BASELINES)
    triples.update((n, 2.0, 26) for n in (15, 25, 35, 40))
    triples.update((n, d, 26) for n in (20, 30) for d in (1.5, 2.5))
    triples.update((n, 2.0, shift) for n in (20, 30)
                   for shift in (13, 20, 39))
    return tuple(sorted(triples))


def candidate_definitions():
    specs = []
    for basis in PRICE_BASES:
        for n, multiplier, shift in frozen_parameters():
            for style in STYLES:
                # Identifier is stable and omits all price/outcome information.
                flag = ('T_' + ('C' if basis == 'close' else 'H') +
                        f'_{n}_{int(multiplier*10)}_{shift}_' +
                        ('S' if style == 'strict' else 'G'))
                specs.append({'flag': flag, 'basis': basis, 'period': n,
                              'multiplier': multiplier, 'shift': shift,
                              'cross': style,
                              'is_original_setting':
                                  (n, multiplier, shift) in BASELINES})
    assert len({s['flag'] for s in specs}) == len(specs)
    return specs


def contiguous_lookback(session_index, code, window):
    """Exclude stale lines crossing ANY missing ticker session in its history.

    To compare today's line against yesterday's line, the earliest consumed
    window point is n+shift sessions back, not n+shift-1.
    """
    return session_index.sub(session_index.groupby(code, sort=False).shift(window)).eq(window)


def build_tuning_signals(raw: pd.DataFrame, *, min_history=MIN_HISTORY):
    """Causal candidate lines, evaluated only on complete issuer session runs.

    The existing strict scanner filter is retained as an explicit hypothesis;
    the user's visible *line* formula alone does not include a candle filter.
    """
    d, sessions = build_blue_signals(raw, min_history=min_history)
    group = d.groupby('code', sort=False)
    history = group.cumcount() + 1
    prior_session = group.session_index.shift(1)
    prior_close = d.prior_close
    eligible = (history.ge(min_history) &
                prior_session.eq(d.session_index - 1) &
                prior_close.gt(0) &
                ((d.open / prior_close - 1).abs() < .4))
    body = d.close - d.open
    positive_body = body.gt(0) & (body / d.open * 100).ge(.5)

    bases = {'close': d.close, 'hlc3': (d.high + d.low + d.close)/3}
    rolls = {}
    for basis, value in bases.items():
        for n in sorted({s[0] for s in frozen_parameters()}):
            by_ticker = value.groupby(d.code, sort=False)
            rolls[(basis, n)] = (
                by_ticker.transform(lambda x: x.rolling(n, min_periods=n).mean()),
                by_ticker.transform(lambda x: x.rolling(n, min_periods=n).std(ddof=0)))

    defs = {}
    for spec in candidate_definitions():
        n, multiplier, shift = (spec['period'], spec['multiplier'], spec['shift'])
        mean, deviation = rolls[(spec['basis'], n)]
        line = (mean + multiplier*deviation).groupby(d.code, sort=False).shift(shift)
        previous_line = line.groupby(d.code, sort=False).shift(1)
        safe_window = contiguous_lookback(d.session_index, d.code, n + shift)
        geometry = (eligible & safe_window & line.gt(0) & previous_line.gt(0) &
                    line.lt(previous_line) & prior_close.le(previous_line) &
                    d.open.lt(line) & d.close.gt(line) & body.gt(0))
        if spec['cross'] == 'strict':
            hit = (geometry & positive_body &
                   ((line-d.open) / body).ge(.2) &
                   ((d.close-line) / body).ge(.2))
        else:
            hit = geometry
        d[spec['flag']] = hit.fillna(False).astype(bool)
        defs[spec['flag']] = (f"SHIFT(BBandsUp({n},{multiplier}),{shift}), "
                              f"basis hypothesis={spec['basis']}, "
                              f"strict_body={spec['cross']=='strict'}, "
                              'requires falling line and continuous ticker sessions')
    return d, sessions, defs


def compact_report(full, specs):
    """Keep cohort counts and risk detail but never issue securities signals."""
    data = {k: v for k, v in full.items() if k not in ('results', 'pattern_definitions')}
    data.pop('repeated_signals_and_C_subset_of_B_are_not_independent', None)
    data.update({
        'schema': 'BLUE_DOT_SHIFTED_UPPER_TUNING_EXPLORATORY_V1',
        'original_user_line_formula_verified': True,
        'formula': 'SHIFT(BBandsUp(Period,D1),shift)',
        'shift_positive_moves_line_right': True,
        'broker_numeric_line_parity_verified': False,
        'price_basis_candidates_not_verified': list(PRICE_BASES),
        'std_ddof_assumed_unverified': 0,
        'ticker_history_window_contiguity_required': True,
        'candidate_grid_frozen_before_this_sweep_only': True,
        'grid_designed_after_prior_baseline_results_were_seen': True,
        'same_stock_and_overlapping_candidate_events_not_independent': True,
        'one_variable_changed_from_baseline': True,
        'previously_inspected_2026_holdout_not_pristine': True,
        'risk_outcomes_first_touch_with_censoring_not_actual_trades': True,
        'automated_best_candidate_selection': False,
        'new_rule_or_gold_or_alert_or_trade_allowed': False,
        'specs': specs,
        'primary_5d_take2_5_stop4_5': {},
        'predefined_sensitivity': [],
    })
    for study in full['results']:
        key = (study['observation_sessions_not_forced_holding'],
               study['take_profit_pct'], study['stop_loss_pct'])
        if key == PRIMARY_POLICY:
            for flag, result in study['patterns'].items():
                data['primary_5d_take2_5_stop4_5'][flag] = {
                    'train': result['train'], 'holdout': result['holdout'],
                    'holdout_by_market_1d': result['holdout_by_market_1d'],
                    'holdout_by_market_5d': result['holdout_by_market_5d'],
                    'examples_take': result['holdout_latest_first_take_examples'],
                    'examples_stop': result['holdout_latest_first_stop_examples'],
                }
        else:
            data['predefined_sensitivity'].append({
                'observation_sessions_not_forced_holding': key[0],
                'take_profit_pct': key[1], 'stop_loss_pct': key[2],
                'summary': {flag: {'train': r['train'], 'holdout': r['holdout']}
                            for flag, r in study['patterns'].items()},
            })
    return data


def chart_check_dossier(full, d: pd.DataFrame, specs, *, chart_disputes=None):
    """Annotate a small, predeclared set of holdout examples for HTS checks.

    Broker line values are *not* read from an HTS. Every displayed modeled
    line is recomputed from the pinned unadjusted HLC3 bars, with all needed
    prior bars retained. Reject a case that is not actually a modeled cross.
    """
    if chart_disputes is None:
        chart_disputes = json.loads(CHART_DISPUTES_FILE.read_text(encoding='utf-8'))
    disputed = {}
    for item in chart_disputes['disputes']:
        pair = (str(item['code']).zfill(6), str(item['model_signal_day']))
        if pair in disputed or item['verdict'] not in (
            'MODEL_SIGNAL_DAY_DIFFERS_FROM_USER_CHART',
            'USER_REPORTS_NO_BLUE_DOTTED_LINE_CROSS'):
            raise ValueError('CHART_CHECK_INVALID_USER_DISPUTE')
        disputed[pair] = item
    studies = [s for s in full['results'] if (
        s['observation_sessions_not_forced_holding'],
        s['take_profit_pct'], s['stop_loss_pct']) == PRIMARY_POLICY]
    if len(studies) != 1:
        raise ValueError('CHART_CHECK_PRIMARY_STUDY_NOT_UNIQUE')
    patterns = studies[0]['patterns']
    spec_map = {spec['flag']: spec for spec in specs}
    if any(flag not in spec_map or flag not in patterns
           for flag in CHART_CHECK_FLAGS):
        raise ValueError('CHART_CHECK_MISSING_PREDEFINED_FLAG')

    selected = set()
    for flag in CHART_CHECK_FLAGS:
        for _, key in CHART_CHECK_CATEGORIES:
            if key not in patterns[flag]:
                raise ValueError('CHART_CHECK_MISSING_RISK_EXAMPLES')
            for case in patterns[flag][key]:
                selected.add(str(case['code']).zfill(6))
    # Restrict heavy rolling computations to the small number of chart
    # samples; keep each code's entire history to avoid lookback leakage.
    columns = ['date', 'code', 'Name', 'open', 'high', 'low', 'close',
               'prior_close', 'session_index', *CHART_CHECK_FLAGS]
    stock = d.loc[d.code.isin(selected), columns].copy()
    if not stock.empty and stock.duplicated(['code', 'date']).any():
        raise ValueError('CHART_CHECK_DUPLICATE_SOURCE_BAR')
    stock = stock.sort_values(['code', 'date']).reset_index(drop=True)
    hlc3 = (stock.high + stock.low + stock.close) / 3
    output = {}
    for flag in CHART_CHECK_FLAGS:
        spec = spec_map[flag]
        if spec['basis'] != 'hlc3' or spec['cross'] != 'geometry':
            raise ValueError('CHART_CHECK_UNEXPECTED_SPEC')
        period, shift = spec['period'], spec['shift']
        rolling = hlc3.groupby(stock.code, sort=False).transform(
            lambda x: x.rolling(period, min_periods=period).mean() +
            2 * x.rolling(period, min_periods=period).std(ddof=0))
        line = rolling.groupby(stock.code, sort=False).shift(shift)
        previous_line = line.groupby(stock.code, sort=False).shift(1)
        safe = contiguous_lookback(stock.session_index, stock.code, period + shift)
        lookup = {(row.code, row.date.strftime('%Y-%m-%d')): idx
                  for idx, row in enumerate(stock.itertuples(index=False))}
        cases = {}
        for category, key in CHART_CHECK_CATEGORIES:
            annotated = []
            for sample in patterns[flag][key]:
                code = str(sample['code']).zfill(6)
                idx = lookup.get((code, sample['signal_day']))
                if idx is None or not safe.iloc[idx] or not bool(stock.iloc[idx][flag]):
                    raise ValueError('CHART_CHECK_SAMPLE_NOT_A_VALID_SIGNAL')
                row = stock.iloc[idx]
                if not pd.notna(line.iloc[idx]) or not pd.notna(previous_line.iloc[idx]):
                    raise ValueError('CHART_CHECK_NO_MODELED_LINE')
                classification = classify_cross(
                    float(row.open), float(row.close), float(row.prior_close),
                    float(previous_line.iloc[idx]), float(line.iloc[idx]))
                if not classification['geometry_cross']:
                    raise ValueError('CHART_CHECK_MODELED_GEOMETRY_MISMATCH')
                dispute = disputed.get((code, sample['signal_day']))
                annotated.append({**sample,
                    'source_ohlc_krw_on_signal_day': {
                        'open': float(row.open), 'high': float(row.high),
                        'low': float(row.low), 'close': float(row.close),
                        'prior_close': float(row.prior_close)},
                    'model_line_krw_signal_day': round(float(line.iloc[idx]), 3),
                    'model_line_krw_prior_day': round(float(previous_line.iloc[idx]), 3),
                    'model_line_cross_classification': classification,
                    'source_ticker_sessions_contiguous_for_line': True,
                    'broker_line_value_not_supplied_for_this_sample': True,
                    'broker_signal_verified': False,
                    'chart_validation_status': (
                        'USER_DISPUTED_MODEL_SIGNAL' if dispute else
                        'MODEL_ONLY_NOT_BROKER_VERIFIED'),
                    'user_chart_dispute': ({
                        'verdict': dispute['verdict'],
                        'user_reported_chart_signal_day':
                            dispute['user_reported_chart_signal_day']}
                        if dispute else None)})
            cases[category] = annotated
        output[flag] = {'parameters': {'period': period,
                        'multiplier': spec['multiplier'], 'shift': shift},
                        'price_basis_hypothesis': 'hlc3',
                        'cross': 'geometry', 'categories': cases}
    return {
        'sample_selection': 'LATEST_FULL_HOLDOUT_DISTINCT_TICKERS_AND_DATES_BY_CATEGORY',
        'categories_can_overlap_and_are_not_independent': True,
        'samples_are_not_random_or_ranked_by_performance': True,
        'only_predeclared_hlc3_geometry_flags': list(CHART_CHECK_FLAGS),
        'broker_numeric_line_parity_verified': False,
        'confirmed_broker_signal_examples': [],
        'no_candidates_may_be_labeled_broker_verified': True,
        'reported_disagreements': chart_disputes['disputes'],
        'dispute_screenshots_do_not_show_exact_indicator_settings': True,
        'broker_adjustment_and_fill_not_verified': True,
        'source_is_pinned_unadjusted_marcap_not_kiwoom': True,
        'cases_by_flag': output,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=('plan', 'study'), default='plan')
    parser.add_argument('--source-dir', default='output/blue_dot_tuning/sources')
    parser.add_argument('--out', default='output/blue_dot_tuning/report.json')
    args = parser.parse_args()
    specs = candidate_definitions()
    if args.mode == 'plan':
        print('BLUE_DOT_TUNING_PLAN', json.dumps({
            'years': [2025, 2026], 'source_sha256': EXACT_MARCAP_HASHES,
            'formula': 'SHIFT(BBandsUp(Period,D1),shift)',
            'candidate_count': len(specs),
            'parameter_triples': frozen_parameters(),
            'bases': PRICE_BASES, 'styles': STYLES,
            'no_market_download_no_secrets_no_db_no_trades': True}))
        return
    raw, hashes = load_marcap([2025, 2026], local_dir=args.source_dir)
    if hashes != EXACT_MARCAP_HASHES:
        raise ValueError('BLUE_DOT_TUNING_SOURCE_SHA_MISMATCH')
    d, sessions, definitions = build_tuning_signals(raw)
    full = evaluate(d, sessions, stage_flags={s['flag']: s['flag'] for s in specs},
                    pattern_definitions=definitions, policies=ALL_POLICIES,
                    horizons=ALL_HORIZONS, expose_risk_examples=True)
    report = compact_report(full, specs)
    report['chart_check_dossier'] = chart_check_dossier(full, d, specs)
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n',
                      encoding='utf-8')
    print('BLUE_DOT_TUNING_STUDY',
          'candidates='+str(len(specs)),
          'sessions='+str(report['studied_market_sessions']),
          'D1_SQL=0', 'TURSO_SQL=0', 'KIS_CALLS=0', 'TRADES=0',
          'BEST_SELECTED=FALSE', 'CHART_NUMERIC_PARITY=FALSE')


if __name__ == '__main__':
    main()

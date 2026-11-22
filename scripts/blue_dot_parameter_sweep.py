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
    from scripts.env20_rebound_comparison import MIN_HISTORY, evaluate
    from scripts.market_scan import load_marcap
    from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES
except ModuleNotFoundError:
    from blue_dot_2026_research import build_blue_signals
    from env20_rebound_comparison import MIN_HISTORY, evaluate
    from market_scan import load_marcap
    from research_v2_targeted_history import EXACT_MARCAP_HASHES


BASELINES = ((20, 2.0, 26), (30, 2.0, 26))
PRICE_BASES = ('close', 'hlc3')
STYLES = ('strict', 'geometry')
PRIMARY_POLICY = (5, 2.5, 4.5)
ALL_POLICIES = ((2.5, 4.5), (5.0, 3.0))
ALL_HORIZONS = (5, 20)


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
                    horizons=ALL_HORIZONS)
    report = compact_report(full, specs)
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

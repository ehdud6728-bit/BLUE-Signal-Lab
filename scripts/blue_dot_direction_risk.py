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
    from scripts.blue_dot_supply_interaction import analyze_supply_interaction
    from scripts.blue_dot_2026_research import build_blue_signals
    from scripts.blue_dot_parameter_sweep import contiguous_lookback
    from scripts.env20_rebound_comparison import MIN_HISTORY, evaluate
    from scripts.market_scan import load_marcap
    from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES
except ModuleNotFoundError:
    from blue_dot_broker_parity import classify_cross
    from blue_dot_supply_interaction import analyze_supply_interaction
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


def assert_supply_reconciles(report: dict) -> None:
    """Every supply bucket must conserve the exact underlying A/B cases."""
    by_flag = {s['flag']: s for s in report['model_cohorts']}
    primary = [row for row in report['supply_interaction']['results'] if (
        row['observation_sessions_not_forced_holding'],
        row['take_profit_pct'], row['stop_loss_pct']) == PRIMARY]
    if len(primary) != 6:
        raise ValueError('SUPPLY_PRIMARY_COHORT_COUNT_MISMATCH')
    fields = ('n', 'first_take_count', 'first_stop_count', 'stop_gap_count',
              'severe_resolved_net_at_or_below_minus_10pct_count',
              'unresolved_no_touch_count', 'review_discontinuity_count')
    for row in primary:
        if row['flag'] not in by_flag:
            raise ValueError('SUPPLY_UNEXPECTED_BASE_MODEL')
        for side in ('train', 'holdout'):
            expected = by_flag[row['flag']][side]
            actual = row[side]['total']
            if any(expected[field] != actual[field] for field in fields):
                raise ValueError('SUPPLY_BASE_SIGNAL_OUTCOME_MISMATCH_' +
                                 row['flag'] + '_' + side)
        for lag in (1, 5):
            market = row['holdout'][f'by_supply_and_market_breadth_{lag}d']
            baseline = by_flag[row['flag']][f'holdout_market_{lag}d']
            if set(market) != set(baseline) or any(
                    any(market[state]['total'][key] != baseline[state][key]
                        for key in fields)
                    for state in market):
                raise ValueError('SUPPLY_MARKET_BREADTH_OUTCOME_MISMATCH_' +
                                 row['flag'] + '_' + str(lag))



# The canonical user signal is a descending blue line that is crossed UPWARD.
# A 3-day descent means three strictly decreasing day-over-day comparisons
# (four line observations), not merely the most recent negative difference.
FALLING_LENGTHS = (3, 5)
PREVIOUS_MODEL_STOP_AUDIT = (
    ('000640', '2026-11-12', 20, '동아제약'),
    ('001530', '2026-11-10', 20, 'DI동일'),
    ('002995', '2026-11-09', 20, '금호건설우'),
    ('043650', '2026-11-12', 30, '국순당'),
    ('001515', '2026-11-11', 30, 'SK증권우'),
    ('014280', '2026-11-10', 30, '금강공업'),
    ('000050', '2026-11-11', 40, '경방'),
    ('004060', '2026-11-10', 40, 'SG세계물산'),
    ('002995', '2026-11-09', 40, '금호건설우'),
)


def falling_streak_flags(d: pd.DataFrame):
    """Add 3/5 consecutive down *moves* to existing 1-day A model.

    Does not modify legacy A/B flags, supply analysis, DB, or production search.
    Historical lookback is complete through the shifted source window.
    """
    specs, descriptions, line_cols = [], {}, {}
    sources = {'close': d.close, 'hlc3': (d.high+d.low+d.close)/3}
    for n in PERIODS:
        for basis, values in sources.items():
            grouped = values.groupby(d.code, sort=False)
            ma = grouped.transform(lambda x: x.rolling(n, min_periods=n).mean())
            std = grouped.transform(lambda x: x.rolling(n, min_periods=n).std(ddof=0))
            for band, sign in (('upper', 1), ('lower', -1)):
                letter = ('C' if basis == 'close' else 'H')
                side = ('U' if band == 'upper' else 'L')
                prefix = f'FALL_{n}_{letter}_{side}'
                base = f'DIR_{n}_{letter}_{side}_A'
                line = (ma + sign*MULTIPLIER*std).groupby(
                    d.code, sort=False).shift(SHIFT)
                line_cols[prefix] = line
                group_line = line.groupby(d.code, sort=False)
                prior = [group_line.shift(i) for i in range(1, 6)]
                for streak in FALLING_LENGTHS:
                    # Require k consecutive down moves, including the signal day.
                    checks = line.gt(0)
                    for off in range(streak):
                        newer = line if off == 0 else prior[off-1]
                        older = prior[off]
                        checks = checks & older.gt(0) & newer.lt(older)
                    checks = checks & contiguous_lookback(
                        d.session_index, d.code, n+SHIFT+streak)
                    flag = f'{prefix}_{streak}D'
                    d[flag] = (d[base] & checks).fillna(False).astype(bool)
                    specs.append(dict(flag=flag, period=n, basis=basis,
                                      band=band, falling_moves=streak,
                                      multiplier=MULTIPLIER, shift=SHIFT))
                    descriptions[flag] = (
                        f'{streak} consecutive STRICTLY decreasing daily line moves; '
                        f'{basis} shifted BB {band} {n}/2/26; '
                        'prior close<=prior line, open<line<close, bullish; '
                        'complete historical issuer sessions; model only')
                if (d[f'{prefix}_5D'] & ~d[f'{prefix}_3D']).any():
                    raise ValueError('FALL5_NOT_SUBSET_OF_FALL3')
                if (d[f'{prefix}_3D'] & ~d[base]).any():
                    raise ValueError('FALL3_NOT_SUBSET_OF_ORIGINAL_A')
    if len(specs) != 24:
        raise ValueError('FALLING_COHORT_SPEC_COUNT_MISMATCH')
    return specs, descriptions, line_cols


def strict_falling_report(d: pd.DataFrame, sessions: list[pd.Timestamp]) -> dict:
    """Non-production first-touch study plus explicit prior-failure audit."""
    specs, defs, lines = falling_streak_flags(d)
    raw = evaluate(d, sessions,
        stage_flags={x['flag']: x['flag'] for x in specs},
        pattern_definitions=defs,
        policies=((2.5, 4.5),), horizons=(5,),
        expose_risk_examples=True,
        output_schema='BLUE_DOT_FALLING_3_5_RESEARCH_ONLY_V1')
    patterns = raw['results'][0]['patterns']
    by_code = {code: h.reset_index(drop=True)
               for code, h in d.groupby('code', sort=False)}
    index = {code: {r.date.strftime('%Y-%m-%d'): i
                    for i, r in enumerate(h.itertuples(index=False))}
             for code, h in by_code.items()}
    audit_rows = []
    for code, date, n, label in PREVIOUS_MODEL_STOP_AUDIT:
        h = by_code.get(code)
        idx = index.get(code, {}).get(date)
        if h is None or idx is None:
            audit_rows.append(dict(code=code, label=label, date=date,
                                   period=n, status='NOT_FOUND_IN_PINNED_DATA'))
            continue
        row = h.iloc[idx]
        prefix = f'FALL_{n}_H_L'
        # d is ordered by code/date; use direct d row to retrieve global line.
        target = d.loc[d.code.eq(code) & d.date.eq(pd.Timestamp(date))]
        if len(target) != 1:
            raise ValueError('PRIOR_FAILURE_AUDIT_DUPLICATE')
        target_idx = target.index[0]
        original = bool(target.iloc[0][f'DIR_{n}_H_LA'])
        passes3 = bool(target.iloc[0][prefix+'_3D'])
        passes5 = bool(target.iloc[0][prefix+'_5D'])
        # The actual shifted line is calculated on the full source, never on
        # the filtered failure sample (which would corrupt the rolling window).
        series = lines[prefix]
        vals = series.loc[d.loc[d.code.eq(code)].index]
        pos = list(vals.index).index(target_idx)
        last6 = list(vals.iloc[max(0,pos-5):pos+1])
        audit_rows.append(dict(code=code, name_at_date=str(row.Name),
            originally_reported_name=label, signal_day=date, period=n,
            original_one_day_A_model=original,
            meets_strict_3_declines=passes3,
            meets_strict_5_declines=passes5,
            excluded_by_3=not passes3,
            excluded_by_5=not passes5,
            trailing_six_modeled_line_values_krw=[
                round(float(x),3) if pd.notna(x) else None for x in last6],
            broker_verified=False))
    models = []
    for s in specs:
        p = patterns[s['flag']]
        examples={}
        for tag, source in (
            ('first_stop', 'holdout_latest_first_stop_examples'),
            ('first_take', 'holdout_latest_first_take_examples'),
            ('stop_gap', 'holdout_latest_stop_gap_examples')):
            items=[]
            for example in p[source]:
                ex=dict(example)
                h = by_code[ex['code']]
                idx = index[ex['code']][ex['signal_day']]
                row = h.iloc[idx]
                prefix=f'FALL_{s["period"]}_{"C" if s["basis"]=="close" else "H"}_{"U" if s["band"]=="upper" else "L"}'
                subset = d.loc[d.code.eq(ex['code'])]
                gidx = subset.index[idx]
                v = lines[prefix].loc[subset.index].iloc[max(0,idx-5):idx+1]
                values=list(v)
                if len(values)<s['falling_moves']+1 or not all(
                    values[-1-off] < values[-2-off]
                    for off in range(s['falling_moves'])):
                    raise ValueError('FALLING_MODEL_EXAMPLE_DID_NOT_DESCEND')
                if not bool(d.loc[gidx,s['flag']]):
                    raise ValueError('FALLING_MODEL_EXAMPLE_NOT_CROSS')
                ex.update(model_line_last_six_krw=[
                    round(float(x),3) for x in values],
                    signal_open_krw=float(row.open),
                    signal_close_krw=float(row.close),
                    prior_close_krw=float(row.prior_close),
                    validated_descending_model_only=True,
                    broker_signal_verified=False)
                items.append(ex)
            examples[tag]=items
        models.append({**s, 'signals':p['signal_events'],
            'train':p['train'], 'holdout':p['holdout'],
            'examples': examples})
    return dict(schema='BLUE_DOT_FALLING_3_5_MODEL_ONLY_V1',
       required_declines=[3,5],
       comparisons_include_signal_day=True,
       required_line_values={'3_day':4,'5_day':6},
       original_A_B_study_untouched=True,
       only_downward_streaks_and_upward_candle_cross=True,
       holdout_reused_not_independent=True,
       source_sha256=raw['source_2025_2026_hashes'],
       policy={'first_touch_observation_days':5,'tp_pct':2.5,'sl_pct':4.5,
               'assumed_round_trip_cost_pct_points':0.3},
       all_models_not_broker_verified=True,
       previous_reported_A_failures_audit=audit_rows,
       previously_reported_B_excluded_by_definition=True,
       models=models, recommendation_allowed=False)


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
    report['supply_interaction'] = analyze_supply_interaction(d, sessions)
    assert_supply_reconciles(report)
    report['strict_falling_3_5'] = strict_falling_report(d, sessions)
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

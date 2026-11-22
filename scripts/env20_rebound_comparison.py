#!/usr/bin/env python3
"""Offline, exploratory ENV20 first-touch vs downward-line reclaim research.

This is NOT the audited KRX/Turso study. Inputs are independently pinned,
UNADJUSTED FinanceData/marcap snapshots. A/B/C are predefined hypotheses,
never trade signals to publish. Missing whole-market sessions, missing ticker
bars, unverified corporate actions and missing fills can distort outcomes.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
from statistics import median

import numpy as np
import pandas as pd

try:
    from scripts.market_scan import load_marcap, normalise
    from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES
except ModuleNotFoundError:
    from market_scan import load_marcap, normalise
    from research_v2_targeted_history import EXACT_MARCAP_HASHES


STAGES = ('A_FIRST_TOUCH_FROM_ABOVE', 'B_RECLAIM_FALLING_LOWER_FROM_BELOW',
          'C_B_AFTER_A_WITHIN_20_SESSIONS')
POLICIES = ((2.5, 4.5), (5.0, 3.0))  # Fixed ex ante, not trained on performance.
HORIZONS = (5, 20, 60)  # Observation/censoring caps, NOT time exits.
START, END = '2026-03-01', '2026-11-19'
MIN_HISTORY = 250
COST_PCT = 0.3
# The XKRX library version in this workflow predates the 2026 reinstatement
# of Constitution Day as a market closure. KRX's May 20, 2026 public notice
# explicitly closed all markets on 2026-07-17; see docs/WORK_LOG.md.
KRX_2026_EXTRA_CLOSED = frozenset(('2026-07-17',))


def build_signals(raw: pd.DataFrame, *, min_history=MIN_HISTORY):
    """Use R1.1's price normalizer, but only the defined ENV20 calculations.

    C's predecessor A must have occurred on a strictly earlier full-market
    session with every intervening issuer bar present. No future search.
    """
    d = normalise(raw)
    if d.empty:
        raise ValueError('EMPTY_REBOUND_SOURCE')
    days = sorted(d.date.unique())
    indices = {pd.Timestamp(day): idx for idx, day in enumerate(days)}
    d['session_index'] = d.date.map(indices).astype('int32')
    by_code = d.groupby('code', sort=False)
    d['code_position'] = by_code.cumcount().astype('int32')
    d['history_bars'] = d.code_position + 1
    d['env20_lower'] = by_code.close.transform(
        lambda close: close.rolling(20, min_periods=20).mean()) * 0.8
    by_code = d.groupby('code', sort=False)
    d['prior_lower'] = by_code.env20_lower.shift(1)
    d['prior_low'] = by_code.low.shift(1)
    d['prior_close'] = by_code.close.shift(1)
    d['prior_session'] = by_code.session_index.shift(1)
    consecutive = d.prior_session.eq(d.session_index - 1)
    eligibility = (d.history_bars.ge(min_history) & consecutive &
                   d.prior_close.gt(0) &
                   ((d.open / d.prior_close - 1).abs() < 0.4))
    # A: the currently studied oversold first-touch from ABOVE; red/green
    # candle, slope and close are deliberately irrelevant to this hypothesis.
    a = (eligibility & d.prior_low.gt(d.prior_lower) &
         d.low.le(d.env20_lower) & d.high.ge(d.env20_lower))
    # B: user's proposed confirmation: the LOWER line slopes down, and the
    # stock finishes a bullish crossing FROM BELOW. No same-day lookahead.
    b = (eligibility & d.env20_lower.lt(d.prior_lower) &
         d.prior_close.le(d.prior_lower) & d.open.lt(d.env20_lower) &
         d.close.gt(d.env20_lower) & d.close.gt(d.open))
    d['A'] = a
    d['B'] = b
    d['A_session'] = pd.Series(np.where(a, d.session_index, np.nan), index=d.index)
    d['A_code_position'] = pd.Series(
        np.where(a, d.code_position, np.nan), index=d.index)
    d['last_A_session'] = d.groupby('code', sort=False).A_session.transform(
        lambda x: x.ffill().shift(1))
    d['last_A_position'] = d.groupby('code', sort=False).A_code_position.transform(
        lambda x: x.ffill().shift(1))
    gap = d.session_index - d.last_A_session
    d['C'] = (b & gap.between(1, 20) &
              (d.code_position - d.last_A_position).eq(gap))
    return d, [pd.Timestamp(day) for day in days]


def market_breadth(d: pd.DataFrame):
    """Equal-weight stock breadth on the exact prior 1/5 observed market day."""
    pivot = d.pivot(index='date', columns='code', values='close').sort_index()
    result = {}
    for lag in (1, 5):
        prior = pivot.shift(lag)
        matched = pivot.notna() & prior.notna()
        n = matched.sum(axis=1)
        universe = pivot.notna().sum(axis=1)
        rising = (pivot.gt(prior) & matched).sum(axis=1)
        falling = (pivot.lt(prior) & matched).sum(axis=1)
        net = (rising - falling) / n.replace(0, np.nan)
        for day, count in n.items():
            state = 'UNKNOWN'
            if count >= 30 and count / universe[day] >= 0.9:
                if net[day] >= 0.1:
                    state = 'UP'
                elif net[day] <= -0.1:
                    state = 'DOWN'
                else:
                    state = 'MIXED'
            result[(pd.Timestamp(day), lag)] = state
    return result


def validate_market_calendar(sessions, *, start=START, end=END,
                             calendar_sessions=None):
    """Fail closed on ANY missing whole-market date, not a weekend heuristic.

    Observed sessions are cross-checked against a separate XKRX calendar plus
    the documented 2026-07-17 exceptional exchange closure. The third-party
    library does not certify the KRX calendar, so no 'officially verified'
    flag is asserted even when exact parity passes.
    """
    if calendar_sessions is None:
        import exchange_calendars as xc
        # Initialize across the full years so a holiday before the FIRST
        # session (e.g. Sunday 2026-03-01) is a valid range boundary.
        exchange = xc.get_calendar('XKRX', start=start[:4]+'-01-01',
                                   end=end[:4]+'-12-31')
        calendar_sessions = exchange.sessions_in_range(start, end).tz_localize(None)
    expected = {pd.Timestamp(day).normalize() for day in calendar_sessions}
    expected -= {pd.Timestamp(day) for day in KRX_2026_EXTRA_CLOSED
                 if start <= day <= end}
    observed = {pd.Timestamp(day).normalize() for day in sessions
                if start <= pd.Timestamp(day).strftime('%Y-%m-%d') <= end}
    if observed != expected:
        raise ValueError('REBOUND_MARKET_CALENDAR_DATE_MISMATCH')
    return len(expected)


def observe_touch(entry, future, take_pct, stop_pct):
    """Observes first touches from the session AFTER entry. No forced exit.

    `future` is a list of (open, high, low, close, previous_close, shares).
    A price discontinuity beyond 40% is review-only, not a stop-gap profit.
    """
    close = entry
    take, stop = close * (1 + take_pct / 100), close * (1 - stop_pct / 100)
    for held, (op, hi, lo, cl, previous_close) in enumerate(future, 1):
        if not all(np.isfinite(v) and v > 0 for v in (op, hi, lo, cl, previous_close)):
            return ('REVIEW_DISCONTINUITY', None, held)
        if abs(op / previous_close - 1) >= .4:
            return ('REVIEW_DISCONTINUITY', None, held)
        if op <= stop:
            return ('STOP_GAP', round(100 * (op / close - 1) - COST_PCT, 3), held)
        if op >= take:
            return ('TAKE_GAP', round(take_pct - COST_PCT, 3), held)
        if lo <= stop:
            return ('STOP', round(-stop_pct - COST_PCT, 3), held)
        if hi >= take:
            return ('TAKE', round(take_pct - COST_PCT, 3), held)
    return ('NO_TOUCH', None, None)


def _summarize(cases):
    reasons = Counter(case['reason'] for case in cases)
    n = len(cases)
    stops = reasons['STOP'] + reasons['STOP_GAP']
    takes = reasons['TAKE'] + reasons['TAKE_GAP']
    resolved = [case['net'] for case in cases if case['net'] is not None]
    day_groups = defaultdict(list)
    for case in cases:
        day_groups[case['day']].append(case)
    day_rates = []
    for group in day_groups.values():
        day_rates.append(sum(x['reason'] in ('STOP', 'STOP_GAP') for x in group)
                         / len(group))
    return {'n': n, 'distinct_signal_days': len(day_groups),
        'first_take_count': takes, 'first_stop_count': stops,
        'intraday_both_touch_assumed_stop_count':
            sum(bool(x.get('both_touch', False)) for x in cases),
        'first_take_fraction_of_all_pct': round(takes * 100 / n, 1) if n else None,
        'first_stop_fraction_of_all_pct': round(stops * 100 / n, 1) if n else None,
        'stop_gap_count': reasons['STOP_GAP'],
        'severe_resolved_net_at_or_below_minus_10pct_count': sum(x <= -10 for x in resolved),
        'review_discontinuity_count': reasons['REVIEW_DISCONTINUITY'],
        'unresolved_no_touch_count': reasons['NO_TOUCH'],
        'pending_recent_no_touch': sum(x['reason'] == 'NO_TOUCH' and not x['full']
                                      for x in cases),
        'resolved_only_net_mean_pct_selection_biased':
            round(sum(resolved) / len(resolved), 3) if resolved else None,
        'median_signal_day_stop_fraction_pct':
            round(100 * median(day_rates), 1) if day_rates else None}


def _latest_distinct_examples(cases, reasons, limit=3):
    """Chart-check examples, NOT a ranked strategy or strongest performers.

    Take the latest fully observed cases in deterministic date-desc/code-asc
    order, first preferring different signal dates as well as stock codes.
    This intentional date diversity does not claim a random sample.
    """
    ordered = sorted(
        (c for c in cases if c['full'] and c['reason'] in reasons),
        key=lambda c: (-int(c['day'].replace('-', '')), c['code']))
    selected, codes, days = [], set(), set()
    for distinct_days in (True, False):
        for case in ordered:
            if case['code'] in codes or (distinct_days and case['day'] in days):
                continue
            selected.append({
                'stock_name_at_signal': case['name'],
                'code': case['code'],
                'signal_day': case['day'],
                'first_touch_day': case['touch_day'],
                'first_touch_type': case['reason'],
                'signal_close_krw': case['close'],
                'assumed_net_return_pct': case['net'],
                'intraday_both_touch_order_unknown': case['both_touch'],
                'first_touch_bar_high_krw': case['touch_high'],
                'first_touch_bar_low_krw': case['touch_low'],
                'take_threshold_krw': case['take_threshold'],
                'stop_threshold_krw': case['stop_threshold'],
            })
            codes.add(case['code'])
            days.add(case['day'])
            if len(selected) == limit:
                return selected
    return selected


def evaluate(d: pd.DataFrame, sessions: list[pd.Timestamp], *, start=START,
             end=END, policies=POLICIES, horizons=HORIZONS,
             min_market_stocks=1700, stage_flags=None,
             output_schema='BLUE_ENV20_MARCAP_REVERSAL_EXPLORATORY_V1',
             pattern_definitions=None):
    if stage_flags is None:
        stage_flags = dict(zip(('A', 'B', 'C'), STAGES))
    if pattern_definitions is None:
        pattern_definitions = {
            STAGES[0]: 'previous low ABOVE prior MA20*0.8, today low<=MA20*0.8<=high',
            STAGES[1]: 'MA20*0.8 declining; prior close<=prior lower; open<lower<close',
            STAGES[2]: 'B after latest A in 1..20 fully observed market sessions'}
    studied = [day for day in sessions if start <= day.strftime('%Y-%m-%d') <= end]
    if len(studied) < 40 or studied[-1].strftime('%Y-%m-%d') != end:
        raise ValueError('REBOUND_STUDY_MISSING_SESSIONS_OR_LAST_DATE')
    day_sizes = d.groupby('date').size()
    if any(day_sizes.get(day, 0) < min_market_stocks for day in studied):
        raise ValueError('REBOUND_STUDY_PARTIAL_MARKET_DAY')
    validated_sessions = validate_market_calendar(sessions, start=start, end=end)
    split = sessions.index(studied[len(studied) * 3 // 4])
    market = market_breadth(d)
    # Only ticker-level bars; never forward-fill a missing ticker/session.
    paths = defaultdict(dict)
    for row in d.itertuples(index=False):
        paths[row.code][row.session_index] = (
            float(row.open), float(row.high), float(row.low), float(row.close),
            float(row.prior_close) if pd.notna(row.prior_close) else float('nan'))
    paths = dict(paths)
    prepared = {}
    for flag, name in stage_flags.items():
        e = d.loc[d[flag] & d.date.between(start, end),
                  ['date', 'code', 'session_index', 'Name']]
        prepared[name] = [(pd.Timestamp(day), code, int(i), str(stock_name))
                          for day, code, i, stock_name
                          in e.itertuples(index=False, name=None)]
    results = []
    for horizon in horizons:
        for take, stop in policies:
            study = {'observation_sessions_not_forced_holding': horizon,
                     'take_profit_pct': take, 'stop_loss_pct': stop, 'patterns': {}}
            for pattern, events in prepared.items():
                groups = {'train': [], 'holdout': []}
                excluded = Counter()
                for day, code, i, stock_name in events:
                    if i + horizon < split:
                        group = 'train'
                    elif i >= split:
                        group = 'holdout'
                    else:
                        excluded['embargoed_overlap_cases'] += 1
                        continue
                    if i + 1 >= len(sessions):
                        excluded['pending_no_followup'] += 1
                        continue
                    last = min(i + horizon, len(sessions) - 1)
                    path = paths[code]
                    if any(k not in path for k in range(i, last + 1)):
                        excluded['missing_stock_session_unsafe'] += 1
                        continue
                    outcome, net, held = observe_touch(
                        path[i][3], [path[k] for k in range(i + 1, last + 1)],
                        take, stop)
                    touch_bar = path[i + held] if held is not None else None
                    # The daily bar reveals no high-vs-low order. STOP is a
                    # conservative tie-break, NOT verified first execution.
                    both_touch = bool(outcome == 'STOP' and touch_bar and
                                      touch_bar[1] >= path[i][3]*(1+take/100))
                    groups[group].append({'day': day.strftime('%Y-%m-%d'),
                        'code': code, 'reason': outcome, 'net': net,
                        'name': stock_name, 'close': path[i][3],
                        'both_touch': both_touch,
                        'touch_high': touch_bar[1] if touch_bar else None,
                        'touch_low': touch_bar[2] if touch_bar else None,
                        'take_threshold': round(path[i][3]*(1+take/100), 2),
                        'stop_threshold': round(path[i][3]*(1-stop/100), 2),
                        'touch_day': sessions[i + held].strftime('%Y-%m-%d')
                                     if held is not None else None,
                        'held': held, 'full': i + horizon < len(sessions),
                        'market1': market.get((day, 1), 'UNKNOWN'),
                        'market5': market.get((day, 5), 'UNKNOWN')})
                result = {'signal_events': len(events), 'exclusions': dict(excluded),
                          'train': _summarize(groups['train']),
                          'holdout': _summarize(groups['holdout']),
                          'holdout_latest_first_take_examples':
                              _latest_distinct_examples(
                                  groups['holdout'], ('TAKE', 'TAKE_GAP')),
                          'holdout_latest_first_stop_examples':
                              _latest_distinct_examples(
                                  groups['holdout'], ('STOP', 'STOP_GAP'))}
                for cohort in ('train', 'holdout'):
                    result[cohort + '_by_market_1d'] = {
                        state: _summarize([x for x in groups[cohort]
                            if x['market1'] == state])
                        for state in ('UP', 'DOWN', 'MIXED', 'UNKNOWN')}
                    result[cohort + '_by_market_5d'] = {
                        state: _summarize([x for x in groups[cohort]
                            if x['market5'] == state])
                        for state in ('UP', 'DOWN', 'MIXED', 'UNKNOWN')}
                study['patterns'][pattern] = result
            results.append(study)
    return {'schema': output_schema,
        'source': 'PINNED_FINANCEDATA_MARCAP_UNADJUSTED_NOT_AUDITED_KRX',
        'source_2025_2026_hashes': EXACT_MARCAP_HASHES,
        'study_start': start, 'study_end': end,
        'studied_market_sessions': len(studied),
        'separate_XKRX_calendar_session_count_parity_passed': validated_sessions,
        'train_end_before_holdout_start': sessions[split-1].strftime('%Y-%m-%d'),
        'holdout_start': sessions[split].strftime('%Y-%m-%d'),
        'market_regime': 'EQUAL_WEIGHT_1D_AND_5D_ADVANCERS_MINUS_DECLINERS_10PP',
        'pattern_definitions': pattern_definitions,
        'source_market_calendar_independently_verified': False,
        'secondary_XKRX_calendar_exact_parity_with_official_2026_07_17_exception': True,
        'source_corporate_actions_verified': False,
        'entry_fill_verified': False, 'exit_fill_verified': False,
        'closing_auction_1520_signal_supported': False,
        'entry_assumption': 'CONDITIONAL_SIGNAL_DAY_CLOSE_AFTER_HOURS_FILL',
        'no_time_exit': True, 'no_touch_is_censored': True,
        'gap_opens_are_assumed_not_verified_fills': True,
        'same_day_double_touch_stop_first': True,
        'repeated_signals_and_C_subset_of_B_are_not_independent': True,
        'selected_rule': None, 'recommendation_allowed': False,
        'candidate_stocks': [], 'results': results}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=('plan', 'study'), default='plan')
    parser.add_argument('--source-dir', default='output/env20_rebound/sources')
    parser.add_argument('--out', default='output/env20_rebound/report.json')
    args = parser.parse_args()
    if args.mode == 'plan':
        print('BLUE_ENV20_REBOUND_PLAN', json.dumps({
            'status': 'NO_NETWORK_NO_DB', 'years': [2025, 2026],
            'expected_sha256': EXACT_MARCAP_HASHES, 'policies': POLICIES,
            'horizons': HORIZONS, 'recommendations': False}))
        return
    raw, hashes = load_marcap([2025, 2026], local_dir=args.source_dir)
    if hashes != EXACT_MARCAP_HASHES:
        raise ValueError('REBOUND_MARCAP_SHA_MISMATCH')
    d, days = build_signals(raw)
    report = evaluate(d, days)
    target = Path(args.out)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n',
                      encoding='utf8')
    print('BLUE_ENV20_REBOUND_STUDY', 'days=' + str(report['studied_market_sessions']),
          'D1_SQL=0', 'TURSO_SQL=0', 'KIS_CALLS=0', 'TRADES=0')


if __name__ == '__main__':
    main()

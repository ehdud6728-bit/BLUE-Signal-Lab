#!/usr/bin/env python3
"""Conditional signal-close entry: first profit/stop touch, no time exit.

The final daily signal is NOT available at the 15:20 closing auction. This
module assumes an unverified *after-hours* fill at the signal-day close and
observes possible exits only from the NEXT audited trading session onward.
Daily OHLC cannot establish intraday ordering or real order execution. A
double touch is conservatively assigned to the stop, and an opening stop gap
is filled at the worse observed open. No calendar-horizon liquidation occurs.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from statistics import median

try:
    from scripts.empirical_entry_exit_research import (
        COST_PCT, HORIZONS, MIN_HOLDOUT, MIN_HOLDOUT_DAYS, MIN_TRAIN,
        MIN_TRAIN_DAYS, QUANTILES, _levels, _statistics,
    )
    from scripts.exit_policy_research import VerifiedBar, _valid_bars
except ModuleNotFoundError:
    from empirical_entry_exit_research import (
        COST_PCT, HORIZONS, MIN_HOLDOUT, MIN_HOLDOUT_DAYS, MIN_TRAIN,
        MIN_TRAIN_DAYS, QUANTILES, _levels, _statistics,
    )
    from exit_policy_research import VerifiedBar, _valid_bars


@dataclass(frozen=True)
class Touch:
    reason: str  # TAKE, TAKE_GAP, STOP, STOP_GAP, AMBIGUOUS_STOP_FIRST, NO_TOUCH
    sessions_until_touch: int | None
    exit_price: float | None
    net_return_pct: float | None
    stop_gap_overrun_pct_points: float


def first_touch(bars: list[VerifiedBar], take_profit_pct: float,
                stop_loss_pct: float, cost_pct: float = COST_PCT) -> Touch:
    """Accept signal bar plus observed future; absence of touch is censored.

    The caller classifies full-window vs recent-window censoring separately.
    Actual fills, spreads, halts and stop-trigger processing are unavailable.
    """
    if not (0 < take_profit_pct <= 40 and 0 < stop_loss_pct <= 30 and
            0 <= cost_pct <= 5 and len(bars) >= 1):
        raise ValueError('INVALID_FIRST_TOUCH_POLICY')
    _valid_bars(bars)
    entry = bars[0].close
    target = entry * (1 + take_profit_pct / 100)
    stop = entry * (1 - stop_loss_pct / 100)
    for held, bar in enumerate(bars[1:], 1):
        if bar.open <= stop:
            reason, exit_price = 'STOP_GAP', bar.open
        elif bar.open >= target:
            reason, exit_price = 'TAKE_GAP', target  # no better-than-limit fill assumption
        elif bar.low <= stop and bar.high >= target:
            reason, exit_price = 'AMBIGUOUS_STOP_FIRST', stop
        elif bar.low <= stop:
            reason, exit_price = 'STOP', stop
        elif bar.high >= target:
            reason, exit_price = 'TAKE', target
        else:
            continue
        overrun = max(0, 100 * (stop - exit_price) / entry) if reason == 'STOP_GAP' else 0
        return Touch(reason, held, exit_price, 100 * (exit_price / entry - 1) - cost_pct,
                     round(overrun, 3))
    return Touch('NO_TOUCH', None, None, None, 0)


def _feature_groups(bar: VerifiedBar) -> tuple[str, ...]:
    # Predeclared and known at the FINAL signal close (after-hours mode only).
    labels = ['all']
    if 100 * (bar.high - bar.low) / bar.close >= 10:
        labels.append('signal_day_range_at_least_10pct')
    if 100 * (bar.close / bar.open - 1) <= -5:
        labels.append('signal_day_close_down_at_least_5pct')
    if bar.high > bar.low and (bar.close - bar.low) / (bar.high - bar.low) <= 0.25:
        labels.append('signal_day_close_in_bottom_quartile')
    return tuple(labels)


def _describe(cases, take, stop, minimum_cases, minimum_days, *, features=False):
    """Never treat censored cases as a forced close, win, or loss."""
    signal_days = len({day for day, _, _, _ in cases})
    observed = []
    for day, code, segment, full_window in cases:
        outcome = first_touch(segment, take, stop)
        observed.append((day, code, segment, full_window, outcome))
    resolved = [x for x in observed if x[4].reason != 'NO_TOUCH']
    unresolved = [x for x in observed if x[4].reason == 'NO_TOUCH']
    reasons = Counter(x[4].reason for x in resolved)
    nets = [x[4].net_return_pct for x in resolved]
    gap_nets = [x[4].net_return_pct for x in resolved if x[4].reason == 'STOP_GAP']
    latest_mark = [100 * (seg[-1].close / seg[0].close - 1) - COST_PCT
                   for _, _, seg, _, _ in unresolved]
    result = {
        'n': len(cases), 'signal_days': signal_days,
        'status': ('DESCRIPTIVE_ONLY_NOT_VALIDATED' if len(cases) >= minimum_cases and
                   signal_days >= minimum_days else 'INSUFFICIENT_INDEPENDENT_SIGNAL_DAYS_OR_CASES'),
        'first_take_count': reasons['TAKE'] + reasons['TAKE_GAP'],
        'first_stop_count': reasons['STOP'] + reasons['STOP_GAP'] +
                            reasons['AMBIGUOUS_STOP_FIRST'],
        'stop_gap_count': reasons['STOP_GAP'],
        'take_gap_count': reasons['TAKE_GAP'],
        'same_bar_ambiguous_stop_first_count': reasons['AMBIGUOUS_STOP_FIRST'],
        'resolved_count': len(resolved),
        'resolved_net_loss_at_or_below_minus_10pct_count': sum(x <= -10 for x in nets),
        'resolved_net_loss_at_or_below_minus_20pct_count': sum(x <= -20 for x in nets),
        'stop_gap_overrun_at_least_2pct_points_count': sum(
            x[4].reason == 'STOP_GAP' and x[4].stop_gap_overrun_pct_points >= 2
            for x in resolved),
        'stop_gap_overrun_at_least_5pct_points_count': sum(
            x[4].reason == 'STOP_GAP' and x[4].stop_gap_overrun_pct_points >= 5
            for x in resolved),
        'unresolved_no_touch_full_window': sum(full for _, _, _, full, _ in unresolved),
        'pending_recent_no_touch': sum(not full for _, _, _, full, _ in unresolved),
        'resolved_net_only_selection_biased': _statistics(nets),
        'stop_gap_net_only': _statistics(gap_nets),
        'worst_stop_gap_overrun_pct_points': max(
            (x[4].stop_gap_overrun_pct_points for x in resolved), default=0),
        'median_sessions_until_first_touch': (round(median(x[4].sessions_until_touch
            for x in resolved), 2) if resolved else None),
        'unresolved_latest_close_mark_to_market_not_an_exit': _statistics(latest_mark),
    }
    if features:
        groups = defaultdict(list)
        for item in observed:
            for name in _feature_groups(item[2][0]):
                groups[name].append(item)
        feature_summaries = {}
        for key in ('all', 'signal_day_range_at_least_10pct',
                    'signal_day_close_down_at_least_5pct',
                    'signal_day_close_in_bottom_quartile'):
            group = groups[key]
            n_days = len({x[0] for x in group})
            stops = [x for x in group if x[4].reason in
                     ('STOP', 'STOP_GAP', 'AMBIGUOUS_STOP_FIRST')]
            feature_summaries[key] = {
                'n': len(group), 'signal_days': n_days,
                'status': ('EXPLORATORY_ASSOCIATION_ONLY' if len(group) >= MIN_TRAIN and
                           n_days >= MIN_TRAIN_DAYS else 'INSUFFICIENT_SUBGROUP'),
                'first_stop_count': len(stops),
                'stop_gap_count': sum(x[4].reason == 'STOP_GAP' for x in group),
                'no_touch_count': sum(x[4].reason == 'NO_TOUCH' for x in group),
                # Denominator includes NO_TOUCH, avoiding resolved-only success rates.
                'first_stop_fraction_of_all_observed_pct': (
                    round(100 * len(stops) / len(group), 1) if group else None),
            }
        result['signal_day_features_train_only'] = feature_summaries
    return result


def analyze_first_touch_risk(dates, events, per_code, patterns):
    """Predefined chronological 75/25 split with a FULL-window train embargo.

    Windows limit observation and data completeness ONLY. A no-touch path does
    not result in a time-stop transaction. Thresholds derive solely from full,
    historical training paths. Every grid combination is shown: no retrospective
    winner ranking from censored/repeated signals or sparse holdout samples.
    """
    split_index = max(1, min(len(dates) - 1, len(dates) * 3 // 4)) if len(dates) > 1 else 0
    windows = []
    for horizon in HORIZONS:
        grouped = defaultdict(lambda: {'train': [], 'holdout': [], 'embargoed': 0,
                                       'missing': 0, 'no_followup': 0})
        for i, day, code, names in events:
            relevant = [name for name in names if name in patterns]
            if not relevant:
                continue
            if i + 1 >= len(dates):
                for name in relevant:
                    grouped[name]['no_followup'] += 1
                continue
            full_window = i + horizon < len(dates)
            end = min(len(dates), i + horizon + 1)
            segment = [per_code[code].get(d) for d in dates[i:end]]
            if any(bar is None for bar in segment):
                for name in relevant:
                    grouped[name]['missing'] += 1
                continue
            case = (day, code, segment, full_window)
            for name in relevant:
                group = grouped[name]
                if split_index and i + horizon < split_index:
                    group['train'].append(case)
                elif split_index and i >= split_index:
                    group['holdout'].append(case)
                else:
                    group['embargoed'] += 1
        summaries = []
        for name in patterns:
            group = grouped[name]
            train, holdout = group['train'], group['holdout']
            train_days = len({c[0] for c in train})
            result = {
                'pattern': name,
                'training_cases': len(train), 'training_signal_days': train_days,
                'holdout_cases': len(holdout),
                'holdout_signal_days': len({c[0] for c in holdout}),
                'embargoed_overlap_cases': group['embargoed'],
                'excluded_missing_price_path': group['missing'],
                'pending_no_followup': group['no_followup'],
                'status': 'INSUFFICIENT_TRAIN', 'candidate_count': 0,
                'first_touch_grid': [], 'selected_rule': None,
                'recommendation_allowed': False,
            }
            if len(train) < MIN_TRAIN or train_days < MIN_TRAIN_DAYS:
                summaries.append(result)
                continue
            gains = [max(0, 100 * (max(b.high for b in segment[1:]) /
                                segment[0].close - 1)) for _, _, segment, _ in train]
            losses = [max(0, 100 * (1 - min(b.low for b in segment[1:]) /
                                          segment[0].close)) for _, _, segment, _ in train]
            takes = _levels(gains, 1, 40)
            stops = _levels(losses, 1, 30)
            for take in takes:
                for stop in stops:
                    # No policy ranking: resolved-only means are selected-outcome
                    # biased, no-touch cases have neither known P&L nor time exit.
                    result['first_touch_grid'].append({
                        'take_profit_pct': take, 'stop_loss_pct': stop,
                        'training': _describe(train, take, stop, MIN_TRAIN, MIN_TRAIN_DAYS,
                                              features=True),
                        'holdout': _describe(holdout, take, stop, MIN_HOLDOUT,
                                             MIN_HOLDOUT_DAYS),
                    })
            result['candidate_count'] = len(result['first_touch_grid'])
            result['status'] = 'TRAIN_ONLY_GRID_NOT_SELECTED'
            summaries.append(result)
        windows.append({'observation_sessions_not_forced_holding': horizon,
                        'patterns': summaries})
    return {
        'status': 'EXPLORATORY_UNVERIFIED_AFTER_HOURS_CLOSE_FILL',
        'entry_assumption': 'SIGNAL_DAY_FINAL_CLOSE_IF_AFTER_HOURS_ORDER_MATCHED',
        'closing_call_auction_1520_1530': 'BLOCKED_NO_PRE_CLOSE_SIGNAL_OR_AUCTION_FILLS',
        'actual_entry_or_exit_fills_verified': False,
        'future_gap_used_to_select_entry': False,
        'observation_window_is_not_a_time_exit': True,
        'no_touch_is_unresolved_not_a_win_or_loss': True,
        'stop_gap_fill': 'NEXT_OR_LATER_SESSION_OPEN_IF_BELOW_STOP',
        'resolved_returns_exclude_no_touch_and_are_selection_biased': True,
        'profit_gap_fill': 'LIMIT_TARGET_NOT_IMPROVED_OPEN',
        'same_bar_touch_rule': 'STOP_FIRST_CONSERVATIVE',
        'intraday_stop_slippage_liquidity_verified': False,
        'chronological_split': 'TRAIN_FIRST_75PCT_FULL_WINDOW_EMBARGO_HOLDOUT_LAST_25PCT',
        'holdout_start_day': dates[split_index] if split_index else None,
        'levels_derived_from': 'TRAIN_ONLY_FULL_PATH_MFE_MAE',
        'quantiles': list(QUANTILES), 'cost_pct_assumed_round_trip': COST_PCT,
        'repeated_stock_signals_independent': False,
        'multiple_testing_corrected': False,
        'independent_session_calendar_and_corporate_actions_verified': False,
        'candidate_stocks': [], 'recommendation_allowed': False,
        'windows': windows,
    }

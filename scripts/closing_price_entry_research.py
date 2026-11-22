#!/usr/bin/env python3
"""Two distinct closing-price entry hypotheses for the current search tags.

Closing auction (15:20-15:30) cannot be replayed from finalized daily bars:
its pre-close signal and auction fill are both absent. After-hours closing-price
entry (15:40-16:00) can use the final EOD signal, but the presence of a seller,
queue position and execution are unknown. Its close-price path is CONDITIONAL,
not an executable or verified strategy. No stock candidates are ever emitted.
"""
from __future__ import annotations

from collections import defaultdict
from statistics import mean, median

try:
    from scripts.empirical_entry_exit_research import (
        COST_PCT, HORIZONS, MIN_HOLDOUT, MIN_HOLDOUT_DAYS,
        MIN_TRAIN, MIN_TRAIN_DAYS, _percentile, _statistics,
    )
except ModuleNotFoundError:
    from empirical_entry_exit_research import (
        COST_PCT, HORIZONS, MIN_HOLDOUT, MIN_HOLDOUT_DAYS,
        MIN_TRAIN, MIN_TRAIN_DAYS, _percentile, _statistics,
    )


# Descriptive buckets declared independently of historical returns; the
# overnight gap is observed AFTER any conditional signal-day close purchase.
GAP_BUCKETS = ('down_2pct_or_more', 'down_under_2pct',
               'up_under_2pct', 'up_2pct_or_more')


def _gap_bucket(pct):
    if pct <= -2:
        return GAP_BUCKETS[0]
    if pct < 0:
        return GAP_BUCKETS[1]
    if pct < 2:
        return GAP_BUCKETS[2]
    return GAP_BUCKETS[3]


def _describe(cases, minimum_cases, minimum_days):
    dates = {c[0] for c in cases}
    result = {'n': len(cases), 'signal_days': len(dates),
              'status': 'INSUFFICIENT_INDEPENDENT_SIGNAL_DAYS_OR_CASES',
              'conditional_close_entry': None,
              'next_open_entry_same_cohort': None,
              'overnight_gap_buckets': None}
    if len(cases) < minimum_cases or len(dates) < minimum_days:
        return result
    close_returns = []
    open_returns = []
    gaps = []
    max_gains = []
    max_losses = []
    for _, _, segment in cases:
        signal_close = segment[0].close
        next_open = segment[1].open
        end_close = segment[-1].close
        close_returns.append(100 * (end_close / signal_close - 1) - COST_PCT)
        open_returns.append(100 * (end_close / next_open - 1) - COST_PCT)
        gaps.append(100 * (next_open / signal_close - 1))
        max_gains.append(100 * (max(bar.high for bar in segment[1:]) / signal_close - 1))
        max_losses.append(100 * (min(bar.low for bar in segment[1:]) / signal_close - 1))
    result['status'] = 'CONDITIONAL_PRICE_PATH_ONLY'
    result['conditional_close_entry'] = {
        'hold_to_horizon_net': _statistics(close_returns),
        'overnight_gap_median_pct': round(median(gaps), 3),
        'overnight_gap_p10_pct': round(_percentile(gaps, 0.1), 3),
        'overnight_gap_p90_pct': round(_percentile(gaps, 0.9), 3),
        'gap_down_at_least_2pct_count': sum(x <= -2 for x in gaps),
        'gap_up_at_least_2pct_count': sum(x >= 2 for x in gaps),
        'median_observed_max_gain_pct': round(median(max_gains), 3),
        'median_observed_max_loss_pct': round(median(max_losses), 3),
        'worst_observed_max_loss_pct': round(min(max_losses), 3),
        'mean_observed_max_gain_pct': round(mean(max_gains), 3),
        'mean_observed_max_loss_pct': round(mean(max_losses), 3),
    }
    result['next_open_entry_same_cohort'] = {
        'hold_to_horizon_net': _statistics(open_returns),
        'difference_in_mean_pct_points_conditional_close_minus_next_open': round(
            mean(close_returns) - mean(open_returns), 3),
    }
    buckets = defaultdict(list)
    for case, gap, net in zip(cases, gaps, close_returns):
        buckets[_gap_bucket(gap)].append((case[0], net))
    result['overnight_gap_buckets'] = {}
    for label in GAP_BUCKETS:
        observations = buckets[label]
        days = {day for day, _ in observations}
        enough = len(observations) >= MIN_HOLDOUT and len(days) >= MIN_HOLDOUT_DAYS
        result['overnight_gap_buckets'][label] = {
            'n': len(observations), 'signal_days': len(days),
            'status': 'DESCRIPTIVE_ONLY' if enough else 'INSUFFICIENT_SUBGROUP',
            'hold_to_horizon_net': _statistics([net for _, net in observations]) if enough else None,
        }
    return result


def analyze_closing_entries(dates, events, per_code, patterns):
    """Chronological, embargoed conditional price paths; never assume fills.

    No finalized daily candle is treated as a known pre-close signal. The
    holdout is diagnostic only, and its prices never tune a filter or threshold.
    """
    split_index = max(1, min(len(dates) - 1, len(dates) * 3 // 4)) if len(dates) > 1 else 0
    split_day = dates[split_index] if split_index else None
    windows = []
    for horizon in HORIZONS:
        groups = defaultdict(lambda: {'training': [], 'holdout': [],
                                     'embargoed': 0, 'pending': 0, 'missing': 0})
        for i, day, code, names in events:
            relevant = [name for name in names if name in patterns]
            if not relevant:
                continue
            if i + horizon >= len(dates):
                for name in relevant:
                    groups[name]['pending'] += 1
                continue
            segment = [per_code[code].get(d) for d in dates[i:i + horizon + 1]]
            if any(bar is None for bar in segment):
                for name in relevant:
                    groups[name]['missing'] += 1
                continue
            case = (day, code, segment)
            for name in relevant:
                group = groups[name]
                if split_index and i + horizon < split_index:
                    group['training'].append(case)
                elif split_index and i >= split_index:
                    group['holdout'].append(case)
                else:
                    group['embargoed'] += 1
        results = []
        for name in patterns:
            group = groups[name]
            results.append({
                'pattern': name, 'pending_recent': group['pending'],
                'excluded_missing_price_path': group['missing'],
                'embargoed_overlap_cases': group['embargoed'],
                'training': _describe(group['training'], MIN_TRAIN, MIN_TRAIN_DAYS),
                'holdout': _describe(group['holdout'], MIN_HOLDOUT, MIN_HOLDOUT_DAYS),
                'recommendation_allowed': False,
            })
        windows.append({'holding_sessions': horizon, 'patterns': results})
    return {
        'modes': {
            'closing_call_auction_1520_1530': {
                'status': 'BLOCKED_NO_PRE_CLOSE_SIGNAL_OR_AUCTION_FILLS',
                'signal_time': 'BEFORE_FINAL_EOD_CLOSE',
                'requires': ['timestamped_pre_close_1520_signal_snapshot',
                             'final_auction_signal_reconciliation',
                             'auction_order_and_fill_evidence'],
                'price_path_statistics': None, 'executability_verified': False,
            },
            'after_hours_close_1540_1600': {
                'status': 'CONDITIONAL_UNVERIFIED_CLOSE_PRICE_FILL',
                'signal_time': 'AFTER_FINAL_EOD_CLOSE',
                'entry_price_assumption': 'SIGNAL_DAY_CLOSE_ONLY_IF_MATCHED',
                'actual_order_fill_verified': False,
                'time_exit_fill_verified': False,
                'requires': ['actual_after_hours_sell_liquidity_and_fill_evidence'],
                'future_gap_known_at_entry': False,
                'holdout_start_day': split_day,
                'holdout_embargo': 'FULL_HOLDING_HORIZON_BEFORE_HOLDOUT_SIGNAL_DAY',
                'overnight_gap_buckets_predeclared_pct': [-2, 0, 2],
                'round_trip_cost_assumption_pct': COST_PCT,
                'windows': windows,
            },
        },
        'same_day_final_signal_is_not_known_at_1520': True,
        'no_orders_or_predictions': True,
        'independent_calendar_corporate_actions_and_liquidity_verified': False,
        'recommendation_allowed': False,
    }

#!/usr/bin/env python3
"""Train-only empirical exit levels for the *current* stock-search patterns.

Pure analysis, no database access, no recommendation. EOD signals are known only
after close; execution starts at the next session's open. Dates are an audited
but not independently certified exchange calendar, so all results are exploratory.
"""
from __future__ import annotations

from collections import defaultdict
from statistics import mean, median

try:
    from scripts.exit_policy_research import ExitPolicy, simulate_exit
except ModuleNotFoundError:
    from exit_policy_research import ExitPolicy, simulate_exit


HORIZONS = (5, 10, 20, 60)
QUANTILES = (0.25, 0.5, 0.75)  # declared before examining any returns
MIN_TRAIN = 30
MIN_TRAIN_DAYS = 5
MIN_HOLDOUT = 12
MIN_HOLDOUT_DAYS = 3
COST_PCT = 0.3


def _percentile(values, fraction):
    if not values:
        raise ValueError('EMPTY_EMPIRICAL_QUANTILE')
    ordered = sorted(values)
    pos = (len(ordered) - 1) * fraction
    low = int(pos)
    high = min(len(ordered) - 1, low + 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (pos - low)


def _levels(values, minimum, maximum):
    # Half-percent resolution prevents accidental false precision or huge grids.
    return sorted(set(max(minimum, min(maximum, round(
        _percentile(values, q) * 2) / 2)) for q in QUANTILES))


def _statistics(values):
    if not values:
        return {'n': 0}
    return {'n': len(values), 'mean_net_return_pct': round(mean(values), 3),
            'median_net_return_pct': round(median(values), 3),
            'positive_case_pct': round(100 * sum(x > 0 for x in values) / len(values), 1),
            'p10_net_return_pct': round(_percentile(values, 0.1), 3),
            'worst_net_return_pct': round(min(values), 3)}


def _evaluate(cases, policy):
    outcomes = [simulate_exit(segment, 0, policy) for _, _, segment in cases]
    if any(x is None for x in outcomes):
        raise ValueError('EMPIRICAL_INCOMPLETE_CASE')
    return outcomes


def analyze_empirical_entries(dates, events, per_code, patterns):
    """Use the same audited events/bars as the parent pattern study.

    Training is globally chronological. Every training *full horizon* must end
    strictly before the holdout's first signal day (embargo). No holdout candle
    participates in level discovery, ranking or tie breaking.
    """
    split_index = max(1, min(len(dates) - 1, len(dates) * 3 // 4)) if len(dates) > 1 else 0
    split_day = dates[split_index] if split_index else None
    windows = []
    for horizon in HORIZONS:
        grouped = defaultdict(lambda: {'train': [], 'holdout': [], 'purged': 0,
                                       'pending': 0, 'missing': 0})
        for i, day, code, names in events:
            relevant = [name for name in names if name in patterns]
            if not relevant:
                continue
            if i + horizon >= len(dates):
                for name in relevant:
                    grouped[name]['pending'] += 1
                continue
            segment = [per_code[code].get(d) for d in dates[i:i + horizon + 1]]
            if any(bar is None for bar in segment):
                for name in relevant:
                    grouped[name]['missing'] += 1
                continue
            case = (day, code, segment)
            for name in relevant:
                target = grouped[name]
                if split_index and i + horizon < split_index:
                    target['train'].append(case)
                elif split_index and i >= split_index:
                    target['holdout'].append(case)
                else:
                    target['purged'] += 1

        summaries = []
        for name in patterns:
            group = grouped[name]
            train, holdout = group['train'], group['holdout']
            train_days = {c[0] for c in train}
            holdout_days = {c[0] for c in holdout}
            result = {'pattern': name, 'status': 'INSUFFICIENT_TRAIN',
                      'training_cases': len(train), 'training_signal_days': len(train_days),
                      'holdout_cases': len(holdout), 'holdout_signal_days': len(holdout_days),
                      'embargoed_overlap_cases': group['purged'],
                      'pending_recent': group['pending'],
                      'excluded_missing_price_path': group['missing'],
                      'candidate_count': 0, 'training_selected_rule': None,
                      'holdout_comparison': None, 'recommendation_allowed': False}
            if len(train) < MIN_TRAIN or len(train_days) < MIN_TRAIN_DAYS:
                summaries.append(result)
                continue
            gains = [100 * (max(b.high for b in c[2][1:]) / c[2][1].open - 1)
                     for c in train]
            losses = [max(0, 100 * (1 - min(b.low for b in c[2][1:]) /
                                          c[2][1].open)) for c in train]
            takes = _levels(gains, 1, 40)
            stops = _levels(losses, 1, 30)
            candidates = []
            for take in takes:
                for stop in stops:
                    policy = ExitPolicy(take, stop, horizon, COST_PCT)
                    outcomes = _evaluate(train, policy)
                    net = [o.net_return_pct for o in outcomes]
                    stats = _statistics(net)
                    # Predeclared robust ranking: reward median, penalise the
                    # bottom decile; candidate grid is capped at nine.
                    score = stats['median_net_return_pct'] + \
                        0.25 * min(0, stats['p10_net_return_pct'])
                    candidates.append((score, take, stop, policy, stats, outcomes))
            best = sorted(candidates, key=lambda x: (-x[0], x[1], x[2]))[0]
            _, take, stop, policy, training_stats, train_outcomes = best
            gaps = [100 * (c[2][1].open / c[2][0].close - 1) for c in train]
            training_median_gap = median(gaps)
            result['candidate_count'] = len(candidates)
            result['status'] = 'TRAIN_ONLY_UNVALIDATED'
            result['training_selected_rule'] = {
                'take_profit_pct': take, 'stop_loss_pct': stop,
                'max_holding_sessions': horizon, 'cost_pct': COST_PCT,
                'source': 'TRAIN_ONLY_MFE_MAE_QUANTILES',
                'entry': 'NEXT_SESSION_OPEN',
                'training_entry_gap_median_pct': round(training_median_gap, 3),
                'training_entry_gap_p10_pct': round(_percentile(gaps, 0.1), 3),
                'training_entry_gap_p90_pct': round(_percentile(gaps, 0.9), 3),
                'training_last_exit_day': max(c[2][-1].day for c in train),
                'training_performance': training_stats,
                'training_same_bar_ambiguous_cases': sum(o.ambiguous_same_bar for o in train_outcomes),
            }
            if len(holdout) >= MIN_HOLDOUT and len(holdout_days) >= MIN_HOLDOUT_DAYS:
                outcomes = _evaluate(holdout, policy)
                candidate = _statistics([o.net_return_pct for o in outcomes])
                baseline = _statistics([100 * (c[2][-1].close / c[2][1].open - 1) - COST_PCT
                                        for c in holdout])
                result['status'] = 'EXPLORATORY_HOLDOUT'
                # The entry gap is observable at the first executable open.
                # The threshold is learned from training ONLY. Conditional
                # groups are diagnostics, never separately optimised policies.
                gap_groups = {'at_or_below_train_median': [], 'above_train_median': []}
                for case, outcome in zip(holdout, outcomes):
                    observed_gap = 100 * (case[2][1].open / case[2][0].close - 1)
                    bucket = ('at_or_below_train_median' if observed_gap <= training_median_gap
                              else 'above_train_median')
                    gap_groups[bucket].append(outcome.net_return_pct)
                result['holdout_comparison'] = {
                    'candidate': candidate, 'hold_to_horizon_baseline': baseline,
                    'median_candidate_minus_baseline_pct_points': round(
                        candidate['median_net_return_pct'] - baseline['median_net_return_pct'], 3),
                    'same_bar_ambiguous_cases': sum(o.ambiguous_same_bar for o in outcomes),
                    'entry_gap_subgroups': {key: _statistics(values)
                                            if len(values) >= 5 else {'n': len(values),
                                                'status': 'INSUFFICIENT_SUBGROUP'}
                                            for key, values in gap_groups.items()},
                }
            summaries.append(result)
        windows.append({'holding_sessions': horizon, 'patterns': summaries})
    return {'method': 'CHRONOLOGICAL_TRAIN_75PCT_WITH_HORIZON_EMBARGO',
            'holdout_start_day': split_day, 'levels_derived_from': 'TRAIN_ONLY_FULL_HORIZON_MFE_MAE',
            'quantiles': list(QUANTILES),
            'minimum_training_cases': MIN_TRAIN, 'minimum_training_signal_days': MIN_TRAIN_DAYS,
            'minimum_holdout_cases': MIN_HOLDOUT, 'minimum_holdout_signal_days': MIN_HOLDOUT_DAYS,
            'entry_comparison': '신호일 종가=비체결 참조값, 실제 가정은 다음 거래일 시가; 종가-시가 갭만 관측',
            'same_bar_convention': 'TAKE_AND_STOP_SAME_BAR_IS_STOP_FIRST',
            'statistical_significance_tested': False,
            'overlapping_stock_events_decorrelated': False,
            'multiple_testing_corrected': False,
            'trading_calendar_and_corporate_actions_independently_verified': False,
            'recommendation_allowed': False, 'windows': windows}

#!/usr/bin/env python3
"""Link blue-dot A/B model events to BLUE's existing R15110 supply proxy.

Only signal-day CLOSE/HLC3 LOWER 20/30/40 A/B model cohorts are included in
this first interaction study. This deliberately does not use future bars to
construct a supply zone or treat daily H-L volume allocation as real orders.
"""
from __future__ import annotations

from collections import defaultdict
import math

import pandas as pd

try:
    from scripts.env20_rebound_comparison import (
        START, END, _summarize, market_breadth, observe_touch,
    )
    from scripts.supply_profile_r15110 import METHOD, estimate_supply_profile
except ModuleNotFoundError:
    from env20_rebound_comparison import (START, END, _summarize,
                                          market_breadth, observe_touch)
    from supply_profile_r15110 import METHOD, estimate_supply_profile


WINDOW = 120
PERIODS = (20, 30, 40)
DIRECTIONS = ('A', 'B')
BUCKETS = ('INSIDE', 'NEAR_0_3', 'MID_3_8', 'FAR_OVER_8',
           'NO_UPPER', 'UNKNOWN')
STRENGTHS = ('STRONG', 'OTHER', 'NONE', 'UNKNOWN')
POLICIES = ((2.5, 4.5), (5.0, 3.0))
HORIZONS = (5, 20)
PRIMARY = (5, 2.5, 4.5)
MARKET_STATES = ('UP', 'DOWN', 'MIXED', 'UNKNOWN')
MARKET_LAGS = (1, 5)
TAKE_REASONS = ('TAKE', 'TAKE_GAP')
STOP_REASONS = ('STOP', 'STOP_GAP')


def equal_stake_resolved_ledger(cases: list[dict]) -> dict:
    """Sum modeled net percentages for one *equal-size unit stake per event*.

    No-touch/pending/review cases have NO realized return here; sums are not
    portfolio returns, since many flags overlap and fills are unverified.
    """
    if any((c['reason'] in TAKE_REASONS + STOP_REASONS) !=
           (c['net'] is not None) for c in cases):
        raise ValueError('SUPPLY_CASH_LEDGER_OUTCOME_MISMATCH')
    if any(c['net'] is not None and (
            not math.isfinite(float(c['net'])) or
            (c['reason'] in TAKE_REASONS and float(c['net']) <= 0) or
            (c['reason'] in STOP_REASONS and float(c['net']) >= 0))
           for c in cases):
        raise ValueError('SUPPLY_CASH_LEDGER_NET_INVALID')
    take_nets = [float(c['net']) for c in cases
                 if c['reason'] in TAKE_REASONS and c['net'] is not None]
    stop_nets = [float(c['net']) for c in cases
                 if c['reason'] in STOP_REASONS and c['net'] is not None]
    resolved = take_nets + stop_nets
    return {
        'event_count': len(cases),
        'first_take_resolved_count': len(take_nets),
        'first_stop_resolved_count': len(stop_nets),
        'unresolved_or_review_count': len(cases)-len(resolved),
        'modeled_takes_net_pct_points_equal_stakes': round(sum(take_nets), 3),
        'modeled_stops_net_pct_points_equal_stakes': round(sum(stop_nets), 3),
        'modeled_total_resolved_net_pct_points_equal_stakes':
            round(sum(resolved), 3),
        'modeled_mean_net_pct_resolved_only_selection_biased':
            round(sum(resolved)/len(resolved), 3) if resolved else None,
        'modeled_worst_resolved_net_pct': min(resolved) if resolved else None,
        'resolved_minus_10pct_or_worse_count': sum(x <= -10 for x in resolved),
        'resolved_minus_20pct_or_worse_count': sum(x <= -20 for x in resolved),
    }


def hypothetical_near_filter(cases: list[dict]) -> dict:
    """Post-hoc accounting only; filtering was NOT validated prospectively."""
    excluded = [c for c in cases if c['bucket'] in ('INSIDE', 'NEAR_0_3')]
    retained = [c for c in cases if c['bucket'] not in ('INSIDE', 'NEAR_0_3')]
    losses = equal_stake_resolved_ledger(excluded)
    kept = equal_stake_resolved_ledger(retained)
    return {
        'excluded_event_count': len(excluded),
        'first_takes_missed': losses['first_take_resolved_count'],
        'first_stops_excluded': losses['first_stop_resolved_count'],
        'stop_gaps_excluded': sum(c['reason'] == 'STOP_GAP' for c in excluded),
        'resolved_minus_10pct_or_worse_excluded':
            losses['resolved_minus_10pct_or_worse_count'],
        'missed_first_take_net_pct_points_equal_stakes':
            losses['modeled_takes_net_pct_points_equal_stakes'],
        'avoided_first_stop_net_loss_abs_pct_points_equal_stakes':
            -losses['modeled_stops_net_pct_points_equal_stakes'],
        'excluded_resolved_total_net_pct_points_equal_stakes':
            losses['modeled_total_resolved_net_pct_points_equal_stakes'],
        'retained_event_count': kept['event_count'],
        'retained_resolved_total_net_pct_points_equal_stakes':
            kept['modeled_total_resolved_net_pct_points_equal_stakes'],
        'unresolved_excluded_not_assigned_a_return':
            losses['unresolved_or_review_count'],
    }


def by_market_supply_interaction(cases: list[dict], lag: int) -> dict:
    """As-of 1/5-day breadth crossed with distance AND density; no tuning."""
    result = {}
    for state in MARKET_STATES:
        subset = [c for c in cases if c[f'market{lag}'] == state]
        cells = []
        for bucket in BUCKETS:
            for strength in STRENGTHS:
                cell = [c for c in subset if c['bucket'] == bucket
                        and c['strength'] == strength]
                if cell:
                    cells.append({'bucket': bucket, 'strength': strength,
                                  'outcomes': _summarize(cell),
                                  'resolved_unit_stakes':
                                      equal_stake_resolved_ledger(cell)})
        result[state] = {
            'total': _summarize(subset),
            'resolved_unit_stakes': equal_stake_resolved_ledger(subset),
            'by_supply_distance_and_density_nonempty': cells,
            'hypothetical_exclude_near_overhead': hypothetical_near_filter(subset),
        }
    return result


def asof_supply_context(history: pd.DataFrame, i: int) -> dict:
    """Use today's close for the price bin, but volume ONLY from prior bars.

    Require all 120 issuer sessions to be consecutive in the independently
    constructed full market-session index. Never forward-fill a suspension.
    """
    if i < WINDOW or not bool(history.session_index.iloc[
            i-WINDOW:i+1].diff().iloc[1:].eq(1).all()):
        return {'bucket': 'UNKNOWN', 'strength': 'UNKNOWN',
                'profile_status': 'NONCONTIGUOUS_OR_INSUFFICIENT_HISTORY',
                'distance_to_zone_low_pct': None,
                'strength_relative_pct': None,
                'zone_low_krw': None, 'zone_high_krw': None}
    profile = estimate_supply_profile(history.iloc[i-WINDOW:i+1])
    status = profile['supply_profile_status']
    base = {'profile_status': status, 'bucket': 'UNKNOWN',
            'strength': 'UNKNOWN', 'distance_to_zone_low_pct': None,
            'strength_relative_pct': None, 'zone_low_krw': None,
            'zone_high_krw': None}
    if status == 'NO_UPPER_CONCENTRATION':
        return {**base, 'bucket': 'NO_UPPER', 'strength': 'NONE'}
    if status != 'READY':
        return base
    close = float(history.iloc[i].close)
    try:
        low = float(profile['supply_zone_low'])
        high = float(profile['supply_zone_high'])
        intensity = float(profile['supply_strength_relative_pct'])
    except (ValueError, TypeError):
        return base
    if not all(math.isfinite(v) for v in (close, low, high, intensity)) or (
            close <= 0 or low <= 0 or high <= low or not 0 <= intensity <= 100):
        return base
    distance = 100*(low/close-1)
    bucket = ('INSIDE' if distance <= 0 else
              'NEAR_0_3' if distance <= 3 else
              'MID_3_8' if distance <= 8 else 'FAR_OVER_8')
    return {**base, 'bucket': bucket,
            'strength': 'STRONG' if intensity >= 75 else 'OTHER',
            'distance_to_zone_low_pct': round(distance, 3),
            'strength_relative_pct': round(intensity, 2),
            'zone_low_krw': low, 'zone_high_krw': high}


def analyze_supply_interaction(d: pd.DataFrame, sessions: list[pd.Timestamp],
                               *, start=START, end=END) -> dict:
    """Stratify the SAME causal signal events by as-of overhead concentration.

    No optimization, no post-entry gap as entry filter, and no time exit.
    Every eligible direction event belongs to exactly one supply bucket.
    """
    selected = [f'DIR_{n}_H_L_{direction}'
                for n in PERIODS for direction in DIRECTIONS]
    if any(col not in d.columns for col in selected):
        raise ValueError('SUPPLY_DIRECTION_FLAGS_MISSING')
    studied = [day for day in sessions
               if start <= day.strftime('%Y-%m-%d') <= end]
    if len(studied) < 40:
        raise ValueError('SUPPLY_STUDY_SESSIONS_INSUFFICIENT')
    split_idx = sessions.index(studied[len(studied)*3//4])
    last_idx = len(sessions)-1
    # The exact same prior-1/5-session same-stock equal-weight proxy reused
    # in the baseline direction study. Today's final close is known only EOD.
    market = market_breadth(d)
    # Keys are model flag / horizon / TP / SL / split / zone / intensity.
    groups = defaultdict(list)
    audit = {'signal_events': 0, 'excluded_embargoed': 0,
             'excluded_no_followup': 0, 'excluded_missing_issuer_session': 0,
             'profile_buckets': {bucket: 0 for bucket in BUCKETS}}
    for _, h in d.groupby('code', sort=False):
        h = h.reset_index(drop=True)
        event_rows = h.loc[h[selected].any(axis=1) &
                           h.date.between(start, end)]
        if event_rows.empty:
            continue
        for i in event_rows.index:
            row = h.iloc[i]
            active = [flag for flag in selected if bool(row[flag])]
            if not active:
                continue
            context = asof_supply_context(h, int(i))
            bucket, strength = context['bucket'], context['strength']
            audit['signal_events'] += len(active)
            audit['profile_buckets'][bucket] += len(active)
            signal_index = int(row.session_index)
            for horizon in HORIZONS:
                if signal_index + horizon < split_idx:
                    split = 'train'
                elif signal_index >= split_idx:
                    split = 'holdout'
                else:
                    audit['excluded_embargoed'] += len(active)*len(POLICIES)
                    continue
                available = min(horizon, last_idx-signal_index)
                if available <= 0:
                    audit['excluded_no_followup'] += len(active)*len(POLICIES)
                    continue
                if i+available >= len(h) or any(
                    int(h.iloc[i+j].session_index) != signal_index+j
                    for j in range(1, available+1)):
                    audit['excluded_missing_issuer_session'] += (
                        len(active)*len(POLICIES))
                    continue
                future = [(float(r.open), float(r.high), float(r.low),
                           float(r.close), float(r.prior_close))
                          for r in h.iloc[i+1:i+available+1].itertuples()]
                for take, stop in POLICIES:
                    reason, net, held = observe_touch(
                        float(row.close), future, take, stop)
                    case = {'day': row.date.strftime('%Y-%m-%d'),
                            'reason': reason, 'net': net,
                            'bucket': bucket, 'strength': strength,
                            'market1': market.get((row.date, 1), 'UNKNOWN'),
                            'market5': market.get((row.date, 5), 'UNKNOWN'),
                            'full': signal_index+horizon <= last_idx}
                    for flag in active:
                        groups[(flag, horizon, take, stop, split,
                                bucket, strength)].append(case)
    results = []
    for n in PERIODS:
        for direction in DIRECTIONS:
            flag = f'DIR_{n}_H_L_{direction}'
            for horizon in HORIZONS:
                for take, stop in POLICIES:
                    cohorts = {}
                    for split in ('train', 'holdout'):
                        by_bucket, by_strength = {}, {}
                        overall = []
                        for bucket in BUCKETS:
                            subset = [case for strength in STRENGTHS
                                      for case in groups[(flag, horizon, take, stop,
                                                          split, bucket, strength)]]
                            by_bucket[bucket] = _summarize(subset)
                            overall.extend(subset)
                        for intensity in STRENGTHS:
                            subset = [case for bucket in BUCKETS
                                      for case in groups[(flag, horizon, take, stop,
                                                          split, bucket, intensity)]]
                            by_strength[intensity] = _summarize(subset)
                        # A predeclared thought experiment: excluding ANY near
                        # meaningful overhead bin also misses its future takes.
                        excluded_near = sum((groups[(flag, horizon, take, stop,
                            split, bucket, intensity)]
                            for bucket in ('INSIDE', 'NEAR_0_3')
                            for intensity in STRENGTHS), [])
                        near_filter = hypothetical_near_filter(overall)
                        if near_filter['excluded_event_count'] != len(excluded_near):
                            raise ValueError('SUPPLY_NEAR_FILTER_EVENT_MISMATCH')
                        cohorts[split] = {
                            'total': _summarize(overall),
                            'by_distance_to_lower_edge': by_bucket,
                            'by_relative_density': by_strength,
                            'resolved_equal_stake_unit_ledger':
                                equal_stake_resolved_ledger(overall),
                            'hypothetical_exclude_near_overhead': near_filter,
                            'by_supply_and_market_breadth_1d':
                                by_market_supply_interaction(overall, 1),
                            'by_supply_and_market_breadth_5d':
                                by_market_supply_interaction(overall, 5),
                        }
                    results.append({'flag': flag, 'period': n,
                        'direction': 'A_FALLING' if direction == 'A' else 'B_NONFALLING',
                        'price_basis': 'hlc3', 'band': 'lower',
                        'observation_sessions_not_forced_holding': horizon,
                        'take_profit_pct': take, 'stop_loss_pct': stop,
                        'train': cohorts['train'], 'holdout': cohorts['holdout']})
    return {
        'schema': 'BLUE_DOT_A_B_SUPPLY_MARKET_INTERACTION_EXPLORATORY_V2',
        'supply_method_reused': METHOD,
        'supply_is_daily_hl_uniform_volume_proxy_not_actual_order_book': True,
        'uses_prior_120_bars_volume_and_signal_day_close_for_bins': True,
        'chart_parity_and_fill_verified': False,
        'all_price_basis_band_models_not_yet_in_supply_interaction': True,
        'selected_model_family': 'HLC3_LOWER_ONLY_20_30_40_A_B',
        'bucket_definitions': {
            'INSIDE': 'nearest overhead zone lower edge at or below close',
            'NEAR_0_3': 'zone lower edge >0% and <=3% above signal close',
            'MID_3_8': 'zone lower edge >3% and <=8% above close',
            'FAR_OVER_8': 'zone lower edge >8% above close',
            'NO_UPPER': 'valid profile but no overhead concentration >=25% of POC',
            'UNKNOWN': 'history incomplete or profile calculation unavailable',
            'STRONG': 'near zone density >=75% of estimated POC bin',
            'OTHER': 'relative concentration under 75%',
        },
        'train_end_before_holdout_start':
            sessions[split_idx-1].strftime('%Y-%m-%d'),
        'holdout_start': sessions[split_idx].strftime('%Y-%m-%d'),
        'audit': audit,
        'results': results,
        'signal_or_trade_recommendation_allowed': False,
        'overlapping_signals_not_independent': True,
        'reused_2026_holdout_not_clean_out_of_sample': True,
        'market_regime': 'EQUAL_WEIGHT_1D_AND_5D_ADVANCERS_MINUS_DECLINERS_10PP',
        'market_regime_not_official_kospi_or_kosdaq_index': True,
        'market_1d_5d_uses_signal_day_eod_not_available_preclose_auction': True,
        'market_regime_states': list(MARKET_STATES),
        'cash_ledger_is_one_equal_stake_per_overlapping_model_event_not_portfolio': True,
        'cash_ledger_excludes_no_touch_pending_and_unresolved': True,
        'cash_ledger_uses_assumed_costs_and_unverified_fills': True,
        'filter_outcomes_are_hindsight_not_prospective_rule': True,
    }

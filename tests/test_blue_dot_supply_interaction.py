import unittest
from unittest import mock

import pandas as pd

from scripts.blue_dot_direction_risk import build_direction_signals
from scripts.blue_dot_supply_interaction import (
    BUCKETS, MARKET_STATES, analyze_supply_interaction, asof_supply_context,
    by_market_supply_interaction, equal_stake_resolved_ledger,
    hypothetical_near_filter,
)
from scripts.env20_rebound_comparison import market_breadth
from tests.test_blue_dot_direction_risk import fixture


def supply_history(*, close=99):
    days = pd.bdate_range(end='2026-10-23', periods=150)
    rows = []
    for i, date in enumerate(days):
        op, high, low, cl = 105, 110, 100, 105
        if i == 145:
            op, high, low, cl = close, close+1, close-1, close
        rows.append({'date': date, 'code': '000001', 'open': op,
                     'high': high, 'low': low, 'close': cl,
                     'volume': 10000, 'session_index': i})
    return pd.DataFrame(rows)


class BlueDotSupplyInteractionTest(unittest.TestCase):
    def test_reuses_r15110_120_prior_bars_without_future_or_today_volume(self):
        h = supply_history()
        i = 145
        first = asof_supply_context(h, i)
        self.assertEqual(first['profile_status'], 'READY')
        self.assertIn(first['bucket'], {'INSIDE', 'NEAR_0_3'})
        h.loc[i, 'volume'] = 99999999999
        h.loc[i+1, ['high', 'low', 'close', 'volume']] = \
            [10000, 100, 9000, 100000000]
        self.assertEqual(first, asof_supply_context(h, i))

    def test_no_overhead_is_distinct_from_insufficient_history(self):
        h = supply_history(close=2000)
        self.assertEqual(asof_supply_context(h, 145)['bucket'], 'NO_UPPER')
        self.assertEqual(asof_supply_context(h, 90)['bucket'], 'UNKNOWN')
        h.loc[140, 'session_index'] = 141
        self.assertEqual(asof_supply_context(h, 145)['bucket'], 'UNKNOWN')

    def test_model_events_stay_a_b_disjoint_and_bucket_counts_conserve(self):
        d, sessions, _, _ = build_direction_signals(fixture(), min_history=70)
        result = analyze_supply_interaction(d, sessions)
        self.assertEqual(result['audit']['signal_events'], 3)
        self.assertEqual(sum(result['audit']['profile_buckets'].values()), 3)
        self.assertEqual(set(result['audit']['profile_buckets']), set(BUCKETS))
        self.assertEqual(len(result['results']), 24)
        for n in (20, 30, 40):
            a = next(x for x in result['results'] if x['period'] == n and
                     x['flag'].endswith('_A') and
                     x['observation_sessions_not_forced_holding'] == 5 and
                     x['take_profit_pct'] == 2.5)
            b = next(x for x in result['results'] if x['period'] == n and
                     x['flag'].endswith('_B') and
                     x['observation_sessions_not_forced_holding'] == 5 and
                     x['take_profit_pct'] == 2.5)
            self.assertEqual(a['holdout']['total']['n'], 0)
            self.assertEqual(b['holdout']['total']['n'], 1)
            self.assertEqual(b['holdout']['total']['stop_gap_count'], 1)
        self.assertFalse(result['signal_or_trade_recommendation_allowed'])

    def test_near_supply_filter_counts_missed_takes_and_avoided_stops(self):
        d, sessions, _, _ = build_direction_signals(fixture(), min_history=70)
        near = {'profile_status': 'READY', 'bucket': 'NEAR_0_3',
                'strength': 'STRONG', 'distance_to_zone_low_pct': 1.2,
                'strength_relative_pct': 90.0, 'zone_low_krw': 1619,
                'zone_high_krw': 1634}
        with mock.patch('scripts.blue_dot_supply_interaction.asof_supply_context',
                        return_value=near):
            report = analyze_supply_interaction(d, sessions)
        case = next(x for x in report['results'] if x['flag'] == 'DIR_30_H_L_B'
                    and x['observation_sessions_not_forced_holding'] == 5 and
                    x['take_profit_pct'] == 2.5)
        excluded = case['holdout']['hypothetical_exclude_near_overhead']
        self.assertEqual(excluded['excluded_event_count'], 1)
        self.assertEqual(excluded['first_takes_missed'], 0)
        self.assertEqual(excluded['first_stops_excluded'], 1)
        self.assertEqual(excluded['stop_gaps_excluded'], 1)

    def test_equal_stake_ledger_separates_money_from_win_loss_counts(self):
        cases = [
            {'reason': 'TAKE', 'net': 2.2, 'bucket': 'INSIDE'},
            {'reason': 'TAKE_GAP', 'net': 2.2, 'bucket': 'NEAR_0_3'},
            {'reason': 'STOP', 'net': -4.8, 'bucket': 'INSIDE'},
            {'reason': 'STOP_GAP', 'net': -14.3, 'bucket': 'NEAR_0_3'},
            {'reason': 'NO_TOUCH', 'net': None, 'bucket': 'INSIDE'},
            {'reason': 'TAKE', 'net': 2.2, 'bucket': 'FAR_OVER_8'},
        ]
        ledger = equal_stake_resolved_ledger(cases)
        self.assertEqual(ledger['first_take_resolved_count'], 3)
        self.assertEqual(ledger['first_stop_resolved_count'], 2)
        self.assertEqual(ledger['unresolved_or_review_count'], 1)
        self.assertAlmostEqual(ledger['modeled_total_resolved_net_pct_points_equal_stakes'], -12.5)
        near = hypothetical_near_filter(cases)
        self.assertEqual(near['first_takes_missed'], 2)
        self.assertEqual(near['first_stops_excluded'], 2)
        self.assertEqual(near['missed_first_take_net_pct_points_equal_stakes'], 4.4)
        self.assertEqual(near['avoided_first_stop_net_loss_abs_pct_points_equal_stakes'], 19.1)
        self.assertEqual(near['excluded_resolved_total_net_pct_points_equal_stakes'], -14.7)
        self.assertEqual(near['retained_resolved_total_net_pct_points_equal_stakes'], 2.2)
        self.assertEqual(near['unresolved_excluded_not_assigned_a_return'], 1)

    def test_market_distance_density_three_way_partition_preserves_events(self):
        cases = [
            {'day': '2026-10-21', 'reason': 'TAKE', 'net': 2.2,
             'bucket': 'INSIDE', 'strength': 'STRONG', 'market1': 'UP', 'market5': 'DOWN',
             'full': True},
            {'day': '2026-10-22', 'reason': 'STOP_GAP', 'net': -12.3,
             'bucket': 'NEAR_0_3', 'strength': 'OTHER', 'market1': 'UP', 'market5': 'DOWN',
             'full': True},
            {'day': '2026-10-23', 'reason': 'NO_TOUCH', 'net': None,
             'bucket': 'UNKNOWN', 'strength': 'UNKNOWN', 'market1': 'UNKNOWN',
             'market5': 'UNKNOWN', 'full': False},
            {'day': '2026-10-23', 'reason': 'STOP', 'net': -4.8,
             'bucket': 'MID_3_8', 'strength': 'STRONG', 'market1': 'DOWN', 'market5': 'UP',
             'full': True},
        ]
        for lag in (1, 5):
            grouped = by_market_supply_interaction(cases, lag)
            self.assertEqual(set(grouped), set(MARKET_STATES))
            self.assertEqual(sum(v['total']['n'] for v in grouped.values()), len(cases))
            for group in grouped.values():
                cells = group['by_supply_distance_and_density_nonempty']
                self.assertEqual(sum(c['outcomes']['n'] for c in cells),
                                 group['total']['n'])
                self.assertAlmostEqual(sum(c['resolved_unit_stakes'][
                    'modeled_total_resolved_net_pct_points_equal_stakes']
                    for c in cells), group['resolved_unit_stakes'][
                    'modeled_total_resolved_net_pct_points_equal_stakes'])
                excluded = group['hypothetical_exclude_near_overhead']
                self.assertEqual(excluded['excluded_event_count'] +
                                 excluded['retained_event_count'], group['total']['n'])

    def test_future_bars_do_not_change_prior_day_market_breadth(self):
        dates = pd.bdate_range('2026-10-07', periods=10)
        rows = []
        for i, day in enumerate(dates):
            for code in range(40):
                rows.append({'date': day, 'code': str(code).zfill(6),
                             'close': 100+i})
        history = pd.DataFrame(rows)
        initial = market_breadth(history)
        self.assertEqual(initial[(dates[6], 1)], 'UP')
        self.assertEqual(initial[(dates[6], 5)], 'UP')
        history.loc[history.date.ge(dates[7]), 'close'] = 1
        changed = market_breadth(history)
        for lag in (1, 5):
            self.assertEqual(initial[(dates[6], lag)], changed[(dates[6], lag)])

    def test_ledger_rejects_impossible_or_unresolved_fake_profits(self):
        for event in ({'reason': 'NO_TOUCH', 'net': 7},
                      {'reason': 'STOP', 'net': 2.2},
                      {'reason': 'TAKE', 'net': None}):
            with self.subTest(event=event), self.assertRaises(ValueError):
                equal_stake_resolved_ledger([event])


if __name__ == '__main__':
    unittest.main()

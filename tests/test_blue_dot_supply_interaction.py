import unittest
from unittest import mock

import pandas as pd

from scripts.blue_dot_direction_risk import build_direction_signals
from scripts.blue_dot_supply_interaction import (
    BUCKETS, analyze_supply_interaction, asof_supply_context,
)
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


if __name__ == '__main__':
    unittest.main()

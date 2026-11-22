import contextlib
import copy
import io
import json
import sys
import unittest
from unittest import mock

import pandas as pd

from scripts.blue_dot_triple_period_parity import (
    OBSERVATIONS, audit_triple_periods, main,
)


def synthetic_market():
    days = pd.bdate_range(end='2026-10-23', periods=200)
    rows = []
    for day in days:
        op, high, low, close = 1400, 1600, 1400, 1500
        if day == pd.Timestamp('2026-10-22'):
            op, high, low, close = 1400, 1650, 1400, 1600
        rows.append({'Date': day, 'Code': '013810', 'Name': '스페코',
                     'Market': 'KOSDAQ', 'Open': op, 'High': high,
                     'Low': low, 'Close': close, 'Volume': 10000,
                     'Amount': 15000000})
    return pd.DataFrame(rows)


class BlueDotTriplePeriodParityTest(unittest.TestCase):
    def setUp(self):
        self.obs = json.loads(OBSERVATIONS.read_text(encoding='utf-8'))

    def test_all_three_periods_both_bases_and_bands_are_explicit(self):
        result = audit_triple_periods(synthetic_market(), self.obs)
        specs = {(x['period'], x['price_basis'], x['band'])
                 for x in result['scenarios']}
        self.assertEqual(len(specs), 12)
        self.assertEqual({x[0] for x in specs}, {20, 30, 40})
        self.assertFalse(result['broker_numeric_line_parity_verified'])
        self.assertFalse(result['trade_performance_or_recommendation_allowed'])
        self.assertTrue(result['zero_broker_samples_for_20_and_40'])
        self.assertTrue(result['production_scanner_unchanged'])
        self.assertEqual(len(result['scenarios'][0]['days']), 3)
        for scenario in result['scenarios']:
            self.assertTrue(all(day['user_reported_broker_line_krw'] is None
                                for day in scenario['days']) if
                            scenario['period'] != 30 else
                            all(day['user_reported_broker_line_krw'] is not None
                                for day in scenario['days']))

    def test_price_cross_is_separate_from_line_slope(self):
        result = audit_triple_periods(synthetic_market(), self.obs)
        for scenario in result['scenarios']:
            day = scenario['days'][1]
            self.assertTrue(day['price_cross_from_below_ignoring_slope'])
            self.assertEqual(day['line_direction'], 'flat')
            self.assertTrue(day['nonfalling_line_price_cross'])
            self.assertFalse(day['falling_line_geometry_cross'])
            self.assertFalse(day['scanner_strict_cross'])

    def test_future_ohlc_does_not_change_prior_period_lines(self):
        market = synthetic_market()
        original = audit_triple_periods(market, self.obs)
        market.loc[market.Date.eq(pd.Timestamp('2026-10-23')),
                   ['Open', 'High', 'Low', 'Close']] = [2000, 4000, 1200, 3000]
        future_changed = audit_triple_periods(market, self.obs)
        for a, b in zip(original['scenarios'], future_changed['scenarios']):
            self.assertEqual(a['days'][:2], b['days'][:2])

    def test_bad_samples_or_missing_issuer_bar_fail_closed(self):
        malformed = copy.deepcopy(self.obs)
        malformed['observations'][2]['date'] = '2026-10-21'
        with self.assertRaisesRegex(ValueError, 'THREE_ORDERED'):
            audit_triple_periods(synthetic_market(), malformed)
        market = synthetic_market()
        other = market.copy()
        other['Code'] = '999999'  # Maintain the market session calendar.
        market = pd.concat([market[~market.Date.eq(pd.Timestamp('2026-09-30'))],
                            other], ignore_index=True)
        with self.assertRaisesRegex(ValueError, 'NONCONTIGUOUS'):
            audit_triple_periods(market, self.obs)

    def test_plan_mode_never_loads_market_data(self):
        stdout = io.StringIO()
        with mock.patch('scripts.blue_dot_triple_period_parity.load_marcap',
                        side_effect=AssertionError('unexpected network load')):
            with mock.patch.object(sys, 'argv', ['triple', '--mode=plan']):
                with contextlib.redirect_stdout(stdout):
                    main()
        self.assertIn('"periods": [20, 30, 40]', stdout.getvalue())
        self.assertIn('"broker_parity_verified": false', stdout.getvalue())


if __name__ == '__main__':
    unittest.main()

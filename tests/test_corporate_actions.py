"""Offline regression: LK Samyang 5:1 consolidation must not fake a breakout."""
import sys
import unittest
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from corporate_actions import (ADJUSTED, ALREADY_ADJUSTED, REVIEW,
                               adjust_verified_actions)
from market_scan_r11 import diagnose_symbol, build_symbol_snapshot
from append_symbol_analysis_sql import statements


def sample(post_price=5000., pre_price=1000., code='225190'):
    sessions = pd.bdate_range('2025-05-01', '2026-11-17')
    # The stock was halted for the share consolidation.
    sessions = sessions[(sessions < '2026-09-03') | (sessions >= '2026-09-28')]
    close = [pre_price if t < pd.Timestamp('2026-09-28') else post_price
             for t in sessions]
    volume = [50000 if t < pd.Timestamp('2026-09-28') else 10000
              for t in sessions]
    return pd.DataFrame({
        'Date': sessions, 'Code': code, 'Name': 'LK삼양',
        'Open': close, 'High': [v*1.02 for v in close],
        'Low': [v*.98 for v in close], 'Close': close,
        'Volume': volume, 'Amount': 1_000_000_000, 'Market': 'KOSDAQ'})


class CorporateActionsTests(unittest.TestCase):
    def test_raw_history_is_kept_and_5_to_1_is_adjusted_once(self):
        source = sample()
        before = source.loc[source.Date.lt('2026-09-28')].iloc[-1]
        fixed, audit = adjust_verified_actions(source, '2026-11-17')
        self.assertEqual(audit[0]['status'], ADJUSTED)
        self.assertEqual(audit[0]['factor'], 5)
        self.assertEqual(float(before.Close), 1000)
        ix = fixed.Date.lt('2026-09-28')
        self.assertTrue(fixed.loc[ix, 'Close'].eq(5000).all())
        self.assertTrue(fixed.loc[ix, 'Volume'].eq(10000).all())
        self.assertTrue(fixed.Amount.eq(source.Amount).all())
        second, again = adjust_verified_actions(fixed, '2026-11-17')
        self.assertEqual(again, [])
        self.assertTrue(second.Close.equals(fixed.Close))

    def test_diagnostic_recalculates_long_mas_on_adjusted_history(self):
        result = diagnose_symbol(sample(), '2026-11-17', '225190', [])
        self.assertEqual(result['quality_status'], ADJUSTED)
        self.assertTrue(result['price_adjusted'])
        self.assertFalse(result['non_adjusted_history'])
        self.assertFalse(result['large_historical_gap_review'])
        self.assertEqual(result['ma112'], 5000)
        self.assertEqual(result['ma224'], 5000)

    def test_independent_snapshot_chart_and_sql_share_adjusted_basis(self):
        item = build_symbol_snapshot(sample(), '2026-11-17', '225190', [], 'TEST')
        self.assertEqual(item['quality_status'], ADJUSTED)
        self.assertTrue(item['chart']['price_adjusted'])
        self.assertEqual(item['chart']['bars'][-1]['ma224'], 5000)
        self.assertIsNotNone(item['stats'])
        self.assertTrue(item['stats']['price_adjusted'])
        self.assertGreater(len(statements(item, 'action_audit_01')), 2)

    def test_pre_adjusted_vendor_prices_are_not_multiplied_again(self):
        d = sample(post_price=5000., pre_price=5000.)
        fixed, audit = adjust_verified_actions(d, '2026-11-17')
        self.assertEqual(audit[0]['status'], ALREADY_ADJUSTED)
        self.assertTrue(fixed.Close.equals(d.Close))
        self.assertTrue(fixed.Volume.equals(d.Volume))

    def test_ambiguous_history_does_not_fabricate_factor_or_signals(self):
        d = sample(post_price=2500.)
        result = diagnose_symbol(d, '2026-11-17', '225190', [])
        self.assertEqual(result['quality_status'], REVIEW)
        self.assertTrue(result['large_historical_gap_review'])
        self.assertIsNone(result['ma112'])
        self.assertIsNone(result['ma224'])
        self.assertIsNone(result['additional_predicates']['MA112_CROSS'])
        self.assertIsNone(result['signal_predicates']['BB20_UPPER_SIGNAL'])
        fixed, audit = adjust_verified_actions(d, '2026-11-17')
        self.assertEqual(audit[0]['status'], REVIEW)
        self.assertTrue(fixed.Close.equals(d.Close))

    def test_asof_before_event_does_not_use_future_action(self):
        d = sample()
        fixed, audit = adjust_verified_actions(d, '2026-08-10')
        self.assertEqual(audit, [])
        self.assertTrue(fixed.Close.equals(d.Close))

    def test_unregistered_ticker_is_not_auto_adjusted_by_large_gap(self):
        d = sample(code='123456')
        fixed, audit = adjust_verified_actions(d, '2026-11-17')
        self.assertEqual(audit, [])
        self.assertTrue(fixed.Close.equals(d.Close))


if __name__ == '__main__':
    unittest.main()

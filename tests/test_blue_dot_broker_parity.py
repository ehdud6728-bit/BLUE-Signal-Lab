import copy
import json
import unittest

import pandas as pd

from scripts.blue_dot_broker_parity import (
    SAMPLE_FILE, audit_broker_samples, classify_cross,
)


def sample_market():
    dates = pd.bdate_range(end='2026-11-12', periods=300)
    rows = []
    for date in dates:
        close, op = (100100, 100100)
        if date == pd.Timestamp('2026-11-12'):
            op, close = 100200, 101200
        rows.append({'Date': date, 'Code': '005300', 'Name': '롯데칠성',
                     'Market': 'KOSPI', 'Open': op,
                     'High': max(op, close) + 200,
                     'Low': min(op, close) - 200,
                     'Close': close, 'Volume': 20000, 'Amount': 2e9})
    return pd.DataFrame(rows)


class BlueDotBrokerParityTest(unittest.TestCase):
    def setUp(self):
        self.sample = json.loads(SAMPLE_FILE.read_text(encoding='utf-8'))

    def test_reported_broker_geometry_differs_from_strict_body_filter(self):
        result = classify_cross(100200, 101200, 100100, 100542, 100267)
        self.assertTrue(result['falling_line'])
        self.assertTrue(result['geometry_cross'])
        self.assertFalse(result['scanner_strict_cross'])
        self.assertEqual(result['body_below_line_pct'], 6.7)

    def test_causal_pinned_source_comparison_is_diagnostic_only(self):
        result = audit_broker_samples(sample_market(), self.sample)
        self.assertEqual(result['broker_line_delta_krw'], -275)
        self.assertEqual(result['source_ohlc_krw_on_signal_day']['close'], 101200)
        self.assertTrue(result['broker_line_vs_source_ohlc_classification']['geometry_cross'])
        self.assertFalse(result['broker_line_vs_source_ohlc_classification']['scanner_strict_cross'])
        self.assertEqual(set(result['price_basis_hypotheses']), {'close', 'hlc3'})
        self.assertFalse(result['broker_numeric_line_parity_verified'])
        self.assertFalse(result['recommendation_or_production_change_allowed'])
        self.assertIsNone(result['selected_rule'])

    def test_future_ohlc_cannot_change_prior_model_line_audit(self):
        raw = sample_market()
        before = audit_broker_samples(raw, self.sample)
        next_day = raw.iloc[-1].copy()
        next_day['Date'] = pd.Timestamp('2026-11-13')
        next_day['Close'] = next_day['High'] = 150000
        next_day['Open'] = 130000
        next_day['Low'] = 90000
        after = audit_broker_samples(pd.concat(
            [raw, pd.DataFrame([next_day])], ignore_index=True), self.sample)
        self.assertEqual(before['price_basis_hypotheses'],
                         after['price_basis_hypotheses'])

    def test_wrong_date_or_history_fails_closed(self):
        invalid = copy.deepcopy(self.sample)
        invalid['observations'][1]['date'] = '2026-11-10'
        with self.assertRaisesRegex(ValueError, 'TWO_ORDERED_DAYS'):
            audit_broker_samples(sample_market(), invalid)
        with self.assertRaisesRegex(ValueError, 'HISTORY_TOO_SHORT'):
            audit_broker_samples(sample_market().tail(50), self.sample)


if __name__ == '__main__':
    unittest.main()

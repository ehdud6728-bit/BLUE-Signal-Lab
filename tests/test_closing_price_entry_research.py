import unittest
from datetime import date, timedelta

from scripts.closing_price_entry_research import analyze_closing_entries
from scripts.exit_policy_research import VerifiedBar
from scripts.pattern_exit_study import analyze, SEARCH_PATTERN_TAGS


def closing_fixture(n=30, codes=5, open_price=108):
    days = []
    cursor = date(2026, 10, 1)
    while len(days) < n:
        if cursor.weekday() < 5:
            days.append(cursor.isoformat())
        cursor += timedelta(days=1)
    prices = {}
    events = []
    signals = []
    bars = []
    for code_index in range(codes):
        code = f'{code_index + 1:06d}'
        prices[code] = {}
        for i, day in enumerate(days):
            price = VerifiedBar(day, open_price, max(110, open_price),
                                min(98, open_price), 100, audited=True)
            prices[code][day] = price
            bars.append({'day': day, 'code': code, 'open': price.open,
                         'high': price.high, 'low': price.low, 'close': price.close})
            events.append((i, day, code, ['ENV20_LOWER_TOUCH']))
            signals.append({'day': day, 'code': code, 'names': ['ENV20_LOWER_TOUCH']})
    snap = {'format': 'BLUE_TURSO_EXIT_SOURCE_V1', 'storage': 'TURSO',
            'audits_readback_verified': True, 'asof_day': days[-1],
            'eod_days': [{'day': day, 'expected': 2660, 'actual': 2660} for day in days],
            'research_audited_days': len(days), 'signals': signals, 'bars': bars,
            'trading_calendar_verified': False, 'corporate_actions_verified': False}
    return days, events, prices, snap


def pattern(report, holding_sessions, tag='ENV20_LOWER_TOUCH'):
    windows = report['modes']['after_hours_close_1540_1600']['windows']
    return next(p for w in windows if w['holding_sessions'] == holding_sessions
                for p in w['patterns'] if p['pattern'] == tag)


class ClosingPriceEntryResearchTests(unittest.TestCase):
    def test_auction_is_blocked_without_preclose_snapshot_or_real_fills(self):
        days, events, prices, _ = closing_fixture()
        report = analyze_closing_entries(days, events, prices, SEARCH_PATTERN_TAGS)
        auction = report['modes']['closing_call_auction_1520_1530']
        self.assertEqual(auction['status'], 'BLOCKED_NO_PRE_CLOSE_SIGNAL_OR_AUCTION_FILLS')
        self.assertIsNone(auction['price_path_statistics'])
        self.assertFalse(auction['executability_verified'])
        self.assertTrue(report['same_day_final_signal_is_not_known_at_1520'])
        self.assertFalse(report['recommendation_allowed'])

    def test_confirmed_close_is_a_conditional_fill_not_a_next_open_trade(self):
        days, events, prices, _ = closing_fixture()
        report = analyze_closing_entries(days, events, prices, SEARCH_PATTERN_TAGS)
        conditional = report['modes']['after_hours_close_1540_1600']
        self.assertFalse(conditional['actual_order_fill_verified'])
        self.assertFalse(conditional['time_exit_fill_verified'])
        self.assertFalse(conditional['future_gap_known_at_entry'])
        five = pattern(report, 5)
        train = five['training']
        self.assertEqual(train['status'], 'CONDITIONAL_PRICE_PATH_ONLY')
        self.assertEqual(train['conditional_close_entry']['overnight_gap_median_pct'], 8)
        self.assertAlmostEqual(train['conditional_close_entry']['hold_to_horizon_net']
                               ['mean_net_return_pct'], -0.3)
        self.assertAlmostEqual(train['next_open_entry_same_cohort']['hold_to_horizon_net']
                               ['mean_net_return_pct'], -7.707)
        self.assertAlmostEqual(train['next_open_entry_same_cohort']
                               ['difference_in_mean_pct_points_conditional_close_minus_next_open'],
                               7.407)

    def test_limited_holdout_is_kept_separate_and_not_tuned(self):
        days, events, prices, _ = closing_fixture()
        report = analyze_closing_entries(days, events, prices, SEARCH_PATTERN_TAGS)
        self.assertEqual(report['modes']['after_hours_close_1540_1600']['holdout_start_day'],
                         days[22])
        five = pattern(report, 5)
        self.assertEqual(five['training']['n'], 85)
        self.assertEqual(five['training']['signal_days'], 17)
        self.assertEqual(five['holdout']['n'], 15)
        self.assertEqual(five['holdout']['signal_days'], 3)
        self.assertEqual(five['holdout']['status'], 'CONDITIONAL_PRICE_PATH_ONLY')
        self.assertEqual(five['embargoed_overlap_cases'], 25)
        self.assertEqual(pattern(report, 10)['holdout']['n'], 0)
        self.assertIsNone(pattern(report, 10)['holdout']['conditional_close_entry'])
        self.assertFalse(five['recommendation_allowed'])

    def test_overnight_buckets_are_descriptive_not_same_day_entry_filters(self):
        days, events, prices, _ = closing_fixture()
        train = pattern(analyze_closing_entries(days, events, prices, SEARCH_PATTERN_TAGS),
                        5)['training']
        bins = train['overnight_gap_buckets']
        self.assertEqual(bins['up_2pct_or_more']['n'], train['n'])
        self.assertEqual(bins['up_2pct_or_more']['status'], 'DESCRIPTIVE_ONLY')
        self.assertEqual(bins['down_2pct_or_more']['n'], 0)
        self.assertIsNone(bins['down_2pct_or_more']['hold_to_horizon_net'])

    def test_missing_price_path_and_short_history_fail_closed(self):
        days, events, prices, snap = closing_fixture(12, codes=1)
        del prices['000001'][days[4]]
        report = analyze_closing_entries(days, events, prices, SEARCH_PATTERN_TAGS)
        five = pattern(report, 5)
        self.assertGreater(five['excluded_missing_price_path'], 0)
        self.assertIsNone(five['training']['conditional_close_entry'])
        self.assertIsNone(five['holdout']['conditional_close_entry'])
        integrated = analyze(snap)
        self.assertIn('closing_price_entry_research', integrated)
        self.assertEqual(integrated['candidate_stocks'], [])
        self.assertFalse(integrated['investment_recommendation_enabled'])


if __name__ == '__main__':
    unittest.main()

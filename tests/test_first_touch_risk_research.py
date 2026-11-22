import unittest
from datetime import date, timedelta

from scripts.exit_policy_research import VerifiedBar
from scripts.first_touch_risk_research import (
    first_touch, analyze_first_touch_risk, _representative_stop_stocks)
from scripts.pattern_exit_study import analyze, SEARCH_PATTERN_TAGS


def bar(day, open_=100, high=100, low=100, close=100):
    return VerifiedBar(day, open_, high, low, close, audited=True)


def fixture(n=30, codes=5):
    dates = []
    current = date(2026, 10, 1)
    while len(dates) < n:
        if current.weekday() < 5:
            dates.append(current.isoformat())
        current += timedelta(days=1)
    per_code = {}
    events = []
    signals = []
    rows = []
    for c in range(codes):
        code = f'{c + 1:06d}'
        per_code[code] = {day: bar(day) for day in dates}
        for i, day in enumerate(dates):
            events.append((i, day, code, ['ENV20_LOWER_TOUCH']))
            signals.append({'day': day, 'code': code, 'names': ['ENV20_LOWER_TOUCH']})
            rows.append({'day': day, 'code': code, 'open': 100, 'high': 100,
                         'low': 100, 'close': 100})
    snap = {'format': 'BLUE_TURSO_EXIT_SOURCE_V1', 'storage': 'TURSO',
            'audits_readback_verified': True, 'asof_day': dates[-1],
            'eod_days': [{'day': day, 'expected': 2660, 'actual': 2660} for day in dates],
            'research_audited_days': len(dates), 'signals': signals, 'bars': rows,
            'trading_calendar_verified': False, 'corporate_actions_verified': False}
    return dates, events, per_code, snap


def group(report, horizon=5, tag='ENV20_LOWER_TOUCH'):
    window = next(w for w in report['windows']
                  if w['observation_sessions_not_forced_holding'] == horizon)
    return next(p for p in window['patterns'] if p['pattern'] == tag)


class FirstTouchUnitTests(unittest.TestCase):
    def test_first_take_wins_before_a_later_stop(self):
        path = [bar('2026-11-02'), bar('2026-11-03', high=106, low=99, close=104),
                bar('2026-11-04', high=101, low=82, close=90)]
        outcome = first_touch(path, 5, 3)
        self.assertEqual(outcome.reason, 'TAKE')
        self.assertEqual(outcome.sessions_until_touch, 1)
        self.assertAlmostEqual(outcome.net_return_pct, 4.7)

    def test_stop_wins_before_later_take(self):
        path = [bar('2026-11-02'), bar('2026-11-03', high=101, low=96, close=97),
                bar('2026-11-04', high=120, low=100, close=110)]
        self.assertEqual(first_touch(path, 5, 3).reason, 'STOP')

    def test_overnight_stop_gap_exits_below_planned_stop(self):
        path = [bar('2026-11-02'), bar('2026-11-03', open_=92, high=95, low=90,
                                       close=93)]
        outcome = first_touch(path, 5, 3)
        self.assertEqual(outcome.reason, 'STOP_GAP')
        self.assertEqual(outcome.exit_price, 92)
        self.assertAlmostEqual(outcome.net_return_pct, -8.3)
        self.assertEqual(outcome.stop_gap_overrun_pct_points, 5)

    def test_double_touch_stop_first_and_take_gap_target_only(self):
        double = [bar('2026-11-02'), bar('2026-11-03', high=110, low=90)]
        self.assertEqual(first_touch(double, 5, 3).reason, 'AMBIGUOUS_STOP_FIRST')
        gap = [bar('2026-11-02'), bar('2026-11-03', open_=110, high=111,
                                     low=108, close=109)]
        self.assertEqual(first_touch(gap, 5, 3).exit_price, 105)
        self.assertEqual(first_touch(gap, 5, 3).reason, 'TAKE_GAP')

    def test_no_touch_has_no_time_exit_even_with_long_path(self):
        path = [bar('2026-11-02'), bar('2026-11-03', high=102, low=98),
                bar('2026-11-04', high=102, low=98)]
        outcome = first_touch(path, 5, 3)
        self.assertEqual(outcome.reason, 'NO_TOUCH')
        self.assertIsNone(outcome.net_return_pct)
        self.assertIsNone(outcome.exit_price)

    def test_unverified_or_invalid_bars_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'UNVERIFIED_OR_INVALID_BAR'):
            first_touch([bar('2026-11-02'),
                         VerifiedBar('2026-11-03', 100, 100, 90, 100, audited=False)], 5, 3)


class FirstTouchReportTests(unittest.TestCase):
    def test_repeated_stop_stock_examples_keep_signal_days_and_gap_separate(self):
        cases = [
            ('2026-11-02', '000001', [bar('2026-11-02'),
                bar('2026-11-03', open_=88, high=91, low=87, close=89)], True),
            ('2026-11-04', '000001', [bar('2026-11-04'),
                bar('2026-11-05', open_=100, high=102, low=94, close=96)], True),
            ('2026-11-02', '000002', [bar('2026-11-02'),
                bar('2026-11-03', open_=100, high=107, low=99, close=106)], True),
            ('2026-11-04', '000003', [bar('2026-11-04'),
                bar('2026-11-05', open_=100, high=102, low=95, close=97)], True),
        ]
        examples = _representative_stop_stocks(cases, 5, 3, None,
            {('2026-11-02', '000001'): '가상종목A',
             ('2026-11-04', '000001'): '가상종목A'})
        first = examples['top_stocks_by_first_stop_count'][0]
        self.assertEqual(first['code'], '000001')
        self.assertEqual(first['stock_name_at_signal'], '가상종목A')
        self.assertEqual(first['distinct_signal_days'], 2)
        self.assertEqual(first['first_stop_count'], 2)
        self.assertEqual(first['stop_gap_count'], 1)
        self.assertEqual(first['first_stop_fraction_of_all_signals_pct'], 100)
        self.assertEqual(examples['worst_stop_gap_events'][0]['signal_day'],
                         '2026-11-02')
        self.assertAlmostEqual(examples['worst_stop_gap_events'][0]
                               ['net_return_pct'], -12.3)
        self.assertEqual(examples['total_distinct_stocks_with_a_first_stop'], 2)
        self.assertFalse(examples['policy_selected_or_recommended'])

    def test_representative_examples_not_a_buy_list_or_holdout_selected_policy(self):
        dates, events, prices, _ = fixture()
        for code in prices:
            prices[code][dates[15]] = bar(dates[15], open_=60, high=100,
                                          low=59, close=100)
        names = {(dates[14], '000001'): '검증종목'}
        report = analyze_first_touch_risk(dates, events, prices,
            SEARCH_PATTERN_TAGS, signal_stock_names=names)
        five = group(report)
        examples = five['representative_stop_stocks_first_grid_only']
        self.assertEqual(examples['take_profit_pct'],
                         five['first_touch_grid'][0]['take_profit_pct'])
        self.assertEqual(examples['stop_loss_pct'],
                         five['first_touch_grid'][0]['stop_loss_pct'])
        self.assertTrue(examples['training']['worst_stop_gap_events'])
        self.assertFalse(report['recommendation_allowed'])
        self.assertNotIn('representative_stop_stocks_first_grid_only',
                         group(report, horizon=20))

    def test_stock_name_provenance_rejects_control_characters(self):
        _, _, _, snap = fixture(n=12, codes=1)
        snap['signals'][0]['stock_name_at_signal'] = 'bad\nname'
        with self.assertRaisesRegex(ValueError, 'INVALID_SIGNAL_STOCK_NAME'):
            analyze(snap)

    def test_rare_training_open_crash_is_counted_as_catastrophic_stop_gap(self):
        dates, events, prices, _ = fixture()
        for code in prices:
            prices[code][dates[15]] = bar(dates[15], open_=60, high=100,
                                          low=59, close=100)
        report = analyze_first_touch_risk(dates, events, prices, SEARCH_PATTERN_TAGS)
        candidates = group(report)['first_touch_grid']
        severe = [item['training'] for item in candidates if item['stop_loss_pct'] == 1]
        self.assertTrue(severe)
        self.assertGreater(severe[0]['stop_gap_count'], 0)
        self.assertGreater(severe[0]['stop_gap_overrun_at_least_5pct_points_count'], 0)
        self.assertGreater(severe[0]['resolved_net_loss_at_or_below_minus_20pct_count'], 0)
        self.assertLessEqual(severe[0]['resolved_net_only_selection_biased']
                             ['worst_net_return_pct'], -40)
        self.assertFalse(report['recommendation_allowed'])

    def test_no_touch_is_censored_and_grid_is_never_ranked(self):
        dates, events, prices, snap = fixture()
        report = analyze_first_touch_risk(dates, events, prices, SEARCH_PATTERN_TAGS)
        five = group(report)
        self.assertEqual(five['training_cases'], 85)
        self.assertEqual(five['training_signal_days'], 17)
        self.assertEqual(five['candidate_count'], 1)
        self.assertEqual(five['status'], 'TRAIN_ONLY_GRID_NOT_SELECTED')
        self.assertIsNone(five['selected_rule'])
        training = five['first_touch_grid'][0]['training']
        self.assertEqual(training['resolved_count'], 0)
        self.assertEqual(training['unresolved_no_touch_full_window'], 85)
        self.assertEqual(training['resolved_net_only_selection_biased'], {'n': 0})
        self.assertEqual(training['unresolved_latest_close_mark_to_market_not_an_exit']['n'], 85)
        holdout = five['first_touch_grid'][0]['holdout']
        self.assertEqual(holdout['unresolved_no_touch_full_window'], 15)
        self.assertEqual(holdout['pending_recent_no_touch'], 20)
        self.assertFalse(report['actual_entry_or_exit_fills_verified'])
        self.assertTrue(report['observation_window_is_not_a_time_exit'])
        self.assertFalse(report['recommendation_allowed'])
        integrated = analyze(snap)
        self.assertIn('first_touch_exit_risk_research', integrated)
        self.assertFalse(integrated['investment_recommendation_enabled'])
        self.assertEqual(integrated['candidate_stocks'], [])

    def test_holdout_cannot_change_training_thresholds(self):
        dates, events, prices, _ = fixture()
        original = group(analyze_first_touch_risk(dates, events, prices,
                         SEARCH_PATTERN_TAGS))['first_touch_grid']
        for code in prices:
            for day in dates[22:]:
                prices[code][day] = bar(day, open_=60, high=101, low=40, close=100)
        changed = group(analyze_first_touch_risk(dates, events, prices,
                        SEARCH_PATTERN_TAGS))['first_touch_grid']
        self.assertEqual([(x['take_profit_pct'], x['stop_loss_pct']) for x in original],
                         [(x['take_profit_pct'], x['stop_loss_pct']) for x in changed])
        self.assertEqual(original[0]['training'], changed[0]['training'])

    def test_no_followup_missing_and_insufficient_history_are_distinct(self):
        dates, events, prices, _ = fixture(12, 1)
        del prices['000001'][dates[5]]
        report = analyze_first_touch_risk(dates, events, prices, SEARCH_PATTERN_TAGS)
        five = group(report)
        self.assertGreater(five['excluded_missing_price_path'], 0)
        self.assertEqual(five['pending_no_followup'], 1)
        self.assertEqual(five['candidate_count'], 0)
        self.assertEqual(five['status'], 'INSUFFICIENT_TRAIN')

    def test_pre_entry_features_are_descriptive_not_recommendations(self):
        dates, events, prices, _ = fixture()
        for code in prices:
            for day in dates[:22]:
                prices[code][day] = bar(day, open_=110, high=130, low=90, close=91)
        report = analyze_first_touch_risk(dates, events, prices, SEARCH_PATTERN_TAGS)
        candidate = group(report)['first_touch_grid'][0]
        features = candidate['training']['signal_day_features_train_only']
        self.assertEqual(features['signal_day_range_at_least_10pct']['n'], 85)
        self.assertEqual(features['signal_day_close_down_at_least_5pct']['n'], 85)
        self.assertEqual(features['signal_day_close_in_bottom_quartile']['n'], 85)
        self.assertIsNone(group(report)['selected_rule'])


if __name__ == '__main__':
    unittest.main()

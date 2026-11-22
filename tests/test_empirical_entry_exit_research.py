import unittest
from datetime import date, timedelta

from scripts.exit_policy_research import ExitPolicy
from scripts.pattern_exit_study import analyze, SEARCH_PATTERN_TAGS


def source(n=120):
    days = []
    today = date(2026, 4, 1)
    while len(days) < n:
        if today.weekday() < 5:
            days.append(today.isoformat())
        today += timedelta(days=1)
    bars = []
    for i, day in enumerate(days):
        phase = (i // 10) % 3
        bars.append({'day': day, 'code': '005930', 'open': 100,
                     'high': 103 + phase * 4, 'low': 99 - phase * 2,
                     'close': 101})
    return {'format': 'BLUE_TURSO_EXIT_SOURCE_V1', 'storage': 'TURSO',
            'audits_readback_verified': True, 'asof_day': days[-1],
            'eod_days': [{'day': day, 'expected': 2660, 'actual': 2660} for day in days],
            'research_audited_days': n, 'signals': [
                {'day': day, 'code': '005930', 'names': ['ENV20_LOWER_TOUCH']}
                for day in days], 'bars': bars,
            'trading_calendar_verified': False, 'corporate_actions_verified': False}


def empirical(source_data, horizon=5, pattern='ENV20_LOWER_TOUCH'):
    root = analyze(source_data)['empirical_entry_exit_research']
    window = next(x for x in root['windows'] if x['holding_sessions'] == horizon)
    return root, next(x for x in window['patterns'] if x['pattern'] == pattern)


class EmpiricalEntryExitResearchTests(unittest.TestCase):
    def test_all_eleven_search_patterns_and_four_horizons_even_when_unavailable(self):
        root, item = empirical(source(12))
        self.assertEqual(root['holdout_start_day'], source(12)['eod_days'][9]['day'])
        self.assertEqual([x['holding_sessions'] for x in root['windows']], [5, 10, 20, 60])
        for window in root['windows']:
            self.assertEqual([x['pattern'] for x in window['patterns']], list(SEARCH_PATTERN_TAGS))
            self.assertFalse(any(x['recommendation_allowed'] for x in window['patterns']))
        self.assertEqual(item['status'], 'INSUFFICIENT_TRAIN')
        self.assertIsNone(item['training_selected_rule'])

    def test_train_quantile_levels_selected_and_holdout_never_used_to_tune(self):
        baseline = source()
        root, first = empirical(baseline)
        self.assertEqual(first['status'], 'EXPLORATORY_HOLDOUT')
        self.assertLessEqual(first['candidate_count'], 9)
        self.assertGreater(first['candidate_count'], 1)
        self.assertLess(first['training_selected_rule']['training_last_exit_day'],
                        root['holdout_start_day'])
        self.assertGreater(first['embargoed_overlap_cases'], 0)
        self.assertGreater(first['holdout_cases'], 0)
        self.assertIn('hold_to_horizon_baseline', first['holdout_comparison'])
        self.assertEqual(sum(v['n'] for v in first['holdout_comparison']['entry_gap_subgroups'].values()),
                         first['holdout_cases'])
        self.assertAlmostEqual(first['training_selected_rule']['training_entry_gap_median_pct'],
                               -0.99, places=2)
        modified = source()
        for bar in modified['bars']:
            if bar['day'] >= root['holdout_start_day']:
                bar['high'], bar['low'], bar['close'] = 160, 60, 140
        _, changed = empirical(modified)
        self.assertEqual(first['training_selected_rule'], changed['training_selected_rule'])
        self.assertNotEqual(first['holdout_comparison'], changed['holdout_comparison'])

    def test_training_entry_gap_cutoff_is_not_retrained_on_holdout_opens(self):
        before = source()
        root, first = empirical(before)
        changed = source()
        for bar in changed['bars']:
            if bar['day'] >= root['holdout_start_day']:
                bar['open'] = 90
                bar['low'] = min(bar['low'], 80)
        _, revised = empirical(changed)
        self.assertEqual(first['training_selected_rule'], revised['training_selected_rule'])
        self.assertNotEqual(first['holdout_comparison'], revised['holdout_comparison'])

    def test_60_day_exit_policy_is_valid_but_no_60_day_holdout_is_fabricated(self):
        self.assertEqual(ExitPolicy(10, 5, 60).max_holding_sessions, 60)
        _, item = empirical(source(), horizon=60)
        self.assertEqual(item['status'], 'TRAIN_ONLY_UNVALIDATED')
        self.assertEqual(item['holdout_cases'], 0)
        self.assertIsNone(item['holdout_comparison'])

    def test_missing_price_paths_are_excluded_without_synthetic_outcomes(self):
        snap = source()
        missing = snap['eod_days'][30]['day']
        snap['signals'] = [row for row in snap['signals'] if row['day'] != missing]
        snap['bars'] = [bar for bar in snap['bars'] if bar['day'] != missing]
        _, item = empirical(snap)
        self.assertGreater(item['excluded_missing_price_path'], 0)
        self.assertFalse(item['recommendation_allowed'])

    def test_no_predictions_or_stock_recommendations_even_if_audit_flags_true(self):
        snap = source()
        snap['trading_calendar_verified'] = True
        snap['corporate_actions_verified'] = True
        report = analyze(snap)
        self.assertFalse(report['investment_recommendation_enabled'])
        self.assertEqual(report['candidate_stocks'], [])
        self.assertFalse(report['empirical_entry_exit_research']['recommendation_allowed'])


if __name__ == '__main__':
    unittest.main()

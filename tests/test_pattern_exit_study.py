import unittest
from datetime import date, timedelta

from scripts.pattern_exit_study import analyze, WINDOWS


def fixture(n=26, corporate=False, calendar=False):
    days = []
    now = date(2026, 10, 1)
    while len(days) < n:
        if now.weekday() < 5:
            days.append(now.isoformat())
        now += timedelta(days=1)
    return {
        'format': 'BLUE_TURSO_EXIT_SOURCE_V1', 'storage': 'TURSO',
        'audits_readback_verified': True, 'asof_day': days[-1],
        'eod_days': [{'day': day, 'expected': 2660, 'actual': 2660} for day in days],
        'research_audited_days': len(days),
        'signals': [{'day': days[i], 'code': '005930', 'names': ['BB20']}
                    for i in range(0, len(days), 2)],
        'bars': [{'day': day, 'code': '005930', 'open': 100, 'high': 107,
                  'low': 99, 'close': 104} for day in days],
        'trading_calendar_verified': calendar,
        'corporate_actions_verified': corporate,
    }


class PatternExitStudyTest(unittest.TestCase):
    def test_all_horizons_and_mature_vs_pending_cases(self):
        report = analyze(fixture())
        self.assertEqual([x['sessions'] for x in report['short_and_long_windows']], list(WINDOWS))
        self.assertTrue(report['short_and_long_windows'][0]['archive_complete'])
        self.assertFalse(report['short_and_long_windows'][-1]['archive_complete'])
        self.assertEqual(report['candidate_stocks'], [])
        self.assertFalse(report['investment_recommendation_enabled'])
        twenty = report['short_and_long_windows'][2]
        self.assertEqual(twenty['sessions'], 20)
        self.assertGreater(twenty['candidate_policies'], 0)
        self.assertFalse(twenty['watchlist_allowed'])
        path = report['observed_path_windows']
        self.assertEqual([w['holding_sessions'] for w in path], [5, 10, 20, 60])
        self.assertGreater(path[0]['mature_signal_stock_days'], 0)
        self.assertGreater(path[0]['pending_recent'], 0)
        self.assertEqual(path[0]['excluded_missing_price_path'], 0)
        self.assertFalse(path[0]['investment_recommendation_enabled'])
        stock = next(p for p in path[0]['patterns'] if p['pattern'] == 'BB20')
        self.assertEqual(stock['median_max_gain_pct'], 7)
        self.assertEqual(stock['median_max_loss_pct'], -1)
        self.assertEqual(stock['same_session_unresolved_count'], stock['n'])
        self.assertEqual(stock['low_first_count'] + stock['high_first_count'], 0)

    def test_even_opted_in_independent_proofs_do_not_fabricate_recommendations(self):
        result = analyze(fixture(65, corporate=True, calendar=True))
        self.assertEqual(result['candidate_stocks'], [])
        self.assertFalse(result['investment_recommendation_enabled'])

    def test_rejects_unverified_source_and_missing_price_path(self):
        snap = fixture()
        snap['audits_readback_verified'] = False
        with self.assertRaisesRegex(ValueError, 'UNVERIFIED_STUDY_SOURCE'):
            analyze(snap)
        snap = fixture()
        snap['bars'] = []
        with self.assertRaisesRegex(ValueError, 'SIGNAL_WITHOUT_AUDITED_CLOSE'):
            analyze(snap)
        snap = fixture()
        snap['eod_days'][0]['actual'] = 1
        with self.assertRaisesRegex(ValueError, 'INCOMPLETE_STUDY_AUDIT'):
            analyze(snap)

    def test_missing_future_bars_excludes_cases_not_counted_as_losers(self):
        snap = fixture()
        snap['bars'] = [row for row in snap['bars'] if row['day'] != snap['eod_days'][5]['day']]
        report = analyze(snap)
        self.assertEqual(report['candidate_stocks'], [])
        self.assertFalse(report['short_and_long_windows'][2]['watchlist_allowed'])
        self.assertGreater(report['observed_path_windows'][0]['excluded_missing_price_path'], 0)
        self.assertEqual(report['observed_path_windows'][0]['investment_recommendation_enabled'], False)

    def test_short_history_does_not_claim_a_mature_60_session_path(self):
        snap = fixture(10)
        report = analyze(snap)
        sixty = report['observed_path_windows'][3]
        self.assertEqual(sixty['mature_signal_stock_days'], 0)
        self.assertGreater(sixty['pending_recent'], 0)
        self.assertEqual(sixty['patterns'], [])


if __name__ == '__main__':
    unittest.main()

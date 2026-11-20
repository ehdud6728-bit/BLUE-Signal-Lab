import unittest
from datetime import datetime, timezone

from scripts.turso_history_batch_guard import guard


NOW = datetime(2026, 11, 20, 3, 0, tzinfo=timezone.utc)
BASE = ('ehdud6728-bit/BLUE-Signal-Lab', 'refs/heads/main', NOW)


class HistoryGuardTest(unittest.TestCase):
    def test_plan_and_dry_run_no_writes(self):
        for mode in ('plan', 'dry_run'):
            result = guard('2026-11-09', '2026-11-13', mode, '', *BASE)
            self.assertEqual(len(result['days']), 5)
            self.assertFalse(result['turso_write_permitted'])
            self.assertFalse(result['d1_access_permitted'])

    def test_apply_requires_exact_dates_in_confirmation(self):
        with self.assertRaisesRegex(ValueError, 'HISTORY_WRITE_NOT_CONFIRMED'):
            guard('2026-11-09', '2026-11-13', 'apply', 'blue-turso-history', *BASE)
        approved = guard('2026-11-09', '2026-11-13', 'apply',
                         'blue-turso-history-2026-11-09-2026-11-13', *BASE)
        self.assertTrue(approved['turso_write_permitted'])
        with self.assertRaisesRegex(ValueError, 'HISTORY_INDICATORS_NOT_CONFIRMED'):
            guard('2026-11-09', '2026-11-13', 'apply',
                  'blue-turso-history-2026-11-09-2026-11-13', *BASE, True, '')
        indicator = guard('2026-11-09', '2026-11-13', 'apply',
                          'blue-turso-history-2026-11-09-2026-11-13', *BASE,
                          True, 'blue-turso-all-indicators')
        self.assertTrue(indicator['indicator_write_permitted'])

    def test_rejects_broad_future_invalid_branch_and_weekend_only(self):
        cases = [
            ('2026-11-09', '2026-11-18', 'plan', '', *BASE),
            ('2026-11-20', '2026-11-20', 'plan', '', *BASE),
            ('2026-11-14', '2026-11-15', 'plan', '', *BASE),
            ('2026-11-31', '2026-11-31', 'plan', '', *BASE),
            ('2026-11-09', '2026-11-13', 'plan', '', 'wrong/repo', BASE[1], NOW),
            ('2026-11-09', '2026-11-13', 'apply', '', BASE[0], 'refs/heads/feature', NOW),
            ('2026-11-09', '2026-11-13', 'bad', '', *BASE),
        ]
        for params in cases:
            with self.subTest(params=params), self.assertRaises(ValueError):
                guard(*params)


if __name__ == '__main__':
    unittest.main()

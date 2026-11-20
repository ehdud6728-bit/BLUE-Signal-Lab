import unittest
from datetime import date, datetime, timezone
from pathlib import Path
import re
import subprocess
import sys

from scripts.turso_history_batch_guard import guard
from scripts.turso_unified_day_guard import select_pipeline_day


NOW = datetime(2026, 11, 20, 3, 0, tzinfo=timezone.utc)
BASE = ('ehdud6728-bit/BLUE-Signal-Lab', 'refs/heads/main', NOW)


class HistoryGuardTest(unittest.TestCase):
    def test_history_scanner_uses_exact_calendar_years_not_year_count(self):
        workflow = (Path(__file__).resolve().parents[1] / '.github/workflows'
                    / 'blue_turso_history_research_batch.yml').read_text(encoding='utf-8')
        self.assertNotIn('--years 2', workflow)
        self.assertIn('--date "$DAY" --years "$RESEARCH_YEARS"', workflow)
        self.assertIn('--verified-eod-dir output/history/eod', workflow)
        self.assertLess(workflow.index('eod-range-import.mjs --mode=dry_run'),
                        workflow.index('python scripts/market_scan_r11.py --date "$DAY"'))
        command = re.search(r'RESEARCH_YEARS="\$\(python3 -c \'([^\']+)\' "\$DAY"\)"', workflow)
        self.assertIsNotNone(command, 'Historical scan must derive years for every selected day')
        for day, expected in (
            ('2025-12-31', '2024,2025'),
            ('2026-01-02', '2025,2026'),
            ('2026-11-09', '2025,2026'),
            ('2027-01-04', '2026,2027'),
        ):
            with self.subTest(day=day):
                actual = subprocess.check_output(
                    [sys.executable, '-c', command.group(1), day], text=True).strip()
                daily = select_pipeline_day(day, 'dry_run', 'workflow_dispatch', '',
                                            today=date(2027, 1, 10))['RESEARCH_YEARS']
                self.assertEqual(actual, expected)
                self.assertEqual(actual, daily)

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

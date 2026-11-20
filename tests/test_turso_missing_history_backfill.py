import unittest
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from scripts.turso_missing_history_guard import guard, MANUAL_CONFIRM, SCHEDULE_CONFIRM
from scripts.turso_history_sessions import weekday_candidates


NOW = datetime(2026, 11, 20, 4, 0, tzinfo=timezone.utc)
REPO, REF = 'ehdud6728-bit/BLUE-Signal-Lab', 'refs/heads/main'


class MissingHistoryTest(unittest.TestCase):
    def test_explicit_apply_permission_and_bounded_auto_opt_in(self):
        base=('workflow_dispatch', 'apply', '760', '5')
        with self.assertRaisesRegex(ValueError, 'MISSING_HISTORY_WRITE_NOT_CONFIRMED'):
            guard(*base, '', REPO, REF, NOW)
        result=guard(*base, MANUAL_CONFIRM, REPO, REF, NOW)
        self.assertEqual(result['end'], '2026-11-19')
        self.assertEqual(result['batch_size'], 5)
        self.assertTrue(result['write_allowed'])
        with self.assertRaisesRegex(ValueError, 'MISSING_HISTORY_SCHEDULE_NOT_APPROVED'):
            guard('schedule', 'apply', '760', '5', SCHEDULE_CONFIRM, REPO, REF, NOW)
        with self.assertRaisesRegex(ValueError, 'MISSING_HISTORY_SCHEDULE_NOT_APPROVED'):
            guard('schedule', 'apply', '760', '5', MANUAL_CONFIRM, REPO, REF, NOW, 'true')
        auto=guard('schedule', 'apply', '760', '5', SCHEDULE_CONFIRM, REPO, REF, NOW, 'true')
        self.assertTrue(auto['write_allowed'])

    def test_readonly_audit_dry_run_and_branch_guards(self):
        for mode in ('audit', 'dry_run'):
            result=guard('workflow_dispatch', mode, '365', '2', '', REPO, REF, NOW)
            self.assertFalse(result['write_allowed'])
            self.assertEqual(result['d1_sql'], 0)
        for bad in ('0', '6', '050', '-1', '5.0'):
            with self.subTest(bad=bad), self.assertRaisesRegex(ValueError, 'MISSING_HISTORY_LIMIT_INVALID'):
                guard('workflow_dispatch', 'audit', '760', bad, '', REPO, REF, NOW)
        with self.assertRaisesRegex(ValueError, 'MISSING_HISTORY_MAIN_ONLY'):
            guard('workflow_dispatch', 'audit', '760', '5', '', REPO, 'refs/heads/dev', NOW)

    def test_weekdays_remain_unverified_until_exact_krx_day_source_passes(self):
        days=weekday_candidates(date(2026, 11, 9), date(2026, 11, 15))
        self.assertEqual(days, ['2026-11-09', '2026-11-10', '2026-11-11',
                                '2026-11-12', '2026-11-13'])

    def test_calendar_range_guard_is_offline_and_bounded(self):
        with self.assertRaisesRegex(ValueError, 'HISTORY_CALENDAR_RANGE_INVALID'):
            weekday_candidates(date(2026, 11, 20), date(2026, 11, 19))
        with self.assertRaisesRegex(ValueError, 'HISTORY_CALENDAR_RANGE_INVALID'):
            weekday_candidates(date(2024, 1, 1), date(2026, 11, 19))
        self.assertEqual(weekday_candidates(date(2026, 11, 14), date(2026, 11, 15)), [])

    def test_workflow_keeps_schedule_disabled_and_old_writer_immutable(self):
        root=Path(__file__).resolve().parents[1]
        workflow=(root/'.github/workflows/blue_turso_missing_history_backfill.yml').read_text()
        self.assertIn("vars.BLUE_TURSO_MISSING_HISTORY_AUTO_ENABLED == 'true'", workflow)
        self.assertIn('vars.BLUE_TURSO_MISSING_HISTORY_AUTO_CONFIRM', workflow)
        self.assertIn('blue-turso-eod-research-writer', workflow)
        self.assertIn('missing-history-plan.mjs', workflow)
        self.assertIn('turso_history_sessions.py', workflow)
        self.assertIn('BLUE_MISSING_HISTORY_DAY_KRX_UNVERIFIED',workflow)
        self.assertIn('if (( SUCCESS >= BATCH_SIZE ))',workflow)
        self.assertIn("HISTORY_CANDIDATE_LIMIT: '50'",workflow)
        self.assertNotIn('D1_DATABASE_ID', workflow)
        self.assertNotIn('include_indicators', workflow)


if __name__ == '__main__':
    unittest.main()

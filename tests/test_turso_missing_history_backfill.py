import unittest
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from scripts.turso_missing_history_guard import guard, MANUAL_CONFIRM, SCHEDULE_CONFIRM
from scripts.turso_history_sessions import verified_sessions


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

    def test_index_sessions_skip_proven_closed_weekdays(self):
        def index(_start, _end, symbol):
            self.assertEqual(symbol, '1001')
            return pd.DataFrame({'종가': [3500, 3510, 3520, 3530]},
                                index=pd.to_datetime(['2026-11-09', '2026-11-10',
                                                      '2026-11-12', '2026-11-13']))
        days=verified_sessions(pd.Timestamp('2026-11-09').date(),
                               pd.Timestamp('2026-11-13').date(), index)
        self.assertEqual(days, ['2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13'])

    def test_truncated_or_invalid_calendar_is_not_treated_as_holidays(self):
        start=pd.Timestamp('2026-11-09').date()
        end=pd.Timestamp('2026-11-20').date()
        def short(*_):
            return pd.DataFrame({'종가': [3000]},index=pd.to_datetime(['2026-11-09']))
        def invalid(*_):
            return pd.DataFrame({'종가': [3000, 3001]},
                                index=pd.to_datetime(['2026-11-09', '2026-11-14']))
        with self.assertRaisesRegex(ValueError, 'HISTORY_KRX_CALENDAR_INCOMPLETE'):
            verified_sessions(start, end, short)
        with self.assertRaisesRegex(ValueError, 'HISTORY_KRX_CALENDAR_INVALID_SESSION'):
            verified_sessions(start, end, invalid)

    def test_workflow_keeps_schedule_disabled_and_old_writer_immutable(self):
        root=Path(__file__).resolve().parents[1]
        workflow=(root/'.github/workflows/blue_turso_missing_history_backfill.yml').read_text()
        self.assertIn("vars.BLUE_TURSO_MISSING_HISTORY_AUTO_ENABLED == 'true'", workflow)
        self.assertIn('vars.BLUE_TURSO_MISSING_HISTORY_AUTO_CONFIRM', workflow)
        self.assertIn('blue-turso-eod-research-writer', workflow)
        self.assertIn('missing-history-plan.mjs', workflow)
        self.assertIn('turso_history_sessions.py', workflow)
        self.assertNotIn('D1_DATABASE_ID', workflow)
        self.assertNotIn('include_indicators', workflow)


if __name__ == '__main__':
    unittest.main()

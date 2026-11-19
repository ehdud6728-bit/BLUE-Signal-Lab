"""The opt-in daily scanner must not wake D1 or silently write Turso."""
from datetime import date
from pathlib import Path
import unittest

from scripts.turso_research_day_guard import select_research_day


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/blue_turso_daily_research.yml'


class TursoDailyResearchWorkflowTests(unittest.TestCase):
    def test_exact_day_and_rolling_source_years(self):
        today = date(2026, 11, 19)
        self.assertEqual(select_research_day('', 'dry_run', 'workflow_dispatch', '', today=today), {
            'TRADE_DAY': '2026-11-19', 'RESEARCH_YEARS': '2025,2026',
            'RESEARCH_MODE': 'dry_run'})
        self.assertEqual(select_research_day('2027-01-04', 'dry_run',
            'workflow_dispatch', '', today=date(2027, 1, 5))['RESEARCH_YEARS'], '2026,2027')

    def test_manual_apply_requires_exact_confirmation(self):
        for confirmation in ('', 'yes', 'blue-turso-research', ' blue-turso-research-only'):
            with self.assertRaisesRegex(ValueError, 'RESEARCH_APPLY_CONFIRMATION_REQUIRED'):
                select_research_day('2026-11-18', 'apply', 'workflow_dispatch',
                                    confirmation, today=date(2026, 11, 19))
        self.assertEqual(select_research_day('2026-11-18', 'apply',
            'workflow_dispatch', 'blue-turso-research-only',
            today=date(2026, 11, 19))['TRADE_DAY'], '2026-11-18')

    def test_rejects_future_weekends_and_invalid_dates(self):
        for day in ('2026-11-20', '2026-11-21', '2026-11-31', 'latest', '../2026-11-18'):
            with self.assertRaises(ValueError):
                select_research_day(day, 'dry_run', 'workflow_dispatch', '',
                                    today=date(2026, 11, 19))

    def test_schedule_cannot_provide_manual_mode_or_date(self):
        with self.assertRaisesRegex(ValueError, 'INVALID_SCHEDULED_RESEARCH_INPUTS'):
            select_research_day('2026-11-18', 'apply', 'schedule', '',
                                today=date(2026, 11, 19))
        with self.assertRaisesRegex(ValueError, 'INVALID_SCHEDULED_RESEARCH_INPUTS'):
            select_research_day('', 'dry_run', 'schedule', '', today=date(2026, 11, 19))
        self.assertEqual(select_research_day('', 'apply', 'schedule', '',
            today=date(2026, 11, 19))['TRADE_DAY'], '2026-11-19')

    def test_workflow_is_no_d1_opt_in_and_precisely_guarded(self):
        workflow = WORKFLOW.read_text(encoding='utf-8')
        self.assertIn("vars.BLUE_TURSO_RESEARCH_AUTO_ENABLED == 'true'", workflow)
        self.assertIn('default: dry_run', workflow)
        self.assertIn('github.event_name == \'schedule\' && \'apply\'', workflow)
        self.assertIn('blue-turso-research-only', workflow)
        self.assertIn('python3 scripts/turso_research_day_guard.py', workflow)
        self.assertIn('--date "$TRADE_DAY"', workflow)
        self.assertIn('audit[\'asof\'] == os.environ[\'TRADE_DAY\']', workflow)
        self.assertIn('blue_eod', (ROOT/'tools/turso/signal-snapshot-import.mjs').read_text())
        self.assertIn("if: ${{ env.RESEARCH_MODE == 'apply' }}", workflow)
        self.assertIn('--mode=dry_run', workflow)
        self.assertIn('--mode=apply', workflow)
        for forbidden in ('wrangler d1', 'env.DB', '--mode=issue', 'tokenP(',
                          'publish_to_d1:', 'CLOUDFLARE_API_TOKEN'):
            self.assertNotIn(forbidden, workflow)


if __name__ == '__main__':
    unittest.main()

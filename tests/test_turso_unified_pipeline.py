"""No secrets, DB, token issuance or network: one daily EOD+research contract."""
from datetime import date, datetime, timezone
from pathlib import Path
import unittest

from scripts.turso_unified_day_guard import CONFIRM, select_pipeline_day, use_global_scope


SCHEDULE_NOW = datetime(2026, 11, 19, 13, 20, tzinfo=timezone.utc)

ROOT = Path(__file__).resolve().parents[1]
EOD = ROOT / '.github/workflows/blue_turso_daily_verified_eod_auto.yml'
RESEARCH = ROOT / '.github/workflows/blue_turso_daily_research.yml'


class TursoUnifiedPipelineTests(unittest.TestCase):
    def test_manual_dry_run_combines_both_sources(self):
        result = select_pipeline_day('2026-11-19', 'dry_run', 'workflow_dispatch', '',
                                     today=date(2026, 11, 19))
        self.assertEqual(result, {'TRADE_DAY': '2026-11-19',
                                  'RESEARCH_YEARS': '2025,2026', 'RUN_RESEARCH': 'true',
                                  'RUN_INDICATORS': 'false'})

    def test_global_scope_forward_cutover_preserves_historical_writes(self):
        for day, mode, expected in (('2026-11-27','dry_run',True),
                                    ('2026-11-27','apply',False),
                                    ('2026-11-30','apply',True),
                                    ('2027-01-04','apply',True)):
            with self.subTest(day=day, mode=mode):
                self.assertIs(use_global_scope(day,mode),expected)
        with self.assertRaises(ValueError):
            use_global_scope('2026-11-30','auto')
        eod=EOD.read_text(encoding='utf8')
        self.assertIn('if [[ "$DAILY_GLOBAL_SCOPE" == "true" ]]',eod)
        self.assertIn("if os.environ['DAILY_GLOBAL_SCOPE'] == 'true':",eod)

    def test_manual_apply_requires_exact_confirmation(self):
        for text in ('', 'yes', 'blue-turso-research-only', f'{CONFIRM} '):
            with self.assertRaisesRegex(ValueError, 'UNIFIED_APPLY_CONFIRMATION_REQUIRED'):
                select_pipeline_day('2026-11-19', 'apply', 'workflow_dispatch', text,
                                    today=date(2026, 11, 19))
        self.assertEqual(select_pipeline_day('2026-11-19', 'apply', 'workflow_dispatch',
                         CONFIRM, today=date(2026, 11, 19))['RUN_RESEARCH'], 'true')

    def test_schedule_writes_only_audited_eod_until_research_opt_in(self):
        disabled = select_pipeline_day('', 'apply', 'schedule', '',
                                       now=SCHEDULE_NOW)
        enabled = select_pipeline_day('', 'apply', 'schedule', '', auto_research='true',
                                      now=SCHEDULE_NOW)
        self.assertEqual(disabled['RUN_RESEARCH'], 'false')
        self.assertEqual(enabled['RUN_RESEARCH'], 'true')
        self.assertEqual(enabled['RUN_INDICATORS'], 'false')
        self.assertEqual(enabled['TRADE_DAY'], '2026-11-19')
        for args in [('2026-11-18', 'apply', 'schedule', ''),
                     ('', 'dry_run', 'schedule', ''),
                     ('', 'apply', 'schedule', CONFIRM)]:
            with self.assertRaisesRegex(ValueError, 'INVALID_UNIFIED_SCHEDULE_INPUTS'):
                select_pipeline_day(*args, now=SCHEDULE_NOW)

    def test_delayed_schedule_selects_most_recent_elapsed_weekday_slot(self):
        for utc, expected in (
            ('2026-11-24T23:06:30+00:00', '2026-11-24'),
            ('2026-11-25T13:19:59+00:00', '2026-11-24'),
            ('2026-11-25T13:20:00+00:00', '2026-11-25'),
            ('2026-11-27T23:10:00+00:00', '2026-11-27'),
            ('2026-11-30T01:00:00+00:00', '2026-11-27'),
            ('2027-01-01T00:00:00+00:00', '2026-12-31'),
        ):
            with self.subTest(utc=utc):
                result = select_pipeline_day('', 'apply', 'schedule', '',
                                             now=datetime.fromisoformat(utc))
                self.assertEqual(result['TRADE_DAY'], expected)
        # An explicitly requested manual date is not reinterpreted by cron policy.
        result = select_pipeline_day('2026-11-25', 'dry_run', 'workflow_dispatch', '',
                                     now=datetime.fromisoformat('2026-11-25T01:00:00+00:00'))
        self.assertEqual(result['TRADE_DAY'], '2026-11-25')

    def test_no_date_substitution_or_invalid_calendar(self):
        for day in ('2026-11-20', '2026-11-21', '2026-11-31', 'latest', '../../2026-11-18'):
            with self.assertRaises(ValueError):
                select_pipeline_day(day, 'dry_run', 'workflow_dispatch', '',
                                    today=date(2026, 11, 19))
        self.assertEqual(select_pipeline_day('2027-01-04', 'dry_run', 'workflow_dispatch',
                         '', today=date(2027, 1, 5))['RESEARCH_YEARS'], '2026,2027')

    def test_all_market_indicators_are_separately_opt_in(self):
        manual = select_pipeline_day('2026-11-19', 'apply', 'workflow_dispatch',
                                     CONFIRM, include_indicators='true', today=date(2026, 11, 19))
        self.assertEqual(manual['RUN_INDICATORS'], 'true')
        off = select_pipeline_day('', 'apply', 'schedule', '', auto_indicators='true',
                                  now=SCHEDULE_NOW)
        self.assertEqual(off['RUN_INDICATORS'], 'false')
        on = select_pipeline_day('', 'apply', 'schedule', '', auto_research='true',
                                 auto_indicators='true', now=SCHEDULE_NOW)
        self.assertEqual(on['RUN_INDICATORS'], 'true')

    def test_one_schedule_has_ordered_eod_and_research_with_bounded_kis_secondary(self):
        eod = EOD.read_text(encoding='utf-8')
        research = RESEARCH.read_text(encoding='utf-8')
        self.assertIn("cron: '20 13 * * 1-5'", eod)
        self.assertNotIn('  schedule:', research)
        self.assertIn('group: blue-turso-eod-research-writer', eod)
        self.assertIn('group: blue-turso-eod-research-writer', research)
        self.assertIn('python3 scripts/turso_unified_day_guard.py', eod)
        self.assertIn('vars.BLUE_TURSO_RESEARCH_AUTO_ENABLED', eod)
        self.assertIn('vars.BLUE_TURSO_ALL_INDICATORS_AUTO_ENABLED', eod)
        self.assertIn('default: false', eod)
        krx_success = "steps.krx_fetch.outcome == 'success' && "
        self.assertIn("if: ${{ " + krx_success +
                      "env.RUN_INDICATORS == 'true' && env.MODE == 'apply' }}", eod)
        self.assertIn('--turso-indicators-out', eod)
        self.assertIn("if: ${{ " + krx_success +
                      "env.RUN_RESEARCH == 'true' && env.MODE == 'apply' }}", eod)
        self.assertIn("if: ${{ " + krx_success + "env.MODE == 'apply' }}", eod)
        self.assertIn("id: krx_fetch\n        continue-on-error: true", eod)
        self.assertIn("if: ${{ always() && steps.krx_fetch.outcome == 'failure' }}", eod)
        self.assertIn('krx-kis-fallback-collect.mjs --mode=apply --day="$TRADE_DAY"', eod)
        self.assertIn("if: ${{ steps.krx_fetch.outcome == 'failure' && env.MODE == 'apply' }}", eod)
        self.assertIn('node tools/turso/provisional-fallback-gate.mjs --day="$TRADE_DAY"', eod)
        self.assertIn('if: ${{ steps.krx_fetch.outcome == \'success\' }}', eod)
        self.assertIn('--start "$TRADE_DAY" --end "$TRADE_DAY"', eod)
        self.assertIn('--date "$TRADE_DAY" --years "$RESEARCH_YEARS"', eod)
        self.assertIn('--reuse-target-eod-dir output/turso_daily_eod', eod)
        self.assertIn('--scan-workers 2 --scan-chunk-size 500', eod)
        self.assertIn("test_turso_parallel_pattern_scan.py", eod)
        self.assertIn("audit['asof'] == os.environ['TRADE_DAY']", eod)
        self.assertLess(eod.index('node tools/turso/eod-range-import.mjs --mode=apply'),
                        eod.index('python scripts/market_scan_r11.py'))
        self.assertLess(eod.index('python scripts/market_scan_r11.py'),
                        eod.index('node tools/turso/signal-snapshot-import.mjs',
                                  eod.index('python scripts/market_scan_r11.py')))
        self.assertIn('source_payload_sha256',
                      (ROOT / 'tools/turso/signal-snapshot-import.mjs').read_text())
        gate = (ROOT / 'tools/turso/provisional-fallback-gate.mjs').read_text()
        for required in ('blue_kis_provisional_daily_v1', 'blue_eod_ingest_audit_v1',
                         'KIS_PROVISIONAL_NOT_AVAILABLE'):
            self.assertIn(required, gate)
        for forbidden in ('tokenP(', 'getKisDailyQuote(', 'client.batch(',
                          'INSERT INTO', 'UPDATE blue_eod'):
            self.assertNotIn(forbidden, gate)
        for forbidden in ('wrangler d1', 'env.DB', '--mode=issue', 'tokenP(',
                          'CLOUDFLARE_API_TOKEN', 'FULL_MIRROR'):
            self.assertNotIn(forbidden, eod)


if __name__ == '__main__':
    unittest.main()

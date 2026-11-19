"""Static checks for production mirror rollout guardrails; no cloud credentials."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MirrorRolloutSafety(unittest.TestCase):
    def test_full_mirror_is_off_for_turso_primary_transition(self):
        config = json.loads((ROOT / 'collector/wrangler.jsonc').read_text())
        self.assertEqual(config['vars']['TURSO_MIRROR_ENABLED'], 'false')
        self.assertNotIn('TURSO_DIRECT_QUOTES_ENABLED', config['vars'])
        self.assertNotIn('TURSO_INSTANT_QUOTES_ENABLED', config['vars'])
        workflow = (ROOT / '.github/workflows/blue_r142_collector_deploy.yml').read_text()
        self.assertIn('workflow_dispatch:', workflow)
        self.assertNotIn('schedule:', workflow)
        self.assertIn('default: false', workflow)
        self.assertIn('confirm_full_mirror:', workflow)
        self.assertIn('confirm_mirror_off:', workflow)
        self.assertIn("blue-turso-full-mirror", workflow)
        self.assertIn("blue-turso-mirror-off", workflow)
        self.assertIn('FULL_MIRROR_DEPLOY_BLOCKED', workflow)
        self.assertIn('MIRROR_OFF_DEPLOY_BLOCKED', workflow)
        # The Collector suite imports tools/turso/kis-token-steward.mjs;
        # a clean Actions runner must install that package's @libsql/client.
        self.assertIn('working-directory: tools/turso', workflow)
        self.assertIn('npm install --no-package-lock --no-audit --no-fund --ignore-scripts', workflow)
        self.assertLess(workflow.index('Install Turso test dependencies'),
                        workflow.index('Install and run collector tests'))
        self.assertLess(workflow.index('FULL_MIRROR_DEPLOY_BLOCKED'),
                        workflow.index('npx wrangler deploy'))
        self.assertLess(workflow.index('MIRROR_OFF_DEPLOY_BLOCKED'),
                        workflow.index('npx wrangler deploy'))
        # Keep the future explicit full-mirror approval gate, even with OFF default.
        self.assertIn('"TURSO_MIRROR_ENABLED"', workflow)

    def test_emergency_pause_overrides_full_mode(self):
        mirror = (ROOT / 'collector/src/turso-mirror.mjs').read_text()
        self.assertLess(mirror.index('TURSO_MIRROR_PAUSED'),
                        mirror.index("TURSO_MIRROR_ENABLED || 'false'"))
        emergency = (ROOT / '.github/workflows/blue_turso_mirror_emergency.yml').read_text()
        self.assertIn('default: dry_run', emergency)
        self.assertIn('blue-market-collector', emergency)
        self.assertIn('blue-turso-mirror-resume', emergency)
        self.assertIn('secret put TURSO_MIRROR_PAUSED', emergency)
        self.assertNotIn('tokenP', emergency.replace('no KIS tokenP', ''))

    def test_parity_audit_requires_explicit_small_d1_read(self):
        workflow = (ROOT / '.github/workflows/blue_turso_quote_parity_audit.yml').read_text()
        script = (ROOT / 'tools/turso/quote-parity-audit.mjs').read_text()
        self.assertIn('default: turso_only', workflow)
        self.assertIn('compare_small', workflow)
        self.assertIn('blue-d1-bounded-read', script)
        self.assertIn('const MAX_SAMPLE=6', script)
        self.assertNotIn('INSERT INTO', script)
        self.assertNotIn('tokenP', workflow)


if __name__ == '__main__':
    unittest.main()

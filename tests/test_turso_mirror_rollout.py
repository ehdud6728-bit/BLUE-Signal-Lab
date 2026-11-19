"""Static checks for production mirror rollout guardrails; no cloud credentials."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class MirrorRolloutSafety(unittest.TestCase):
    def test_full_mirror_is_deploy_candidate_only(self):
        config = json.loads((ROOT / 'collector/wrangler.jsonc').read_text())
        self.assertEqual(config['vars']['TURSO_MIRROR_ENABLED'], 'true')
        workflow = (ROOT / '.github/workflows/blue_r142_collector_deploy.yml').read_text()
        self.assertIn('workflow_dispatch:', workflow)
        self.assertNotIn('schedule:', workflow)
        self.assertIn('default: false', workflow)
        self.assertIn('confirm_full_mirror:', workflow)
        self.assertIn("blue-turso-full-mirror", workflow)
        self.assertIn('FULL_MIRROR_DEPLOY_BLOCKED', workflow)
        self.assertLess(workflow.index('FULL_MIRROR_DEPLOY_BLOCKED'),
                        workflow.index('npx wrangler deploy'))

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

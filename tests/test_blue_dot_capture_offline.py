"""Offline static capture form contract: only user values, no data fabrication."""
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

PAGE = Path('research/kiwoom_blue_dot_capture_offline.html')


def read_form():
    source = PAGE.read_text(encoding='utf-8')
    match = re.search(
        r'<script type="application/json" id="pinned-models">\s*(.*?)\s*</script>',
        source, re.DOTALL
    )
    if not match:
        raise ValueError('PINNED_MODEL_JSON_MISSING')
    return source, json.loads(match.group(1))


class BrokerCaptureStaticTest(unittest.TestCase):
    def test_no_network_or_automatic_model_as_broker_input(self):
        source, models = read_form()
        self.assertIn('연구 전용', source)
        self.assertIn('실측 아님', source)
        self.assertNotRegex(source, r'(?i)<script[^>]+src\s*=')
        self.assertNotRegex(source, r'(?i)\bfetch\s*\(')
        self.assertNotRegex(source, r'(?i)XMLHttpRequest|WebSocket')
        self.assertNotRegex(source, r'(?i)<iframe\b')
        self.assertEqual(set(models), {'352820', '071850'})
        self.assertIn('var values = JSON.parse(JSON.stringify(BASE));', source)
        self.assertNotIn('values[key]=MODELS', source)

    def test_requested_dates_and_all_four_model_hypotheses(self):
        _, models = read_form()
        expected = [
            '2026-11-05', '2026-11-06', '2026-11-09',
            '2026-11-10', '2026-11-11', '2026-11-12',
        ]
        names = {
            'HLC3_LOWER_PRIMARY_UNVERIFIED', 'CLOSE_LOWER_ALTERNATIVE',
            'HLC3_UPPER_ALTERNATIVE', 'CLOSE_UPPER_ALTERNATIVE',
        }
        for code in models:
            self.assertEqual(models[code]['dates'], expected)
            self.assertEqual(set(models[code]['models']), names)
            self.assertTrue(all(len(v) == 6 for v in models[code]['models'].values()))
        self.assertAlmostEqual(
            models['352820']['models']['HLC3_LOWER_PRIMARY_UNVERIFIED'][-1],
            152862.20516, places=5
        )
        self.assertAlmostEqual(
            models['071850']['models']['HLC3_LOWER_PRIMARY_UNVERIFIED'][-1],
            1191.56892, places=5
        )

    def test_only_known_hybe_manual_screenshot_prefilled(self):
        source, _ = read_form()
        self.assertIn('"352820|2026-11-12"', source)
        self.assertIn('line_value_krw: 153078.28', source)
        self.assertIn('source: "USER_PROVIDED_KIWOOM_MTS_SCREENSHOT"', source)
        self.assertIn('market_session: "UNKNOWN"', source)
        self.assertIn('adjusted_prices: null', source)
        self.assertIn('source:"USER_REPORTED_KIWOOM_INDICATOR"', source)
        self.assertIn('schema:"USER_KIWOOM_BLUE_DOTTED_30_2_26_VALUES_V1"', source)
        self.assertIn('visual_target:"THICK_BLUE_DOTTED_LINE"', source)

    @unittest.skipUnless(shutil.which('node'), 'Node.js not installed')
    def test_embedded_javascript_syntax(self):
        source, _ = read_form()
        scripts = re.findall(r'<script(?:\s[^>]*)?>(.*?)</script>', source, re.DOTALL)
        self.assertEqual(len(scripts), 2)
        with tempfile.TemporaryDirectory() as tmp:
            js = Path(tmp) / 'offline_capture_check.js'
            js.write_text(scripts[-1], encoding='utf-8')
            completed = subprocess.run(
                [shutil.which('node'), '--check', str(js)],
                capture_output=True, text=True, timeout=10
            )
        self.assertEqual(completed.returncode, 0, completed.stderr)


if __name__ == '__main__':
    unittest.main()

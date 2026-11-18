"""Regression checks for the opt-in Turso EOD directory workflow mode."""

import unittest
from pathlib import Path


WORKFLOW = (
    Path(__file__).resolve().parents[1]
    / ".github/workflows/blue_market_scan_research_only.yml"
)


class TursoEodWorkflowModeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")

    def test_off_default_and_options_are_explicit_strings(self):
        mode_block = self.workflow.split("      turso_directory_mode:", 1)[1].split(
            "\npermissions:", 1
        )[0]
        self.assertRegex(mode_block, r"(?m)^\s+default: ['\"]off['\"]$")
        self.assertRegex(mode_block, r"(?m)^\s+- ['\"]off['\"]$")
        self.assertRegex(mode_block, r"(?m)^\s+- ['\"]dry_run['\"]$")
        self.assertRegex(mode_block, r"(?m)^\s+- ['\"]apply_12['\"]$")
        self.assertRegex(mode_block, r"(?m)^\s+- ['\"]apply_all['\"]$")

    def test_optional_steps_only_run_for_allowlisted_modes(self):
        condition = (
            "if: ${{ inputs.turso_directory_mode == 'dry_run' || "
            "inputs.turso_directory_mode == 'apply_12' || "
            "inputs.turso_directory_mode == 'apply_all' }}"
        )
        self.assertEqual(self.workflow.count(condition), 3)
        self.assertNotIn("inputs.turso_directory_mode != 'off'", self.workflow)

    def test_full_name_backfill_blocks_any_d1_publication(self):
        self.assertIn("if: ${{ inputs.turso_directory_mode == 'apply_all' }}", self.workflow)
        self.assertIn("if [[ \"$PUBLISH_ALL\" != 'false' || \"$PUBLISH_SYMBOL\" != 'false' ]]", self.workflow)

    def test_mode_is_passed_to_pilot_without_implicit_fallback(self):
        self.assertIn("TURSO_EOD_MODE: ${{ inputs.turso_directory_mode }}", self.workflow)
        self.assertIn('node tools/turso/eod-directory-pilot.mjs --mode="$TURSO_EOD_MODE"', self.workflow)


if __name__ == "__main__":
    unittest.main()

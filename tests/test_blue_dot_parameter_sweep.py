import contextlib
import io
import json
import sys
import unittest
from unittest import mock

import pandas as pd

from scripts.blue_dot_parameter_sweep import (
    BASELINES, build_tuning_signals, candidate_definitions, compact_report,
    contiguous_lookback, frozen_parameters, main,
)
from tests.test_env20_rebound_comparison import fixture


class BlueDotParameterSweepTest(unittest.TestCase):
    def test_only_one_parameter_changes_from_an_original_setting(self):
        triples = frozen_parameters()
        self.assertEqual(len(triples), 16)
        for triple in triples:
            self.assertTrue(any(sum(a != b for a, b in zip(triple, baseline)) <= 1
                                for baseline in BASELINES))
        specs = candidate_definitions()
        self.assertEqual(len(specs), 64)
        self.assertEqual(len({s['flag'] for s in specs}), 64)
        self.assertEqual(set(s['basis'] for s in specs), {'close', 'hlc3'})
        self.assertEqual(set(s['cross'] for s in specs), {'strict', 'geometry'})

    def test_signed_shift_and_missing_issuer_bar_are_not_forward_filled(self):
        session = pd.Series([0, 1, 2, 4, 5, 6, 7, 8])
        code = pd.Series(['000001']*8)
        self.assertEqual(contiguous_lookback(session, code, 2).tolist(),
                         [False, False, True, False, False, True, True, True])
        # The missing session 3 also invalidates windows which cross the gap.
        self.assertFalse(bool(contiguous_lookback(session, code, 4).iloc[6]))

    def test_broker_formula_baseline_matches_existing_close_scanner_on_full_bars(self):
        raw, sessions = fixture()
        actual, dates, defs = build_tuning_signals(raw)
        self.assertEqual(len(dates), len(sessions))
        for n in (20, 30):
            strict = f'T_C_{n}_20_26_S'
            geometry = f'T_C_{n}_20_26_G'
            self.assertIn('SHIFT(BBandsUp', defs[strict])
            self.assertEqual(actual[strict].tolist(), actual[f'U{n}'].tolist())
            self.assertTrue((~actual[strict] | actual[geometry]).all())

    def test_new_ticker_gap_prevents_stale_shifted_line_signal(self):
        raw, _ = fixture()
        # Every roll used for this cross must cover n+shift+1 consecutive
        # exchange sessions, even when there are already 250+ issuer bars.
        raw = raw[~((raw.Code == '000001') &
                    (raw.Date == pd.Timestamp('2025-12-02')))]
        d, _, _ = build_tuning_signals(raw, min_history=220)
        code = d[d.code == '000001'].reset_index(drop=True)
        idx = int(code[code.date == pd.Timestamp('2025-12-03')].index[0])
        self.assertFalse(bool(contiguous_lookback(
            code.session_index, code.code, 46).iloc[idx]))

    def test_future_prices_cannot_change_past_signal_flags(self):
        raw, days = fixture()
        before, _, _ = build_tuning_signals(raw)
        revised = raw.copy()
        # Even a huge revision at a future session cannot alter past lines.
        revised.loc[revised.Date.eq(days[-1]), ['Open', 'High', 'Low', 'Close']] = \
            [70, 140, 65, 130]
        after, _, _ = build_tuning_signals(revised)
        flags = [s['flag'] for s in candidate_definitions()]
        pd.testing.assert_frame_equal(
            before.loc[before.date.lt(days[-1]), flags].reset_index(drop=True),
            after.loc[after.date.lt(days[-1]), flags].reset_index(drop=True))

    def test_offline_plan_does_not_read_market(self):
        output = io.StringIO()
        with mock.patch('scripts.blue_dot_parameter_sweep.load_marcap',
                        side_effect=AssertionError('market must not load')):
            with mock.patch.object(sys, 'argv', ['sweep', '--mode=plan']):
                with contextlib.redirect_stdout(output):
                    main()
        self.assertIn('"candidate_count": 64', output.getvalue())
        self.assertIn('no_market_download_no_secrets_no_db_no_trades',
                      output.getvalue())

    def test_final_report_never_promotes_candidates(self):
        specs = candidate_definitions()
        dummy = {'schema': 'OLD', 'results': [], 'pattern_definitions': {}}
        result = compact_report(dummy, specs)
        self.assertIsNone(result.get('selected_rule'))
        self.assertFalse(result['automated_best_candidate_selection'])
        self.assertFalse(result['broker_numeric_line_parity_verified'])
        self.assertFalse(result['new_rule_or_gold_or_alert_or_trade_allowed'])
        self.assertTrue(result['previously_inspected_2026_holdout_not_pristine'])
        self.assertTrue(result['grid_designed_after_prior_baseline_results_were_seen'])
        json.dumps(result)


if __name__ == '__main__':
    unittest.main()

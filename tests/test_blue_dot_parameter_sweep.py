import contextlib
import io
import json
import sys
import unittest
from unittest import mock

import pandas as pd

from scripts.blue_dot_parameter_sweep import (
    BASELINES, CHART_CHECK_FLAGS, build_tuning_signals, candidate_definitions,
    chart_check_dossier, compact_report,
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

    def test_chart_dossier_uses_actual_prior_hlc3_line_and_rejects_false_signals(self):
        # Controlled downward HLC3 history followed by a candle crossing the
        # shifted historical upper line. No real broker values are injected.
        days = pd.bdate_range('2026-07-01', periods=100)
        price = [160-i for i in range(100)]
        data = pd.DataFrame({
            'date': days, 'code': ['000001']*100,
            'Name': ['시험종목']*100, 'session_index': list(range(100)),
            'open': price, 'high': price, 'low': price, 'close': price,
            'prior_close': [float('nan'), *price[:-1]],
        })
        data.loc[70, ['open', 'high', 'low', 'close']] = [90, 145, 90, 145]
        for flag in CHART_CHECK_FLAGS:
            data[flag] = False
        flag = 'T_H_20_20_26_G'
        data.loc[70, flag] = True
        sample = {'code': '000001', 'signal_day': days[70].strftime('%Y-%m-%d'),
                  'stock_name_at_signal': '시험종목', 'first_touch_type': 'STOP_GAP',
                  'assumed_net_return_pct': -12.3}
        patterns = {f: {k: [] for _, k in (
            ('take', 'holdout_latest_first_take_examples'),
            ('stop', 'holdout_latest_first_stop_examples'),
            ('gap', 'holdout_latest_stop_gap_examples'),
            ('severe', 'holdout_latest_severe_loss_examples'))}
            for f in CHART_CHECK_FLAGS}
        patterns[flag]['holdout_latest_stop_gap_examples'] = [sample]
        patterns[flag]['holdout_latest_severe_loss_examples'] = [sample]
        full = {'results': [{'observation_sessions_not_forced_holding': 5,
                            'take_profit_pct': 2.5, 'stop_loss_pct': 4.5,
                            'patterns': patterns}]}
        result = chart_check_dossier(full, data, candidate_definitions())
        gap = result['cases_by_flag'][flag]['categories']['stop_gap'][0]
        self.assertTrue(gap['model_line_cross_classification']['geometry_cross'])
        self.assertLess(gap['model_line_krw_signal_day'],
                        gap['model_line_krw_prior_day'])
        self.assertEqual(gap['source_ohlc_krw_on_signal_day']['close'], 145)
        self.assertFalse(result['broker_numeric_line_parity_verified'])
        self.assertEqual(result['confirmed_broker_signal_examples'], [])
        self.assertEqual(result['cases_by_flag'][flag]['categories']['severe_loss'], [gap])
        dispute = {'disputes': [{'code': '000001',
                    'model_signal_day': sample['signal_day'],
                    'user_reported_chart_signal_day': None,
                    'verdict': 'USER_REPORTS_NO_BLUE_DOTTED_LINE_CROSS'}]}
        disputed = chart_check_dossier(full, data, candidate_definitions(),
                                       chart_disputes=dispute)
        disputed_case = (disputed['cases_by_flag'][flag]['categories']['stop_gap'][0])
        self.assertEqual(disputed_case['chart_validation_status'],
                         'USER_DISPUTED_MODEL_SIGNAL')
        self.assertFalse(disputed_case['broker_signal_verified'])
        self.assertEqual(disputed_case['user_chart_dispute']['verdict'],
                         'USER_REPORTS_NO_BLUE_DOTTED_LINE_CROSS')
        data.loc[70, flag] = False
        with self.assertRaisesRegex(ValueError, 'SAMPLE_NOT_A_VALID_SIGNAL'):
            chart_check_dossier(full, data, candidate_definitions())


if __name__ == '__main__':
    unittest.main()

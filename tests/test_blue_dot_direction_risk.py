import contextlib
import io
import json
import sys
import unittest
from unittest import mock

import pandas as pd

from scripts.blue_dot_direction_risk import (
    annotate_chart_examples, build_direction_signals, compact_risk_report,
    flags_and_specs, main,
)


def fixture(*, descending=False):
    dates = pd.bdate_range(end='2026-10-23', periods=200)
    rows = []
    for i, date in enumerate(dates):
        price = 2200-3*i if descending else 1500
        op, close = price, price
        if date == pd.Timestamp('2026-10-22'):
            op, close = (1600, 2200) if descending else (1400, 1600)
        rows.append({'Date': date, 'Code': '013810', 'Name': '스페코',
                     'Market': 'KOSDAQ', 'Open': op,
                     'High': max(op, close), 'Low': min(op, close),
                     'Close': close, 'Volume': 10000, 'Amount': 10000000})
    return pd.DataFrame(rows)


class BlueDotDirectionRiskTest(unittest.TestCase):
    def test_24_explicit_period_basis_band_direction_cohorts(self):
        specs = flags_and_specs()
        self.assertEqual(len(specs), 24)
        self.assertEqual(len({x['flag'] for x in specs}), 24)
        self.assertEqual({x['period'] for x in specs}, {20, 30, 40})
        self.assertEqual({x['basis'] for x in specs}, {'close', 'hlc3'})
        self.assertEqual({x['band'] for x in specs}, {'upper', 'lower'})
        self.assertEqual({x['direction'] for x in specs},
                         {'A_FALLING', 'B_NONFALLING'})

    def test_flat_and_falling_lines_are_mutually_exclusive(self):
        for descending in (False, True):
            d, _, specs, _ = build_direction_signals(
                fixture(descending=descending), min_history=70)
            row = d[d.date.eq(pd.Timestamp('2026-10-22'))].iloc[0]
            for s in specs:
                self.assertEqual(bool(row[s['flag']]),
                                 (s['direction'] == ('A_FALLING' if descending
                                                     else 'B_NONFALLING')))
            for name in {s['flag'][:-1] for s in specs}:
                self.assertFalse(bool(row[name+'A'] and row[name+'B']))

    def test_missing_issuer_session_prevents_stale_model_signal(self):
        raw = fixture()
        other = raw.copy()
        other['Code'] = '999999'
        raw = pd.concat([raw[~raw.Date.eq(pd.Timestamp('2026-09-30'))], other],
                        ignore_index=True)
        d, _, specs, _ = build_direction_signals(raw, min_history=70)
        row = d[d.code.eq('013810') &
                d.date.eq(pd.Timestamp('2026-10-22'))].iloc[0]
        self.assertTrue(all(not bool(row[s['flag']]) for s in specs))

    def test_future_candle_revisions_do_not_rewrite_past_signals(self):
        raw = fixture(descending=True)
        before, _, specs, _ = build_direction_signals(raw, min_history=70)
        raw.loc[raw.Date.eq(pd.Timestamp('2026-10-23')),
                ['Open', 'High', 'Low', 'Close']] = [500, 3500, 500, 3000]
        after, _, _, _ = build_direction_signals(raw, min_history=70)
        fields = [s['flag'] for s in specs]
        pd.testing.assert_frame_equal(
            before.loc[before.date.lt('2026-10-23'), fields].reset_index(drop=True),
            after.loc[after.date.lt('2026-10-23'), fields].reset_index(drop=True))

    def test_compact_output_does_not_select_trades(self):
        specs = flags_and_specs()
        empty = {'first_take_count': 0, 'first_stop_count': 0,
                 'stop_gap_count': 0,
                 'severe_resolved_net_at_or_below_minus_10pct_count': 0}
        patterns = {s['flag']: {'signal_events': 0, 'exclusions': {},
             'train': empty, 'holdout': empty,
             'holdout_by_market_1d': {}, 'holdout_by_market_5d': {},
             'holdout_latest_first_take_examples': [],
             'holdout_latest_first_stop_examples': [],
             'holdout_latest_stop_gap_examples': [],
             'holdout_latest_severe_loss_examples': []} for s in specs}
        full = {'source': 'PINNED', 'source_2025_2026_hashes': {},
                'study_start': '2026-03-01', 'study_end': '2026-11-19',
                'studied_market_sessions': 178,
                'train_end_before_holdout_start': '2026-09-01',
                'holdout_start': '2026-09-02',
                'results': [{'observation_sessions_not_forced_holding': 5,
                             'take_profit_pct': 2.5, 'stop_loss_pct': 4.5,
                             'patterns': patterns}]}
        report = compact_risk_report(full, specs)
        self.assertEqual(len(report['model_cohorts']), 24)
        self.assertFalse(report['automated_best_candidate_selected'])
        self.assertFalse(report['recommendation_or_production_change_allowed'])
        self.assertEqual(report['broker_confirmed_signal_count'], 0)
        json.dumps(report)

    def test_chart_check_examples_include_prior_and_signal_day_numeric_lines(self):
        d, _, specs, _ = build_direction_signals(fixture(), min_history=70)
        sample = {'code': '013810', 'signal_day': '2026-10-22',
                  'stock_name_at_signal': '스페코'}
        chosen = next(s for s in specs if s['period'] == 40 and
                      s['basis'] == 'hlc3' and s['band'] == 'lower' and
                      s['direction'] == 'B_NONFALLING')
        case = dict(sample)
        report = {'model_cohorts': [{**chosen, 'chart_check_take_examples': [case],
            'chart_check_stop_examples': [], 'chart_check_stop_gap_examples': [],
            'chart_check_severe_loss_examples': []}]}
        annotate_chart_examples(report, d)
        self.assertTrue(case['plain_cross_model_verified'])
        self.assertEqual(case['model_line_direction'], 'nonfalling')
        self.assertEqual(case['model_line_signal_day_krw'], 1500)
        self.assertEqual(case['source_ohlc_krw']['close'], 1600)
        self.assertFalse(case['broker_signal_verified'])
        self.assertEqual(case['chart_validation_status'],
                         'MODEL_ONLY_NOT_KIWOOM_VERIFIED')

    def test_plan_requires_no_market_data(self):
        stdout = io.StringIO()
        with mock.patch('scripts.blue_dot_direction_risk.load_marcap',
                        side_effect=AssertionError('plan should not download')):
            with mock.patch.object(sys, 'argv', ['script', '--mode=plan']):
                with contextlib.redirect_stdout(stdout):
                    main()
        self.assertIn('"cohorts": 24', stdout.getvalue())
        self.assertIn('"no_download_no_db_no_orders": true', stdout.getvalue())



    def test_falling_three_and_five_moves_nested(self):
        from scripts.blue_dot_direction_risk import falling_streak_flags
        d, _, _, _ = build_direction_signals(
            fixture(descending=True), min_history=70)
        specs, definitions, _ = falling_streak_flags(d)
        self.assertEqual(len(specs), 24)
        self.assertEqual(len(definitions), 24)
        row = d[d.date.eq(pd.Timestamp('2026-10-22'))].iloc[0]
        for s in specs:
            self.assertTrue(bool(row[s['flag']]))
        for s in specs:
            if s['falling_moves'] != 5:
                continue
            flag3 = s['flag'].replace('_5D', '_3D')
            self.assertFalse(bool((d[s['flag']] & ~d[flag3]).any()))

    def test_flat_line_does_not_count_as_falling(self):
        from scripts.blue_dot_direction_risk import falling_streak_flags
        d, _, _, _ = build_direction_signals(fixture(), min_history=70)
        specs, _, _ = falling_streak_flags(d)
        self.assertFalse(d[[s['flag'] for s in specs]].any().any())

    def test_falling_future_data_cannot_change_past(self):
        from scripts.blue_dot_direction_risk import falling_streak_flags
        raw = fixture(descending=True)
        base, _, _, _ = build_direction_signals(raw,min_history=70)
        specs, _, _=falling_streak_flags(base)
        raw.loc[raw.Date.eq(pd.Timestamp('2026-10-23')),
                ['Open','High','Low','Close']] = [500,3500,500,3000]
        changed, _, _, _=build_direction_signals(raw,min_history=70)
        falling_streak_flags(changed)
        names=[s['flag'] for s in specs]
        pd.testing.assert_frame_equal(
            base.loc[base.date.lt('2026-10-23'),names].reset_index(drop=True),
            changed.loc[changed.date.lt('2026-10-23'),names].reset_index(drop=True))

    def test_falling_missing_market_session_rejected(self):
        from scripts.blue_dot_direction_risk import falling_streak_flags
        raw=fixture(descending=True)
        # Keep the full market calendar via another issuer. Otherwise the
        # missing date would disappear globally and could not be detected.
        other=raw.copy()
        other['Code']='999999'
        raw=pd.concat([raw[raw.Date.ne(pd.Timestamp('2026-10-21'))],other],
                      ignore_index=True)
        d,_,_,_=build_direction_signals(raw,min_history=70)
        specs,_,_=falling_streak_flags(d)
        row=d[(d.code.eq('013810')) &
              d.date.eq(pd.Timestamp('2026-10-22'))].iloc[0]
        self.assertFalse(any(bool(row[s['flag']]) for s in specs))

    def test_audit_references_fixed_9_old_failure_cases(self):
        from scripts.blue_dot_direction_risk import PREVIOUS_MODEL_STOP_AUDIT
        self.assertEqual(len(PREVIOUS_MODEL_STOP_AUDIT),9)
        self.assertEqual({row[2] for row in PREVIOUS_MODEL_STOP_AUDIT},{20,30,40})


    def test_full_strict_streak_audit_uses_actual_one_day_flag_and_dates(self):
        """The full report path previously failed only after heavy evaluation."""
        from scripts.blue_dot_direction_risk import (
            strict_falling_report, falling_streak_flags,
        )
        d, sessions, _, _ = build_direction_signals(
            fixture(descending=True), min_history=70)
        specs, _, _ = falling_streak_flags(d)
        bare = {
            'signal_events': 1,
            'train': {}, 'holdout': {},
            'holdout_latest_first_stop_examples': [],
            'holdout_latest_first_take_examples': [],
            'holdout_latest_stop_gap_examples': [],
        }
        synthetic = {
            'results': [{'patterns': {s['flag']: dict(bare) for s in specs}}],
            'source_2025_2026_hashes': {},
        }
        observed = (
            ('013810', '2026-10-22', 20, '스페코'),
        )
        with mock.patch('scripts.blue_dot_direction_risk.evaluate',
                        return_value=synthetic):
            with mock.patch('scripts.blue_dot_direction_risk.'
                            'PREVIOUS_MODEL_STOP_AUDIT', observed):
                result = strict_falling_report(d, sessions)
        self.assertEqual(len(result['models']), 24)
        entry = result['previous_reported_A_failures_audit'][0]
        self.assertTrue(entry['original_one_day_A_model'])
        self.assertTrue(entry['meets_strict_3_declines'])
        self.assertTrue(entry['meets_strict_5_declines'])
        self.assertEqual(entry['signal_day'], '2026-10-22')
        self.assertEqual(len(entry['trailing_six_modeled_line_values_krw']), 6)
        self.assertFalse(entry['broker_verified'])

    def test_full_strict_streak_report_stop_examples_are_checked_again(self):
        from scripts.blue_dot_direction_risk import (
            strict_falling_report, falling_streak_flags,
        )
        d, sessions, _, _ = build_direction_signals(
            fixture(descending=True), min_history=70)
        specs, _, _ = falling_streak_flags(d)
        selected = next(s for s in specs if
                        s['period'] == 20 and s['basis'] == 'hlc3' and
                        s['band'] == 'lower' and s['falling_moves'] == 5)
        bare = {
            'signal_events': 1,
            'train': {}, 'holdout': {},
            'holdout_latest_first_stop_examples': [],
            'holdout_latest_first_take_examples': [],
            'holdout_latest_stop_gap_examples': [],
        }
        patterns = {s['flag']: dict(bare) for s in specs}
        patterns[selected['flag']]['holdout_latest_first_stop_examples'] = [
            {'code': '013810', 'signal_day': '2026-10-22',
             'first_touch_day': '2026-10-23', 'assumed_net_return_pct': -4.8}
        ]
        synthetic = {
            'results': [{'patterns': patterns}],
            'source_2025_2026_hashes': {},
        }
        with mock.patch('scripts.blue_dot_direction_risk.evaluate',
                        return_value=synthetic):
            with mock.patch('scripts.blue_dot_direction_risk.'
                            'PREVIOUS_MODEL_STOP_AUDIT', ()):
                report = strict_falling_report(d, sessions)
        row = next(s for s in report['models'] if
                   s['flag'] == selected['flag'])['examples']['first_stop'][0]
        self.assertTrue(row['validated_descending_model_only'])
        self.assertEqual(row['signal_day'], '2026-10-22')
        self.assertEqual(len(row['model_line_last_six_krw']), 6)
        self.assertFalse(row['broker_signal_verified'])


if __name__ == '__main__':
    unittest.main()

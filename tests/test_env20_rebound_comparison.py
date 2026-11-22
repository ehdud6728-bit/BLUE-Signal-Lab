import unittest
from unittest import mock

import pandas as pd

from scripts.env20_rebound_comparison import (
    STAGES, build_signals, evaluate, observe_touch, validate_market_calendar,
    _latest_distinct_examples, _summarize,
)


def fixture(close_on_reclaim=85):
    rows = []
    days = pd.bdate_range('2025-01-02', periods=280)
    for code in ('000001', '000002'):
        for i, day in enumerate(days):
            price = 100
            op, hi, lo, cl = 100, 100, 100, 100
            if i == 260:
                op, hi, lo, cl = 100, 100, 75, 75
            elif i == 261:
                op, hi, lo, cl = 74, 79, 74, 74
            elif i == 262:
                op, hi, lo, cl = 74, 86, 74, close_on_reclaim
            rows.append({'Date': day, 'Code': code, 'Open': op, 'High': hi,
                         'Low': lo, 'Close': cl, 'Volume': 1000,
                         'Amount': 100000000, 'Market': 'KOSPI'})
    return pd.DataFrame(rows), days


class Env20ReboundTest(unittest.TestCase):
    def test_first_down_touch_is_not_upward_reclaim_and_c_has_no_future_leak(self):
        raw, days = fixture()
        result, _ = build_signals(raw)
        by_day = result[result.code.eq('000001')].set_index('date')
        self.assertTrue(bool(by_day.loc[days[260], 'A']))
        self.assertFalse(bool(by_day.loc[days[260], 'B']))
        self.assertFalse(bool(by_day.loc[days[261], 'B']))
        self.assertTrue(bool(by_day.loc[days[262], 'B']))
        self.assertTrue(bool(by_day.loc[days[262], 'C']))
        self.assertLess(by_day.loc[days[262], 'env20_lower'],
                        by_day.loc[days[262], 'prior_lower'])

    def test_no_bullish_lower_reclaim_without_close_over_falling_lower(self):
        raw, days = fixture(close_on_reclaim=75)
        result, _ = build_signals(raw)
        row = result[(result.code == '000001') & (result.date == days[262])].iloc[0]
        self.assertFalse(bool(row.B))
        self.assertFalse(bool(row.C))

    def test_open_gap_stop_and_same_bar_double_touch_are_conservative(self):
        reason, net, held = observe_touch(100, [(88, 95, 87, 92, 100)], 5, 3)
        self.assertEqual((reason, net, held), ('STOP_GAP', -12.3, 1))
        reason, net, held = observe_touch(100, [(100, 110, 90, 100, 100)], 5, 3)
        self.assertEqual((reason, net), ('STOP', -3.3))
        reason, net, held = observe_touch(100, [(110, 112, 105, 108, 100)], 5, 3)
        self.assertEqual((reason, net), ('TAKE_GAP', 4.7))
        reason, net, held = observe_touch(100, [(100, 102, 98, 100, 100)], 5, 3)
        self.assertEqual((reason, net, held), ('NO_TOUCH', None, None))

    def test_suspicious_price_jump_is_review_not_fabricated_executable_stop(self):
        reason, net, held = observe_touch(100, [(40, 50, 39, 42, 100)], 5, 3)
        self.assertEqual((reason, net, held), ('REVIEW_DISCONTINUITY', None, 1))

    def test_official_2026_constitution_day_exception_and_missing_day_guard(self):
        # Separate calendar has a now-stale July 17 holiday entry; the
        # official KRX holiday notice overrides that one exact date.
        source = list(pd.to_datetime(['2026-07-16', '2026-07-20']))
        expected = list(pd.to_datetime(['2026-07-16', '2026-07-17', '2026-07-20']))
        self.assertEqual(validate_market_calendar(source,
            start='2026-07-16', end='2026-07-20',
            calendar_sessions=expected), 2)
        with self.assertRaisesRegex(ValueError, 'MARKET_CALENDAR_DATE_MISMATCH'):
            validate_market_calendar(source, start='2026-07-15',
                end='2026-07-20', calendar_sessions=[
                    pd.Timestamp('2026-07-15'), *expected])

    def test_unresolved_and_recent_pending_never_count_as_wins(self):
        rows = [{'day': '2026-11-10', 'reason': 'NO_TOUCH', 'net': None, 'full': False},
                {'day': '2026-11-10', 'reason': 'TAKE', 'net': 2.2, 'full': True},
                {'day': '2026-11-11', 'reason': 'STOP_GAP', 'net': -11.1, 'full': True}]
        result = _summarize(rows)
        self.assertEqual(result['pending_recent_no_touch'], 1)
        self.assertEqual(result['first_take_count'], 1)
        self.assertEqual(result['first_stop_count'], 1)
        self.assertEqual(result['severe_resolved_net_at_or_below_minus_10pct_count'], 1)
        self.assertEqual(result['distinct_signal_days'], 2)

    def test_chart_examples_are_full_paths_distinct_stocks_and_dates(self):
        def event(code, day, *, full=True, reason='TAKE'):
            return {'code': code, 'name': '종목' + code, 'day': day,
                    'touch_day': '2026-11-19', 'full': full, 'reason': reason,
                    'net': 2.2, 'close': 100.0, 'both_touch': False,
                    'touch_high': 103.0, 'touch_low': 99.0,
                    'take_threshold': 102.5, 'stop_threshold': 95.5}
        cases = [
            event('000004', '2026-11-18', full=False),
            event('000002', '2026-11-12'),
            event('000001', '2026-11-12'),
            event('000001', '2026-11-11'),  # repeated stock
            event('000003', '2026-11-11'),
            event('000005', '2026-11-10', reason='STOP'),
            event('000006', '2026-11-09'),
        ]
        actual = _latest_distinct_examples(cases, ('TAKE', 'TAKE_GAP'))
        self.assertEqual([(x['code'], x['signal_day']) for x in actual],
                         [('000001', '2026-11-12'),
                          ('000003', '2026-11-11'),
                          ('000006', '2026-11-09')])
        self.assertEqual(actual[0]['stock_name_at_signal'], '종목000001')

    def test_gap_severe_dossier_is_opt_in_without_changing_old_schema(self):
        sessions = list(pd.bdate_range('2026-09-01', periods=60))
        rows = []
        for i, day in enumerate(sessions):
            op, hi, lo, cl = (88, 95, 87, 90) if i == 46 else (100, 100, 100, 100)
            rows.append({'date': day, 'code': '000001', 'Name': '검증종목',
                         'session_index': i, 'open': op, 'high': hi,
                         'low': lo, 'close': cl,
                         'prior_close': 100 if i else float('nan'),
                         'TEST': i == 45})
        data = pd.DataFrame(rows)
        options = {'start': sessions[0].strftime('%Y-%m-%d'),
                   'end': sessions[-1].strftime('%Y-%m-%d'),
                   'min_market_stocks': 1, 'stage_flags': {'TEST': 'TEST'},
                   'horizons': (5,), 'policies': ((2.5, 4.5),)}
        with mock.patch('scripts.env20_rebound_comparison.validate_market_calendar',
                        return_value=60):
            baseline = evaluate(data, sessions, **options)
            extended = evaluate(data, sessions, expose_risk_examples=True, **options)
        old = baseline['results'][0]['patterns']['TEST']
        new = extended['results'][0]['patterns']['TEST']
        self.assertNotIn('holdout_latest_stop_gap_examples', old)
        self.assertNotIn('holdout_latest_severe_loss_examples', old)
        self.assertEqual(new['holdout']['stop_gap_count'], 1)
        self.assertEqual(new['holdout']['severe_resolved_net_at_or_below_minus_10pct_count'], 1)
        self.assertEqual(new['holdout_latest_stop_gap_examples'][0]['code'], '000001')
        self.assertEqual(new['holdout_latest_severe_loss_examples'][0]
                         ['assumed_net_return_pct'], -12.3)


if __name__ == '__main__':
    unittest.main()

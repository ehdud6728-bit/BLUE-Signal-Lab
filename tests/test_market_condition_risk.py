import copy
import unittest
from datetime import date, timedelta

from scripts.exit_policy_research import VerifiedBar
from scripts.first_touch_risk_research import analyze_first_touch_risk, first_touch, _feature_groups
from scripts.market_condition_risk import (
    validated_market_context, market_state, describe_market_conditional,
)
from scripts.pattern_exit_study import analyze


def mkbar(day, *, open_=100, high=100, low=100, close=100):
    return VerifiedBar(day, open_, high, low, close, audited=True)


def market_fixture(n=30, codes=5):
    days = []
    cursor = date(2026, 10, 1)
    while len(days) < n:
        if cursor.weekday() < 5:
            days.append(cursor.isoformat())
        cursor += timedelta(days=1)
    # Synthetic broad KRX-like full market: 1200 KOSPI, 1460 KOSDAQ.
    counts = {'ALL': 2660, 'KOSPI': 1200, 'KOSDAQ': 1460}
    market_rows = []
    for i, day in enumerate(days):
        for scope, total in counts.items():
            market_rows.append({'day': day, 'scope': scope, 'universe': total,
                'matched1': total if i >= 1 else 0,
                'up1': int(total * .7) if i >= 1 else 0,
                'down1': int(total * .3) if i >= 1 else 0,
                'matched5': total if i >= 5 else 0,
                'up5': int(total * .2) if i >= 5 else 0,
                'down5': int(total * .8) if i >= 5 else 0})
    events, prices, markets, bars, signals = [], {}, {}, [], []
    for c in range(codes):
        code = f'{c + 1:06d}'
        scope = 'KOSPI' if c%2 else 'KOSDAQ'
        prices[code] = {day: mkbar(day) for day in days}
        markets[code] = {day: scope for day in days}
        for i, day in enumerate(days):
            events.append((i, day, code, ['ENV20_LOWER_TOUCH']))
            signals.append({'day': day, 'code': code, 'names': ['ENV20_LOWER_TOUCH']})
            bars.append({'day': day, 'code': code, 'market': scope,
                         'open': 100, 'high': 100, 'low': 100, 'close': 100})
    snap = {'format': 'BLUE_TURSO_EXIT_SOURCE_V1', 'storage': 'TURSO',
            'audits_readback_verified': True, 'asof_day': days[-1],
            'eod_days': [{'day': day, 'expected': 2660, 'actual': 2660} for day in days],
            'research_audited_days': len(days), 'signals': signals, 'bars': bars,
            'market_breadth_by_day': market_rows,
            'market_breadth_method':
                'AUDITED_KRX_EQUAL_WEIGHT_ADVANCERS_VS_PRIOR_1_AND_5_AUDITED_EOD_DATES',
            'trading_calendar_verified': False, 'corporate_actions_verified': False}
    return days, events, prices, markets, market_rows, snap


class MarketSourceTests(unittest.TestCase):
    def test_audited_full_market_breadth_is_known_at_signal_close(self):
        days, _, _, markets, rows, _ = market_fixture()
        ctx = validated_market_context(days, {day:2660 for day in days}, rows, markets)
        self.assertEqual(market_state(ctx, days[7], '000001', 'ALL', 1), 'UP')
        self.assertEqual(market_state(ctx, days[7], '000001', 'ALL', 5), 'DOWN')
        self.assertEqual(market_state(ctx, days[7], '000001', 'OWN', 5), 'DOWN')
        self.assertEqual(market_state(ctx, days[0], '000001', 'ALL', 1), 'UNKNOWN')
        self.assertEqual(market_state(ctx, days[4], '000001', 'ALL', 5), 'UNKNOWN')

    def test_missing_market_audit_or_tampering_is_rejected(self):
        days, _, _, markets, rows, _ = market_fixture()
        expected = {day:2660 for day in days}
        mutated = copy.deepcopy(rows)
        mutated[0]['universe'] -= 1
        with self.assertRaisesRegex(ValueError, 'MARKET_BREADTH_EOD_UNIVERSE_MISMATCH'):
            validated_market_context(days, expected, mutated, markets)
        mutated = copy.deepcopy(rows)
        mutated[0]['up1'] = 100
        mutated[0]['matched1'] = 100
        with self.assertRaisesRegex(ValueError, 'MARKET_BREADTH_PREHISTORY_LEAK'):
            validated_market_context(days, expected, mutated, markets)
        mutated = copy.deepcopy(rows)
        mutated[0]['up1'] = 12000
        with self.assertRaisesRegex(ValueError, 'INVALID_MARKET_BREADTH_COUNT'):
            validated_market_context(days, expected, mutated, markets)
        with self.assertRaisesRegex(ValueError, 'INVALID_MARKET_BAR_LABEL'):
            validated_market_context(days, expected, rows,
                                     {'000001': {days[0]:'UNKNOWN_INDEX'}})

    def test_unchanged_breadth_is_not_falsely_called_a_down_market(self):
        days, _, _, markets, rows, _ = market_fixture()
        for row in rows:
            row['up1'] = 0
            row['down1'] = 0
        ctx = validated_market_context(days, {day:2660 for day in days}, rows, markets)
        self.assertEqual(market_state(ctx, days[7], '000001', 'ALL', 1), 'MIXED')


class MarketRiskStudies(unittest.TestCase):
    def test_skip_flag_tradeoff_counts_missed_takes_and_avoided_stop_gaps(self):
        days, _, _, markets, rows, _ = market_fixture()
        ctx = validated_market_context(days, {day:2660 for day in days}, rows, markets)
        risk_day = days[7]
        risky = mkbar(risk_day, open_=110, high=130, low=90, close=91)
        safe = mkbar(risk_day)
        losses = [
            (risk_day, '000001', [risky, mkbar(days[8], open_=60, high=90,
                                                low=60, close=80)], True),
            (risk_day, '000002', [risky, mkbar(days[8], high=101, low=90)], True),
            (risk_day, '000003', [safe, mkbar(days[8], high=106, low=99)], True),
            (risk_day, '000004', [safe, mkbar(days[8], high=102, low=96)], True),
        ]
        observed = [(day,code,seg,full,first_touch(seg,5,3))
                    for day,code,seg,full in losses]
        study = describe_market_conditional(observed, ctx, _feature_groups)
        down = study['ALL_PREV_5_AUDITED_DAYS']['DOWN']
        self.assertEqual(down['risk']['n'], 4)
        f = down['signal_day_filter_tradeoffs']['signal_day_range_at_least_10pct']
        self.assertEqual(f['if_feature_skipped']['n'], 2)
        self.assertEqual(f['if_feature_retained']['n'], 2)
        self.assertEqual(f['avoided_stop_gap_count_if_skipped'], 1)
        self.assertEqual(f['missed_take_count_if_skipped'], 1)
        self.assertEqual(f['if_feature_retained']['stop_first'], 1)
        self.assertIsNone(f['median_same_day_stop_rate_kept_minus_skipped_pct_points'])

    def test_existing_first_touch_grid_and_integration_remain_research_only(self):
        days, events, prices, markets, rows, snap = market_fixture()
        report = analyze_first_touch_risk(days, events, prices,
                                          ('ENV20_LOWER_TOUCH',),market_rows=rows,
                                          market_labels=markets,
                                          expected_counts={day:2660 for day in days})
        five = report['windows'][0]['patterns'][0]
        result = five['first_touch_grid'][0]['training']
        grouped = result['market_conditioned_risk_and_pre_entry_filter_tradeoffs']
        self.assertEqual(report['market_condition_status'],
                         'AUDITED_EQUAL_WEIGHT_BREADTH_PROXY_DESCRIPTIVE_ONLY')
        self.assertEqual(grouped['ALL_PREV_1_AUDITED_DAYS']['UP']['risk']['n'], 80)
        self.assertEqual(grouped['ALL_PREV_5_AUDITED_DAYS']['DOWN']['risk']['n'], 60)
        self.assertEqual(grouped['ALL_PREV_5_AUDITED_DAYS']['UNKNOWN']['risk']['n'], 25)
        self.assertFalse(report['recommendation_allowed'])
        integrated = analyze(snap)
        self.assertEqual(integrated['candidate_stocks'], [])
        self.assertFalse(integrated['investment_recommendation_enabled'])
        altered = copy.deepcopy(snap)
        altered['market_breadth_method'] = 'UNVERIFIED_THIRD_PARTY_DATA'
        with self.assertRaisesRegex(ValueError, 'UNVERIFIED_MARKET_BREADTH_METHOD'):
            analyze(altered)


if __name__ == '__main__':
    unittest.main()

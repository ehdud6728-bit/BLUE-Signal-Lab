import contextlib
import io
import math
import sys
import unittest
from unittest import mock

from scripts.blue_dot_breakout_context_study import (
    body_breakout_features, turnover_features, supply_bin_from_raw,
    should_exclude, hypothetical_exclusion, summarize_context,
    check_against_slope, main,
)


def event(name, code, reason, net, *,
          depth='SHALLOW',amount='LOW',supply='NEAR',
          trend='STEEPENING',slope='STEEP'):
    return {
        'day':'2026-11-10','code':code,'name':name,
        'reason':reason,'net':net,'full':True,
        'body_bin':depth,'amount_bin':amount,'supply_bin':supply,
        'trend_bin':trend,'slope_bin':slope,'touch_day':'2026-11-12',
        'period':40,'down_moves':5,
        'body_above_line_fraction':0.1,
        'bullish_body_pct_of_open':1.0,
        'signal_day_amount_krw':10000000.0,
        'ratio_to_prior20_median':0.5,
        'distance_to_zone_low_pct':1.5,
        'line_krw':90.0,'open_krw':80.0,'close_krw':100.0,
    }


class BlueDotBreakoutContextTest(unittest.TestCase):
    def test_depth_is_proportion_not_raw_krw(self):
        a=body_breakout_features(80,100,98)
        b=body_breakout_features(800,1000,980)
        self.assertEqual(a['body_bin'],'SHALLOW')
        self.assertEqual(a['body_above_line_fraction'],
                         b['body_above_line_fraction'])
        self.assertEqual(body_breakout_features(80,100,90)['body_bin'],
                         'MIDDLE')
        self.assertEqual(body_breakout_features(80,100,87)['body_bin'],
                         'DEEP')
        with self.assertRaises(ValueError):
            body_breakout_features(100,80,90)
        with self.assertRaises(ValueError):
            body_breakout_features(80,100,80)

    def test_full_day_amount_uses_only_prior20_reference(self):
        previous=[100.0]*20
        got=turnover_features(250,previous,True)
        self.assertEqual(got['amount_bin'],'HIGH')
        self.assertEqual(got['ratio_to_prior20_median'],2.5)
        self.assertEqual(turnover_features(100,previous,True)['amount_bin'],
                         'NORMAL')
        self.assertEqual(turnover_features(70,previous,True)['amount_bin'],
                         'LOW')
        self.assertEqual(turnover_features(70,previous,False)['amount_bin'],
                         'UNKNOWN')
        self.assertEqual(turnover_features(70,[100]*19,True)['amount_bin'],
                         'UNKNOWN')
        self.assertEqual(turnover_features(70,[100]*19+[0],True)['amount_bin'],
                         'UNKNOWN')
        self.assertEqual(turnover_features(math.nan,previous,True)['amount_bin'],
                         'UNKNOWN')

    def test_near_supply_bucket_not_confused_with_unknown(self):
        self.assertEqual(supply_bin_from_raw('INSIDE'),'NEAR')
        self.assertEqual(supply_bin_from_raw('NEAR_0_3'),'NEAR')
        self.assertEqual(supply_bin_from_raw('NO_UPPER'),'NOT_NEAR')
        self.assertEqual(supply_bin_from_raw('UNKNOWN'),'UNKNOWN')

    def test_posthoc_exclusion_accounts_for_missed_takes(self):
        cases=[
            event('STOP CASE','A','STOP',-4.8),
            event('TAKE CASE','B','TAKE',2.2),
            event('NO_TOUCH','C','NO_TOUCH',None,depth='DEEP',
                  amount='HIGH',supply='NOT_NEAR',
                  trend='FLATTENING'),
        ]
        summary=hypothetical_exclusion(cases,'EXCLUDE_NEAR_SUPPLY')
        self.assertEqual(summary['excluded']['outcomes']['n'],2)
        self.assertEqual(summary['retained']['outcomes']['n'],1)
        self.assertEqual(summary['stops_avoided_events'],1)
        self.assertEqual(summary['first_takes_missed_events'],1)
        self.assertEqual(summary[
            'modeled_stop_loss_avoided_abs_pct_points_equal_stakes'],4.8)
        self.assertEqual(summary[
            'modeled_take_profit_missed_pct_points_equal_stakes'],2.2)
        self.assertIsNone(
            cases[2]['net'])

    def test_pairwise_and_four_way_counts_conserve_exactly(self):
        cases=[
            event('STOP CASE','A','STOP_GAP',-11.5),
            event('TAKE CASE','B','TAKE',2.2,depth='DEEP',
                  amount='HIGH',supply='NOT_NEAR',trend='FLATTENING',
                  slope='MODERATE'),
            event('PENDING','C','NO_TOUCH',None,depth='MIDDLE',
                  amount='UNKNOWN',supply='UNKNOWN',trend='UNKNOWN',
                  slope='NEAR_FLAT'),
        ]
        r=summarize_context(cases)
        self.assertEqual(r['all']['outcomes']['n'],3)
        self.assertEqual(len(r['gap_stop_examples']),1)
        self.assertEqual(sum(x['stats']['outcomes']['n'] for x in
                         r['four_way_nonempty_cells']),3)
        self.assertEqual(r['all']['outcomes']['unresolved_no_touch_count'],1)

    def test_bad_baseline_must_fail_instead_of_dropping_signals(self):
        with self.assertRaises(ValueError):
            check_against_slope([],{})
        with self.assertRaises(ValueError):
            check_against_slope([],{
                'schema':'BLUE_DOT_SLOPE_EXPLORATORY_V1','results':[]})

    def test_plan_cannot_download_market_data(self):
        stdout=io.StringIO()
        with mock.patch('scripts.blue_dot_breakout_context_study.load_marcap',
                        side_effect=AssertionError('download forbidden')):
            with mock.patch.object(sys,'argv',['script','--mode=plan']):
                with contextlib.redirect_stdout(stdout):
                    main()
        self.assertIn('no_market_download_or_database_write',stdout.getvalue())


if __name__=='__main__':
    unittest.main()

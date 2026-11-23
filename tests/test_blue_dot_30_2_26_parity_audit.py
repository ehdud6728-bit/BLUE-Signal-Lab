import contextlib
import io
import json
import sys
import unittest
from unittest import mock

from scripts.blue_dot_30_2_26_parity_audit import (
    PERIOD, SHIFT, MULTIPLIER, SPEC_EXAMPLES,
    audit_screen_examples, check_30_report_baselines, spico_reference_check,
    main,
)
from scripts.blue_dot_direction_risk import (
    build_direction_signals, falling_streak_flags,
)
from tests.test_blue_dot_direction_risk import fixture


class KiwoomThirtyFocusTest(unittest.TestCase):
    def test_user_confirmed_visual_period_and_four_screenshots(self):
        self.assertEqual((PERIOD,MULTIPLIER,SHIFT),(30,2,26))
        self.assertEqual(len(SPEC_EXAMPLES),4)
        self.assertEqual({r[0] for r in SPEC_EXAMPLES},
                         {'013310','071850','005850','352820'})
        self.assertEqual({r[2] for r in SPEC_EXAMPLES},
                         {'2026-11-11','2026-11-12'})

    def test_four_screenshots_never_get_silent_40_to_30_promotion(self):
        d,_,_,_=build_direction_signals(fixture(descending=True),
                                        min_history=70)
        _,_,lines=falling_streak_flags(d)
        got=audit_screen_examples(d,lines)
        self.assertEqual(len(got),4)
        for x in got:
            self.assertTrue(x[
                'the_reported_40_period_result_is_not_a_30_period_verdict'])
            self.assertIsNone(x['broker_blue_dotted_line_price_krw'])
            self.assertFalse(x['brokers_verified_signal'])

    def test_30_line_calculation_checks_strict_3_5_on_synthetic(self):
        d,_,_,_=build_direction_signals(
            fixture(descending=True),min_history=70)
        _,_,lines=falling_streak_flags(d)
        # Controlled fixture has a 30 HLC3 lower upward-crossing signal.
        s=[('013810','스페코','2026-10-22',
            1600,2200,1600,2200,'SYNTHETIC')]
        got=audit_screen_examples(d,lines,s)[0]
        primary=got['basis_and_band_hypotheses'][
            'HLC3_LOWER_PRIMARY_UNVERIFIED']
        self.assertTrue(primary['falls_3_consecutive_moves'])
        self.assertTrue(primary['falls_5_consecutive_moves'])
        self.assertTrue(primary['geometry_from_model_source_ohlc'][
            'geometry_cross'])
        self.assertFalse(primary['broker_confirmed'])
        self.assertTrue(got['marcap_ohlc_matches_screenshot_exactly'])
        json.dumps(got,allow_nan=False)

    def test_model_30_results_reconcile_prior_studies(self):
        stats={'n':1,'first_take_count':1,'first_stop_count':0,
               'stop_gap_count':0,'unresolved_no_touch_count':0,
               'review_discontinuity_count':0}
        base={'strict_falling_3_5':{'models':[
             {'flag':f'FALL_30_H_L_{k}D',
              'train':dict(stats),'holdout':dict(stats),
              'examples':{'first_stop':[],'first_take':[]}}
             for k in (3,5)]},'source_sha256':{'2026':'test'}}
        context={'schema':'BLUE_DOT_SLOPE_BREAKOUT_AMOUNT_SUPPLY_MODEL_ONLY_V1',
                 'source_sha256':base['source_sha256'],'results':[
                 {'flag':f'FALL_30_H_L_{k}D',
                  'train':{'all':{'outcomes':dict(stats)}},
                  'holdout':{'all':{'outcomes':dict(stats)},
                             'first_stop_examples':[],
                             'first_take_examples':[]}}
                 for k in (3,5)]}
        slope={'schema':'BLUE_DOT_SLOPE_EXPLORATORY_V1',
               'source_sha256':base['source_sha256'],'results':[
               {'flag':f'FALL_30_H_L_{k}D',
                'train':{'total':{'stats':dict(stats)}},
                'holdout':{'total':{'stats':dict(stats)}}}
               for k in (3,5)]}
        self.assertEqual(len(check_30_report_baselines(base,context,slope)),2)
        context['results'][0]['holdout']['all']['outcomes'][
            'first_take_count']=0
        with self.assertRaisesRegex(ValueError,'RECONCILIATION'):
            check_30_report_baselines(base,context,slope)

    def test_plan_never_downloads_or_creates_unverified_report(self):
        output=io.StringIO()
        with mock.patch(
            'scripts.blue_dot_30_2_26_parity_audit.load_marcap',
            side_effect=AssertionError('market download prohibited')
        ):
            with mock.patch.object(sys,'argv',['audit','--mode=plan']):
                with contextlib.redirect_stdout(output):
                    main()
        self.assertIn('broker_line_verification',output.getvalue())
        self.assertIn('no_database_or_orders',output.getvalue())


if __name__=='__main__':
    unittest.main()

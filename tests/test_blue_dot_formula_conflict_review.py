import contextlib
import copy
import io
import json
import sys
import unittest
from unittest import mock

from scripts.blue_dot_formula_conflict_review import (
    EXACT_FORMULA,analyze_discrepancy,main,
)


def examples():
    def model(name,n,match,mae):
        return {'model':name,'observed_day_count':n,
                'matching_day_count':match,
                'mean_absolute_error_krw':mae,
                'by_day':[{'date':'2026-11-11'}]*n}
    names=('HLC3_LOWER','CLOSE_LOWER','HLC3_UPPER','CLOSE_UPPER')
    def study(code,period,n,matching,errors):
        return {'code':code,'settings':{'period':period,'shift':26},
                'candidate_model_comparisons':[
                    model(name,n,matching[i],errors[i])
                    for i,name in enumerate(names)]}
    original={
        'schema':'BLUE_DOT_BBANDS_UP_FORMULA_COMPARISON_V1',
        'source_sha256':{'2025':'AAA','2026':'BBB'},
        'kiwoom_expression_user_provided':EXACT_FORMULA,
        'cases':[
            study('013810',30,3,[3,0,0,0],[.0029,5.93,118.97,109.46]),
            study('005300',35,2,[0,0,0,0],[6512,6789,4.368,283])]}
    cases=[]
    for code in ('013310','071850','005850','352820'):
        cases.append({
            'code':code,'name_on_screenshot':'TEST',
            'signal_day':'2026-11-12',
            'screenshot_ohlc_krw':{'high':200,'low':100,'close':150},
            'basis_and_band_hypotheses':{
                'HLC3_LOWER_PRIMARY_UNVERIFIED':{'line_krw':140},
                'HLC3_UPPER_ALTERNATIVE':{'line_krw':220},
            },
        })
    focus={
        'schema':'BLUE_DOT_KIWOOM_30_2_26_FOCUS_MODEL_AUDIT_V2',
        'source_sha256':original['source_sha256'],
        'user_confirmed_parameters':{'period':30,'multiplier':2,'shift':26},
        'screenshots_four_cases_30_period_reclassified':cases,
    }
    observed={'schema':'BLUE_DOT_30_2_26_OBSERVED_PRICE_MATCH_V1',
              'observed_value_count':0}
    return original,focus,observed


class FormulaConflictReviewTests(unittest.TestCase):
    def test_30_lower_numeric_conflict_vs_upper_named_function(self):
        args=examples()
        report=analyze_discrepancy(*args)
        self.assertTrue(report['spico_30_2_26_user_reported'][
            'model_label_vs_numeric_conflict'])
        self.assertEqual(report['spico_30_2_26_user_reported'][
            'hlc3_lower_matching_days'],3)
        self.assertEqual(report['spico_30_2_26_user_reported'][
            'hlc3_upper_matching_days'],0)
        self.assertTrue(report['lotte_35_2_26_user_reported_separate_reference'][
            'hlc3_upper_nearest_of_four_models'])
        self.assertFalse(report['formula_identity_proven'])
        self.assertEqual(report[
            'numeric_blue_dot_observations_for_four_screenshots'],0)
        json.dumps(report,allow_nan=False)

    def test_no_proof_when_model_happens_to_match(self):
        o,f,v=examples()
        o['cases'][0]['candidate_model_comparisons'][0]['matching_day_count']=0
        report=analyze_discrepancy(o,f,v)
        self.assertFalse(report['spico_30_2_26_user_reported'][
            'model_label_vs_numeric_conflict'])
        self.assertFalse(report['formula_identity_proven'])
        self.assertTrue(report['do_not_map_to_live_screen_or_ai_recommendations'])

    def test_four_chart_range_only_does_not_authenticate_line(self):
        report=analyze_discrepancy(*examples())
        self.assertEqual(len(report['four_screenshot_candle_range_context_only']),4)
        for x in report['four_screenshot_candle_range_context_only']:
            a,b=x['models']
            self.assertTrue(a['model_line_in_screenshot_day_high_low'])
            self.assertFalse(b['model_line_in_screenshot_day_high_low'])
            self.assertTrue(x['visually_same_line_not_proven'])

    def test_hash_period_or_model_missing_fails(self):
        for version in ('hash','period','model'):
            o,f,v=examples()
            if version=='hash':
                f['source_sha256']=dict(f['source_sha256'])
                f['source_sha256']['2026']='XXX'
            elif version=='period':
                o['cases'][1]['settings']['period']=30
            else:
                o['cases'][0]['candidate_model_comparisons'].pop()
            with self.subTest(version=version):
                with self.assertRaises(ValueError):
                    analyze_discrepancy(o,f,v)

    def test_plan_no_io_download(self):
        out=io.StringIO()
        with mock.patch('scripts.blue_dot_formula_conflict_review.Path.read_text',
                        side_effect=AssertionError('read in plan')):
            with mock.patch.object(sys,'argv',['test','--mode=plan']):
                with contextlib.redirect_stdout(out):
                    main()
        self.assertIn('no_market_download_or_db_or_order',out.getvalue())


if __name__=='__main__':
    unittest.main()

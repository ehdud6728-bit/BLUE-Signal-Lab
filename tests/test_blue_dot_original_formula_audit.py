import contextlib
import copy
import io
import sys
import unittest
from unittest import mock

import pandas as pd

from scripts.blue_dot_original_formula_audit import (
    MODEL_KEYS, SOURCE_FORMULA, case_definitions,
    shifted_bollinger_candidate_series,
    evaluate_case, compare_original_formula, main,
)
from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES


def fixture():
    days=pd.bdate_range('2025-09-01',periods=125)
    base=[1050-i*.25 for i in range(len(days))]
    rows=[]
    for code,name in (('013810','스페코'),('005300','롯데칠성')):
        for day,close in zip(days,base):
            rows.append({'Date':day,'Code':code,'Name':name,
                         'Market':'KOSDAQ' if code=='013810' else 'KOSPI',
                         'Open':close-2,'High':close+4,
                         'Low':close-5,'Close':close,
                         'Volume':100,'Amount':100000})
    return pd.DataFrame(rows),days


def user_reference_for(raw,days,code,period,n_days=3):
    from scripts.market_scan import normalise
    d=normalise(raw.loc[raw.Code.eq(code)])
    lines=shifted_bollinger_candidate_series(d,period,2,26)
    dates=list(days[-n_days:])
    values=[float(lines['HLC3_LOWER'].iloc[-n_days+i])
            for i in range(n_days)]
    return [{'date':str(t.date()),'observed_line_krw':v,
             'display_decimals':4} for t,v in zip(dates,values)]


class OriginalKiwoomFormulaAuditTest(unittest.TestCase):
    def test_user_original_formula_exposed_and_candidates_not_assumed(self):
        self.assertEqual(SOURCE_FORMULA,
            'SHIFT(BBandsUp(설정값,설정값2),설정값3)')
        self.assertEqual(len(MODEL_KEYS),4)
        self.assertIn('HLC3_LOWER',MODEL_KEYS)
        self.assertIn('HLC3_UPPER',MODEL_KEYS)

    def test_both_periods_remain_separate(self):
        baseline={'formula':'SHIFT(BBandsUp(Period,D1),shift)',
                  'period':35,'multiplier':2.0,'shift':26,
                  'ticker_code':'005300','ticker_name':'롯데칠성',
                  'observations':[{'date':'2026-11-11','blue_line_krw':100542},
                                  {'date':'2026-11-12','blue_line_krw':100267}],
                  'source':'USER'}
        cases=case_definitions(baseline)
        self.assertEqual([x['period'] for x in cases],[30,35])
        self.assertTrue(cases[0]['is_main_study_period'])
        self.assertFalse(cases[1]['is_main_study_period'])
        self.assertEqual(len(cases[0]['observations']),3)
        with self.assertRaises(ValueError):
            case_definitions({**baseline,'period':30})

    def test_pinned_fixture_numeric_matches_do_not_prove_formula(self):
        raw,days=fixture()
        case={'code':'013810','name':'스페코','period':30,
              'multiplier':2,'shift':26,'reference_type':'TEST_SYNTHETIC',
              'reference_is_independently_authenticated':False,
              'is_main_study_period':True,
              'observations':user_reference_for(raw,days,'013810',30)}
        result=evaluate_case(raw,days,case)
        a={x['model']:x for x in result['candidate_model_comparisons']}
        self.assertEqual(a['HLC3_LOWER']['matching_day_count'],3)
        self.assertEqual(a['HLC3_UPPER']['matching_day_count'],0)
        self.assertTrue(result[
            'all_candidate_names_are_models_not_vendor_documented_definitions'])

    def test_causal_future_row_does_not_change_prior_comparison(self):
        raw,days=fixture()
        case={'code':'013810','name':'스페코','period':30,
              'multiplier':2,'shift':26,'reference_type':'TEST_SYNTHETIC',
              'reference_is_independently_authenticated':False,
              'is_main_study_period':True,
              'observations':user_reference_for(raw,days,'013810',30)}
        first=evaluate_case(raw,days,case)
        tomorrow=days[-1]+pd.Timedelta(days=1)
        future=raw.loc[raw.Code.eq('013810')].iloc[-1].copy()
        future['Date']=tomorrow
        future['Close']=future['Open']=future['High']=1e6
        future['Low']=999990
        expanded=pd.concat([raw,pd.DataFrame([future])],ignore_index=True)
        second=evaluate_case(expanded,sorted(list(days)+[tomorrow]),case)
        self.assertEqual(first['candidate_model_comparisons'],
                         second['candidate_model_comparisons'])

    def test_no_market_download_in_plan(self):
        out=io.StringIO()
        with mock.patch('scripts.blue_dot_original_formula_audit.load_marcap',
                        side_effect=AssertionError('unexpected download')):
            with mock.patch.object(sys,'argv',['script','--mode=plan']):
                with contextlib.redirect_stdout(out):
                    main()
        self.assertIn('no_download_or_database_access',out.getvalue())


if __name__=='__main__':
    unittest.main()

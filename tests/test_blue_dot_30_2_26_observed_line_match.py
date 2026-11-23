import copy
import json
import unittest

from scripts.blue_dot_30_2_26_observed_line_match import (
    EXPECTED_SCHEMA,check_model_pairs,is_strict_falling,
)


def _baseline():
    def lines(offset):
        return [
            {'date':day,'model_line_krw':100.10+offset-i*.1}
            for i,day in enumerate((
                '2026-11-05','2026-11-06','2026-11-09',
                '2026-11-10','2026-11-11','2026-11-12'))
        ]
    names=('HLC3_LOWER_PRIMARY_UNVERIFIED','CLOSE_LOWER_ALTERNATIVE',
           'HLC3_UPPER_ALTERNATIVE','CLOSE_UPPER_ALTERNATIVE')
    return {
        'schema':'BLUE_DOT_KIWOOM_30_2_26_FOCUS_MODEL_AUDIT_V2',
        'user_confirmed_parameters':{'period':30,'multiplier':2,'shift':26},
        'screenshots_four_cases_30_period_reclassified':[{
            'code':'352820','name_on_screenshot':'하이브',
            'signal_day':'2026-11-12',
            'screenshot_ohlc_krw':{'open':90,'high':105,
                                   'low':89,'close':102},
            'basis_and_band_hypotheses':{
                name:{'model_line_last_six_by_date':lines(offset)}
                for name,offset in zip(names,(0.,0.9,30.,50.))}
        }],
    }


def _payload(entries):
    return {
        'schema':EXPECTED_SCHEMA,
        'visual_target':'THICK_BLUE_DOTTED_LINE',
        'settings':{'period':30,'multiplier':2,'shift':26},
        'observations':entries,
    }


def _one(date='2026-11-12',price=99.60,code='352820'):
    return {'code':code,'date':date,'line_value_krw':price,
            'display_decimals':2,
            'source':'USER_REPORTED_KIWOOM_INDICATOR',
            'market_session':'KRX','adjusted_prices':True}


def _baseline_with_case(case):
    baseline=_baseline()
    baseline['screenshots_four_cases_30_period_reclassified']=[case]
    return baseline


class BrokerManualLineValuesTest(unittest.TestCase):
    def test_empty_input_does_not_manufacture_confirmed_broker_values(self):
        actual=check_model_pairs(_baseline(),_payload([]))
        self.assertEqual(actual['status'],
                         'WAITING_FOR_USER_BLUE_LINE_NUMERIC_VALUES')
        self.assertEqual(actual['observed_value_count'],0)
        self.assertFalse(actual['broker_verified_strategy_or_live_fill'])
        self.assertEqual(
            actual['cases'][0]['price_basis_hypothesis_comparison'][0][
                'paired_day_count'],0)
        json.dumps(actual,allow_nan=False)

    def test_one_day_matches_one_hypothesis_not_formula_proof(self):
        actual=check_model_pairs(_baseline(),_payload([_one()]))
        a,b=actual['cases'][0]['price_basis_hypothesis_comparison'][:2]
        self.assertEqual(a['paired_day_count'],1)
        self.assertEqual(a['matching_day_count'],1)
        self.assertEqual(b['matching_day_count'],0)
        self.assertIsNone(a['observed_5_consecutive_declines'])
        self.assertTrue(a['signal_day_bullish_body_crosses_broker_line_only'])
        self.assertFalse(a['formula_identity_confirmed'])
        self.assertFalse(actual['broker_verified_strategy_or_live_fill'])

    def test_six_days_allow_strict_falling_observation_not_broker_proof(self):
        names=['2026-11-05','2026-11-06','2026-11-09',
               '2026-11-10','2026-11-11','2026-11-12']
        rows=[_one(day,round(100.10-0.1*i,2))
              for i,day in enumerate(names)]
        actual=check_model_pairs(_baseline(),_payload(rows))
        a=actual['cases'][0]['price_basis_hypothesis_comparison'][0]
        self.assertTrue(a['six_day_numeric_price_match'])
        self.assertTrue(a['observed_5_consecutive_declines'])
        self.assertTrue(a['observed_3_consecutive_declines'])
        self.assertFalse(a['formula_identity_confirmed'])
        self.assertEqual(a['paired_day_count'],6)

    def test_actual_hybe_screenshot_broker_value_is_not_model_parity(self):
        from pathlib import Path
        payload=json.loads(Path(
            'research/kiwoom_blue_dot_30_2_26_observations.json'
        ).read_text(encoding='utf-8'))
        self.assertEqual(payload['observations'][0]['line_value_krw'],
                         153078.28)
        self.assertEqual(payload['observations'][0]['date'],'2026-11-12')
        case=_baseline()['screenshots_four_cases_30_period_reclassified'][0]
        case['screenshot_ohlc_krw']={
            'open':152400,'high':157700,'low':150200,'close':155600}
        expected={
            'HLC3_LOWER_PRIMARY_UNVERIFIED':152862.20516,
            'CLOSE_LOWER_ALTERNATIVE':152238.97285,
            'HLC3_UPPER_ALTERNATIVE':187233.35039,
            'CLOSE_UPPER_ALTERNATIVE':187234.36048}
        for name,line in expected.items():
            case['basis_and_band_hypotheses'][name][
                'model_line_last_six_by_date'][-1]['model_line_krw']=line
        result=check_model_pairs(_baseline_with_case(case),payload)
        self.assertEqual(result['observed_value_count'],1)
        self.assertTrue(result['cases'][0][
            'signal_day_blue_line_within_screen_bull_body'])
        self.assertFalse(result['broker_verified_strategy_or_live_fill'])
        self.assertTrue(result['cases'][0][
            'full_strict_downline_upcross_unverified_without_prior_blue_line'])
        models=result['cases'][0]['price_basis_hypothesis_comparison']
        self.assertTrue(all(x['paired_day_count']==1 for x in models))
        self.assertTrue(all(x['matching_day_count']==0 for x in models))
        self.assertTrue(all(x['observed_3_consecutive_declines'] is None
                            for x in models))
        self.assertAlmostEqual(models[0]['model_line_30_2_26_values'][-1][
            'model_minus_broker_krw'],-216.07484,places=5)
        self.assertAlmostEqual(models[0]['model_line_30_2_26_values'][-1][
            'model_minus_broker_pct'],-0.141153,places=5)
        self.assertEqual(models[0]['model_line_30_2_26_values'][-1][
            'observation_source'],'USER_PROVIDED_KIWOOM_MTS_SCREENSHOT')

    def test_invalid_duplicate_precision_and_unsourced_value_fail(self):
        for entries,pattern in [
            ([_one(),_one()],'DUPLICATE'),
            ([_one(price=float('nan'))],'PRICE_INVALID'),
            ([_one(price=99.601)],'PRECISION_MISMATCH'),
            ([_one(code='000001')],'NOT_IN_PINNED'),
            ([{**_one(),'source':'INFERRED_FROM_SCREENSHOT'}],'SOURCE'),
            ([{**_one(),'market_session':'ALL'}],'SESSION'),
        ]:
            with self.subTest(pattern=pattern):
                with self.assertRaisesRegex(ValueError,pattern):
                    check_model_pairs(_baseline(),_payload(entries))

    def test_strict_descending_requires_contiguous_full_window(self):
        self.assertIsNone(is_strict_falling([None,None,10,9,8,7],5))
        self.assertFalse(is_strict_falling([12,11,10,10,8,7],5))
        self.assertTrue(is_strict_falling([12,11,10,9,8,7],5))

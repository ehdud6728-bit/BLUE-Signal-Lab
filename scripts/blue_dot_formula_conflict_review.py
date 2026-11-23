#!/usr/bin/env python3
"""Read-only investigation of the BBandsUp label versus user-reported values.

Never 'fix' the user's original formula, flip the sign of the band, or
promote a model matched on one ticker to actual Kiwoom broker parity.
Consumes already-created, SHA-pinned research reports only.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

UPPER='HLC3_UPPER'
LOWER='HLC3_LOWER'
EXACT_FORMULA='SHIFT(BBandsUp(설정값,설정값2),설정값3)'
SECONDARY_REFERENCES=(
    'https://sjsks3.tistory.com/entry/키움증권-영웅문-HTS-수식-및-함수-정리',
    'https://wikidocs.net/89275',
    'https://thinkjb.tistory.com/entry/키움증권-영웅문-수식관리자-Valuewhen-함수에-대해서-알아보자',
)
OFFICIAL_USAGE_GUIDE='https://download.kiwoom.com/hero4_help_new/012.htm'
MODEL_NAMES=('HLC3_LOWER','CLOSE_LOWER','HLC3_UPPER','CLOSE_UPPER')


def _model_map(sample):
    values=sample['candidate_model_comparisons']
    if {x['model'] for x in values}!=set(MODEL_NAMES):
        raise ValueError('FORMULA_CONFLICT_FOUR_MODELS_REQUIRED')
    mapped={x['model']:x for x in values}
    if len(mapped)!=4:
        raise ValueError('FORMULA_CONFLICT_DUPLICATE_MODEL')
    for v in mapped.values():
        n=int(v['observed_day_count'])
        if n<=0 or len(v['by_day'])!=n or not 0<=v['matching_day_count']<=n:
            raise ValueError('FORMULA_CONFLICT_MODEL_COUNT_INVALID')
    return mapped


def analyze_discrepancy(original_report, focus_report,
                        observed_match_report):
    if original_report.get('schema')!='BLUE_DOT_BBANDS_UP_FORMULA_COMPARISON_V1':
        raise ValueError('FORMULA_CONFLICT_ORIGINAL_REPORT_REQUIRED')
    if focus_report.get('schema')!='BLUE_DOT_KIWOOM_30_2_26_FOCUS_MODEL_AUDIT_V2':
        raise ValueError('FORMULA_CONFLICT_FOCUS_REPORT_REQUIRED')
    if observed_match_report.get('schema')!=(
            'BLUE_DOT_30_2_26_OBSERVED_PRICE_MATCH_V1'):
        raise ValueError('FORMULA_CONFLICT_OBSERVED_REPORT_REQUIRED')
    if original_report['source_sha256']!=focus_report['source_sha256']:
        raise ValueError('FORMULA_CONFLICT_SOURCE_HASH_CHANGED')
    if original_report.get('kiwoom_expression_user_provided')!=EXACT_FORMULA:
        raise ValueError('FORMULA_CONFLICT_USER_EXPRESSION_CHANGED')
    if focus_report['user_confirmed_parameters']!={
            'period':30,'multiplier':2,'shift':26}:
        raise ValueError('FORMULA_CONFLICT_FOCUS_PARAMETERS_CHANGED')
    cases=original_report['cases']
    if len(cases)!=2 or not all(x['settings']['shift']==26 for x in cases):
        raise ValueError('FORMULA_CONFLICT_EXPECTED_TWO_REFERENCES')
    spico=next((x for x in cases if x['code']=='013810' and
                x['settings']['period']==30),None)
    lotte=next((x for x in cases if x['code']=='005300' and
                x['settings']['period']==35),None)
    if spico is None or lotte is None:
        raise ValueError('FORMULA_CONFLICT_PERIOD_TICKER_MISMATCH')
    first=_model_map(spico)
    second=_model_map(lotte)
    spico_days=first[LOWER]['observed_day_count']
    if (spico_days!=3 or any(
            v['observed_day_count']!=spico_days for v in first.values())):
        raise ValueError('FORMULA_CONFLICT_SPECO_THREE_DAYS_REQUIRED')
    lotte_days=second[UPPER]['observed_day_count']
    if (lotte_days!=2 or any(
            v['observed_day_count']!=lotte_days for v in second.values())):
        raise ValueError('FORMULA_CONFLICT_LOTTE_TWO_DAYS_REQUIRED')
    conflict=(first[LOWER]['matching_day_count']==3 and
              first[UPPER]['matching_day_count']==0)
    upper_is_nearest=(second[UPPER]['mean_absolute_error_krw']==
                     min(v['mean_absolute_error_krw']
                         for v in second.values()))
    exact_lotte=second[UPPER]['matching_day_count']==2
    focus_cases=focus_report['screenshots_four_cases_30_period_reclassified']
    if len(focus_cases)!=4:
        raise ValueError('FORMULA_CONFLICT_FOUR_SCREENSHOTS_REQUIRED')
    sample_tickers={c['code'] for c in focus_cases}
    if sample_tickers!={'013310','071850','005850','352820'}:
        raise ValueError('FORMULA_CONFLICT_SCREENSHOT_SET_CHANGED')
    visual_checks=[]
    for c in focus_cases:
        high=float(c['screenshot_ohlc_krw']['high'])
        low=float(c['screenshot_ohlc_krw']['low'])
        close=float(c['screenshot_ohlc_krw']['close'])
        if high<low or not low<=close<=high:
            raise ValueError('FORMULA_CONFLICT_SCREENSHOT_BAD_OHLC')
        hypotheses=c['basis_and_band_hypotheses']
        comparisons=[]
        for name in ('HLC3_LOWER_PRIMARY_UNVERIFIED',
                     'HLC3_UPPER_ALTERNATIVE'):
            if name not in hypotheses:
                raise ValueError('FORMULA_CONFLICT_FOCUS_MODEL_MISSING')
            price=hypotheses[name]['line_krw']
            if price is None:
                raise ValueError('FORMULA_CONFLICT_FOCUS_NO_LINE_VALUE')
            comparisons.append({
                'model':name,
                'model_line_krw':price,
                'model_line_in_screenshot_day_high_low':
                    low<=float(price)<=high,
                'distance_from_screenshot_close_pct':
                    round(100*(float(price)/close-1),5),
                'not_actual_broker_line_readout':True,
            })
        visual_checks.append({
            'code':c['code'],'name':c['name_on_screenshot'],
            'date':c['signal_day'],'screen_close_krw':close,
            'models':comparisons,
            'visually_same_line_not_proven':True,
        })
    observations=int(observed_match_report['observed_value_count'])
    if observations<0:
        raise ValueError('FORMULA_CONFLICT_NEGATIVE_OBSERVATIONS')
    return {
        'schema':'BLUE_DOT_KIWOOM_BBANDSUP_LABEL_NUMERIC_CONFLICT_V1',
        'source_sha256':original_report['source_sha256'],
        'user_formula':EXACT_FORMULA,
        'confirmed_target_style':'THICK_BLUE_DOTTED_LINE_OVERLAPS_RED_SOLID',
        'main_settings':{'period':30,'multiplier':2,'shift':26},
        'term_BBandsUp_conventionally_means_upper_not_lower':True,
        'meaning_evidence':'SECONDARY_PUBLIC_DOCS_NOT_KIWOOM_INTERNAL_SOURCE',
        'public_references':{
            'secondary_function_definitions':list(SECONDARY_REFERENCES),
            'official_formula_editor_usage_only':OFFICIAL_USAGE_GUIDE},
        'spico_30_2_26_user_reported':{
            'days':spico_days,
            'hlc3_lower_matching_days':first[LOWER]['matching_day_count'],
            'hlc3_lower_mean_abs_error_krw':
                first[LOWER]['mean_absolute_error_krw'],
            'hlc3_upper_matching_days':first[UPPER]['matching_day_count'],
            'hlc3_upper_mean_abs_error_krw':
                first[UPPER]['mean_absolute_error_krw'],
            'model_label_vs_numeric_conflict':conflict,
        },
        'lotte_35_2_26_user_reported_separate_reference':{
            'days':lotte_days,
            'hlc3_upper_nearest_of_four_models':upper_is_nearest,
            'hlc3_upper_matching_days_at_display_precision':
                second[UPPER]['matching_day_count'],
            'hlc3_upper_mean_abs_error_krw':
                second[UPPER]['mean_absolute_error_krw'],
            'exact_both_days_at_display_precision':exact_lotte,
            'different_period_not_evidence_of_formula_side_switch':True,
        },
        'four_screenshot_candle_range_context_only':visual_checks,
        'numeric_blue_dot_observations_for_four_screenshots':observations,
        'formula_identity_proven':False,
        'unresolved_questions':[
            'Does the recorded SPECO number belong to the exact BBandsUp plot?',
            'What does Kiwoom function explanation show for BBandsUp and SHIFT?',
            'Are 30/35 values on comparable adjusted KRX-only OHLC bars?',
            'Can at least two independent 30/2/26 stocks supply dated blue-line values?',
        ],
        'next_validation_gate':'CONFIRM_SOURCE_FORMULA_PLOT_AND_PRICE_BASIS_FIRST',
        'do_not_map_to_live_screen_or_ai_recommendations':True,
        'do_not_auto_reverse_user_BBandsUp_to_BBandsDown':True,
    }


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--mode',choices=('plan','study'),default='plan')
    p.add_argument('--original',
                   default='output/blue_dot_direction/original_formula_comparison.json')
    p.add_argument('--focus',
                   default='output/blue_dot_direction/kiwoom_30_2_26_audit.json')
    p.add_argument('--observed',
                   default='output/blue_dot_direction/kiwoom_30_2_26_observed_match.json')
    p.add_argument('--out',
                   default='output/blue_dot_direction/formula_conflict_report.json')
    args=p.parse_args()
    if args.mode=='plan':
        print('BBANDSUP_FORMULA_CONFLICT_PLAN',json.dumps({
            'period':30,'multiplier':2,'shift':26,
            'user_formula':EXACT_FORMULA,
            'public_definition_secondary_only':True,
            'no_market_download_or_db_or_order':True,
        }))
        return
    original=json.loads(Path(args.original).read_text(encoding='utf-8'))
    focus=json.loads(Path(args.focus).read_text(encoding='utf-8'))
    observed=json.loads(Path(args.observed).read_text(encoding='utf-8'))
    out=analyze_discrepancy(original,focus,observed)
    target=Path(args.out)
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(out,ensure_ascii=False,
                                 indent=2,allow_nan=False)+'\n',
                      encoding='utf-8')
    print('BBANDSUP_CONFLICT', '30_SPICO_MATCHES_LOWER=',
          out['spico_30_2_26_user_reported']['hlc3_lower_matching_days'],
          'BROKER_PROVEN=FALSE','DB=0','ORDERS=0')


if __name__=='__main__':
    main()

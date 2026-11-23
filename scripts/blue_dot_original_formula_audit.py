#!/usr/bin/env python3
"""Original Kiwoom BBandsUp formula vs candidate MARCAP shifted bands.

The user specified the *indicator expression*, not the vendor's documented
price-source/side semantics. Numeric parity never authenticates that mapping.
Read-only study against pinned 2025/26 public UNADJUSTED EOD.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import pandas as pd

try:
    from scripts.blue_dot_30_2_26_parity_audit import SPECO_ANCHOR
    from scripts.market_scan import load_marcap, normalise
    from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES
except ModuleNotFoundError:
    from blue_dot_30_2_26_parity_audit import SPECO_ANCHOR
    from market_scan import load_marcap, normalise
    from research_v2_targeted_history import EXACT_MARCAP_HASHES

SOURCE_FORMULA='SHIFT(BBandsUp(설정값,설정값2),설정값3)'
BROKER_INPUT_FORMULA='SHIFT(BBandsUp(Period,D1),shift)'
MODEL_KEYS=('HLC3_LOWER','CLOSE_LOWER','HLC3_UPPER','CLOSE_UPPER')
PERIOD_30=30
SHIFT=26
MULTIPLIER=2.0


def case_definitions(sample):
    """Keep the 35-day historical sample separate from user's 30-day target."""
    if sample['formula'] != BROKER_INPUT_FORMULA:
        raise ValueError('FORMULA_BASELINE_35_SAMPLE_MISMATCH')
    if (int(sample['period']),float(sample['multiplier']),
            int(sample['shift']))!=(35,2.0,26):
        raise ValueError('FORMULA_BASELINE_35_PARAMS_CHANGED')
    obs35=[{'date':o['date'],'observed_line_krw':float(o['blue_line_krw']),
            'display_decimals':0} for o in sample['observations']]
    obs30=[{'date':day,'observed_line_krw':value,
            'display_decimals':2} for day,value in sorted(SPECO_ANCHOR.items())]
    return [
        {'code':'013810','name':'스페코','period':PERIOD_30,
         'multiplier':MULTIPLIER,'shift':SHIFT,
         'reference_type':'USER_REPORTED_THREE_DAY_30_2_26',
         'reference_is_independently_authenticated':False,
         'is_main_study_period':True,'observations':obs30},
        {'code':str(sample['ticker_code']).zfill(6),
         'name':str(sample['ticker_name']),
         'period':int(sample['period']),
         'multiplier':float(sample['multiplier']),
         'shift':int(sample['shift']),
         'reference_type':sample['source'],
         'reference_is_independently_authenticated':False,
         'is_main_study_period':False,'observations':obs35},
    ]


def shifted_bollinger_candidate_series(frame, period, multiplier, shift):
    """Model alternatives; does NOT reimplement undisclosed Kiwoom BBandsUp."""
    if not 2<=int(period)<=250 or not 1<=int(shift)<=100:
        raise ValueError('FORMULA_INVALID_PARAMETERS')
    if not 0<float(multiplier)<=10:
        raise ValueError('FORMULA_INVALID_MULTIPLIER')
    bases={'HLC3':(frame.high+frame.low+frame.close)/3,
           'CLOSE':frame.close}
    result={}
    for basis,prices in bases.items():
        avg=prices.rolling(period,min_periods=period).mean()
        sd=prices.rolling(period,min_periods=period).std(ddof=0)
        # Positive Kiwoom SHIFT rightwards by N bars: displayed t = model t-N.
        # This direction is explicitly regression-tested, not a vendor-side
        # confirmation that this numeric series is the actual blue plot.
        result[basis+'_LOWER']=(avg-multiplier*sd).shift(shift)
        result[basis+'_UPPER']=(avg+multiplier*sd).shift(shift)
    return result


def evaluate_case(raw, market_dates, case):
    code=case['code']
    subset=raw.loc[raw['Code'].astype(str).str.zfill(6).eq(code)]
    if subset.empty:
        raise ValueError('FORMULA_TICKER_MISSING_'+code)
    frame=normalise(subset)
    dates=frame.date.to_list()
    index={day:i for i,day in enumerate(dates)}
    position={pd.Timestamp(day):i for i,day in enumerate(market_dates)}
    candidate_lines=shifted_bollinger_candidate_series(
        frame,case['period'],case['multiplier'],case['shift'])
    details={key:[] for key in MODEL_KEYS}
    n=case['period']+case['shift']
    prior_i=None
    for point in case['observations']:
        date=pd.Timestamp(point['date'])
        if date not in index:
            raise ValueError('FORMULA_TICKER_DATE_MISSING_'+code)
        i=index[date]
        if i<n:
            raise ValueError('FORMULA_LOOKBACK_INSUFFICIENT_'+code)
        if prior_i is not None and i!=prior_i+1:
            raise ValueError('FORMULA_REFERENCE_DATES_NOT_CONSECUTIVE_'+code)
        prior_i=i
        window=frame.date.iloc[i-n:i+1]
        if (len(window)!=n+1 or
                any(position.get(b,-99)!=position.get(a,-99)+1
                    for a,b in zip(window.iloc[:-1],window.iloc[1:]))):
            raise ValueError('FORMULA_SOURCE_ISSUER_DAYS_NOT_CONTIGUOUS_'+code)
        broker=float(point['observed_line_krw'])
        decimals=point['display_decimals']
        if not math.isfinite(broker) or broker<=0 or (
                type(decimals) is not int or not 0<=decimals<=4):
            raise ValueError('FORMULA_OBSERVATION_INVALID')
        # Display rounding: 2 decimals means ±0.005 KRW, 0 means ±0.5.
        tolerance=.5*(10**(-decimals))+1e-8
        for key in MODEL_KEYS:
            value=float(candidate_lines[key].iloc[i])
            if not math.isfinite(value) or value<=0:
                raise ValueError('FORMULA_MODEL_VALUE_INVALID_'+key)
            delta=value-broker
            details[key].append({
                'date':str(date.date()),
                'user_reported_kiwoom_line_krw':broker,
                'marcap_model_line_krw':round(value,6),
                'model_minus_user_krw':round(delta,6),
                'allowed_display_rounding_error_krw':round(tolerance,6),
                'matches_at_reported_precision':abs(delta)<=tolerance,
            })
    candidates=[]
    for key in MODEL_KEYS:
        rows=details[key]
        errors=[abs(r['model_minus_user_krw']) for r in rows]
        candidates.append({
            'model':key,
            'observed_day_count':len(rows),
            'matching_day_count':sum(
                r['matches_at_reported_precision'] for r in rows),
            'max_absolute_error_krw':round(max(errors),6),
            'mean_absolute_error_krw':round(sum(errors)/len(errors),6),
            'by_day':rows,
            'not_verified_kiwoom_function_semantics':True,
        })
    # Keep fixed candidate ordering. No automated winner/trade rule.
    return {
        'code':code,'name':case['name'],
        'indicator_formula_from_user':SOURCE_FORMULA,
        'settings':{'period':case['period'],
                    'multiplier':case['multiplier'],'shift':case['shift']},
        'main_30_2_26_research':case['is_main_study_period'],
        'observed_source':case['reference_type'],
        'source_authenticated':case['reference_is_independently_authenticated'],
        'candidate_model_comparisons':candidates,
        'all_candidate_names_are_models_not_vendor_documented_definitions':True,
    }


def compare_original_formula(raw,sample,source_hashes):
    if source_hashes!=EXACT_MARCAP_HASHES:
        raise ValueError('FORMULA_SOURCE_HASH_MISMATCH')
    market=raw.loc[raw['Market'].astype(str).str.upper().isin(
        ('KOSPI','KOSDAQ')),'Date']
    market_dates=sorted(set(pd.to_datetime(market)))
    cases=case_definitions(sample)
    results=[evaluate_case(raw,market_dates,c) for c in cases]
    if len(results)!=2 or results[0]['settings']['period']!=30:
        raise ValueError('FORMULA_EXPECTED_MAIN_THEN_COMPARATOR')
    return {
        'schema':'BLUE_DOT_BBANDS_UP_FORMULA_COMPARISON_V1',
        'kiwoom_expression_user_provided':SOURCE_FORMULA,
        'kiwoom_original_function':'BBandsUp',
        'user_confirmed_main_visual_target':'THICK_BLUE_DOTTED_LINE_OVERLAPPING_RED_LINE',
        'main_parameters':{'period':30,'multiplier':2,'shift':26},
        'reused_35_period_user_sample_is_separate_comparator':True,
        'formula_expression_known_but_function_internal_price_basis_and_vendor_implementation_unverified':True,
        'numeric_agreement_does_not_prove_indicator_source_or_production_scanner_parity':True,
        'adjusted_kiwoom_prices_vs_unadjusted_marcap_unreconciled':True,
        'user_values_are_not_authenticated_broker_exports':True,
        'hypotheses':list(MODEL_KEYS),
        'no_auto_winner_or_trading_recommendation':True,
        'source_sha256':source_hashes,
        'cases':results,
    }


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--mode',choices=('plan','study'),default='plan')
    p.add_argument('--source-dir',default='output/blue_dot_direction/sources')
    p.add_argument('--sample',default='research/blue_dot_broker_samples.json')
    p.add_argument('--out',default=
                   'output/blue_dot_direction/original_formula_comparison.json')
    args=p.parse_args()
    if args.mode=='plan':
        print('KIWOOM_ORIGINAL_BBANDSUP_PLAN',json.dumps({
            'formula':SOURCE_FORMULA,'main_parameters':[30,2,26],
            'model_hypotheses':MODEL_KEYS,'reference_samples':[
                'SPECO_30_THREE_USER_REPORTED_DAYS',
                'LOTTE_35_TWO_USER_REPORTED_DAYS'],
            'no_download_or_database_access':True,
        }))
        return
    raw,hashes=load_marcap([2025,2026],local_dir=args.source_dir)
    sample=json.loads(Path(args.sample).read_text(encoding='utf-8'))
    report=compare_original_formula(raw,sample,hashes)
    target=Path(args.out)
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(report,ensure_ascii=False,
                                 indent=2,allow_nan=False)+'\n',
                      encoding='utf-8')
    print('KIWOOM_ORIGINAL_FORMULA_COMPARE', 'model_cases=2',
          'main=30_2_26', 'vendor_formula_internal=UNVERIFIED',
          'D1=0','TURSO=0','KIS=0','TRADES=0')


if __name__=='__main__':
    main()

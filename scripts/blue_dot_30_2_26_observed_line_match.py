#!/usr/bin/env python3
"""Compare manually transcribed Kiwoom 30/2/26 thick-blue-dotted-line prices.

Pure read-only model diagnostic: no public broker API calls, no order execution,
no claims about broker parity from an empty or small sample.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date
import json
import math
from pathlib import Path

EXPECTED_SCHEMA='USER_KIWOOM_BLUE_DOTTED_30_2_26_VALUES_V1'
OUTPUT_SCHEMA='BLUE_DOT_30_2_26_OBSERVED_PRICE_MATCH_V1'
PERIOD_PARAMETERS={'period':30,'multiplier':2,'shift':26}
KNOWN_BASIS=(
    'HLC3_LOWER_PRIMARY_UNVERIFIED',
    'CLOSE_LOWER_ALTERNATIVE',
    'HLC3_UPPER_ALTERNATIVE',
    'CLOSE_UPPER_ALTERNATIVE',
)


def check_and_normalize_observations(payload, supported_cases):
    """Require explicit user-supplied line price, source, precision and context."""
    if payload.get('schema')!=EXPECTED_SCHEMA:
        raise ValueError('BROKER_OBSERVATIONS_SCHEMA')
    if payload.get('visual_target')!='THICK_BLUE_DOTTED_LINE':
        raise ValueError('BROKER_VISUAL_TARGET_NOT_CONFIRMED')
    if payload.get('settings')!=PERIOD_PARAMETERS:
        raise ValueError('BROKER_LINE_SETTINGS_NOT_30_2_26')
    values=payload.get('observations')
    if not isinstance(values,list):
        raise ValueError('BROKER_OBSERVATIONS_NOT_ARRAY')
    known_dates={
        str(c['code']):{
            x['date'] for h in c['basis_and_band_hypotheses'].values()
            for x in h['model_line_last_six_by_date']}
        for c in supported_cases
    }
    found={}
    for item in values:
        code=item.get('code')
        day=item.get('date')
        if not isinstance(code,str) or len(code)!=6 or not code.isdigit():
            raise ValueError('BROKER_OBSERVATION_CODE_SIX_DIGITS_REQUIRED')
        if not isinstance(day,str):
            raise ValueError('BROKER_OBSERVATION_DATE_REQUIRED')
        try:
            if date.fromisoformat(day).isoformat()!=day:
                raise ValueError()
        except ValueError:
            raise ValueError('BROKER_OBSERVATION_DATE_INVALID')
        if code not in known_dates or day not in known_dates[code]:
            raise ValueError('BROKER_OBSERVATION_NOT_IN_PINNED_FOUR_CASES')
        key=(code,day)
        if key in found:
            raise ValueError('BROKER_OBSERVATION_DUPLICATE_CODE_DATE')
        raw=item.get('line_value_krw')
        if isinstance(raw,bool):
            raise ValueError('BROKER_OBSERVATION_PRICE_INVALID')
        try:
            price=float(raw)
        except (TypeError,ValueError):
            raise ValueError('BROKER_OBSERVATION_PRICE_INVALID')
        if not math.isfinite(price) or price<=0:
            raise ValueError('BROKER_OBSERVATION_PRICE_INVALID')
        precision=item.get('display_decimals')
        if type(precision) is not int or not 0<=precision<=4:
            raise ValueError('BROKER_OBSERVATION_PRECISION_INVALID')
        if abs(price-round(price,precision))>1e-6:
            raise ValueError('BROKER_OBSERVATION_PRICE_PRECISION_MISMATCH')
        if item.get('source') not in (
                'USER_REPORTED_KIWOOM_INDICATOR',
                'USER_PROVIDED_KIWOOM_MTS_SCREENSHOT'):
            raise ValueError('BROKER_OBSERVATION_SOURCE_UNVERIFIED')
        evidence_note=item.get('evidence_note')
        if evidence_note is not None and (
                not isinstance(evidence_note,str) or
                not 1<=len(evidence_note)<=1200):
            raise ValueError('BROKER_OBSERVATION_EVIDENCE_NOTE_INVALID')
        if item.get('market_session') not in ('KRX','NXT','UNKNOWN'):
            raise ValueError('BROKER_OBSERVATION_SESSION_INVALID')
        adjusted=item.get('adjusted_prices')
        if adjusted is not None and type(adjusted) is not bool:
            raise ValueError('BROKER_OBSERVATION_ADJUSTED_INVALID')
        found[key]={
            'code':code,'date':day,
            'line_value_krw':price,
            'display_decimals':precision,
            'source':item['source'],
            'market_session':item['market_session'],
            'adjusted_prices':adjusted,
            'evidence_note':evidence_note,
        }
    return found


def is_strict_falling(values, moves):
    if len(values)<moves+1:
        return None
    window=values[-moves-1:]
    if any(x is None for x in window):
        return None
    return all(b<a for a,b in zip(window,window[1:]))


def check_model_pairs(raw_audit, payload):
    if raw_audit.get('schema')!='BLUE_DOT_KIWOOM_30_2_26_FOCUS_MODEL_AUDIT_V2':
        raise ValueError('BROKER_BASELINE_30_V2_REQUIRED')
    if raw_audit.get('user_confirmed_parameters')!=PERIOD_PARAMETERS:
        raise ValueError('BROKER_BASELINE_SETTINGS_MISMATCH')
    cases=raw_audit['screenshots_four_cases_30_period_reclassified']
    observations=check_and_normalize_observations(payload,cases)
    results=[]
    for case in cases:
        code=case['code']
        hypotheses=case['basis_and_band_hypotheses']
        rows=[]
        for name in KNOWN_BASIS:
            if name not in hypotheses:
                raise ValueError('BROKER_MODEL_HYPOTHESIS_MISSING')
            by_date=hypotheses[name]['model_line_last_six_by_date']
            model_dates=[x['date'] for x in by_date]
            if len(model_dates)!=6 or len(set(model_dates))!=6:
                raise ValueError('BROKER_MODEL_HISTORY_SIX_REQUIRED')
            matched=0
            paired=0
            diffs=[]
            row_comparisons=[]
            broker_values=[]
            for x in by_date:
                broker=observations.get((code,x['date']))
                model_value=x['model_line_krw']
                if broker is None:
                    broker_values.append(None)
                    row_comparisons.append({
                        'date':x['date'],'broker_line_krw':None,
                        'model_line_krw':model_value,'display_precision_match':None})
                    continue
                b=broker['line_value_krw']
                broker_values.append(b)
                valid_model=(model_value is not None and
                             math.isfinite(float(model_value)))
                tolerance=0.5*(10**(-broker['display_decimals']))+0.00001
                delta=(model_value-b) if valid_model else None
                passes=(abs(delta)<=tolerance) if delta is not None else False
                paired+=1
                matched+=int(passes)
                if delta is not None:
                    diffs.append(abs(delta))
                row_comparisons.append({
                    'date':x['date'],'broker_line_krw':b,
                    'model_line_krw':model_value,
                    'model_minus_broker_krw':round(delta,5) if delta is not None else None,
                    'model_minus_broker_pct':
                        round(100*delta/b,6) if delta is not None else None,
                    'allowed_rounding_krw':round(tolerance,6),
                    'display_precision_match':passes,
                    'market_session':broker['market_session'],
                    'adjusted_prices':broker['adjusted_prices'],
                    'observation_source':broker['source'],
                    'evidence_note':broker['evidence_note']})
            last_observed_date=case['signal_day']
            final_broker=observations.get((code,last_observed_date))
            candle_cross=(
                (float(case['screenshot_ohlc_krw']['open'])
                 <final_broker['line_value_krw']
                 <float(case['screenshot_ohlc_krw']['close']))
                if final_broker is not None else None)
            rows.append({
                'hypothesis':name,
                'model_line_30_2_26_values':row_comparisons,
                'paired_day_count':paired,
                'matching_day_count':matched,
                'all_available_days_match_at_reported_precision':
                    matched==paired if paired else None,
                'six_day_numeric_price_match':
                    paired==6 and matched==6,
                'largest_absolute_model_broker_difference_krw':
                    round(max(diffs),5) if diffs else None,
                'observed_3_consecutive_declines':
                    is_strict_falling(broker_values,3),
                'observed_5_consecutive_declines':
                    is_strict_falling(broker_values,5),
                'signal_day_bullish_body_crosses_broker_line_only':
                    candle_cross,
                'prior_close_below_previous_broker_line_not_verified':True,
                'formula_identity_confirmed':False,
            })
        results.append({
            'code':code,'name':case['name_on_screenshot'],
            'signal_day':case['signal_day'],
            'available_user_observations':
                len([x for x in observations if x[0]==code]),
            'price_basis_hypothesis_comparison':rows,
            'signal_day_observed_blue_line_krw':(
                observations.get((code,case['signal_day']),{}).get(
                    'line_value_krw')),
            'signal_day_blue_line_within_screen_bull_body':(
                float(case['screenshot_ohlc_krw']['open'])<
                observations[(code,case['signal_day'])]['line_value_krw']<
                float(case['screenshot_ohlc_krw']['close'])
                if (code,case['signal_day']) in observations else None),
            'screenshot_close_vs_source_close_data_basis_may_differ':(
                not case.get('marcap_ohlc_matches_screenshot_exactly',False)
                if 'marcap_ohlc_matches_screenshot_exactly' in case
                else None),
            'full_strict_downline_upcross_unverified_without_prior_blue_line':True,
            'broker_formula_proven':False,
            'broker_trade_execution_verified':False,
        })
    return {
        'schema':OUTPUT_SCHEMA,
        'target':'USER_KIWOOM_THICK_BLUE_DOTTED_LINE_30_2_26',
        'status':('WAITING_FOR_USER_BLUE_LINE_NUMERIC_VALUES'
                  if not observations else
                  'USER_NUMERIC_SAMPLES_RECEIVED_REVIEW_ONLY'),
        'observed_value_count':len(observations),
        'a_screenshot_indicator_popup_value_is_not_a_confirmed_BBandsUp_function_implementation':True,
        'unadjusted_marcap_source_vs_broker_adjustments_not_fully_verified':True,
        'fixed_period_multiplier_shift_only_no_automatic_basis_choice':True,
        'rounding_agreement_is_not_formula_identity':True,
        'broker_verified_strategy_or_live_fill':False,
        'cases':results,
    }


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--audit',default=
        'output/blue_dot_direction/kiwoom_30_2_26_audit.json')
    parser.add_argument('--observations',default=
        'research/kiwoom_blue_dot_30_2_26_observations.json')
    parser.add_argument('--out',default=
        'output/blue_dot_direction/kiwoom_30_2_26_observed_match.json')
    args=parser.parse_args()
    baseline=json.loads(Path(args.audit).read_text(encoding='utf-8'))
    sample=json.loads(Path(args.observations).read_text(encoding='utf-8'))
    output=check_model_pairs(baseline,sample)
    target=Path(args.out)
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(output,ensure_ascii=False,
                                 indent=2,allow_nan=False)+'\n',
                      encoding='utf-8')
    print('KIWOOM_30_NUMERIC_MATCH',output['status'],
          'count='+str(output['observed_value_count']),
          'BROKER_PROVEN=FALSE','TRADES=0')


if __name__=='__main__':
    main()

#!/usr/bin/env python3
"""Broker-screen 30,2,26 blue-dot read-only review, not a scanner.

Only the user's visually identified *thick blue dotted line* is the
research target. Period 30, multiplier 2, shift 26 is known; Close/HLC3
and upper/lower mapping still require numeric Kiwoom chart-line samples.
Do NOT call a 40-period success/stop a confirmed 30-period outcome.
"""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

try:
    from scripts.blue_dot_direction_risk import (
        build_direction_signals, falling_streak_flags)
    from scripts.blue_dot_broker_parity import classify_cross
    from scripts.env20_rebound_comparison import observe_touch
    from scripts.market_scan import load_marcap
    from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES
except ModuleNotFoundError:
    from blue_dot_direction_risk import (
        build_direction_signals, falling_streak_flags)
    from blue_dot_broker_parity import classify_cross
    from env20_rebound_comparison import observe_touch
    from market_scan import load_marcap
    from research_v2_targeted_history import EXACT_MARCAP_HASHES

PERIOD, MULTIPLIER, SHIFT = 30, 2, 26
HORIZON, TAKE_PCT, STOP_PCT = 5, 2.5, 4.5
MODEL_HYPOTHESES = (
    ('H_L','HLC3_LOWER_PRIMARY_UNVERIFIED'),
    ('C_L','CLOSE_LOWER_ALTERNATIVE'),
    ('H_U','HLC3_UPPER_ALTERNATIVE'),
    ('C_U','CLOSE_UPPER_ALTERNATIVE'),
)
SPEC_EXAMPLES = (
    ('013310','아진산업','2026-11-11',2075,2130,2075,2125,'40D_MODEL_TAKE'),
    ('071850','캐스텍코리아','2026-11-12',1177,1190,1171,1189,'40D_MODEL_STOP'),
    ('005850','에스엘','2026-11-11',46700,48000,46700,47650,'40D_MODEL_STOP'),
    ('352820','하이브','2026-11-12',152400,157700,150200,155600,'40D_MODEL_TAKE'),
)
# Prior three displayed model-line prices vs user-reported Kiwoom values,
# for ONE stock only. Not proof of 30-line mapping for other stocks.
SPECO_ANCHOR = {'2026-10-21':1529.14,
                '2026-10-22':1531.15,
                '2026-10-23':1533.75}


def _finite_or_none(x, places=3):
    v=float(x)
    return round(v,places) if math.isfinite(v) and v>0 else None


def check_30_report_baselines(main_report, context_report, slope_report):
    """Do not silently drop/change any previously counted 30-period event."""
    if main_report['source_sha256']!=context_report['source_sha256'] or (
            main_report['source_sha256']!=slope_report['source_sha256']):
        raise ValueError('THIRTY_RESEARCH_SOURCE_HASH_MISMATCH')
    if context_report['schema']!=(
            'BLUE_DOT_SLOPE_BREAKOUT_AMOUNT_SUPPLY_MODEL_ONLY_V1'):
        raise ValueError('THIRTY_RESEARCH_CONTEXT_SCHEMA_MISMATCH')
    if slope_report['schema']!='BLUE_DOT_SLOPE_EXPLORATORY_V1':
        raise ValueError('THIRTY_RESEARCH_SLOPE_SCHEMA_MISMATCH')
    original={m['flag']:m for m in main_report[
        'strict_falling_3_5']['models']}
    context={m['flag']:m for m in context_report['results']}
    sloped={m['flag']:m for m in slope_report['results']}
    keys=('n','first_take_count','first_stop_count','stop_gap_count',
          'unresolved_no_touch_count','review_discontinuity_count')
    groups=[]
    for k in (3,5):
        flag=f'FALL_30_H_L_{k}D'
        m=original[flag]
        c=context[flag]
        s=sloped[flag]
        for part in ('train','holdout'):
            expected=m[part]
            a=c[part]['all']['outcomes']
            b=s[part]['total']['stats']
            if any(expected[x]!=a[x] or a[x]!=b[x] for x in keys):
                raise ValueError('THIRTY_RESEARCH_EVENT_RECONCILIATION_'+flag+
                                 '_'+part)
        groups.append({
            'period':30,'down_moves':k,'flag':flag,
            'holdout':m['holdout'],
            'train':m['train'],
            'model_stop_examples':m['examples']['first_stop'][:3],
            'model_take_examples':m['examples']['first_take'][:3],
            'context_stop_examples':
                c['holdout']['first_stop_examples'][:3],
            'context_take_examples':
                c['holdout']['first_take_examples'][:3],
            'note':'MODEL_ONLY_NOT_BROKER_VERIFIED',
        })
    if groups[1]['holdout']['n']>groups[0]['holdout']['n']:
        raise ValueError('THIRTY_5D_MUST_SUBSET_OF_3D')
    return groups


def _line_strict_declines(raw_values, moves):
    """Only line direction, independent of bullish-body cross."""
    recent=raw_values[-moves-1:]
    return (len(recent)==moves+1 and
            all(math.isfinite(float(v)) and float(v)>0 for v in recent) and
            all(float(recent[j])<float(recent[j-1])
                for j in range(1,len(recent))))


def _model_line_check(history, idx, source_lines, prefix):
    history_window=history.iloc[max(0,idx-5):idx+1]
    values=source_lines[prefix].loc[history_window.original_index]
    raw=[float(x) for x in values]
    last_six=[_finite_or_none(x) for x in raw]
    dated=[{'date':row.date.strftime('%Y-%m-%d'),
            'model_line_krw':_finite_or_none(v,5)}
           for row,v in zip(history_window.itertuples(),raw)]
    return {
        'model_line_last_six_by_date':dated,
        'last_six_values_krw':last_six,
        'current_line_krw':last_six[-1] if last_six else None,
        'prior_line_krw':last_six[-2] if len(last_six)>1 else None,
        'line_falls_3_consecutive_moves':_line_strict_declines(raw,3),
        'line_falls_5_consecutive_moves':_line_strict_declines(raw,5),
        'raw_current_line':raw[-1] if raw else None,
        'raw_previous_line':raw[-2] if len(raw)>1 else None,
    }


def _hypotheses_at_date(d, source_lines, code, date):
    h=d.loc[d.code.eq(code)].reset_index().rename(
        columns={'index':'original_index'})
    hit=h.index[h.date.eq(date)].tolist()
    if len(hit)!=1:
        return None, h, None
    i=int(hit[0]); r=h.iloc[i]
    scenarios={}
    for suffix, desc in MODEL_HYPOTHESES:
        prefix=f'FALL_30_{suffix}'
        prices=_model_line_check(h,i,source_lines,prefix)
        line,prior=prices['raw_current_line'],prices['raw_previous_line']
        if (line is None or prior is None or
                not math.isfinite(line) or not math.isfinite(prior)):
            crossed=None
        else:
            crossed=classify_cross(
                float(r.open),float(r.close),float(r.prior_close),
                prior,line)
        model3=bool(r[f'{prefix}_3D'])
        model5=bool(r[f'{prefix}_5D'])
        scenarios[desc]={
            'line_krw':prices['current_line_krw'],
            'previous_line_krw':prices['prior_line_krw'],
            'model_line_last_six_krw':prices['last_six_values_krw'],
            'model_line_last_six_by_date':prices['model_line_last_six_by_date'],
            'line_falls_3_consecutive_moves':
                prices['line_falls_3_consecutive_moves'],
            'line_falls_5_consecutive_moves':
                prices['line_falls_5_consecutive_moves'],
            'qualifies_3_day_downline_upcross_model':model3,
            'qualifies_5_day_downline_upcross_model':model5,
            'geometry_from_model_source_ohlc':crossed,
            'broker_confirmed':False,
        }
        if model3 and not prices['line_falls_3_consecutive_moves']:
            raise ValueError('THIRTY_3D_CROSS_REQUIRES_DECLINE')
        if model5 and not prices['line_falls_5_consecutive_moves']:
            raise ValueError('THIRTY_5D_CROSS_REQUIRES_DECLINE')
        if (model5 and not model3):
            raise ValueError('THIRTY_5D_NOT_SUBSET_3D')
    return scenarios,h,i


def _model_outcome_if_signal(history, index, d, scenario):
    if not scenario['qualifies_3_day_downline_upcross_model']:
        return {'status':'NO_30_3D_MODEL_SIGNAL'}
    now=history.iloc[index]
    available=min(HORIZON,int(d.session_index.max())-int(now.session_index))
    if available<1:
        return {'status':'NO_FOLLOWING_MARKET_SESSION'}
    if index+available>=len(history) or any(
            int(history.iloc[index+j].session_index)!=
            int(now.session_index)+j
            for j in range(1,available+1)):
        return {'status':'MISSING_ISSUER_SESSION'}
    future=[(float(f.open),float(f.high),float(f.low),
             float(f.close),float(f.prior_close))
            for f in history.iloc[index+1:index+available+1].itertuples()]
    reason,net,held=observe_touch(float(now.close),future,
                                  TAKE_PCT,STOP_PCT)
    return {'status':'MODEL_FIRST_TOUCH_ONLY',
            'first_touch_type':reason,'model_net_pct':net,
            'first_touch_date':(
                history.iloc[index+held].date.strftime('%Y-%m-%d')
                if held is not None else None),
            'not_actual_broker_fill':True}


def audit_screen_examples(d, source_lines, examples=SPEC_EXAMPLES):
    """User-provided screenshots contain OHLC, NOT the broker dotted-line value."""
    found=[]
    for code,name,day,op,hi,lo,cl,old in examples:
        scenarios,h,i=_hypotheses_at_date(d,source_lines,code,day)
        row={
            'code':code,'name_on_screenshot':name,'signal_day':day,
            'screenshot_ohlc_krw':dict(open=op,high=hi,low=lo,close=cl),
            'previously_shown_40_period_model_result':old,
            'the_reported_40_period_result_is_not_a_30_period_verdict':True,
            'broker_blue_dotted_line_price_krw':None,
            'broker_line_numeric_parity_status':
                'UNVERIFIED_NO_SELECTED_DAY_BLUE_LINE_PRICE',
            'brokers_verified_signal':False,
        }
        if scenarios is None:
            row['status']='DATE_OR_CODE_NOT_IN_PINNED_SOURCE'
            found.append(row)
            continue
        source=h.iloc[i]
        source_ohlc={
            x:float(source[x]) for x in ('open','high','low','close')}
        delta={k:source_ohlc[k]-row['screenshot_ohlc_krw'][k]
               for k in source_ohlc}
        row.update({
            'status':'MODEL_CALCULATED_BROKER_LINE_UNVERIFIED',
            'marcap_ohlc_krw':source_ohlc,
            'marcap_minus_screenshot_ohlc_krw':delta,
            'marcap_ohlc_matches_screenshot_exactly':
                all(v==0 for v in delta.values()),
            'basis_and_band_hypotheses':scenarios,
            'primary_30_hlc3_lower_model_result':
                _model_outcome_if_signal(
                    h,i,d,scenarios['HLC3_LOWER_PRIMARY_UNVERIFIED']),
        })
        found.append(row)
    return found


def spico_reference_check(d, source_lines):
    h=d.loc[d.code.eq('013810')].reset_index().rename(
        columns={'index':'original_index'})
    observed={}
    price=source_lines['FALL_30_H_L']
    for day,broker in SPECO_ANCHOR.items():
        rows=h.index[h.date.eq(day)].tolist()
        if len(rows)!=1:
            raise ValueError('THIRTY_SPECO_REFERENCE_DAY_MISSING_'+day)
        model=float(price.loc[h.iloc[rows[0]].original_index])
        observed[day]={'broker_reported_krw':broker,
                       'model_hlc3_lower_krw':round(model,5),
                       'delta_krw':round(model-broker,5),
                       'rounding_within_0p02_krw':abs(model-broker)<0.025}
    if not all(v['rounding_within_0p02_krw'] for v in observed.values()):
        raise ValueError('THIRTY_SPECO_REFERENCE_NUMERIC_ANCHOR_CHANGED')
    return observed


def create_report(d, context_report, slope_report, direction_report):
    groups=check_30_report_baselines(direction_report,context_report,
                                     slope_report)
    _,_,source_lines=falling_streak_flags(d)
    examples=audit_screen_examples(d,source_lines)
    anchor=spico_reference_check(d,source_lines)
    return {
        'schema':'BLUE_DOT_KIWOOM_30_2_26_FOCUS_MODEL_AUDIT_V2',
        'user_confirmed_visual_target':'THICK_BLUE_DOTTED_LINE',
        'user_confirmed_parameters':{
            'period':PERIOD,'multiplier':MULTIPLIER,'shift':SHIFT},
        'working_hypothesis':'HLC3_LOWER_NOT_FULLY_KIWOOM_VERIFIED',
        'other_price_bases_bands_are_separate_hypotheses':True,
        'line_only_descending_vs_full_candle_cross_are_distinct':True,
        'study_20_and_40_are_comparators_not_primary_signals':True,
        'unverified_40_period_examples_do_not_count_as_30_period_trades':True,
        'no_numeric_broker_blue_line_value_for_four_screenshots':True,
        'one_stock_three_day_numeric_anchor_is_not_general_broker_parity':True,
        'screenshot_ohlc_mismatch_may_reflect_price_adjustment_or_data_source':
            True,
        'source_sha256':direction_report['source_sha256'],
        'spico_30_hlc3_lower_three_day_reference':anchor,
        '30_period_strict_declines_3_and_5':groups,
        'screenshots_four_cases_30_period_reclassified':examples,
        'no_automatic_selection_or_trading_recommendation':True,
        'next_broker_validation_required':
            'Selected-day line prices on actual thick blue dotted line '
            'for the same ticker/date, nearby 5 consecutive trading days, '
            'KRX-only vs NXT sessions, and adjusted/unadjusted prices',
    }


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--mode',choices=('plan','study'),default='plan')
    parser.add_argument('--source-dir',
                        default='output/blue_dot_direction/sources')
    parser.add_argument('--report',
                        default='output/blue_dot_direction/report.json')
    parser.add_argument('--slope-report',
                        default='output/blue_dot_direction/slope_report.json')
    parser.add_argument('--context-report',
                        default='output/blue_dot_direction/breakout_context_report.json')
    parser.add_argument('--out',
                        default='output/blue_dot_direction/kiwoom_30_2_26_audit.json')
    args=parser.parse_args()
    if args.mode=='plan':
        print('KIWOOM_30_DOTTED_PLAN',json.dumps({
            'main_period':30,'multiplier':2,'shift':26,
            'screen_examples':len(SPEC_EXAMPLES),
            'broker_line_verification':False,'no_market_download':True,
            'no_database_or_orders':True}))
        return
    original=json.loads(Path(args.report).read_text(encoding='utf-8'))
    slope=json.loads(Path(args.slope_report).read_text(encoding='utf-8'))
    context=json.loads(Path(args.context_report).read_text(encoding='utf-8'))
    if original['source_sha256']!=EXACT_MARCAP_HASHES:
        raise ValueError('THIRTY_AUDIT_SOURCE_HASH_MISMATCH')
    raw,hashes=load_marcap([2025,2026],local_dir=args.source_dir)
    if hashes!=EXACT_MARCAP_HASHES:
        raise ValueError('THIRTY_AUDIT_PINNED_SOURCE_HASH_MISMATCH')
    d,_,_,_=build_direction_signals(raw)
    report=create_report(d,context,slope,original)
    target=Path(args.out)
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(report,ensure_ascii=False,
                                 indent=2,allow_nan=False)+'\n',
                      encoding='utf-8')
    print('KIWOOM_30_2_26_AUDIT_DONE','screen_examples=4',
          'broker_verified=FALSE','D1=0','KIS=0','ORDERS=0')


if __name__=='__main__':
    main()

#!/usr/bin/env python3
"""Read-only slope x candle-cross x turnover x overhead supply audit.

The signals remain the strict 20/30/40, HLC3 lower BB2 shift26, 3/5
declining-line bullish crosses. No broker chart parity, fills, or trades.
This study splits the SAME first-touch outcomes as slope_report.json.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
from statistics import median

try:
    from scripts.blue_dot_direction_risk import (
        PERIODS, SHIFT, MULTIPLIER, build_direction_signals,
        falling_streak_flags,
    )
    from scripts.blue_dot_slope_study import (
        MOVES, HORIZON, TAKE, STOP, slope_context,
    )
    from scripts.blue_dot_supply_interaction import (
        asof_supply_context, equal_stake_resolved_ledger,
    )
    from scripts.env20_rebound_comparison import (
        START, END, _summarize, observe_touch,
    )
    from scripts.market_scan import load_marcap
    from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES
except ModuleNotFoundError:
    from blue_dot_direction_risk import (
        PERIODS, SHIFT, MULTIPLIER, build_direction_signals,
        falling_streak_flags,
    )
    from blue_dot_slope_study import (
        MOVES, HORIZON, TAKE, STOP, slope_context,
    )
    from blue_dot_supply_interaction import (
        asof_supply_context, equal_stake_resolved_ledger,
    )
    from env20_rebound_comparison import START, END, _summarize, observe_touch
    from market_scan import load_marcap
    from research_v2_targeted_history import EXACT_MARCAP_HASHES


BODY_BINS = ('SHALLOW', 'MIDDLE', 'DEEP')
TURNOVER_BINS = ('LOW', 'NORMAL', 'HIGH', 'UNKNOWN')
SUPPLY_BINS = ('NEAR', 'NOT_NEAR', 'UNKNOWN')
TREND_BINS = ('STEEPENING', 'STABLE', 'FLATTENING', 'UNKNOWN')
SLOPE_BINS = ('STEEP', 'MODERATE', 'GENTLE', 'NEAR_FLAT')
PREVIOUS_AMOUNT_DAYS = 20
MIN_CELL_FOR_INTERPRETATION = 20
POLICIES = (
    'EXCLUDE_NEAR_SUPPLY',
    'EXCLUDE_SHALLOW_CROSS',
    'EXCLUDE_LOW_TURNOVER',
    'EXCLUDE_STEEPENING_AND_SHALLOW',
    'EXCLUDE_NEAR_AND_LOW_TURNOVER',
    'EXCLUDE_NEAR_OR_SHALLOW',
)
REASONS_STOP = ('STOP', 'STOP_GAP')
REASONS_TAKE = ('TAKE', 'TAKE_GAP')


def body_breakout_features(open_krw: float, close_krw: float,
                           line_krw: float) -> dict:
    """Position of line within a strictly positive, upward-crossing body."""
    if not all(math.isfinite(x) and x > 0
               for x in (open_krw, close_krw, line_krw)):
        raise ValueError('CONTEXT_BODY_NONFINITE')
    if not (open_krw < line_krw < close_krw):
        raise ValueError('CONTEXT_NOT_UPWARD_BODY_CROSS')
    above=(close_krw-line_krw)/(close_krw-open_krw)
    body_pct=100*(close_krw/open_krw-1)
    bucket=('SHALLOW' if above < 0.20 else
            'MIDDLE' if above < 0.60 else 'DEEP')
    return {
        'body_above_line_fraction':round(above,6),
        'bullish_body_pct_of_open':round(body_pct,5),
        'body_bin':bucket,
    }


def turnover_features(current_amount: float, previous_amounts,
                      contiguous_history: bool) -> dict:
    """Signal-day total KRW amount relative to the preceding 20 FULL sessions.

    Today's total is not available at a 15:20 preclose snapshot. Even when
    available after market close it is NOT a contemporaneous buy fill.
    """
    unknown={'ratio_to_prior20_median':None,'prior20_median_amount_krw':None,
             'amount_bin':'UNKNOWN'}
    if (not contiguous_history or len(previous_amounts)!=PREVIOUS_AMOUNT_DAYS
            or not math.isfinite(float(current_amount))
            or float(current_amount) < 0):
        return unknown
    if any(not math.isfinite(float(x)) or float(x)<=0
           for x in previous_amounts):
        return unknown
    prior=float(median(previous_amounts))
    if prior<=0:
        return unknown
    ratio=float(current_amount)/prior
    if not math.isfinite(ratio) or ratio<0:
        return unknown
    return {
        'ratio_to_prior20_median':round(ratio,5),
        'prior20_median_amount_krw':round(prior),
        'amount_bin':'HIGH' if ratio>=2 else (
            'NORMAL' if ratio>=1 else 'LOW'),
    }


def supply_bin_from_raw(bucket: str) -> str:
    if bucket in ('INSIDE', 'NEAR_0_3'):
        return 'NEAR'
    if bucket in ('MID_3_8','FAR_OVER_8','NO_UPPER'):
        return 'NOT_NEAR'
    return 'UNKNOWN'


def should_exclude(case: dict, policy: str) -> bool:
    near=case['supply_bin']=='NEAR'
    shallow=case['body_bin']=='SHALLOW'
    low=case['amount_bin']=='LOW'
    accelerating=case['trend_bin']=='STEEPENING'
    return {
        'EXCLUDE_NEAR_SUPPLY':near,
        'EXCLUDE_SHALLOW_CROSS':shallow,
        'EXCLUDE_LOW_TURNOVER':low,
        'EXCLUDE_STEEPENING_AND_SHALLOW':accelerating and shallow,
        'EXCLUDE_NEAR_AND_LOW_TURNOVER':near and low,
        'EXCLUDE_NEAR_OR_SHALLOW':near or shallow,
    }[policy]


def _summarize_subset(cases: list[dict]) -> dict:
    return {
        'outcomes':_summarize(cases),
        'equal_stake_resolved_only':equal_stake_resolved_ledger(cases),
        'unique_tickers':len({r['code'] for r in cases}),
        'unique_signal_days':len({r['day'] for r in cases}),
    }


def hypothetical_exclusion(cases: list[dict], policy: str) -> dict:
    """Post-hoc counterfactual, NOT tested execution/causal improvement."""
    excluded=[c for c in cases if should_exclude(c,policy)]
    retained=[c for c in cases if not should_exclude(c,policy)]
    past=_summarize_subset(excluded)
    kept=_summarize_subset(retained)
    stop=past['equal_stake_resolved_only']
    if len(excluded)+len(retained)!=len(cases):
        raise ValueError('CONTEXT_FILTER_EVENT_CONSERVATION')
    return {
        'excluded':past,
        'retained':kept,
        'stops_avoided_events':stop['first_stop_resolved_count'],
        'first_takes_missed_events':stop['first_take_resolved_count'],
        'gap_stops_avoided_events':past['outcomes']['stop_gap_count'],
        'modeled_stop_loss_avoided_abs_pct_points_equal_stakes':
            -stop['modeled_stops_net_pct_points_equal_stakes'],
        'modeled_take_profit_missed_pct_points_equal_stakes':
            stop['modeled_takes_net_pct_points_equal_stakes'],
        'unresolved_excluded_not_treated_as_zero_pnl':
            stop['unresolved_or_review_count'],
        'not_validated_as_future_selection_rule':True,
    }


def _examples(cases, reasons, limit=3):
    ordered=sorted((r for r in cases if r['full'] and r['reason'] in reasons),
                   key=lambda r:(-int(r['day'].replace('-','')),r['code']))
    examples, tickers, dates=[],set(),set()
    for unique_date in (True,False):
        for c in ordered:
            if c['code'] in tickers or (unique_date and c['day'] in dates):
                continue
            fields=(
                'day','touch_day','code','name','reason','net',
                'period','down_moves','slope_bin','trend_bin',
                'body_bin','body_above_line_fraction',
                'bullish_body_pct_of_open','signal_day_amount_krw',
                'ratio_to_prior20_median','amount_bin',
                'supply_bin','distance_to_zone_low_pct',
                'line_krw','open_krw','close_krw',
            )
            examples.append({k:c[k] for k in fields})
            examples[-1]['broker_verified']=False
            tickers.add(c['code'])
            dates.add(c['day'])
            if len(examples)>=limit:
                return examples
    return examples


def summarize_context(cases: list[dict]) -> dict:
    """Include every bucket, and disclose sparse four-way cells."""
    all_by={
        'by_slope':('slope_bin',SLOPE_BINS),
        'by_trend':('trend_bin',TREND_BINS),
        'by_body_depth':('body_bin',BODY_BINS),
        'by_amount_ratio':('amount_bin',TURNOVER_BINS),
        'by_supply':('supply_bin',SUPPLY_BINS),
    }
    table={
        name:{label:_summarize_subset([
            c for c in cases if c[field]==label]) for label in labels}
        for name,(field,labels) in all_by.items()
    }
    cross_keys=(
        ('trend_bin','body_bin'),
        ('body_bin','amount_bin'),
        ('body_bin','supply_bin'),
        ('slope_bin','body_bin'),
        ('trend_bin','supply_bin'),
    )
    pairwise={}
    for first,second in cross_keys:
        a=all_by[next(key for key,val in all_by.items()
                      if val[0]==first)][1]
        b=all_by[next(key for key,val in all_by.items()
                      if val[0]==second)][1]
        pairwise[first+'_X_'+second]={
            x:{y:_summarize_subset([
                c for c in cases if c[first]==x and c[second]==y])
               for y in b}
            for x in a}
    groups=defaultdict(list)
    for c in cases:
        groups[(c['trend_bin'],c['body_bin'],
                c['amount_bin'],c['supply_bin'])].append(c)
    four_way=[]
    for (trend,body,amount,supply),items in sorted(groups.items()):
        stats=_summarize_subset(items)
        four_way.append({
            'trend':trend,'body':body,'amount':amount,'supply':supply,
            'stats':stats,
            'cell_at_least_20_model_events':len(items)>=
                MIN_CELL_FOR_INTERPRETATION,
        })
    n=len(cases)
    for name,rows in table.items():
        if sum(row['outcomes']['n'] for row in rows.values())!=n:
            raise ValueError('CONTEXT_DIMENSION_CONSERVATION_'+name)
    for name,mat in pairwise.items():
        if sum(cell['outcomes']['n'] for row in mat.values()
               for cell in row.values())!=n:
            raise ValueError('CONTEXT_PAIRWISE_CONSERVATION_'+name)
    if sum(cell['stats']['outcomes']['n'] for cell in four_way)!=n:
        raise ValueError('CONTEXT_FOUR_WAY_CONSERVATION')
    return {
        'all':_summarize_subset(cases),
        **table,
        'pairwise':pairwise,
        'four_way_nonempty_cells':four_way,
        'predeclared_hypothetical_exclusions':{
            policy:hypothetical_exclusion(cases,policy)
            for policy in POLICIES},
        'first_stop_examples':_examples(cases,REASONS_STOP),
        'first_take_examples':_examples(cases,REASONS_TAKE),
        'gap_stop_examples':_examples(cases,('STOP_GAP',)),
    }


def check_against_slope(cohorts, slope_report):
    """No event silently dropped from the previously completed slope study."""
    if slope_report.get('schema')!='BLUE_DOT_SLOPE_EXPLORATORY_V1':
        raise ValueError('CONTEXT_SLOPE_BASELINE_SCHEMA')
    expected={x['flag']:x for x in slope_report['results']}
    fields=(
        'n','first_take_count','first_stop_count','stop_gap_count',
        'unresolved_no_touch_count','review_discontinuity_count',
        'severe_resolved_net_at_or_below_minus_10pct_count',
    )
    if len(cohorts)!=6 or len(expected)!=6:
        raise ValueError('CONTEXT_EXPECTED_SIX_COHORTS')
    for current in cohorts:
        old=expected[current['flag']]
        for side in ('train','holdout'):
            summary=current[side]['all']['outcomes']
            previous=old[side]['total']['stats']
            if any(summary[f]!=previous[f] for f in fields):
                raise ValueError(
                    'CONTEXT_SLOPE_RECONCILIATION_'+current['flag']+'_'+side)


def run_context_study(d, sessions, slope_report):
    flags=[f'FALL_{n}_H_L_{k}D' for n in PERIODS for k in MOVES]
    if any(f not in d.columns for f in flags):
        raise ValueError('CONTEXT_REQUIRED_FLAGS_MISSING')
    studied=[day for day in sessions
             if START<=day.strftime('%Y-%m-%d')<=END]
    if len(studied)<40:
        raise ValueError('CONTEXT_STUDY_SESSIONS_INSUFFICIENT')
    split=sessions.index(studied[len(studied)*3//4])
    last_session=len(sessions)-1
    hlc3=(d.high+d.low+d.close)/3
    grouped=hlc3.groupby(d.code,sort=False)
    lines={}
    for n in PERIODS:
        mean=grouped.transform(lambda x:x.rolling(n,min_periods=n).mean())
        std=grouped.transform(lambda x:x.rolling(n,min_periods=n).std(ddof=0))
        lines[n]=(mean-MULTIPLIER*std).groupby(
            d.code,sort=False).shift(SHIFT)
    cases=defaultdict(list)
    audit=dict(signals_found=0,excluded_embargo=0,
               excluded_no_future_session=0,
               excluded_missing_issuer_session=0,
               amount_unknown=0,older_slope_unknown=0)
    for code,h0 in d.groupby('code',sort=False):
        h=h0.reset_index().rename(columns={'index':'original_index'})
        triggered=h.loc[h[flags].any(axis=1)&h.date.between(START,END)]
        if triggered.empty:
            continue
        for i in triggered.index:
            signal=h.iloc[i]
            active=[(n,k) for n in PERIODS for k in MOVES
                    if bool(signal[f'FALL_{n}_H_L_{k}D'])]
            audit['signals_found']+=len(active)
            si=int(signal.session_index)
            if si+HORIZON<split:
                side='train'
            elif si>=split:
                side='holdout'
            else:
                audit['excluded_embargo']+=len(active)
                continue
            available=min(HORIZON,last_session-si)
            if available<=0:
                audit['excluded_no_future_session']+=len(active)
                continue
            if i+available>=len(h) or any(
                int(h.iloc[i+j].session_index)!=si+j
                for j in range(1,available+1)
            ):
                audit['excluded_missing_issuer_session']+=len(active)
                continue
            future=[(float(r.open),float(r.high),float(r.low),
                     float(r.close),float(r.prior_close))
                    for r in h.iloc[i+1:i+available+1].itertuples()]
            reason,net,held=observe_touch(float(signal.close),future,
                                           TAKE,STOP)
            touch=(h.iloc[i+held].date.strftime('%Y-%m-%d')
                   if held is not None else None)
            raw_supply=asof_supply_context(h,int(i))
            supply=supply_bin_from_raw(raw_supply['bucket'])
            amount_window=(h.amount.iloc[i-PREVIOUS_AMOUNT_DAYS:i].tolist()
                           if i>=PREVIOUS_AMOUNT_DAYS else [])
            amount_contiguous=(
                i>=PREVIOUS_AMOUNT_DAYS and
                si-int(h.iloc[i-PREVIOUS_AMOUNT_DAYS].session_index)
                ==PREVIOUS_AMOUNT_DAYS)
            turnover=turnover_features(
                float(signal.amount),amount_window,amount_contiguous)
            for n,k in active:
                if i<2*k:
                    raise ValueError('CONTEXT_REQUIRED_LINE_HISTORY_MISSING')
                line_prices=[float(x) for x in
                    lines[n].loc[h.original_index.iloc[i-2*k:i+1]]]
                prior_index=i-(n+SHIFT+2*k)
                prior_safe=(prior_index>=0 and
                    si-int(h.iloc[prior_index].session_index)
                    ==n+SHIFT+2*k)
                slope=slope_context(
                    line_prices,k,previous_contiguous=prior_safe)
                line=float(line_prices[-1])
                body=body_breakout_features(
                    float(signal.open),float(signal.close),line)
                if turnover['amount_bin']=='UNKNOWN':
                    audit['amount_unknown']+=1
                if slope['trend_bin']=='UNKNOWN':
                    audit['older_slope_unknown']+=1
                dist=raw_supply['distance_to_zone_low_pct']
                dist=(float(dist) if dist is not None
                      and math.isfinite(float(dist)) else None)
                cases[(n,k,side)].append({
                    'day':signal.date.strftime('%Y-%m-%d'),
                    'code':str(code),'name':str(signal.Name),
                    'period':n,'down_moves':k,
                    'reason':reason,'net':net,
                    'touch_day':touch,'full':si+HORIZON<=last_session,
                    'slope_bin':slope['slope_bin'],
                    'trend_bin':slope['trend_bin'],
                    'supply_bin':supply,
                    'distance_to_zone_low_pct':dist,
                    'signal_day_amount_krw':float(signal.amount),
                    'line_krw':round(line,3),
                    'open_krw':float(signal.open),
                    'close_krw':float(signal.close),
                    **body,**turnover,
                })
    results=[]
    for n in PERIODS:
        for k in MOVES:
            results.append({
                'flag':f'FALL_{n}_H_L_{k}D',
                'period':n,'down_moves':k,
                'train':summarize_context(cases[(n,k,'train')]),
                'holdout':summarize_context(cases[(n,k,'holdout')]),
            })
    check_against_slope(results,slope_report)
    for n in PERIODS:
        for side in ('train','holdout'):
            a=next(x for x in results if x['period']==n and
                   x['down_moves']==3)[side]['all']['outcomes']['n']
            b=next(x for x in results if x['period']==n and
                   x['down_moves']==5)[side]['all']['outcomes']['n']
            if b>a:
                raise ValueError('CONTEXT_FIVE_NOT_SUBSET_OF_THREE')
    return {
        'schema':'BLUE_DOT_SLOPE_BREAKOUT_AMOUNT_SUPPLY_MODEL_ONLY_V1',
        'study_start':START,'study_end':END,
        'source_sha256':slope_report['source_sha256'],
        'holdout_start':slope_report['holdout_start'],
        'signal_basis':'HLC3_LOWER_BB_20_30_40_2_SHIFT26_MODEL',
        'body_strength_definition':
            '(signal_close-model_line)/(signal_close-signal_open)',
        'body_strength_buckets':{
            'SHALLOW':'<20% of body above line',
            'MIDDLE':'20% to <60%',
            'DEEP':'>=60%',
        },
        'amount_definition':
            'full_signal_day_KRW_amount / median_prior_20_complete_sessions',
        'amount_bins':{
            'LOW':'<1x','NORMAL':'1x to <2x',
            'HIGH':'>=2x','UNKNOWN':'insufficient or invalid prior amount',
        },
        'signal_day_full_amount_only_available_EOD_not_at_1520':True,
        'supply_definition':
            'reused prior 120 bars H-L distributed volume estimated zones',
        'supply_is_not_actual_order_book':True,
        'slope_change_asof_signal_day_only':True,
        'outcome_policy':{
            'signal_day_close_assumed_fill':True,
            'first_touch_max_sessions_not_forced_exit':HORIZON,
            'take_pct':TAKE,'stop_pct':STOP,
            'assumed_cost_pct_points':0.3,
        },
        'censored_no_touch_not_zero_realized_return':True,
        'reused_2026_holdout_is_not_clean_out_of_sample':True,
        'signal_cohorts_overlap_and_are_not_independent':True,
        'four_way_small_cells_not_stable_evidence':True,
        'predeclared_filters_are_post_hoc_not_prospective':True,
        'no_broker_chart_line_or_trade_fill_verified':True,
        'no_production_search_or_AI_signal_recommendation':True,
        'audit':audit,'results':results,
    }


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--mode',choices=('plan','study'),default='plan')
    p.add_argument('--source-dir',
                   default='output/blue_dot_direction/sources')
    p.add_argument('--slope-report',
                   default='output/blue_dot_direction/slope_report.json')
    p.add_argument('--out',
                   default='output/blue_dot_direction/breakout_context_report.json')
    args=p.parse_args()
    if args.mode=='plan':
        print('BLUE_DOT_BREAKOUT_CONTEXT_PLAN',json.dumps({
            'periods':PERIODS,'decline_moves':MOVES,
            'body_depth_thresholds':[0.2,0.6],
            'amount_ratio_thresholds':[1.0,2.0],
            'first_touch_policy':[HORIZON,TAKE,STOP],
            'source_sha256':EXACT_MARCAP_HASHES,
            'no_market_download_or_database_write':True,
        }))
        return
    slope_report=json.loads(Path(args.slope_report).read_text(encoding='utf-8'))
    if slope_report.get('source_sha256')!=EXACT_MARCAP_HASHES:
        raise ValueError('CONTEXT_SLOPE_SOURCE_HASH_MISMATCH')
    raw,hashes=load_marcap([2025,2026],local_dir=args.source_dir)
    if hashes!=EXACT_MARCAP_HASHES:
        raise ValueError('CONTEXT_MARKET_SOURCE_HASH_MISMATCH')
    d,sessions,_,_=build_direction_signals(raw)
    falling_streak_flags(d)
    result=run_context_study(d,sessions,slope_report)
    out=Path(args.out)
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps(result,ensure_ascii=False,
                              indent=2,allow_nan=False)+'\n',
                   encoding='utf-8')
    print('BLUE_DOT_BREAKOUT_CONTEXT_STUDY',
          'six_cohorts_parity=TRUE','broker_verified=FALSE',
          'D1=0','TURSO=0','KIS=0','TRADES=0')


if __name__=='__main__':
    main()

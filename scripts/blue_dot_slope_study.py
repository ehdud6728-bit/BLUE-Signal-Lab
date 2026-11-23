#!/usr/bin/env python3
"""Exploratory read-only slope and acceleration study, never a trade signal."""
from __future__ import annotations

import argparse
from collections import defaultdict
import json
import math
from pathlib import Path

try:
    from scripts.blue_dot_direction_risk import (
        build_direction_signals, falling_streak_flags, PERIODS, SHIFT, MULTIPLIER)
    from scripts.blue_dot_supply_interaction import (
        asof_supply_context, equal_stake_resolved_ledger)
    from scripts.env20_rebound_comparison import (
        START, END, _summarize, observe_touch, market_breadth)
    from scripts.market_scan import load_marcap
    from scripts.research_v2_targeted_history import EXACT_MARCAP_HASHES
except ModuleNotFoundError:
    from blue_dot_direction_risk import (
        build_direction_signals, falling_streak_flags, PERIODS, SHIFT, MULTIPLIER)
    from blue_dot_supply_interaction import (
        asof_supply_context, equal_stake_resolved_ledger)
    from env20_rebound_comparison import (
        START, END, _summarize, observe_touch, market_breadth)
    from market_scan import load_marcap
    from research_v2_targeted_history import EXACT_MARCAP_HASHES

MOVES = (3, 5)
SLOPE_BINS = ('STEEP', 'MODERATE', 'GENTLE', 'NEAR_FLAT')
TREND_BINS = ('STEEPENING', 'STABLE', 'FLATTENING', 'UNKNOWN')
SUPPLY_BINS = ('NEAR', 'NOT_NEAR', 'UNKNOWN')
MARKET_BINS = ('UP', 'DOWN', 'MIXED', 'UNKNOWN')
SLOPE_THRESHOLDS = (-0.35, -0.15, -0.05)
ACCEL_THRESHOLD = 0.05
HORIZON, TAKE, STOP = 5, 2.5, 4.5


def slope_context(prices, k, previous_contiguous=True):
    """Use last 2*k+1 chronological line values, no future prices."""
    if k not in MOVES or len(prices) != 2*k+1:
        raise ValueError('SLOPE_WINDOW_SIZE')
    # The latest k descending moves MUST have valid line prices. The
    # preceding k moves are optional context and may cross a missing/invalid
    # prehistory window. Do not discard a valid signal because its earlier
    # comparison is unavailable.
    recent=prices[-k-1:]
    if any(not math.isfinite(float(x)) or float(x) <= 0 for x in recent):
        raise ValueError('SLOPE_CURRENT_WINDOW_INVALID')
    if not all(recent[i] < recent[i-1] for i in range(1,k+1)):
        raise ValueError('SLOPE_LINE_NOT_CONSECUTIVELY_DECLINING')
    current=100*(recent[-1]/recent[0]-1)/k
    if current >= 0:
        raise ValueError('SLOPE_NONNEGATIVE')
    prior_start=prices[0]
    prior_valid=(previous_contiguous and
                 math.isfinite(float(prior_start)) and float(prior_start)>0)
    previous=(100*(recent[0]/prior_start-1)/k
              if prior_valid else None)
    delta=current-previous if previous is not None else None
    b=('STEEP' if current <= SLOPE_THRESHOLDS[0]
       else 'MODERATE' if current <= SLOPE_THRESHOLDS[1]
       else 'GENTLE' if current <= SLOPE_THRESHOLDS[2]
       else 'NEAR_FLAT')
    trend=('UNKNOWN' if delta is None else
           'STEEPENING' if delta <= -ACCEL_THRESHOLD else
           'FLATTENING' if delta >= ACCEL_THRESHOLD else 'STABLE')
    return {'slope_pct_per_session':round(current,5),
            'previous_slope_pct_per_session':
                round(previous,5) if previous is not None else None,
            'slope_change_pct_points_per_session':
                round(delta,5) if delta is not None else None,
            'slope_bin':b,'trend_bin':trend}


def summarize_cases(cases):
    def item(rows):
        return {'stats':_summarize(rows),
                'resolved_unit_stakes':equal_stake_resolved_ledger(rows),
                'unique_tickers':len({x['code'] for x in rows})}
    by_slope={s:item([x for x in cases if x['slope_bin']==s])
              for s in SLOPE_BINS}
    by_trend={s:item([x for x in cases if x['trend_bin']==s])
              for s in TREND_BINS}
    by_slope_trend={
        s:{t:item([x for x in cases if x['slope_bin']==s
                   and x['trend_bin']==t]) for t in TREND_BINS}
        for s in SLOPE_BINS}
    by_slope_supply={
        s:{z:item([x for x in cases if x['slope_bin']==s
                   and x['supply_bin']==z]) for z in SUPPLY_BINS}
        for s in SLOPE_BINS}
    by_slope_market={
        s:{m:item([x for x in cases if x['slope_bin']==s
                   and x['market5']==m]) for m in MARKET_BINS}
        for s in SLOPE_BINS}
    if sum(x['stats']['n'] for x in by_slope.values())!=len(cases):
        raise ValueError('SLOPE_EVENT_NOT_CONSERVED')
    if sum(x['stats']['n'] for x in by_trend.values())!=len(cases):
        raise ValueError('SLOPE_TREND_NOT_CONSERVED')
    if any(sum(v['stats']['n'] for v in by_slope_supply[s].values())
           !=by_slope[s]['stats']['n'] for s in SLOPE_BINS):
        raise ValueError('SLOPE_SUPPLY_NOT_CONSERVED')
    def examples(reasons, limit=3):
        ordered=sorted((x for x in cases
                       if x['full'] and x['reason'] in reasons),
                       key=lambda c:(c['day'],c['code']), reverse=True)
        selected, seen_codes, seen_days=[],set(),set()
        for distinct_dates in (True,False):
            for c in ordered:
                if c['code'] in seen_codes or (
                        distinct_dates and c['day'] in seen_days):
                    continue
                selected.append({key:c[key] for key in (
                    'code','name','day','touch_day','reason','net',
                    'slope_pct_per_session','previous_slope_pct_per_session',
                    'slope_change_pct_points_per_session',
                    'slope_bin','trend_bin','supply_bin',
                    'line_last_six_krw','signal_open','signal_close')})
                selected[-1]['broker_verified']=False
                seen_codes.add(c['code'])
                seen_days.add(c['day'])
                if len(selected)>=limit:
                    return selected
        return selected
    return {'total':item(cases),'by_slope':by_slope,'by_trend':by_trend,
            'by_slope_and_trend':by_slope_trend,
            'by_slope_and_supply':by_slope_supply,
            'by_slope_and_market5':by_slope_market,
            'first_stop_examples':examples(('STOP','STOP_GAP')),
            'first_take_examples':examples(('TAKE','TAKE_GAP')),
            'stop_gap_examples':examples(('STOP_GAP',))}


def assert_parity(result, original):
    baseline=original.get('strict_falling_3_5',{})
    if baseline.get('schema')!='BLUE_DOT_FALLING_3_5_MODEL_ONLY_V1':
        raise ValueError('SLOPE_BASELINE_STRICT_REPORT_MISSING')
    expected={p['flag']:p for p in baseline['models']}
    check=('n','first_take_count','first_stop_count','stop_gap_count',
           'unresolved_no_touch_count','review_discontinuity_count',
           'severe_resolved_net_at_or_below_minus_10pct_count')
    if len(result)!=6:
        raise ValueError('SLOPE_EXPECTED_SIX_COHORTS')
    for group in result:
        baseline_group=expected.get(group['flag'])
        if baseline_group is None:
            raise ValueError('SLOPE_FLAG_NOT_IN_STRICT_STUDY')
        for part in ('train','holdout'):
            actual=group[part]['total']['stats']
            prior=baseline_group[part]
            if any(actual[k]!=prior[k] for k in check):
                raise ValueError('SLOPE_BASELINE_COUNT_MISMATCH_'+
                                 group['flag']+'_'+part)


def study(d, sessions, baseline):
    flags=[f'FALL_{n}_H_L_{k}D' for n in PERIODS for k in MOVES]
    if any(f not in d.columns for f in flags):
        raise ValueError('SLOPE_STRICT_FLAGS_MISSING')
    studied=[day for day in sessions
             if START<=day.strftime('%Y-%m-%d')<=END]
    if len(studied)<40:
        raise ValueError('SLOPE_TOO_FEW_SESSIONS')
    split=sessions.index(studied[len(studied)*3//4])
    last=len(sessions)-1
    hlc3=(d.high+d.low+d.close)/3
    by_code=hlc3.groupby(d.code,sort=False)
    lines={}
    for n in PERIODS:
        average=by_code.transform(
            lambda x:x.rolling(n,min_periods=n).mean())
        sigma=by_code.transform(
            lambda x:x.rolling(n,min_periods=n).std(ddof=0))
        lines[n]=(average-MULTIPLIER*sigma).groupby(
            d.code,sort=False).shift(SHIFT)
    market=market_breadth(d)
    grouped=defaultdict(list)
    audit={'skipped_embargo':0,'skipped_followup':0,
           'missing_issuer_sessions':0,'previous_window_unknown':0}
    for code, history in d.groupby('code',sort=False):
        h=history.reset_index().rename(columns={'index':'original_index'})
        hits=h.loc[h[flags].any(axis=1)&h.date.between(START,END)]
        if hits.empty:
            continue
        for i in hits.index:
            row=h.iloc[i]
            active=[(n,k) for n in PERIODS for k in MOVES
                    if bool(row[f'FALL_{n}_H_L_{k}D'])]
            idx=int(row.session_index)
            if idx+HORIZON<split:
                part='train'
            elif idx>=split:
                part='holdout'
            else:
                audit['skipped_embargo']+=len(active)
                continue
            available=min(HORIZON,last-idx)
            if available<=0:
                audit['skipped_followup']+=len(active)
                continue
            if i+available>=len(h) or any(
                    int(h.iloc[i+j].session_index)!=idx+j
                    for j in range(1,available+1)):
                audit['missing_issuer_sessions']+=len(active)
                continue
            future=[(float(f.open),float(f.high),float(f.low),
                     float(f.close),float(f.prior_close))
                    for f in h.iloc[i+1:i+available+1].itertuples()]
            reason,net,held=observe_touch(
                float(row.close),future,TAKE,STOP)
            context=asof_supply_context(h,int(i))
            sb=context['bucket']
            supply_bin=('NEAR' if sb in ('INSIDE','NEAR_0_3') else
                        'UNKNOWN' if sb=='UNKNOWN' else 'NOT_NEAR')
            touch_day=(h.iloc[i+held].date.strftime('%Y-%m-%d')
                       if held is not None else None)
            for n,k in active:
                if i<2*k:
                    raise ValueError('SLOPE_SIGNAL_MISSING_LINE_HISTORY')
                line_vals=lines[n].loc[h.original_index.iloc[i-2*k:i+1]]
                vals=[float(v) for v in line_vals]
                older=i-(n+SHIFT+2*k)
                safe=older>=0 and (
                    idx-int(h.iloc[older].session_index)==n+SHIFT+2*k)
                metrics=slope_context(vals,k,previous_contiguous=safe)
                if metrics['trend_bin']=='UNKNOWN':
                    audit['previous_window_unknown']+=1
                grouped[(n,k,part)].append({
                    'day':row.date.strftime('%Y-%m-%d'),
                    'code':str(code),'name':str(row.Name),'reason':reason,
                    'net':net,'touch_day':touch_day,
                    'full':idx+HORIZON<=last,
                    'market5':market.get((row.date,5),'UNKNOWN'),
                    'supply_bin':supply_bin,
                    'line_last_six_krw':[
                        round(v,3) if math.isfinite(v) and v>0 else None
                        for v in vals[-6:]],
                    'signal_open':float(row.open),
                    'signal_close':float(row.close),
                    **metrics})
    results=[]
    for n in PERIODS:
        for k in MOVES:
            results.append({'flag':f'FALL_{n}_H_L_{k}D',
                            'period':n,'decline_moves':k,
                            'train':summarize_cases(grouped[(n,k,'train')]),
                            'holdout':summarize_cases(grouped[(n,k,'holdout')])})
    assert_parity(results,baseline)
    for n in PERIODS:
        for part in ('train','holdout'):
            a=next(x for x in results
                   if x['period']==n and x['decline_moves']==3)[part][
                       'total']['stats']['n']
            b=next(x for x in results
                   if x['period']==n and x['decline_moves']==5)[part][
                       'total']['stats']['n']
            if b>a:
                raise ValueError('SLOPE_FIVE_GREATER_THAN_THREE')
    return {
        'schema':'BLUE_DOT_SLOPE_EXPLORATORY_V1',
        'source_sha256':baseline['source_sha256'],
        'study_start':START,'study_end':END,
        'holdout_start':baseline['holdout_start'],
        'slope_units':'percentage points of line per trading session',
        'slope_formula':'100*(line_t/line_t-k-1)/k',
        'slope_thresholds_pct_per_day':list(SLOPE_THRESHOLDS),
        'trend_epsilon_pct_points_per_day':ACCEL_THRESHOLD,
        'line_basis':'HLC3_LOWER_BB_20_30_40_2_SHIFT26_HYPOTHESIS',
        'policy':{'entry':'ASSUMED_SIGNAL_DAY_CLOSE','tp':TAKE,
                  'sl':STOP,'max_first_touch_sessions':HORIZON,
                  'round_trip_cost_pct_points':.3},
        'source_broker_parity_unverified':True,
        'study_signal_dates_reused_and_nonindependent':True,
        'prior_supply_proxy_not_orderbook':True,
        'market_breadth_proxy_not_official_index':True,
        'unresolved_not_counted_as_zero_profit':True,
        'no_auto_best_slope_or_production_recommendation':True,
        'audit':audit,'results':results}


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--mode',choices=('plan','study'),default='plan')
    p.add_argument('--source-dir',default='output/blue_dot_direction/sources')
    p.add_argument('--base-report',default='output/blue_dot_direction/report.json')
    p.add_argument('--out',default='output/blue_dot_direction/slope_report.json')
    args=p.parse_args()
    if args.mode=='plan':
        print('BLUE_DOT_SLOPE_PLAN',json.dumps({
            'periods':list(PERIODS),'down_moves':list(MOVES),
            'slope_thresholds':SLOPE_THRESHOLDS,
            'source_hashes':EXACT_MARCAP_HASHES,
            'no_download_no_db_no_trades':True}))
        return
    original=json.loads(Path(args.base_report).read_text(encoding='utf-8'))
    if original.get('source_sha256')!=EXACT_MARCAP_HASHES:
        raise ValueError('SLOPE_ORIGINAL_SHA_MISMATCH')
    raw,hashes=load_marcap([2025,2026],local_dir=args.source_dir)
    if hashes!=EXACT_MARCAP_HASHES:
        raise ValueError('SLOPE_SOURCE_SHA_MISMATCH')
    d,sessions,_,_=build_direction_signals(raw)
    falling_streak_flags(d)
    result=study(d,sessions,original)
    target=Path(args.out)
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(result,ensure_ascii=False,indent=2,
                                 allow_nan=False)+'\n',
                      encoding='utf-8')
    print('BLUE_DOT_SLOPE_STUDY', 'cohorts=6','STRICT_PARITY=TRUE',
          'BROKER_PARITY=FALSE','D1=0','TURSO=0','TRADES=0')


if __name__=='__main__':
    main()

"""R1.5.10.11: as-of daily resistance-zone approach outcome *research*.

Every event recomputes its own overhead daily-volume-density zone from the
PRECEDING 120 daily bars; the source date is never allowed to see future bars.
This is *not* a calibrated forecast, true volume-at-price or sell order book.
"""
from __future__ import annotations

import math
from typing import Any

import pandas as pd
from supply_profile_r15110 import estimate_supply_profile

HORIZONS = (5, 10)
WINDOW = 120
MAX_HISTORY_EVENTS = 480
COOLDOWN = 11  # avoids overlapping 10-session follow-up windows
APPROACH_PCT = 3.0
BREAK_BUFFER_PCT = 0.5
PULLBACK_FROM_ENTRY_PCT = 3.0
MIN_SHOW_RATE = 12


def _finite_positive(v: Any) -> bool:
    try:
        return math.isfinite(float(v)) and float(v) > 0
    except (ValueError, TypeError):
        return False


def _iso(v: Any) -> str:
    return str(pd.Timestamp(v).date())


def wilson_interval(successes: int, total: int) -> list[float] | None:
    """95% Wilson score CI for observed *sample frequency*, never a forecast CI."""
    if total < 1 or successes < 0 or successes > total:
        return None
    z = 1.96
    p = successes / total
    denominator = 1 + z*z/total
    center = (p + z*z/(2*total)) / denominator
    margin = z*math.sqrt(p*(1-p)/total+z*z/(4*total*total))/denominator
    return [round(100*max(0,center-margin),1), round(100*min(1,center+margin),1)]


def classify_outcome(entry_close: float, zone_high: float,
                     follow_closes: list[float], horizon: int) -> tuple[str, int | None]:
    """First decisive *closing-price* event wins. No intraday hit assumption.

    Breakout: two consecutive future daily closes >= zone upper +0.5%.
    Pullback: first future daily close <= entry close -3%.
    Otherwise undecided after a complete horizon.  The second breakout close
    is the confirmation date; rejection on an earlier day wins instead.
    """
    if not (_finite_positive(entry_close) and _finite_positive(zone_high)):
        raise ValueError('Bad entry/zone price')
    if horizon not in HORIZONS or len(follow_closes) < horizon:
        raise ValueError('Incomplete future horizon is never classifiable')
    break_level = zone_high*(1+BREAK_BUFFER_PCT/100)
    reject_level = entry_close*(1-PULLBACK_FROM_ENTRY_PCT/100)
    prior_above = False
    for day, close in enumerate(follow_closes[:horizon],start=1):
        if not _finite_positive(close):
            raise ValueError('Invalid future close')
        if close <= reject_level:
            return 'PULLBACK', day
        above = close >= break_level
        if above and prior_above:
            return 'BREAKOUT',day
        prior_above = above
    return 'UNDECIDED',None


def _zone_at(history:pd.DataFrame,idx:int) -> dict[str,Any] | None:
    # The supplied function uses current index idx only to find the price bin
    # size and nearest overhead zone, and uses exclusively [idx-120, idx-1]
    # for historical volume. It does not use price/volume at future idx+1.
    p = estimate_supply_profile(history.iloc[max(0,idx-WINDOW):idx+1])
    if p.get('supply_profile_status') != 'READY':
        return None
    low,high,close = p.get('supply_zone_low'),p.get('supply_zone_high'),history.iloc[idx].close
    if not all(_finite_positive(v) for v in (low,high,close)):
        return None
    if float(high) <= float(low):
        return None
    # Inside the band or no more than 3% below its *lower* edge.
    gap = 100 * (float(low)-float(close))/float(close)
    return {'low':round(float(low),2),'high':round(float(high),2),
        'grade':str(p.get('supply_strength_grade')),
        'gap_pct':round(gap,2),
        'eligible':float(close)<=float(high) and gap<=APPROACH_PCT}


def _event_summary(events:list[dict],history:pd.DataFrame,horizon:int) -> dict[str,Any]:
    completed=[]
    for e in events:
        i=e['index']
        if i+horizon>=len(history):
            continue   # Immature event: never put in denominator
        future=history['close'].iloc[i+1:i+1+horizon].astype(float).tolist()
        try:
            result,k=classify_outcome(e['close'],e['zone_high'],future,horizon)
        except ValueError:
            continue
        completed.append({'date':e['date'],'grade':e['grade'],
            'zone_low':e['zone_low'],'zone_high':e['zone_high'],
            'entry_close':round(e['close'],2),
            'result':result,
            'result_day':_iso(history.iloc[i+k].date) if k is not None else _iso(history.iloc[i+horizon].date)})
    n=len(completed)
    counts={'BREAKOUT':sum(e['result']=='BREAKOUT' for e in completed),
            'PULLBACK':sum(e['result']=='PULLBACK' for e in completed),
            'UNDECIDED':sum(e['result']=='UNDECIDED' for e in completed)}
    assert sum(counts.values())==n
    eligible=n>=MIN_SHOW_RATE
    rates={k:round(100*v/n,1) if eligible else None for k,v in counts.items()}
    # A chronological final 30% is shown only with n>=20, labeled exploratory;
    # the cohort and thresholds are still post-hoc and not independently validated.
    split=math.ceil(n*.7)
    recent=completed[split:] if n>=20 else []
    return {'n':n,'counts':counts,'rates_pct':rates,
        'sample_status':'EXPLORATORY_FREQUENCY' if eligible else 'INSUFFICIENT_SAMPLE',
        'breakout_wilson95_pct':wilson_interval(counts['BREAKOUT'],n) if eligible else None,
        'pullback_wilson95_pct':wilson_interval(counts['PULLBACK'],n) if eligible else None,
        'recent_holdout':({'n':len(recent),'counts':{
            k:sum(e['result']==k for e in recent) for k in counts
        }} if recent else None),
        'cases':completed[-6:]}


def analyze_zone_reactions(raw:pd.DataFrame,asof:str) -> dict[str,Any]:
    """Historical resistance approaches for a single ticker as-of `asof`.

    `raw` must have sorted or sortable `date, high, low, close, volume` columns.
    Does not return a future probability; only observed historical frequencies.
    """
    h=raw.loc[pd.to_datetime(raw.date).le(pd.Timestamp(asof))].sort_values('date').reset_index(drop=True)
    base={
        'version':'R15111_ZONE_REACTION_V1','asof':asof,
        'status':'INSUFFICIENT_HISTORY',
        'current':None,
        'criteria':{'prior_sessions':WINDOW,'approach_from_lower_pct':APPROACH_PCT,
            'breakout_above_upper_pct':BREAK_BUFFER_PCT,'breakout_confirm_closes':2,
            'pullback_below_entry_pct':PULLBACK_FROM_ENTRY_PCT,
            'dedup_sessions':COOLDOWN,'min_rate_sample':MIN_SHOW_RATE,
            'max_lookback_event_sessions':MAX_HISTORY_EVENTS},
        'cohorts':{},
        'limitations':['원본 일봉 가격·고저가 균등 거래량 배분의 추정치이며 실체결가별 거래량이 아님',
          '같은 종목의 과거 접근 사례 빈도로 미래 확률을 보장하지 않음',
          '접근일과 이전 120봉만 이용해 매물대를 만든 뒤 후속 확정 종가만 평가',
          '휴장·기업행동·수정주가·거래비용·시장과 업종 변화 미반영',
          '12건 미만에서는 비율을 숨김; 12건 이상도 탐색적 통계이며 독립 검증 아님'],
    }
    if len(h)<WINDOW+2 or any(col not in h.columns for col in ('date','high','low','close','volume')):
        return base
    now=_zone_at(h,len(h)-1)
    if now is not None:
        current={'close':round(float(h.iloc[-1].close),2),
            'zone_low':now['low'],'zone_high':now['high'],
            'grade':now['grade'],'distance_to_lower_pct':now['gap_pct'],
            'near':now['eligible']}
        base['current']=current
    start=max(WINDOW,len(h)-MAX_HISTORY_EVENTS-1)
    events=[];last_event=-COOLDOWN
    for i in range(start,len(h)-1):
        if i-last_event<COOLDOWN:
            continue
        close=h.iloc[i].close
        if not _finite_positive(close) or not _finite_positive(h.iloc[i].volume):
            continue
        zone=_zone_at(h,i)
        if zone is None or not zone['eligible']:
            continue
        events.append({'index':i,'date':_iso(h.iloc[i].date),
            'zone_low':zone['low'],'zone_high':zone['high'],
            'close':float(close),'grade':zone['grade']})
        last_event=i
    all_horizons={str(n):_event_summary(events,h,n) for n in HORIZONS}
    same=[e for e in events if now and e['grade']==now['grade']]
    same_horizons={str(n):_event_summary(same,h,n) for n in HORIZONS}
    base.update({'status':'READY' if now is not None else 'NO_UPPER_ZONE',
        'events_seen':len(events),
        'cohorts':{'same_grade':{'label':'현재와 같은 밀집도','horizons':same_horizons},
            'all':{'label':'전체 접근 사례','horizons':all_horizons}}})
    return base

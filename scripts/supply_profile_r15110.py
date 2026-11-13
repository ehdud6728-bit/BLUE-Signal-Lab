"""Research-only approximate daily volume-at-price, using prior 120 full OHLCV bars.

Uniform intrabar H-L allocation is an assumption, NOT real executed price/volume
or standing sell orders. The as-of day's volume is excluded deliberately.
"""
from __future__ import annotations

import json
import math

METHOD = 'DAILY_HL_UNIFORM_120_V2'


def estimate_supply_profile(history):
    result = {
        'supply_strength_grade': '미확인',
        'supply_strength_relative_pct': '',
        'supply_bin_share_pct': '',
        'supply_reference_price': '',
        'supply_strength_method': METHOD,
        'supply_profile_status': 'INSUFFICIENT_HISTORY',
        'supply_volume_est_shares': '',
        'supply_volume_total_shares': '',
        'supply_zone_low': '',
        'supply_zone_high': '',
        'supply_poc_price': '',
        'supply_profile_bins_json': '[]',
    }
    if len(history) < 101:
        return result
    close = float(history.iloc[-1].close)
    if not math.isfinite(close) or close <= 0:
        return result
    prior = history.iloc[-121:-1]
    valid=[]
    for b in prior.itertuples(index=False):
        try:
            low, high, vol = float(b.low), float(b.high), float(b.volume)
        except (TypeError, AttributeError, ValueError):
            continue
        if (math.isfinite(low) and math.isfinite(high) and math.isfinite(vol)
                and low > 0 and high >= low and vol >= 0):
            valid.append((low, high, vol))
    if len(valid) < 100:
        return result
    total = sum(v for _,_,v in valid)
    if total <= 0:
        return result
    width=max(close*.01,(max(b for _,b,_ in valid)-min(a for a,_,_ in valid))/400.0,.01)
    bins={}
    for low,high,vol in valid:
        if vol<=0:continue
        if high==low:
            k=math.floor(low/width)
            bins[k]=bins.get(k,0.0)+vol
            continue
        first=math.floor(low/width)
        last=math.ceil(high/width)-1
        for k in range(first,last+1):
            overlap=min(high,(k+1)*width)-max(low,k*width)
            if overlap>0:
                bins[k]=bins.get(k,0.0)+vol*overlap/(high-low)
    if not bins or max(bins.values())<=0:
        return result
    poc_key=max(bins,key=lambda k:bins[k]); peak=bins[poc_key]
    def center(k):return (k+.5)*width
    def make(k):
        v=bins[k]
        relative=100*v/peak
        return {'low':round(k*width,2), 'high':round((k+1)*width,2),
                'price':round(center(k),2),'volume_shares':int(round(v)),
                'share_pct':round(100*v/total,3),'relative_pct':round(relative,2),
                'grade':'강' if relative>=75 else ('중' if relative>=50 else ('약' if relative>=25 else '낮음'))}
    overhead=sorted((k for k,v in bins.items() if center(k)>close and v>=.25*peak),key=center)
    ref=overhead[0] if overhead else None
    # Nearby upper levels, not simply global top bins far away from price.
    nearby=sorted((k for k,v in bins.items() if center(k)>close and v>=.05*peak),key=center)[:8]
    if ref is not None and ref not in nearby:
        nearby=sorted(set(nearby+[ref]),key=center)[:9]
    result.update({
        'supply_profile_status':'READY',
        'supply_volume_total_shares':int(round(total)),
        'supply_poc_price':round(center(poc_key),2),
        'supply_profile_bins_json':json.dumps([make(k) for k in nearby],ensure_ascii=False,separators=(',',':')),
    })
    if ref is not None:
        line=make(ref)
        result.update({
            'supply_strength_grade':line['grade'],
            'supply_strength_relative_pct':line['relative_pct'],
            'supply_bin_share_pct':line['share_pct'],
            'supply_reference_price':line['price'],
            'supply_zone_low':line['low'],
            'supply_zone_high':line['high'],
            'supply_volume_est_shares':line['volume_shares'],
        })
    else:
        result['supply_profile_status']='NO_UPPER_CONCENTRATION'
    return result

"""BLUE Signal Lab R0.2: DAILY OHLCV ESTIMATED volume-at-price.

No tick/trade-at-price data is inferred. Each session's volume is distributed
70% over the candle body and 30% over the full high-low range, with exact
interval-overlap weights so the sum of bucket volume equals total input volume.
Uses only rows up to as-of; no future pivots or post-signal observations.
"""
from __future__ import annotations
import numpy as np
import pandas as pd


def _allocate(volume, lo, hi, edges, out):
    if volume <= 0: return
    if hi <= lo:
        j=int(np.clip(np.searchsorted(edges,lo,side='right')-1,0,len(out)-1))
        out[j]+=volume
        return
    overlap=np.maximum(0., np.minimum(edges[1:],hi)-np.maximum(edges[:-1],lo))
    s=overlap.sum()
    if s > 0: out[:]+=volume*overlap/s
    else: out[int(np.clip(np.searchsorted(edges,(lo+hi)/2,side='right')-1,0,len(out)-1))]+=volume


def build_profile(prices, asof_idx, lookback=120, bins=48, body_weight=.70,
                  resistance_windows=(20,60,120,224), zone_threshold=.60):
    """Returns dict with price bins, volume, strong zones and PIT metrics.

    Resistance levels are previous highs (current bar excluded). `nearest`
    means closest eligible strong *upper* zone, not maximum-volume upper bin.
    """
    if lookback < 20 or bins < 4 or not 0<=body_weight<=1: raise ValueError('invalid profile parameters')
    if not 0<=asof_idx<len(prices): raise IndexError('asof_idx out of range')
    hist=prices.iloc[max(0,asof_idx-lookback+1):asof_idx+1]
    result=dict(method='DAILY_OHLCV_BODY70_RANGE30_ESTIMATE' if body_weight==.70 else 'DAILY_OHLCV_WEIGHTED_ESTIMATE',
                lookback_bars=len(hist),available=False,edges=[],centers=[],volumes=[],zones=[],
                poc=np.nan,upper_volume_share=np.nan,nearest_supply_low=np.nan,
                nearest_supply_high=np.nan,distance_to_supply_pct=np.nan,
                supply_strength=np.nan,overlap_with_prior_high=False,
                nearest_supply_prior_high_windows='',breakout_headroom_pct=np.nan)
    if len(hist)<20:return result
    low=float(hist.low.min());high=float(hist.high.max())
    if not np.isfinite(low+high) or high<=low:return result
    edges=np.linspace(low,high,bins+1)
    volumes=np.zeros(bins,float)
    for r in hist.itertuples(index=False):
        v=float(r.volume)
        if not np.isfinite(v) or v<0:raise ValueError('invalid OHLCV volume')
        if v==0:continue
        body_lo=min(float(r.open),float(r.close));body_hi=max(float(r.open),float(r.close))
        if body_hi==body_lo:
            _allocate(v*body_weight,body_lo,body_hi,edges,volumes)
        else:_allocate(v*body_weight,body_lo,body_hi,edges,volumes)
        _allocate(v*(1-body_weight),float(r.low),float(r.high),edges,volumes)
    centers=(edges[:-1]+edges[1:])/2
    p=float(prices.close.iloc[asof_idx]);total=float(volumes.sum());peak=float(volumes.max())
    strong=volumes>=zone_threshold*peak if peak>0 else np.zeros(bins,dtype=bool)
    zones=[];i=0
    while i<bins:
        if not strong[i]:i+=1;continue
        j=i
        while j+1<bins and strong[j+1]:j+=1
        zlow=float(edges[i]);zhigh=float(edges[j+1]);zvol=float(volumes[i:j+1].sum())
        zones.append(dict(low=zlow,high=zhigh,volume=zvol,share=zvol/total if total>0 else np.nan,
                          strength=float(volumes[i:j+1].max()/peak),start_bin=i,end_bin=j))
        i=j+1
    # A zone straddling the current price is NOT an overhead zone.
    overhead=sorted((z for z in zones if z['low']>p),key=lambda z:z['low'])
    prior_highs={}
    for n in resistance_windows:
        previous=prices.iloc[max(0,asof_idx-n):asof_idx]
        if len(previous)==n:prior_highs[n]=float(previous.high.max())
    for zone in zones:
        zone['prior_high_windows']=[n for n,h in prior_highs.items() if zone['low']<=h<=zone['high']]
    result.update(available=True,edges=edges.tolist(),centers=centers.tolist(),volumes=volumes.tolist(),zones=zones,
                  poc=float(centers[np.argmax(volumes)]) if peak else np.nan,
                  upper_volume_share=float(volumes[centers>p].sum()/total) if total else np.nan)
    if overhead:
        z=overhead[0];dist=100*(z['low']/p-1)
        result.update(nearest_supply_low=z['low'],nearest_supply_high=z['high'],
                      distance_to_supply_pct=dist,breakout_headroom_pct=dist,
                      supply_strength=z['strength'],overlap_with_prior_high=bool(z['prior_high_windows']),
                      nearest_supply_prior_high_windows='|'.join(map(str,z['prior_high_windows'])))
    return result


def profile_metrics(profile):
    return dict(vp_method=profile['method'],vp_poc=profile['poc'],
                vp_above_volume_share=profile['upper_volume_share'],
                nearest_supply_zone_low=profile['nearest_supply_low'],
                nearest_supply_zone_high=profile['nearest_supply_high'],
                distance_to_nearest_supply_pct=profile['distance_to_supply_pct'],
                supply_zone_strength=profile['supply_strength'],
                overlap_with_prior_high=profile['overlap_with_prior_high'],
                nearest_supply_prior_high_windows=profile['nearest_supply_prior_high_windows'],
                breakout_headroom_pct=profile['breakout_headroom_pct'])

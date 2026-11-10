#!/usr/bin/env python3
"""Additive research diagnostics for BLUE R0.8.

The R0.6 matching/selection engine is unchanged. These diagnostics enrich only
matched rows, and use at-most the as-of date. They are not certified to match
Stock-Hunter's original valid-line, VP or oscillator research rules.
"""
from __future__ import annotations

import json
import numpy as np
import pandas as pd
from market_scan import normalise, enrich
from market_scan_r06 import scan_r06


def last_cross(enriched: pd.DataFrame, flag: str) -> str:
    if flag not in enriched or 'date' not in enriched:
        return ''
    hits = enriched.loc[enriched[flag].fillna(False).astype(bool), 'date']
    return str(hits.iloc[-1].date()) if not hits.empty else ''


def macd_metrics(history: pd.DataFrame) -> dict:
    """Standard EMA(12)-EMA(26) with EMA(9) signal; cross on the latest bar."""
    close = history['close'].astype(float)
    fast = close.ewm(span=12, adjust=False, min_periods=12).mean()
    slow = close.ewm(span=26, adjust=False, min_periods=26).mean()
    macd = fast - slow
    signal = macd.ewm(span=9, adjust=False, min_periods=9).mean()
    cross = macd.shift(1).le(signal.shift(1)) & macd.gt(signal) & signal.notna()
    last = history.loc[cross.fillna(False), 'date']
    def n(series):
        v = float(series.iloc[-1])
        return round(v, 5) if np.isfinite(v) else ''
    return {
        'macd_12_26_9': n(macd),
        'macd_signal_9': n(signal),
        'macd_histogram': n(macd - signal),
        'macd_gc': bool(cross.fillna(False).iloc[-1]),
        'macd_last_gc': str(last.iloc[-1].date()) if not last.empty else '',
    }


LINE_MAP = {
    'BB20': 'BB20_UPPER', 'BB30': 'BB30_UPPER', 'BB40': 'BB40_UPPER',
    'BB20_LOWER': 'BB20_LOWER', 'BB30_LOWER': 'BB30_LOWER',
    'BB40_LOWER': 'BB40_LOWER',
    'BB20_ALT': 'BB20_UPPER_ALT', 'BB30_ALT': 'BB30_UPPER_ALT',
    'BB40_ALT': 'BB40_UPPER_ALT',
    'BB20_LOWER_ALT': 'BB20_LOWER_ALT',
    'BB30_LOWER_ALT': 'BB30_LOWER_ALT',
    'BB40_LOWER_ALT': 'BB40_LOWER_ALT',
    'ENV20': 'ENV20_MID', 'ENV40': 'ENV40_MID',
}


def valid_line_candidates(enriched: pd.DataFrame, flags: str) -> list[dict]:
    """Lines that triggered *today's existing signal*, not backtested valid lines."""
    last = enriched.iloc[-1]
    prev = enriched.iloc[-2] if len(enriched) >= 2 else None
    close = float(last['close'])
    lines=[]
    for name in flags.split(','):
        key=LINE_MAP.get(name)
        if not key:
            continue
        v=last.get(key)
        if v is None or pd.isna(v) or float(v) <= 0:
            continue
        p=float(v)
        earlier=float(prev[key]) if prev is not None and key in prev and pd.notna(prev[key]) else None
        lines.append({
            'signal': name,
            'line_key': key,
            'price': round(p, 2),
            'gap_from_close_pct': round(100 * (close / p - 1), 3),
            'slope_pct': round(100 * (p / earlier - 1), 3) if earlier and earlier > 0 else None,
            'status': 'BODY_CROSS_RESEARCH',
        })
    return lines


def supply_strength(history: pd.DataFrame) -> dict:
    """Same R0.6 prior-120-bar typical-price proxy; strength is relative bin weight.

    Strong >= 75% of the densest bin, medium >= 50%, weak >= 25%; an
    *experimental relative histogram metric*, not true executed volume-at-price.
    """
    last = history.iloc[-1]
    close = float(last['close'])
    prior = history.iloc[:-1].tail(120)
    base = {
        'supply_strength_grade': '미확인',
        'supply_strength_relative_pct': '',
        'supply_bin_share_pct': '',
        'supply_reference_price': '',
        'supply_strength_method': 'PRIOR_120_TYPICAL_PRICE_VOLUME_BIN_V1',
    }
    if len(prior) < 100 or close <= 0:
        return base
    typical = (prior.high + prior.low + prior.close) / 3
    width = max(close * .01, .01)
    bn=np.floor(typical.astype(float) / width).astype('int64')
    hist=prior.groupby(bn)['volume'].sum()
    if hist.empty or float(hist.max()) <= 0 or float(hist.sum()) <= 0:
        return base
    max_volume=float(hist.max())
    candidates=[]
    for k,vol in hist.items():
        level=(int(k)+.5)*width
        if level > close and float(vol) >= max_volume*.25:
            candidates.append((level,float(vol)))
    if not candidates:
        return base
    level,volume=min(candidates,key=lambda pair:pair[0])
    rel=volume/max_volume*100
    base.update({
        'supply_strength_grade':'강' if rel>=75 else ('중' if rel>=50 else '약'),
        'supply_strength_relative_pct':round(rel,2),
        'supply_bin_share_pct':round(volume/float(hist.sum())*100,3),
        'supply_reference_price':round(level,2),
    })
    return base


def scan_r08(raw: pd.DataFrame, asof: str) -> tuple[list[dict],dict]:
    rows,audit=scan_r06(raw,asof)  # Critical: existing matching logic unchanged.
    clean=normalise(raw)
    target=pd.Timestamp(audit['asof'])
    clean=clean.loc[clean.date.le(target)].copy() # No future-data lookahead.
    groups={code:hist for code,hist in clean.groupby('code',sort=False)}
    diagnostics_count=0
    for r in rows:
        hist=groups.get(r['code'])
        if hist is None or hist.empty or hist.date.iloc[-1] != target:
            r['diagnostic_status']='NO_PRICE_HISTORY'
            continue
        rich=enrich(hist)
        r.update(macd_metrics(hist))
        r['rsi_last_gc']=last_cross(rich,'rsi_gc')
        for period in ('14_3_3','12_5_5','20_12_12'):
            r['slow_'+period+'_last_gc']=last_cross(rich,'slow_'+period+'_gc')
        lines=valid_line_candidates(rich,r['signals'])
        r['valid_line_candidates_json']=json.dumps(lines,ensure_ascii=False,separators=(',',':'))
        r['valid_line_candidate_count']=len(lines)
        r['valid_line_status']='RESEARCH_UNVERIFIED'
        r.update(supply_strength(hist))
        r['diagnostic_status']='R08_RESEARCH_EOD'
        diagnostics_count+=1
    audit['r08_diagnostics_rows']=diagnostics_count
    audit['r08_method']='RSI WILDER+SMA9 existing; Stoch existing; MACD EMA12/26/9; signal-line price candidates; daily supply-bin relative strength'
    audit['r08_warning']='Signal selection unchanged. Valid-line candidates and supply grades are exploratory EOD proxies, not Stock-Hunter validated lines or executed volume profile. Intraday price unavailable.'
    return rows,audit

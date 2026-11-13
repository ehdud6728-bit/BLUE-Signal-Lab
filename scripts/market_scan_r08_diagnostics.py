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
    """R15110: prior 120 daily H/L range-weighted estimated volume density."""
    from supply_profile_r15110 import estimate_supply_profile
    return estimate_supply_profile(history)


def ma_event_diagnostics(rich: pd.DataFrame) -> dict:
    """R159: compare prior/current completed EOD candles only (never future bars)."""
    if len(rich)<225:
        return {'ma_down':False,'ma_up':False,'ma_to_up':False,
                'ma112_cross':False,'ma224_cross':False}
    prev,now=rich.iloc[-2],rich.iloc[-1]
    def finite(*vals):
        return all(pd.notna(v) and np.isfinite(float(v)) for v in vals)
    def up(row):
        return finite(row.ma20,row.ma40,row.ma60) and row.ma20>row.ma40>row.ma60
    def down(row):
        return finite(row.ma20,row.ma40,row.ma60) and row.ma20<row.ma40<row.ma60
    def cross(n):
        key=f'ma{n}'
        return finite(prev.close,prev[key],now.close,now[key]) and prev.close<=prev[key] and now.close>now[key]
    return {'ma_down':bool(down(now)),'ma_up':bool(up(now)),
            'ma_to_up':bool(up(now) and not up(prev)),
            'ma112_cross':bool(cross(112)),'ma224_cross':bool(cross(224))}


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
        # Exact verified as-of EOD turnover in KRW, NOT close*volume or intraday KIS.
        traded_amount=hist.iloc[-1].amount
        if pd.notna(traded_amount) and float(traded_amount)>=0:
            r['traded_amount_krw']=int(round(float(traded_amount)))
        r.update(ma_event_diagnostics(rich))
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
    audit['r08_method']='RSI WILDER+SMA9 existing; Stoch existing; MACD EMA12/26/9; signal-line price candidates; R15110 prior-120 daily H/L uniform volume allocation estimate'
    audit['r08_warning']='Signal selection unchanged. R15110 supply volume is distributed uniformly over each daily H/L range, not observed executed-volume-at-price or resting sell orders. No breakout probability is asserted.'
    return rows,audit

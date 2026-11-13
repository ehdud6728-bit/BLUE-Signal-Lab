"""R1.5.10.12: exploratory pattern-conditioned zone reaction outlook.

No fitted ML model or calibrated probability claim. Pattern features are strictly
as-of, event outcomes are completed, and small cohorts shrink toward the same
symbol's ALL-zone-approach reference. No post-asof OHLCV is read.
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd

MATCH_MIN = 3  # grade + trend + momentum + volume: at least 3 of 4
PRIOR_CASES = 12.0
RESULTS = ('BREAKOUT', 'PULLBACK', 'UNDECIDED')


def pattern_features(history: pd.DataFrame) -> list[dict[str, bool]]:
    """Calculate indicators on entire as-of history, using only past/current rows."""
    c = history['close'].astype(float)
    v = history['volume'].astype(float)
    ma20 = c.rolling(20, min_periods=20).mean()
    delta = c.diff()
    gain = delta.clip(lower=0).ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1/14, adjust=False, min_periods=14).mean()
    rsi = 100 - (100 / (1 + gain / loss.replace(0, np.nan)))
    rsi = rsi.where(loss.ne(0), 100).where(gain.ne(0) | loss.ne(0), 50)
    macd = c.ewm(span=12, adjust=False, min_periods=12).mean() - c.ewm(span=26, adjust=False, min_periods=26).mean()
    signal = macd.ewm(span=9, adjust=False, min_periods=9).mean()
    volume_ratio = v / v.shift(1).rolling(20, min_periods=20).mean().replace(0, np.nan)
    return [{
        'trend': bool(np.isfinite(ma20.iloc[i]) and np.isfinite(ma20.iloc[i-1] if i else np.nan)
                      and c.iloc[i] >= ma20.iloc[i] and ma20.iloc[i] >= ma20.iloc[i-1]),
        'momentum': bool(np.isfinite(rsi.iloc[i]) and np.isfinite(macd.iloc[i])
                         and np.isfinite(signal.iloc[i]) and rsi.iloc[i] >= 50
                         and macd.iloc[i] >= signal.iloc[i]),
        'volume': bool(np.isfinite(volume_ratio.iloc[i]) and volume_ratio.iloc[i] >= 1.5),
    } for i in range(len(history))]


def comparable_events(history: pd.DataFrame, events: list[dict], now: dict | None):
    features = pattern_features(history)
    current = features[-1] if now is not None and features else None
    if current is None:
        return [], None
    target_grade = now.get('grade')
    candidates = []
    for event in events:
        i = event['index']
        if not (0 <= i < len(features)):
            continue
        p = features[i]
        matches = int(event['grade'] == target_grade) + sum(int(p[k] == current[k]) for k in ('trend', 'momentum', 'volume'))
        if matches >= MATCH_MIN:
            candidates.append(event)
    return candidates, current


def _direction(context: dict[str, bool] | None):
    if context is None:
        return '판단 보류'
    if context['trend'] and context['momentum']:
        return '상승 시도 우세(정성적)'
    if not context['trend'] and not context['momentum']:
        return '눌림 경계(정성적)'
    return '방향 미정(정성적)'


def forecast_horizons(pattern: dict, grade: dict, overall: dict,
                      context: dict[str,bool] | None, current: dict | None):
    """Smoothed *scenario shares*, not out-of-sample calibrated likelihoods."""
    result = {}
    for period in ('5', '10'):
        summary = overall[period]
        n_all = int(summary['n'])
        if current is None:
            result[period] = {'status': 'NO_UPPER_ZONE', 'estimated_pct': None,
                'source': 'NONE', 'basis_n': 0, 'all_n': n_all,
                'confidence': '판단 보류', 'direction': '상단 매물대 없음'}
            continue
        if n_all == 0:
            result[period] = {'status': 'QUALITATIVE_ONLY', 'estimated_pct': None,
                'source': 'NO_COMPLETED_CASES', 'basis_n': 0, 'all_n': 0,
                'confidence': '매우 낮음', 'direction': _direction(context)}
            continue
        # Dirichlet-one regularization makes a 1/1 history different from 100%.
        base = {key: (summary['counts'][key] + 1.0) / (n_all + len(RESULTS))
                for key in RESULTS}
        selected = pattern[period] if pattern[period]['n'] else (grade[period] if grade[period]['n'] else summary)
        source = ('PATTERN_SIMILAR' if pattern[period]['n'] else
                  'SAME_DENSITY' if grade[period]['n'] else 'ALL_APPROACHES')
        n = int(selected['n'])
        if source == 'ALL_APPROACHES':
            vals = base
        else:
            vals = {key: (selected['counts'][key] + PRIOR_CASES * base[key]) / (n + PRIOR_CASES)
                    for key in RESULTS}
        # One decimal output, guaranteed to sum to exactly 100%.
        br = round(100*vals['BREAKOUT'],1)
        pb = round(100*vals['PULLBACK'],1)
        und = round(100-br-pb,1)
        if und < 0:  # defensive against harmless last-decimal rounding
            pb = round(pb+und,1)
            und = 0.0
        confidence = ('매우 낮음' if n_all < 12 or n < 3 else
                      '낮음' if n_all < 30 or n < 12 else '탐색 단계')
        result[period] = {
            'status': 'EXPLORATORY_SMOOTHED',
            'estimated_pct': {'BREAKOUT': br, 'PULLBACK': pb, 'UNDECIDED': und},
            'source': source, 'basis_n': n, 'all_n': n_all,
            'confidence': confidence,
            'direction': max(RESULTS,key=lambda x: vals[x]),
        }
    return result

#!/usr/bin/env python3
"""Offline, no-order triple-barrier research for *verified* daily OHLC bars.

This module DOES NOT choose a profitable trading rule or make predictions.
Signals are known only after their EOD close; hypothetical entry is the NEXT
session's open. Take-profit, stop-loss and time stop compete for first touch.
Daily OHLC cannot resolve an intraday double touch: assume stop first.
Incomplete future bars remain PENDING, not a losing or winning observation.
No KIS call, Turso/D1 SQL, or current-market recommendation occurs here.
"""
from dataclasses import dataclass
from datetime import date
from math import isfinite
from statistics import mean, median
from typing import Sequence


@dataclass(frozen=True)
class VerifiedBar:
    day: str
    open: float
    high: float
    low: float
    close: float
    audited: bool = False


@dataclass(frozen=True)
class ExitPolicy:
    take_profit_pct: float
    stop_loss_pct: float
    max_holding_sessions: int
    total_round_trip_cost_pct: float = 0.3

    def __post_init__(self):
        if not (0 < self.take_profit_pct <= 40 and 0 < self.stop_loss_pct <= 30 and
                isinstance(self.max_holding_sessions, int) and
                not isinstance(self.max_holding_sessions, bool) and
                1 <= self.max_holding_sessions <= 40 and
                0 <= self.total_round_trip_cost_pct <= 5):
            raise ValueError('INVALID_EXIT_POLICY')


@dataclass(frozen=True)
class ExitOutcome:
    signal_day: str
    entry_day: str
    exit_day: str
    entry_price: float
    exit_price: float
    held_sessions: int
    reason: str
    gross_return_pct: float
    net_return_pct: float
    ambiguous_same_bar: bool
    # These are entire-bar OHLC extrema, NOT an observed intraday path.
    observed_bar_mfe_pct: float
    observed_bar_mae_pct: float


@dataclass(frozen=True)
class PathExtrema:
    """Descriptive high/low after the signal, not a tradable intraday path."""
    signal_day: str
    entry_day: str
    entry_price: float
    holding_sessions: int
    high_day: str
    low_day: str
    max_gain_pct: float
    max_loss_pct: float
    # Across distinct daily candles only; same-session order is unknowable.
    extrema_order: str


def observe_path(bars: Sequence[VerifiedBar], signal_index: int,
                 horizon_sessions: int) -> PathExtrema | None:
    """Observe exact next-session-open H/L extremes over H audited sessions.

    Callers MUST supply the full ordered trading-session path, excluding gaps
    after separately verifying audit dates. Never infer an intraday high/low
    sequence from a single daily OHLC bar.
    """
    if (not isinstance(signal_index, int) or isinstance(signal_index, bool) or
            not 0 <= signal_index < len(bars) or
            not isinstance(horizon_sessions, int) or isinstance(horizon_sessions, bool) or
            horizon_sessions not in (5, 10, 20, 60)):
        raise ValueError('INVALID_PATH_HORIZON')
    _valid_bars(bars)
    if signal_index + horizon_sessions >= len(bars):
        return None
    future = bars[signal_index + 1:signal_index + horizon_sessions + 1]
    entry = future[0].open
    peak = max(future, key=lambda x: x.high)
    trough = min(future, key=lambda x: x.low)
    order = ('HIGH_FIRST' if peak.day < trough.day else
             'LOW_FIRST' if trough.day < peak.day else
             'SAME_SESSION_UNRESOLVED')
    return PathExtrema(bars[signal_index].day, future[0].day, entry,
                       horizon_sessions, peak.day, trough.day,
                       100 * (peak.high / entry - 1),
                       100 * (trough.low / entry - 1), order)


def _valid_bars(bars: Sequence[VerifiedBar]) -> None:
    previous = ''
    for bar in bars:
        try:
            if date.fromisoformat(bar.day).isoformat() != bar.day:
                raise ValueError
        except (ValueError, TypeError) as exc:
            raise ValueError('INVALID_BAR_DATE') from exc
        prices = (bar.open, bar.high, bar.low, bar.close)
        if (not bar.audited or bar.day <= previous or
                not all(isfinite(x) and x > 0 for x in prices) or
                bar.high < max(bar.open, bar.close, bar.low) or
                bar.low > min(bar.open, bar.close, bar.high)):
            raise ValueError('UNVERIFIED_OR_INVALID_BAR')
        previous = bar.day


def simulate_exit(bars: Sequence[VerifiedBar], signal_index: int,
                  policy: ExitPolicy) -> ExitOutcome | None:
    """Return None if the outcome is still pending, never fill missing bars.

    `bars` must be a complete, ordered, audited trading-session path from the
    data source; this pure function does not discover omitted market holidays.
    Caller must verify trading-day continuity and corporate actions first.
    """
    if not isinstance(signal_index, int) or not 0 <= signal_index < len(bars):
        raise ValueError('INVALID_SIGNAL_INDEX')
    _valid_bars(bars)
    if signal_index + 1 >= len(bars):
        return None
    entry_day = bars[signal_index + 1].day
    entry_price = bars[signal_index + 1].open
    target = entry_price * (1 + policy.take_profit_pct / 100)
    stop = entry_price * (1 - policy.stop_loss_pct / 100)
    high_seen, low_seen = entry_price, entry_price
    end = min(len(bars), signal_index + 1 + policy.max_holding_sessions)
    for i in range(signal_index + 1, end):
        bar = bars[i]
        high_seen = max(high_seen, bar.high)
        low_seen = min(low_seen, bar.low)
        held = i - signal_index
        reason = ''
        exit_price: float | None = None
        ambiguous = False
        if bar.open <= stop:
            reason, exit_price = 'STOP_GAP', bar.open  # stop gaps worsen the fill
        elif bar.open >= target:
            reason, exit_price = 'TAKE_GAP', target  # do not assume better than limit
        elif bar.low <= stop and bar.high >= target:
            reason, exit_price, ambiguous = 'AMBIGUOUS_STOP_FIRST', stop, True
        elif bar.low <= stop:
            reason, exit_price = 'STOP', stop
        elif bar.high >= target:
            reason, exit_price = 'TAKE', target
        elif held == policy.max_holding_sessions:
            reason, exit_price = 'TIME', bar.close
        if exit_price is None:
            continue
        gross = 100 * (exit_price / entry_price - 1)
        return ExitOutcome(bars[signal_index].day, entry_day, bar.day,
                           entry_price, exit_price, held, reason, gross,
                           gross - policy.total_round_trip_cost_pct, ambiguous,
                           100 * (high_seen / entry_price - 1),
                           100 * (low_seen / entry_price - 1))
    return None  # Not yet at time barrier; no known outcome.


def describe_exits(outcomes: Sequence[ExitOutcome], min_support: int = 12) -> dict:
    """Descriptive observations only. Sample count is never a probability forecast."""
    if min_support < 3:
        raise ValueError('INVALID_MIN_SUPPORT')
    n = len(outcomes)
    if n == 0:
        return {'status': 'NO_MATURE_CASES', 'n': 0}
    values = [v.net_return_pct for v in outcomes]
    return {'status': 'EXPLORATORY' if n >= min_support else 'SMALL_SAMPLE',
            'n': n, 'mean_net_return_pct': round(mean(values), 3),
            'median_net_return_pct': round(median(values), 3),
            'positive_pct': round(100 * sum(v > 0 for v in values) / n, 1),
            'worst_net_return_pct': round(min(values), 3),
            'mean_holding_sessions': round(mean(v.held_sessions for v in outcomes), 2),
            'take_count': sum(v.reason in ('TAKE', 'TAKE_GAP') for v in outcomes),
            'stop_count': sum(v.reason in ('STOP', 'STOP_GAP',
                                          'AMBIGUOUS_STOP_FIRST') for v in outcomes),
            'time_count': sum(v.reason == 'TIME' for v in outcomes),
            'ambiguous_count': sum(v.ambiguous_same_bar for v in outcomes),
            'note': '일봉 첫 도달의 보수적 가정·거래비용 추정. 시장/업종, 기업행동 및 독립 검증 전에는 추천하지 않습니다.'}

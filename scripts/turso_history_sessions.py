#!/usr/bin/env python3
"""Find exchange sessions using the KOSPI index, never guessed weekdays.

KRX full-market EOD is still independently verified for each selected date.
Index proof is used only to exclude closed sessions from the missing-day plan.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta
import json
from pathlib import Path


def verified_sessions(start: date, end: date, index_reader) -> list[str]:
    if start > end or (end - start).days > 760:
        raise ValueError('HISTORY_CALENDAR_RANGE_INVALID')
    frame = index_reader(start.strftime('%Y%m%d'), end.strftime('%Y%m%d'), '1001')
    if frame is None or not hasattr(frame, 'index') or not hasattr(frame, 'columns'):
        raise ValueError('HISTORY_KRX_CALENDAR_UNAVAILABLE')
    if '종가' not in frame.columns:
        raise ValueError('HISTORY_KRX_CALENDAR_COLUMNS_INVALID')
    sessions = []
    for index, row in frame.iterrows():
        day = index.date() if hasattr(index, 'date') else date.fromisoformat(str(index)[:10])
        if day < start or day > end or day.weekday() >= 5 or float(row['종가']) <= 0:
            raise ValueError('HISTORY_KRX_CALENDAR_INVALID_SESSION')
        sessions.append(day.isoformat())
    if not sessions or sessions != sorted(set(sessions)):
        raise ValueError('HISTORY_KRX_CALENDAR_INCOMPLETE')
    weekdays = sum((start + timedelta(days=i)).weekday() < 5
                   for i in range((end - start).days + 1))
    # A severely truncated provider response must never be treated as holidays.
    if len(sessions) * 5 < weekdays * 3:
        raise ValueError('HISTORY_KRX_CALENDAR_INCOMPLETE')
    return sessions


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', required=True)
    parser.add_argument('--end', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    from pykrx import stock
    try:
        sessions = verified_sessions(date.fromisoformat(args.start),
                                     date.fromisoformat(args.end),
                                     stock.get_index_ohlcv_by_date)
    except Exception as exc:
        code = str(exc) if isinstance(exc, ValueError) and str(exc).startswith('HISTORY_') else 'HISTORY_KRX_CALENDAR_UNAVAILABLE'
        print('BLUE_MISSING_HISTORY_CALENDAR_BLOCKED', code)
        raise SystemExit(1) from None
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'format': 'BLUE_KRX_INDEX_SESSIONS_V1',
                                'start': args.start, 'end': args.end,
                                'sessions': sessions}, indent=2) + '\n', encoding='utf-8')
    print('BLUE_MISSING_HISTORY_CALENDAR_OK sessions=' + str(len(sessions)),
          'start=' + sessions[0], 'end=' + sessions[-1])


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Authorize a bounded Turso-only missing historical session backfill.

No KRX or database access occurs here. The scheduled writer is disabled until
both independent repository variables have been explicitly configured.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import os
import re

MANUAL_CONFIRM = 'blue-turso-missing-history-apply'
SCHEDULE_CONFIRM = 'blue-turso-missing-history-scheduled'


def guard(event: str, mode: str, lookback: str, batch: str, confirmation: str,
          repo: str, ref: str, now: datetime, auto_enabled: str = 'false',
          start_day: str = '', end_day: str = '') -> dict:
    if repo != 'ehdud6728-bit/BLUE-Signal-Lab' or ref != 'refs/heads/main':
        raise ValueError('MISSING_HISTORY_MAIN_ONLY')
    if event not in ('workflow_dispatch', 'schedule'):
        raise ValueError('MISSING_HISTORY_EVENT_NOT_ALLOWED')
    if mode not in ('audit', 'dry_run', 'apply'):
        raise ValueError('MISSING_HISTORY_MODE_INVALID')
    if not lookback.isascii() or not lookback.isdecimal() or not batch.isascii() or not batch.isdecimal():
        raise ValueError('MISSING_HISTORY_LIMIT_INVALID')
    days_back, limit = int(lookback), int(batch)
    if not 30 <= days_back <= 760 or not 1 <= limit <= 5:
        raise ValueError('MISSING_HISTORY_LIMIT_INVALID')
    if event == 'schedule':
        if start_day or end_day:
            raise ValueError('MISSING_HISTORY_SCHEDULE_RANGE_FORBIDDEN')
        if mode != 'apply' or auto_enabled != 'true' or confirmation != SCHEDULE_CONFIRM:
            raise ValueError('MISSING_HISTORY_SCHEDULE_NOT_APPROVED')
    elif mode == 'apply' and confirmation != MANUAL_CONFIRM:
        raise ValueError('MISSING_HISTORY_WRITE_NOT_CONFIRMED')
    today_kst = now.astimezone(timezone(timedelta(hours=9))).date()
    start, end = today_kst - timedelta(days=days_back), today_kst - timedelta(days=1)
    if start_day or end_day:
        if not (re.fullmatch(r'20\d{2}-\d{2}-\d{2}', start_day) and
                re.fullmatch(r'20\d{2}-\d{2}-\d{2}', end_day)):
            raise ValueError('MISSING_HISTORY_MANUAL_RANGE_INVALID')
        try:
            chosen_start, chosen_end = date.fromisoformat(start_day), date.fromisoformat(end_day)
        except ValueError:
            raise ValueError('MISSING_HISTORY_MANUAL_RANGE_INVALID') from None
        if (chosen_start > chosen_end or (chosen_end - chosen_start).days > 30 or
                chosen_start < start or chosen_end > end):
            raise ValueError('MISSING_HISTORY_MANUAL_RANGE_OUT_OF_BOUNDS')
        start, end = chosen_start, chosen_end
    return {'mode': mode, 'start': start.isoformat(), 'end': end.isoformat(),
            'batch_size': limit, 'write_allowed': mode == 'apply', 'd1_sql': 0}


def main():
    result = guard(os.getenv('GITHUB_EVENT_NAME', ''), os.getenv('HISTORY_MODE', ''),
                   os.getenv('HISTORY_LOOKBACK', ''), os.getenv('HISTORY_BATCH', ''),
                   os.getenv('HISTORY_CONFIRM', ''), os.getenv('GITHUB_REPOSITORY', ''),
                   os.getenv('GITHUB_REF', ''), datetime.now(timezone.utc),
                   os.getenv('HISTORY_AUTO_ENABLED', 'false'),
                   os.getenv('HISTORY_START_DAY', ''), os.getenv('HISTORY_END_DAY', ''))
    print('BLUE_MISSING_HISTORY_GUARD mode=' + result['mode'],
          'start=' + result['start'], 'end=' + result['end'],
          'batch=' + str(result['batch_size']), 'D1_SQL=0',
          'TURSO_WRITE=' + str(result['write_allowed']).lower())
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            for key in ('mode', 'start', 'end', 'batch_size'):
                output.write(f'{key}={result[key]}\n')


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        print('BLUE_MISSING_HISTORY_BLOCKED', str(error))
        raise SystemExit(1) from None

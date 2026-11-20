#!/usr/bin/env python3
"""Bounded operator-approved historical Turso EOD + research replay guard.

Plan mode has zero network/DB calls. Dry-run fetches and validates KRX sources
but cannot write Turso. Apply must be explicitly confirmed on main.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import os
import re


def guard(start: str, end: str, mode: str, confirmation: str,
          repository: str, ref: str, now: datetime,
          include_indicators: bool = False, indicator_confirm: str = '') -> dict:
    if mode not in ('plan', 'dry_run', 'apply'):
        raise ValueError('INVALID_HISTORY_MODE')
    if repository != 'ehdud6728-bit/BLUE-Signal-Lab' or ref != 'refs/heads/main':
        raise ValueError('HISTORY_MAIN_ONLY')
    if not re.fullmatch(r'20\d\d-\d\d-\d\d', start) or not re.fullmatch(r'20\d\d-\d\d-\d\d', end):
        raise ValueError('INVALID_HISTORY_DAY')
    try:
        first, last = date.fromisoformat(start), date.fromisoformat(end)
    except ValueError as exc:
        raise ValueError('INVALID_HISTORY_DAY') from exc
    today = now.astimezone(timezone(timedelta(hours=9))).date()
    if not (today - timedelta(days=760) <= first <= last < today) or (last - first).days > 6:
        raise ValueError('HISTORY_RANGE_NOT_SAFE')
    days = [(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)
            if (first + timedelta(days=i)).weekday() < 5]
    if not days or len(days) > 5:
        raise ValueError('HISTORY_WEEKDAY_COUNT')
    if mode == 'apply' and confirmation != f'blue-turso-history-{start}-{end}':
        raise ValueError('HISTORY_WRITE_NOT_CONFIRMED')
    if mode == 'apply' and include_indicators and indicator_confirm != 'blue-turso-all-indicators':
        raise ValueError('HISTORY_INDICATORS_NOT_CONFIRMED')
    return {'status': mode.upper(), 'days': days, 'start': start, 'end': end,
            'turso_write_permitted': mode == 'apply', 'd1_access_permitted': False,
            'indicator_write_permitted': mode == 'apply' and include_indicators}


def main():
    result = guard(os.environ.get('HISTORY_START', ''), os.environ.get('HISTORY_END', ''),
                   os.environ.get('HISTORY_MODE', 'plan'), os.environ.get('HISTORY_CONFIRM', ''),
                   os.environ.get('GITHUB_REPOSITORY', ''), os.environ.get('GITHUB_REF', ''),
                   datetime.now(timezone.utc),
                   os.environ.get('HISTORY_INDICATORS', 'false') == 'true',
                   os.environ.get('HISTORY_INDICATORS_CONFIRM', ''))
    print('BLUE_HISTORY_BATCH_GUARD', result['status'], 'days=' + ','.join(result['days']),
          'D1_SQL=0', 'TURSO_WRITES_ALLOWED=' + str(result['turso_write_permitted']).lower())
    if os.getenv('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as output:
            output.write('days=' + ' '.join(result['days']) + '\n')


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        print('BLUE_HISTORY_BATCH_BLOCKED', str(error))
        raise SystemExit(1) from None

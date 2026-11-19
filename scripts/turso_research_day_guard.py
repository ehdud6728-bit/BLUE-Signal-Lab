#!/usr/bin/env python3
"""Select an exact KST research day for a Turso-only GitHub Action.

No API/DB calls. Never silently substitute an earlier available trade day.
"""
import os
import re
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo


CONFIRM = 'blue-turso-research-only'


def select_research_day(raw_day, mode, event, confirmation, *, today=None):
    if event not in ('workflow_dispatch', 'schedule'):
        raise ValueError('INVALID_RESEARCH_EVENT')
    if mode not in ('dry_run', 'apply'):
        raise ValueError('INVALID_RESEARCH_MODE')
    if event == 'schedule' and (mode != 'apply' or raw_day or confirmation):
        raise ValueError('INVALID_SCHEDULED_RESEARCH_INPUTS')
    if event == 'workflow_dispatch' and mode == 'apply' and confirmation != CONFIRM:
        raise ValueError('RESEARCH_APPLY_CONFIRMATION_REQUIRED')
    current = today or datetime.now(ZoneInfo('Asia/Seoul')).date()
    if raw_day:
        if not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', raw_day):
            raise ValueError('INVALID_RESEARCH_DAY')
        try:
            target = date.fromisoformat(raw_day)
        except ValueError as error:
            raise ValueError('INVALID_RESEARCH_DAY') from error
    else:
        target = current
    if target > current or target.weekday() >= 5:
        raise ValueError('NOT_A_PAST_OR_PRESENT_KST_WEEKDAY')
    return {'TRADE_DAY': target.isoformat(),
            'RESEARCH_YEARS': f'{target.year - 1},{target.year}',
            'RESEARCH_MODE': mode}


def main():
    if os.environ.get('GITHUB_REPOSITORY') != 'ehdud6728-bit/BLUE-Signal-Lab' or \
            os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise ValueError('WRONG_REPOSITORY_OR_BRANCH')
    selected = select_research_day(
        os.environ.get('INPUT_DAY', '').strip(),
        os.environ.get('INPUT_MODE', '').strip(),
        os.environ.get('GITHUB_EVENT_NAME', '').strip(),
        os.environ.get('INPUT_CONFIRM', '').strip())
    with Path(os.environ['GITHUB_ENV']).open('a', encoding='utf-8') as output:
        for key, value in selected.items():
            output.write(f'{key}={value}\n')
    print('BLUE_TURSO_RESEARCH_REQUEST', selected['TRADE_DAY'], selected['RESEARCH_MODE'])
    print('D1 SQL=0; KIS tokenP=0; source/day or Turso EOD proof failure blocks writes.')


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        raise SystemExit(str(error)) from None

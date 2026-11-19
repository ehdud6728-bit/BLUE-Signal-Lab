#!/usr/bin/env python3
"""Fail-closed calendar and write guard for the one-run Turso EOD + research job.

There are no DB, KIS, or network calls here. The scheduled research opt-in
does not change the already scheduled verified-EOD ingestion policy.
"""
import os
import re
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo


CONFIRM = 'blue-turso-eod-research'


def select_pipeline_day(raw_day, mode, event, confirmation, auto_research='',
                        include_indicators='false', auto_indicators='', *, today=None):
    if event not in ('schedule', 'workflow_dispatch') or mode not in ('dry_run', 'apply'):
        raise ValueError('INVALID_UNIFIED_EVENT_OR_MODE')
    if event == 'schedule' and (mode != 'apply' or raw_day or confirmation):
        raise ValueError('INVALID_UNIFIED_SCHEDULE_INPUTS')
    if event == 'workflow_dispatch' and mode == 'apply' and confirmation != CONFIRM:
        raise ValueError('UNIFIED_APPLY_CONFIRMATION_REQUIRED')
    current = today or datetime.now(ZoneInfo('Asia/Seoul')).date()
    if raw_day:
        if not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', raw_day):
            raise ValueError('INVALID_UNIFIED_TRADE_DAY')
        try:
            target = date.fromisoformat(raw_day)
        except ValueError as error:
            raise ValueError('INVALID_UNIFIED_TRADE_DAY') from error
    else:
        target = current
    if target > current or target.weekday() >= 5:
        raise ValueError('NOT_A_PAST_OR_PRESENT_KST_WEEKDAY')
    research = event == 'workflow_dispatch' or auto_research == 'true'
    indicators = research and (include_indicators == 'true' if event == 'workflow_dispatch'
                               else auto_indicators == 'true')
    return {
        'TRADE_DAY': target.isoformat(),
        'RESEARCH_YEARS': f'{target.year - 1},{target.year}',
        'RUN_RESEARCH': 'true' if research else 'false',
        'RUN_INDICATORS': 'true' if indicators else 'false',
    }


def main():
    if os.environ.get('GITHUB_REPOSITORY') != 'ehdud6728-bit/BLUE-Signal-Lab' or \
            os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise ValueError('WRONG_REPOSITORY_OR_BRANCH')
    mode = os.environ.get('MODE', '').strip()
    day = select_pipeline_day(
        os.environ.get('INPUT_DAY', '').strip(), mode,
        os.environ.get('GITHUB_EVENT_NAME', '').strip(),
        os.environ.get('INPUT_CONFIRM', ''),
        os.environ.get('AUTO_RESEARCH_ENABLED', '').strip(),
        os.environ.get('INPUT_INDICATORS', '').strip(),
        os.environ.get('AUTO_INDICATORS_ENABLED', '').strip())
    with Path(os.environ['GITHUB_ENV']).open('a', encoding='utf-8') as out:
        for key, value in day.items():
            out.write(f'{key}={value}\n')
    print(f"BLUE_TURSO_UNIFIED_REQUEST day={day['TRADE_DAY']} mode={mode} "
          f"research={day['RUN_RESEARCH']} indicators={day['RUN_INDICATORS']}")
    print('No D1 reads/writes, no KIS token issuance, no intraday EOD substitution.')


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        raise SystemExit(str(error)) from None

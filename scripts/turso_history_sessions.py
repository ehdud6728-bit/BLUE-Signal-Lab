#!/usr/bin/env python3
"""Generate weekday *candidates* for later KRX exact-day EOD proof.

Never treat weekdays as confirmed sessions: each candidate must pass KRX
full-market verification before it counts or may be written. No KIS token.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta
import json
from pathlib import Path


def weekday_candidates(start: date, end: date) -> list[str]:
    if start > end or (end - start).days > 760:
        raise ValueError('HISTORY_CALENDAR_RANGE_INVALID')
    days = [start + timedelta(days=i) for i in range((end-start).days+1)]
    return [day.isoformat() for day in days if day.weekday() < 5]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', required=True)
    parser.add_argument('--end', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    try:
        sessions = weekday_candidates(date.fromisoformat(args.start),date.fromisoformat(args.end))
        if not sessions:
            raise ValueError('HISTORY_CALENDAR_NO_CANDIDATES')
    except ValueError as exc:
        print('BLUE_MISSING_HISTORY_CALENDAR_BLOCKED',
              str(exc) if str(exc).startswith('HISTORY_') else 'HISTORY_CALENDAR_RANGE_INVALID')
        raise SystemExit(1) from None
    path = Path(args.out)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({'format': 'BLUE_KRX_DAY_PROOF_CANDIDATES_V1',
                                'start': args.start, 'end': args.end,
                                'sessions': sessions,
                                'source_proof': 'PENDING_KRX_EXACT_DAY'}, indent=2) + '\n', encoding='utf-8')
    print('BLUE_MISSING_HISTORY_CANDIDATES weekdays=' + str(len(sessions)),
          'start=' + sessions[0], 'end=' + sessions[-1], 'KRX_PROOF=PENDING')


if __name__ == '__main__':
    main()

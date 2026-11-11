#!/usr/bin/env python3
"""BLUE R1.4 — READ-ONLY KIS quote polling -> separate Cloudflare D1 market tables.

KIS credentials and access token never leave the backend. Does not call /tokenP.
No trading endpoints, no existing EOD table mutations, no raw provider payloads persisted.
Requires existing blue_kis_closing_r13.py, blue_kis_token_vault_r131.py.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, time as dt_time, timedelta, timezone
from pathlib import Path

import blue_kis_closing_r13 as r13
import blue_kis_token_vault_r131 as vault

UTC = timezone.utc
KST = timezone(timedelta(hours=9))
# 13:00-15:25 KST, weekdays. This is a research monitoring window, not continuous tick streaming.
START = dt_time(13, 0)
END = dt_time(15, 26)
TABLE = 'blue_kis_live_quotes_r14'
HISTORY = 'blue_kis_live_history_r14'
MAX_STOCKS = 40


class LiveError(Exception):
    """Sanitized errors only, never secrets or provider response bodies."""


def in_window(now: datetime) -> bool:
    local = now.astimezone(KST)
    return local.weekday() < 5 and START <= local.time() < END


def ensure_live_tables(db) -> None:
    db.query('''CREATE TABLE IF NOT EXISTS blue_kis_live_quotes_r14 (
        trade_date TEXT NOT NULL,
        code TEXT NOT NULL,
        received_at_utc TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY(trade_date, code)
    )''')
    db.query('''CREATE TABLE IF NOT EXISTS blue_kis_live_history_r14 (
        trade_date TEXT NOT NULL,
        code TEXT NOT NULL,
        received_at_utc TEXT NOT NULL,
        price INTEGER NOT NULL,
        volume INTEGER NOT NULL,
        PRIMARY KEY(trade_date, code, received_at_utc)
    )''')
    db.query('''CREATE INDEX IF NOT EXISTS idx_blue_kis_live_history_day_r14
               ON blue_kis_live_history_r14(trade_date, code)''')


def safe_quote(code: str, c: dict, body: dict, now: datetime, source_run: int) -> dict:
    # Require prevalidated six-character ticker; reject malformed/out-of-range provider data.
    if not re.fullmatch(r'[0-9A-Z]{6}', code):
        raise LiveError('INVALID_TICKER')
    try:
        q = r13.parse_quote(c, body, now.astimezone(KST), 'r14-web-live')
    except r13.Failure as exc:
        raise LiveError(str(exc)) from None
    raw = body.get('output', {})
    reported_day = str(raw.get('stck_bsop_date') or '')
    true_day = now.astimezone(KST).strftime('%Y%m%d')
    # No implication that the exchange traded at request time.
    return {
        'code': code,
        'name': str(c.get('name') or '')[:70],
        'received_at_utc': now.astimezone(UTC).isoformat(timespec='seconds'),
        'trade_date_kst': now.astimezone(KST).date().isoformat(),
        'price': q['price'],
        'open': q['open'],
        'high': q['high'],
        'low': q['low'],
        'accumulated_volume': q['accumulated_volume'],
        'change_from_eod_pct': q['change_from_eod_pct'],
        'day_range_position_pct': q['day_range_position_pct'],
        'eod_asof': q['eod_asof'],
        'eod_close': q['eod_close'],
        'eod_signals': q['eod_signals'],
        'source_krx_run_id': source_run,
        'reported_trade_date': reported_day if re.fullmatch(r'\d{8}',reported_day) else None,
        'reported_trade_day_matches_today': reported_day == true_day,
        'exchange_tick_time_verified': False,
        'provider': 'KIS_REST_INQUIRE_PRICE',
        'research_only': True,
    }


def save_quotes(db, quotes: list[dict], now: datetime) -> None:
    if not quotes:
        raise LiveError('NO_QUOTES_TO_PUBLISH')
    if len(quotes) > MAX_STOCKS:
        raise LiveError('TOO_MANY_QUOTES')
    date_string = now.astimezone(KST).date().isoformat()
    # Parameterized multi-row INSERT. Two Cloudflare API calls for up to 40 candidates.
    slot_sql = ','.join(['(?,?,?,?)'] * len(quotes))
    bind = []
    for q in quotes:
        if q.get('trade_date_kst') != date_string:
            raise LiveError('QUOTE_DATE_MISMATCH')
        bind.extend([date_string, q['code'], q['received_at_utc'],
                     json.dumps(q, ensure_ascii=False, separators=(',', ':'))])
    db.query(f'''INSERT INTO {TABLE} (trade_date,code,received_at_utc,payload_json)
        VALUES {slot_sql}
        ON CONFLICT(trade_date,code) DO UPDATE SET
          received_at_utc=excluded.received_at_utc,
          payload_json=excluded.payload_json
        WHERE excluded.received_at_utc > {TABLE}.received_at_utc''', bind)
    slot_sql = ','.join(['(?,?,?,?,?)'] * len(quotes))
    bind = []
    for q in quotes:
        bind.extend([date_string,q['code'],q['received_at_utc'],q['price'],q['accumulated_volume']])
    db.query(f'''INSERT INTO {HISTORY} (trade_date,code,received_at_utc,price,volume)
        VALUES {slot_sql}
        ON CONFLICT(trade_date,code,received_at_utc) DO NOTHING''', bind)
    # Retain a short research trail; do not grow the quote history indefinitely.
    cutoff=(now.astimezone(KST).date()-timedelta(days=20)).isoformat()
    db.query(f'DELETE FROM {HISTORY} WHERE trade_date < ?', [cutoff])
    db.query(f'DELETE FROM {TABLE} WHERE trade_date < ?', [cutoff])


def record_result(path: Path, audit: dict) -> None:
    path.mkdir(parents=True, exist_ok=True)
    (path / 'AUDIT.json').write_text(
        json.dumps(audit, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
    )


def run(args, clock=None, database=None, client_factory=None):
    now = (clock or r13.kst_now)()
    audit = {
        'phase':'BLUE_KIS_R14_WEB_LIVE_RESEARCH_ONLY',
        'created_at_kst':now.astimezone(KST).isoformat(timespec='seconds'),
        'schedule':'13:00-15:25 KST weekday, GitHub Actions 5-minute best effort',
        'orders_enabled':False,
        'token_issuance_allowed':False,
        'exchange_tick_time_verified':False,
        'status':'STARTED',
        'published':0,
    }
    out=Path(args.out)
    try:
        if not in_window(now) and not args.force_probe:
            audit['status']='SKIPPED_OUTSIDE_WINDOW'
            print('BLUE_R14 status=SKIPPED_OUTSIDE_WINDOW no_kis_auth_requested=true')
            return 0
        if now.astimezone(KST).weekday() >= 5 and args.force_probe:
            raise LiveError('WEEKEND_FORCE_PROBE_NOT_ALLOWED')
        limit=int(args.limit)
        if not 1 <= limit <= MAX_STOCKS:
            raise LiveError('INVALID_LIMIT')
        db=database if database is not None else vault.D1Vault()
        # Create quote-specific tables; previous stock/EOD and vault rows unaffected.
        ensure_live_tables(db)
        appkey=os.environ.get('KIS_APP_KEY','').strip()
        appsecret=os.environ.get('KIS_APP_SECRET','').strip()
        if not appkey or not appsecret:
            raise LiveError('KIS_SECRETS_MISSING')
        try:
            # CACHE ONLY: an expired token will pause this collector, never issue.
            token, token_source = vault.obtain_token(appkey,appsecret,allow_new=False,vault=db)
        except vault.VaultError as exc:
            if str(exc)=='CACHE_EMPTY_OR_EXPIRED_NO_ISSUANCE':
                audit['status']='PAUSED_TOKEN_EMPTY_OR_EXPIRED'
                print('BLUE_R14 status=PAUSED_TOKEN_EMPTY_OR_EXPIRED no_token_issued=true')
                return 0
            raise LiveError('TOKEN_VAULT_'+str(exc)) from None
        if token_source != 'CACHE':
            raise LiveError('NON_CACHE_TOKEN_FORBIDDEN')
        eod, stock_rows, eod_run = r13.fetch_latest_verified_eod(now.astimezone(KST).date(),
                                                                   os.environ.get('GITHUB_TOKEN',''))
        candidates=r13.choose_candidates(stock_rows,limit)
        audit['source_krx_run_id']=eod_run
        audit['prior_eod_asof']=eod['asof']
        audit['candidate_count']=len(candidates)
        if not candidates:
            raise LiveError('NO_VERIFIED_CANDIDATES')
        client = client_factory(appkey,appsecret,token) if client_factory else r13.KISClient(appkey,appsecret,token)
        quotes=[]
        fail_codes=[]
        for c in candidates:
            try:
                body=client.quote(c['code'])
                quotes.append(safe_quote(c['code'],c,body,(clock or r13.kst_now)(),eod_run))
            except (r13.Failure, LiveError) as exc:
                fail_codes.append({'code':c['code'],'error':str(exc)})
        if not quotes:
            raise LiveError('NO_VALID_QUOTES')
        save_quotes(db,quotes,now)
        audit['published']=len(quotes)
        audit['failed']=fail_codes
        audit['token_source']='CACHE'
        audit['token_issued_this_run']=False
        audit['status']='OK' if not fail_codes else 'PARTIAL_QUOTES'
        print(f'BLUE_R14 status={audit["status"]} saved={len(quotes)} '
              f'failures={len(fail_codes)} token_source=CACHE token_issued_this_run=false')
        return 0
    except (LiveError,vault.VaultError,r13.Failure) as exc:
        audit['status']='FAILED'
        # All propagated failure identifiers come from sanitized in-project exceptions.
        audit['failure_code']=str(exc)
        print('BLUE_R14_FAILED code='+str(exc),file=sys.stderr)
        return 2
    except Exception:
        audit['status']='FAILED'
        audit['failure_code']='UNEXPECTED_ERROR'
        print('BLUE_R14_FAILED code=UNEXPECTED_ERROR',file=sys.stderr)
        return 2
    finally:
        audit['finished_at_kst']=(clock or r13.kst_now)().astimezone(KST).isoformat(timespec='seconds')
        record_result(out,audit)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--limit',type=int,default=12)
    p.add_argument('--force-probe',action='store_true',help='manual KIS probe on weekday outside closing window')
    p.add_argument('--out',default='output/kis_r14_live')
    args=p.parse_args()
    return run(args)


if __name__=='__main__':
    sys.exit(main())

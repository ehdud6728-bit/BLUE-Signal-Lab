#!/usr/bin/env python3
"""BLUE R1.5.9.7: conservative KIS token maintenance; never exposes tokens.

Issue on expiry only, at most one ATTEMPT per KST day AND 24-hour rolling
window, with an atomic Cloudflare D1 reservation BEFORE contacting tokenP.
This job does not run any market-data or order endpoints. The preexisting
collector reads the encrypted token vault as before.
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Callable

import blue_kis_token_vault_r131 as vault_mod

KST = timezone(timedelta(hours=9))
UTC = timezone.utc
ISSUANCE_TABLE = 'blue_kis_token_issuance_r1597'
COOLDOWN = timedelta(hours=24)
SKEW = timedelta(minutes=5)


def iso_utc(value: datetime) -> str:
    if value.tzinfo is None:
        raise ValueError('timezone required')
    return value.astimezone(UTC).isoformat(timespec='milliseconds')


def parse_utc(value: str) -> datetime:
    return vault_mod.parse_expiry(value)


def kst_day(now: datetime) -> str:
    return now.astimezone(KST).date().isoformat()


def load_metadata(db, appkey: str):
    """Read timestamps only. Never select ciphertext or token-related secrets."""
    rows = db.query(
        'SELECT saved_at_utc,expires_at_utc FROM blue_kis_token_vault_v1 WHERE scope=?',
        [vault_mod.scope_for(appkey)],
    )
    if len(rows) > 1:
        raise vault_mod.VaultError('VAULT_DUPLICATE_SCOPE')
    return rows[0] if rows else None


def evaluate(metadata, now: datetime) -> tuple[str, str | None]:
    if metadata is None:
        return 'MISSING_TOKEN', None
    try:
        saved = parse_utc(metadata['saved_at_utc'])
        expiry = parse_utc(metadata['expires_at_utc'])
    except (KeyError, TypeError, ValueError, vault_mod.VaultError):
        return 'INVALID_TOKEN_METADATA', None
    if saved > now + SKEW or expiry <= saved:
        return 'INVALID_TOKEN_METADATA', None
    if expiry > now + SKEW:
        return 'TOKEN_VALID', iso_utc(expiry)
    if now - saved < COOLDOWN:
        return 'WAIT_24H_FROM_LAST_SAVED', iso_utc(expiry)
    return 'TOKEN_EXPIRED_ELIGIBLE', iso_utc(expiry)


def acquire_attempt(db, scope: str, now: datetime) -> bool:
    """Atomic D1 guard. Reserve BEFORE tokenP; failures remain charged as attempts.

    Enforces both one attempt per KST calendar day AND at least 24h between
    reservations. SQLite RETURNING confirms the sole winner of a race.
    """
    db.query(f'''CREATE TABLE IF NOT EXISTS {ISSUANCE_TABLE} (
      scope TEXT PRIMARY KEY,
      last_attempt_at_utc TEXT NOT NULL,
      last_attempt_day_kst TEXT NOT NULL,
      status TEXT NOT NULL,
      last_success_at_utc TEXT
    )''')
    stamp = iso_utc(now)
    day = kst_day(now)
    rows = db.query(f'''INSERT INTO {ISSUANCE_TABLE}
        (scope,last_attempt_at_utc,last_attempt_day_kst,status,last_success_at_utc)
        VALUES(?,?,?,'CLAIMED',NULL)
        ON CONFLICT(scope) DO UPDATE SET
          last_attempt_at_utc=excluded.last_attempt_at_utc,
          last_attempt_day_kst=excluded.last_attempt_day_kst,
          status='CLAIMED'
        WHERE last_attempt_day_kst < excluded.last_attempt_day_kst
          AND (julianday(excluded.last_attempt_at_utc)-julianday(last_attempt_at_utc)) >= 1.0
        RETURNING last_attempt_at_utc''', [scope, stamp, day])
    return len(rows) == 1 and rows[0].get('last_attempt_at_utc') == stamp


def finish_attempt(db, scope: str, stamp: str, status: str, now: datetime):
    if status not in ('SAVED', 'ISSUE_FAILED', 'VAULT_SAVE_FAILED'):
        raise ValueError('unsanitized attempt status')
    db.query(f'''UPDATE {ISSUANCE_TABLE}
       SET status=?,last_success_at_utc=CASE WHEN ?='SAVED' THEN ? ELSE last_success_at_utc END
       WHERE scope=? AND last_attempt_at_utc=?''',
       [status,status,iso_utc(now),scope,stamp])


def maintain(db, appkey: str, appsecret: str, *, now: datetime,
             issue_enabled: bool, issue_once: Callable | None = None) -> dict:
    """Return safe metadata only. No provider response, ciphertext, token, or scope."""
    if now.tzinfo is None:
        raise ValueError('timezone required')
    if not appkey or not appsecret:
        raise vault_mod.VaultError('KIS_SECRETS_MISSING')
    metadata = load_metadata(db, appkey)
    state, expiry = evaluate(metadata, now)
    if not issue_enabled:
        return {'status':'CHECK_ONLY', 'token_state':state, 'expiry_utc':expiry}
    if state == 'TOKEN_VALID':
        # A timestamp alone does not prove that the encrypted cache is readable.
        # Never issue on a corrupt cache or D1 read failure; fail closed.
        try:
            cached = db.get(appkey,appsecret)
        except vault_mod.VaultError:
            return {'status':'TOKEN_CACHE_DECRYPT_FAILED', 'issued':False}
        if not cached:
            return {'status':'TOKEN_CACHE_INCONSISTENT', 'issued':False}
        return {'status':'TOKEN_VALID', 'expiry_utc':expiry, 'issued':False}
    if state in ('WAIT_24H_FROM_LAST_SAVED','INVALID_TOKEN_METADATA'):
        return {'status':state, 'expiry_utc':expiry, 'issued':False}
    # Metadata says expired/missing; the one-time endpoint may now be used.
    scope = vault_mod.scope_for(appkey)
    stamp = iso_utc(now)
    if not acquire_attempt(db, scope, now):
        return {'status':'ALREADY_ATTEMPTED_KST_DAY_OR_24H', 'issued':False}
    issuer = issue_once or vault_mod.issue_new_token_once
    try:
        token, new_expiry = issuer(appkey, appsecret)
    except Exception:
        # Do NOT retry ambiguous response failures: token may have been issued.
        finish_attempt(db, scope, stamp, 'ISSUE_FAILED', now)
        return {'status':'ISSUE_FAILED_NO_RETRY', 'issued':False}
    try:
        db.put(token,new_expiry,appkey,appsecret)
    except Exception:
        finish_attempt(db, scope, stamp, 'VAULT_SAVE_FAILED', now)
        return {'status':'VAULT_SAVE_FAILED_NO_RETRY', 'issued':False}
    finish_attempt(db, scope, stamp, 'SAVED', now)
    return {'status':'TOKEN_SAVED', 'issued':True, 'expiry_utc':iso_utc(parse_utc(new_expiry))}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mode', choices=('check','issue'), default='check')
    parser.add_argument('--scheduled', action='store_true', help='Apply KST business-day 08-19 issuance gate')
    args = parser.parse_args()
    now = datetime.now(UTC)
    kst = now.astimezone(KST)
    if args.mode == 'issue' and args.scheduled and (kst.weekday() >= 5 or not 8 <= kst.hour <= 19):
        print(json.dumps({'status':'OUTSIDE_SCHEDULED_KST_WINDOW'}))
        return
    appkey = os.environ.get('KIS_APP_KEY','').strip()
    appsecret = os.environ.get('KIS_APP_SECRET','').strip()
    if not appkey or not appsecret:
        raise SystemExit('R1597_MISSING_KIS_SECRETS')
    try:
        db = vault_mod.D1Vault()
        result = maintain(db,appkey,appsecret,now=now,issue_enabled=args.mode=='issue')
        print('R1597_RESULT '+json.dumps(result,sort_keys=True,ensure_ascii=True))
        if result['status'] in ('ISSUE_FAILED_NO_RETRY','VAULT_SAVE_FAILED_NO_RETRY','INVALID_TOKEN_METADATA','TOKEN_CACHE_DECRYPT_FAILED','TOKEN_CACHE_INCONSISTENT'):
            raise SystemExit(2)
    except vault_mod.VaultError as exc:
        # VaultError consists of sanitized identifiers, not upstream HTTP bodies.
        print('R1597_FAILURE '+str(exc))
        raise SystemExit(2) from None


if __name__ == '__main__':
    main()

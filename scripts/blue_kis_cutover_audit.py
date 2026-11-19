#!/usr/bin/env python3
"""Read-only D1 KIS issuer cutover audit. Never issues, decrypts or logs a token."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone

import blue_kis_token_vault_r131 as vault

UTC = timezone.utc
DAY = timedelta(hours=24)
PAUSE_STAMP = re.compile(r'^20\d{2}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$')
ALLOWED_ATTEMPT_STATUS = {
    'CLAIMED', 'CLAIMED_RETRY', 'SAVED', 'ISSUE_FAILED',
    'ISSUE_RETRY_FAILED', 'VAULT_SAVE_FAILED',
}


class AuditError(Exception):
    """Safe, fixed error identifier; never upstream response content."""


def parse_time(value):
    if not isinstance(value, str) or len(value) > 40:
        raise AuditError('D1_AUDIT_TIMESTAMP_INVALID')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError('timezone absent')
        return parsed.astimezone(UTC)
    except (TypeError, ValueError, OverflowError):
        raise AuditError('D1_AUDIT_TIMESTAMP_INVALID') from None


def as_utc(value):
    return value.astimezone(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def single_row(db, sql, scope):
    if not sql.lstrip().upper().startswith('SELECT '):
        raise AuditError('D1_AUDIT_NOT_READONLY')
    result = db.query(sql, [scope])
    if len(result) > 1:
        raise AuditError('D1_AUDIT_DUPLICATE_SCOPE')
    return result[0] if result else None


def audit(db, appkey, env, now):
    if not appkey:
        raise AuditError('KIS_APP_KEY_MISSING')
    if now.tzinfo is None:
        raise AuditError('D1_AUDIT_NOW_INVALID')
    now = now.astimezone(UTC)
    scope = vault.scope_for(appkey)
    # Read only timestamps and a fixed ledger status. No ciphertext, app
    # secret, access token, issuance endpoint or mutable SQL in this script.
    saved = single_row(db, '''SELECT saved_at_utc,expires_at_utc
        FROM blue_kis_token_vault_v1 WHERE scope=? LIMIT 2''', scope)
    attempt = single_row(db, '''SELECT last_attempt_at_utc,last_attempt_day_kst,
        status,last_success_at_utc FROM blue_kis_token_issuance_r1597
        WHERE scope=? LIMIT 2''', scope)
    paused = str(env.get('BLUE_KIS_TOKEN_AUTO_PAUSED', '')).lower() == 'true'
    approved = str(env.get('BLUE_KIS_TURSO_CUTOVER_APPROVED', '')).lower() == 'true'
    stop_raw = str(env.get('BLUE_KIS_D1_DISABLED_AT_UTC', '')).strip()
    saved_at = parse_time(saved['saved_at_utc']) if saved else None
    expires_at = parse_time(saved['expires_at_utc']) if saved else None
    attempt_at = parse_time(attempt['last_attempt_at_utc']) if attempt else None
    last_success_at = (parse_time(attempt['last_success_at_utc'])
                       if attempt and attempt.get('last_success_at_utc') else None)
    status = str(attempt['status']) if attempt else 'NO_LEDGER_ROW'
    if attempt and status not in ALLOWED_ATTEMPT_STATUS:
        raise AuditError('D1_AUDIT_LEDGER_STATUS_INVALID')
    if saved_at and expires_at and expires_at <= saved_at:
        raise AuditError('D1_AUDIT_VAULT_TIMESTAMP_INVALID')
    times = [t for t in (saved_at, attempt_at, last_success_at) if t is not None]
    result = {
        'paused': paused,
        'turso_approved': approved,
        'now_utc': as_utc(now),
        'last_saved_at_utc': as_utc(saved_at) if saved_at else None,
        'token_expires_at_utc': as_utc(expires_at) if expires_at else None,
        'last_attempt_at_utc': as_utc(attempt_at) if attempt_at else None,
        'last_attempt_status': status,
        'last_success_at_utc': as_utc(last_success_at) if last_success_at else None,
        'pause_at_utc': None,
        'earliest_eligible_at_utc': None,
        'cutover_ready': False,
    }
    if not paused:
        reason = 'LEGACY_ISSUER_NOT_PAUSED'
    elif not PAUSE_STAMP.fullmatch(stop_raw):
        reason = 'PAUSE_TIMESTAMP_NOT_RECORDED'
    elif not attempt:
        # Missing history cannot prove when the last tokenP attempt happened.
        reason = 'D1_ISSUANCE_LEDGER_UNVERIFIED'
    else:
        stop = parse_time(stop_raw)
        result['pause_at_utc'] = as_utc(stop)
        if stop > now:
            reason = 'PAUSE_TIMESTAMP_IN_FUTURE'
        elif any(activity > stop for activity in times):
            reason = 'D1_ACTIVITY_AFTER_PAUSE'
        else:
            eligible = max([stop, *times]) + DAY
            result['earliest_eligible_at_utc'] = as_utc(eligible)
            if now < eligible:
                reason = 'WAIT_24H_SINCE_D1_PAUSED'
            else:
                reason = 'READY_FOR_MANUAL_REVIEW'
                result['cutover_ready'] = True
    result['status'] = reason
    if approved and not result['cutover_ready']:
        result['warning'] = 'TURSO_APPROVAL_SET_BEFORE_AUDIT_READY'
    return result


def main():
    try:
        key = os.environ.get('KIS_APP_KEY', '').strip()
        if not key:
            raise AuditError('KIS_APP_KEY_MISSING')
        db = vault.D1Vault()
        result = audit(db, key, os.environ, datetime.now(UTC))
        print('BLUE_KIS_D1_CUTOVER_AUDIT ' + json.dumps(result, sort_keys=True))
    except (AuditError, vault.VaultError) as exc:
        # Both are fixed sanitized error identifiers. Never log HTTP bodies.
        print('BLUE_KIS_D1_CUTOVER_AUDIT_FAILED ' + str(exc))
        raise SystemExit(2) from None


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""KIS access token vault: encrypted Cloudflare D1 storage, fail-closed by default.

Never writes credentials or tokens into GitHub Actions logs/artifacts/repository.
Uses the same Cloudflare D1 DB already configured in worker/wrangler.jsonc.
Does not contain stock order logic. One explicit token issuance at most per invocation.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import request, error

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

KST = timezone(timedelta(hours=9))
UTC = timezone.utc
KIS_URL = 'https://openapi.koreainvestment.com:9443'
CLOCK_SKEW = timedelta(minutes=5)
SCOPE_PREFIX = 'KIS_PROD_READONLY_V1_'

class VaultError(Exception):
    """Fixed, sanitized error identifiers only. Never raw provider errors."""


def utcnow():
    return datetime.now(UTC)


def scope_for(appkey):
    return SCOPE_PREFIX + hashlib.sha256(appkey.encode('utf-8')).hexdigest()[:20]


def cipher_key(appkey, appsecret):
    if not appkey or not appsecret:
        raise VaultError('KIS_SECRETS_MISSING')
    return HKDF(
        algorithm=hashes.SHA256(), length=32,
        salt=hashlib.sha256(('BLUE_KIS_R131_VAULT_' + appkey).encode()).digest(),
        info=b'BLUE-Signal-Lab encrypted KIS access-token D1 v1',
    ).derive(appsecret.encode('utf-8'))


def encrypt_token(token, appkey, appsecret):
    nonce = secrets.token_bytes(12)
    encoded = AESGCM(cipher_key(appkey, appsecret)).encrypt(
        nonce, token.encode('utf-8'), scope_for(appkey).encode('utf-8')
    )
    return base64.urlsafe_b64encode(nonce + encoded).decode('ascii')


def decrypt_token(encoded, appkey, appsecret):
    try:
        blob = base64.urlsafe_b64decode(encoded)
        if len(blob) < 29:
            raise ValueError('short')
        token = AESGCM(cipher_key(appkey, appsecret)).decrypt(
            blob[:12], blob[12:], scope_for(appkey).encode('utf-8')
        ).decode('utf-8')
        if not token:
            raise ValueError('empty')
        return token
    except (ValueError, InvalidTag, UnicodeError):
        raise VaultError('DECRYPT_FAILED') from None


def parse_expiry(expires):
    try:
        dt = datetime.fromisoformat(str(expires).replace('Z', '+00:00'))
        if dt.tzinfo is None:  # KIS access_token_token_expired uses KST local clock
            dt = dt.replace(tzinfo=KST)
        return dt.astimezone(UTC)
    except (TypeError, ValueError, OverflowError):
        raise VaultError('EXPIRY_INVALID') from None


def valid_until(expires, now=None):
    now = now or utcnow()
    return parse_expiry(expires) > now + CLOCK_SKEW


def database_id():
    try:
        conf_path = Path(__file__).resolve().parents[1] / 'worker' / 'wrangler.jsonc'
        conf = json.loads(conf_path.read_text(encoding='utf-8'))
        selected = [x for x in conf['d1_databases'] if x.get('database_name') == 'blue-signal-lab-db']
        if len(selected) != 1:
            raise ValueError('missing')
        v = selected[0]['database_id']
        if not re.fullmatch(r'[0-9a-fA-F-]{36}', str(v)):
            raise ValueError('bad uuid')
        return v
    except (ValueError, KeyError, OSError, TypeError):
        raise VaultError('D1_CONFIGURATION_INVALID') from None


class D1Vault:
    def __init__(self):
        self.account_id = os.environ.get('CLOUDFLARE_ACCOUNT_ID', '').strip()
        self.api_token = os.environ.get('CLOUDFLARE_API_TOKEN', '').strip()
        if not self.account_id or not self.api_token or not re.fullmatch('[a-fA-F0-9]{32}', self.account_id):
            raise VaultError('CLOUDFLARE_SECRETS_MISSING')
        self.db_id = database_id()

    def query(self, sql, params=None):
        url = ('https://api.cloudflare.com/client/v4/accounts/' + self.account_id +
               '/d1/database/' + self.db_id + '/query')
        payload = json.dumps({'sql': sql, 'params': params or []}).encode('utf-8')
        req = request.Request(url, data=payload, headers={
            'Authorization': 'Bearer ' + self.api_token,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }, method='POST')
        try:
            with request.urlopen(req, timeout=25) as res:
                decoded = json.loads(res.read(250_000).decode('utf-8'))
            if decoded.get('success') is not True:
                raise VaultError('D1_QUERY_FAILED')
            groups = decoded.get('result', [])
            if not isinstance(groups, list) or not groups or groups[0].get('success') is not True:
                raise VaultError('D1_QUERY_FAILED')
            result = groups[0].get('results', [])
            if not isinstance(result, list):
                raise VaultError('D1_RESPONSE_INVALID')
            return result
        except VaultError:
            raise
        except (error.HTTPError, error.URLError, TimeoutError, OSError, ValueError, UnicodeError, AttributeError):
            raise VaultError('D1_UNAVAILABLE') from None

    def ensure_table(self):
        self.query('''CREATE TABLE IF NOT EXISTS blue_kis_token_vault_v1 (
            scope TEXT PRIMARY KEY, ciphertext TEXT NOT NULL,
            expires_at_utc TEXT NOT NULL, saved_at_utc TEXT NOT NULL
        )''')

    def get(self, appkey, appsecret):
        rows = self.query('SELECT ciphertext, expires_at_utc FROM blue_kis_token_vault_v1 WHERE scope = ?', [scope_for(appkey)])
        if not rows:
            return None
        row = rows[0]
        expiry = row.get('expires_at_utc')
        if not valid_until(expiry):
            return None
        return decrypt_token(row['ciphertext'], appkey, appsecret)

    def put(self, token, expiry, appkey, appsecret):
        dt = parse_expiry(expiry)
        if not valid_until(dt.isoformat()):
            raise VaultError('TOKEN_ALREADY_EXPIRED')
        self.query('''INSERT INTO blue_kis_token_vault_v1
            (scope,ciphertext,expires_at_utc,saved_at_utc) VALUES (?,?,?,?)
            ON CONFLICT(scope) DO UPDATE SET ciphertext=excluded.ciphertext,
            expires_at_utc=excluded.expires_at_utc,saved_at_utc=excluded.saved_at_utc''',
            [scope_for(appkey), encrypt_token(token, appkey, appsecret),
             dt.isoformat(), utcnow().isoformat()])


def issue_new_token_once(appkey, appsecret):
    body = json.dumps({'grant_type': 'client_credentials',
                       'appkey': appkey, 'appsecret': appsecret}).encode('utf-8')
    req = request.Request(KIS_URL + '/oauth2/tokenP', data=body, method='POST',
                          headers={'Content-Type': 'application/json', 'Accept': 'application/json'})
    try:
        with request.urlopen(req, timeout=20) as resp:
            result = json.loads(resp.read(50_000).decode('utf-8'))
    except (error.HTTPError, error.URLError, TimeoutError, OSError, ValueError, UnicodeError):
        raise VaultError('KIS_ISSUE_FAILED_NO_AUTO_RETRY') from None
    if not isinstance(result, dict) or not isinstance(result.get('access_token'), str):
        raise VaultError('KIS_TOKEN_MISSING')
    expiration = result.get('access_token_token_expired')
    if not expiration:
        raise VaultError('KIS_EXPIRATION_MISSING')
    if not valid_until(expiration):
        raise VaultError('KIS_EXPIRATION_INVALID')
    return result['access_token'], expiration


def obtain_token(appkey, appsecret, allow_new=False, vault=None):
    """Only explicit allow_new=True may call tokenP. Fail closed on D1 errors.

    Returns (token, 'CACHE' or 'NEW_EXPLICIT') with token never logged.
    """
    if not appkey or not appsecret:
        raise VaultError('KIS_SECRETS_MISSING')
    db = vault if vault is not None else D1Vault()
    db.ensure_table()
    cached = db.get(appkey, appsecret)
    if cached:
        return cached, 'CACHE'
    if not allow_new:
        raise VaultError('CACHE_EMPTY_OR_EXPIRED_NO_ISSUANCE')
    # Exactly one issuance request; no retry and never performed in cache-only mode.
    token, expiry = issue_new_token_once(appkey, appsecret)
    db.put(token, expiry, appkey, appsecret)
    return token, 'NEW_EXPLICIT'

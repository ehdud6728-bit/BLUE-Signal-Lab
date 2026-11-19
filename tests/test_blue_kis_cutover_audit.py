import importlib.util
import pathlib
import sys
import unittest
from datetime import datetime, timedelta, timezone

HERE = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE / 'scripts'))
spec = importlib.util.spec_from_file_location(
    'blue_kis_cutover_audit', HERE / 'scripts' / 'blue_kis_cutover_audit.py')
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
UTC = timezone.utc
NOW = datetime(2026, 11, 19, 2, 0, tzinfo=UTC)
GOOD = {
    'BLUE_KIS_TOKEN_AUTO_PAUSED': 'true',
    'BLUE_KIS_D1_DISABLED_AT_UTC': '2026-11-18T01:00:00.000Z',
    'BLUE_KIS_TURSO_CUTOVER_APPROVED': 'false',
}


class ReadOnlyDB:
    def __init__(self, saved=True, ledger=True):
        self.calls = []
        self.saved = ({
            'saved_at_utc': '2026-11-17T07:20:08.000Z',
            'expires_at_utc': '2026-11-18T07:20:08.000Z'
        } if saved else None)
        self.ledger = ({
            'last_attempt_at_utc': '2026-11-17T07:20:08.000Z',
            'last_attempt_day_kst': '2026-11-17',
            'status': 'SAVED',
            'last_success_at_utc': '2026-11-17T07:20:08.000Z'
        } if ledger else None)

    def query(self, sql, params=None):
        self.calls.append((sql, params))
        if 'FROM blue_kis_token_vault_v1' in sql:
            return [self.saved] if self.saved else []
        if 'FROM blue_kis_token_issuance_r1597' in sql:
            return [self.ledger] if self.ledger else []
        raise AssertionError('unexpected SQL')


class Safety(unittest.TestCase):
    def test_never_logs_or_selects_secrets_or_mutates_db(self):
        db = ReadOnlyDB()
        result = mod.audit(db, 'test-app-key', GOOD, NOW)
        self.assertTrue(result['cutover_ready'])
        self.assertEqual(result['status'], 'READY_FOR_MANUAL_REVIEW')
        self.assertEqual(len(db.calls), 2)
        for sql, params in db.calls:
            self.assertTrue(sql.lstrip().upper().startswith('SELECT '))
            self.assertNotIn('ciphertext', sql.lower())
            self.assertNotIn('access_token', sql.lower())
            self.assertNotIn('appsecret', sql.lower())
            self.assertNotIn('test-app-key', str(params))
        self.assertNotIn('test-app-key', str(result))
        self.assertNotIn('ciphertext', str(result).lower())

    def test_paused_variable_must_be_proven(self):
        r = mod.audit(ReadOnlyDB(), 'key', {**GOOD, 'BLUE_KIS_TOKEN_AUTO_PAUSED': 'false'}, NOW)
        self.assertEqual(r['status'], 'LEGACY_ISSUER_NOT_PAUSED')
        self.assertFalse(r['cutover_ready'])

    def test_pause_timestamp_missing_is_not_ready(self):
        r = mod.audit(ReadOnlyDB(), 'key', {**GOOD, 'BLUE_KIS_D1_DISABLED_AT_UTC': ''}, NOW)
        self.assertEqual(r['status'], 'PAUSE_TIMESTAMP_NOT_RECORDED')

    def test_timestamp_in_future_is_rejected(self):
        r = mod.audit(ReadOnlyDB(), 'key',
                      {**GOOD, 'BLUE_KIS_D1_DISABLED_AT_UTC': '2026-11-20T01:00:00.000Z'}, NOW)
        self.assertEqual(r['status'], 'PAUSE_TIMESTAMP_IN_FUTURE')

    def test_minimum_24h_since_pause_is_enforced(self):
        early = NOW - timedelta(hours=23)
        r = mod.audit(ReadOnlyDB(), 'key',
                      {**GOOD, 'BLUE_KIS_D1_DISABLED_AT_UTC': mod.as_utc(early)}, NOW)
        self.assertEqual(r['status'], 'WAIT_24H_SINCE_D1_PAUSED')
        self.assertEqual(r['earliest_eligible_at_utc'], mod.as_utc(early + timedelta(hours=24)))

    def test_manual_early_cutover_needs_saved_issue_older_than_24h(self):
        recent_pause = mod.as_utc(NOW - timedelta(hours=1))
        early_env = {**GOOD, 'BLUE_KIS_D1_DISABLED_AT_UTC': recent_pause,
                     'BLUE_KIS_EARLY_CUTOVER_APPROVED': 'true'}
        r = mod.audit(ReadOnlyDB(), 'key', early_env, NOW)
        self.assertEqual(r['status'], 'EARLY_READY_FOR_MANUAL_REVIEW')
        self.assertTrue(r['early_cutover_ready'])
        self.assertFalse(r['cutover_ready'])
        self.assertEqual(r['earliest_eligible_at_utc'], mod.as_utc(NOW + timedelta(hours=23)))
        db = ReadOnlyDB()
        db.ledger['status'] = 'ISSUE_FAILED'
        self.assertFalse(mod.audit(db, 'key', early_env, NOW)['early_cutover_ready'])
        db = ReadOnlyDB()
        db.saved['saved_at_utc'] = mod.as_utc(NOW - timedelta(hours=10))
        db.saved['expires_at_utc'] = mod.as_utc(NOW + timedelta(hours=14))
        self.assertFalse(mod.audit(db, 'key', early_env, NOW)['early_cutover_ready'])

    def test_any_d1_issuance_attempt_after_pause_invalidates_cutover(self):
        db = ReadOnlyDB()
        db.ledger['last_attempt_at_utc'] = '2026-11-18T01:20:00.000Z'
        r = mod.audit(db, 'key', GOOD, NOW)
        self.assertEqual(r['status'], 'D1_ACTIVITY_AFTER_PAUSE')
        self.assertFalse(r['cutover_ready'])

    def test_ledger_missing_fails_closed(self):
        r = mod.audit(ReadOnlyDB(ledger=False), 'key', GOOD, NOW)
        self.assertEqual(r['status'], 'D1_ISSUANCE_LEDGER_UNVERIFIED')

    def test_bad_metadata_fails_closed(self):
        db = ReadOnlyDB()
        db.ledger['status'] = 'UNTRUSTED'
        with self.assertRaisesRegex(mod.AuditError, 'D1_AUDIT_LEDGER_STATUS_INVALID'):
            mod.audit(db, 'key', GOOD, NOW)
        db = ReadOnlyDB()
        db.saved['saved_at_utc'] = 'BAD_TIMESTAMP'
        with self.assertRaisesRegex(mod.AuditError, 'D1_AUDIT_TIMESTAMP_INVALID'):
            mod.audit(db, 'key', GOOD, NOW)

    def test_premature_turso_approval_flag_is_reported(self):
        r = mod.audit(ReadOnlyDB(), 'key', {
            **GOOD, 'BLUE_KIS_TOKEN_AUTO_PAUSED': 'false',
            'BLUE_KIS_TURSO_CUTOVER_APPROVED': 'true'
        }, NOW)
        self.assertEqual(r['warning'], 'TURSO_APPROVAL_SET_BEFORE_AUDIT_READY')


if __name__ == '__main__':
    unittest.main()

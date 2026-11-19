import importlib.util
import io
import pathlib
import sqlite3
import sys
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock

SRC = pathlib.Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0,str(SRC))
spec = importlib.util.spec_from_file_location('blue_kis_daily_token_r1597',SRC/'blue_kis_daily_token_r1597.py')
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
UTC = timezone.utc
KST = timezone(timedelta(hours=9))
NOW = datetime(2026,11,13,1,0,0,tzinfo=UTC)

class SQLiteDB:
    def __init__(self, metadata=None, valid_cache=False):
        self.conn=sqlite3.connect(':memory:')
        self.conn.row_factory=sqlite3.Row
        self.conn.execute('CREATE TABLE blue_kis_token_vault_v1 (scope TEXT PRIMARY KEY, saved_at_utc TEXT, expires_at_utc TEXT, ciphertext TEXT)')
        self.metadata=metadata
        self.calls=[]
        self.fail_put=False
        if metadata:
            self.conn.execute('INSERT INTO blue_kis_token_vault_v1 VALUES(?,?,?,?)',(
                mod.vault_mod.scope_for('key'),metadata['saved_at_utc'],metadata['expires_at_utc'],'NEVER_PRINT'))
    def query(self,sql,params=None):
        self.calls.append((sql,params))
        q=self.conn.execute(sql,params or [])
        return [dict(x) for x in q.fetchall()] if q.description else []
    def get(self,appkey,appsecret):
        return 'VALID_TEST_CACHE' if self.query('SELECT expires_at_utc FROM blue_kis_token_vault_v1 WHERE scope=?',[mod.vault_mod.scope_for(appkey)]) else None
    def put(self,token,expiry,appkey,appsecret):
        if self.fail_put: raise RuntimeError('test simulated failure')
        self.conn.execute('INSERT OR REPLACE INTO blue_kis_token_vault_v1 VALUES(?,?,?,?)',(
          mod.vault_mod.scope_for(appkey),mod.iso_utc(NOW),expiry,'NEVER_PRINT'))

def metadata(saved_at,expiry):
    return {'saved_at_utc':saved_at.isoformat(),'expires_at_utc':expiry.isoformat()}

class Tests(unittest.TestCase):
    def test_scheduled_maintenance_is_automatic_with_emergency_pause(self):
        workflow=(SRC.parent/'.github/workflows/blue_kis_daily_token_r1597.yml').read_text(encoding='utf-8')
        self.assertIn("if: github.event_name != 'schedule' || vars.BLUE_KIS_TOKEN_AUTO_PAUSED != 'true'",workflow)
        self.assertIn("ALLOW_ISSUE: ${{ github.event_name == 'schedule' && 'true' || inputs.enable_issuance }}",workflow)
        self.assertNotIn('BLUE_KIS_TOKEN_AUTO_ENABLED',workflow)
        self.assertIn('python scripts/blue_kis_daily_token_r1597.py --mode issue --scheduled',workflow)
        self.assertIn("cron: '0,30 21 * * *'",workflow)
    def test_scheduled_window_includes_daily_0600_kst(self):
        self.assertTrue(mod.scheduled_window(datetime(2026,11,18,21,0,tzinfo=UTC)))
        self.assertTrue(mod.scheduled_window(datetime(2026,11,21,21,30,tzinfo=UTC)))
        self.assertFalse(mod.scheduled_window(datetime(2026,11,21,22,0,tzinfo=UTC)))
        self.assertFalse(mod.scheduled_window(datetime(2026,11,18,20,30,tzinfo=UTC)))

    def test_readonly_no_mutation_no_issue(self):
        db=SQLiteDB(metadata(NOW-timedelta(hours=25),NOW-timedelta(minutes=1)))
        issuer=Mock()
        result=mod.maintain(db,'key','secret',now=NOW,issue_enabled=False,issue_once=issuer)
        self.assertEqual(result['status'],'CHECK_ONLY')
        self.assertTrue(all(sql.lstrip().upper().startswith('SELECT ') for sql, _ in db.calls))
        issuer.assert_not_called()
        self.assertNotIn('NEVER_PRINT',str(result))
        self.assertEqual(result['token_state'],'TOKEN_EXPIRED_ELIGIBLE')
    def test_check_only_detects_broken_decryption_without_issuance(self):
        db=SQLiteDB(metadata(NOW-timedelta(hours=3),NOW+timedelta(hours=21)))
        db.get=Mock(side_effect=mod.vault_mod.VaultError('DECRYPT_FAILED'))
        issuer=Mock()
        result=mod.maintain(db,'key','secret',now=NOW,issue_enabled=False,issue_once=issuer)
        self.assertEqual(result['status'],'CHECK_ONLY')
        self.assertEqual(result['token_state'],'TOKEN_CACHE_DECRYPT_FAILED')
        self.assertEqual(result['expiry_utc'],mod.iso_utc(NOW+timedelta(hours=21)))
        self.assertTrue(all(sql.lstrip().upper().startswith('SELECT ') for sql,_ in db.calls))
        issuer.assert_not_called()
        self.assertNotIn('NEVER_PRINT',str(result))
    def test_check_only_distinguishes_missing_and_inconsistent_cache(self):
        empty=SQLiteDB()
        self.assertEqual(mod.maintain(empty,'key','secret',now=NOW,issue_enabled=False)['token_state'],'MISSING_TOKEN')
        inconsistent=SQLiteDB(metadata(NOW-timedelta(hours=1),NOW+timedelta(hours=23)))
        inconsistent.get=Mock(return_value=None)
        result=mod.maintain(inconsistent,'key','secret',now=NOW,issue_enabled=False)
        self.assertEqual(result['token_state'],'TOKEN_CACHE_INCONSISTENT')
    def test_valid_token_never_issues(self):
        db=SQLiteDB(metadata(NOW-timedelta(hours=8),NOW+timedelta(hours=16)))
        issuer=Mock()
        self.assertEqual(mod.maintain(db,'key','secret',now=NOW,issue_enabled=True,issue_once=issuer)['status'],'TOKEN_VALID')
        issuer.assert_not_called()
    def test_expired_but_saved_under_24h_blocked(self):
        db=SQLiteDB(metadata(NOW-timedelta(hours=23),NOW-timedelta(minutes=1)))
        issuer=Mock()
        self.assertEqual(mod.maintain(db,'key','secret',now=NOW,issue_enabled=True,issue_once=issuer)['status'],'WAIT_24H_FROM_LAST_SAVED')
        issuer.assert_not_called()
    def test_expired_issues_once_and_saves(self):
        db=SQLiteDB(metadata(NOW-timedelta(hours=25),NOW-timedelta(hours=1)))
        issuer=Mock(return_value=('SECRET_ACCESS_TOKEN',(NOW+timedelta(hours=24)).isoformat()))
        first=mod.maintain(db,'key','secret',now=NOW,issue_enabled=True,issue_once=issuer)
        self.assertEqual(first['status'],'TOKEN_SAVED')
        self.assertEqual(issuer.call_count,1)
        self.assertNotIn('SECRET_ACCESS_TOKEN',str(first))
        second=mod.maintain(db,'key','secret',now=NOW+timedelta(minutes=5),issue_enabled=True,issue_once=issuer)
        self.assertEqual(second['status'],'TOKEN_VALID')
        self.assertEqual(issuer.call_count,1)
    def test_renewal_due_within_one_hour_respects_saved_24h(self):
        db=SQLiteDB(metadata(NOW-timedelta(hours=23,minutes=50),NOW+timedelta(minutes=10)))
        issuer=Mock()
        result=mod.maintain(db,'key','secret',now=NOW,issue_enabled=True,issue_once=issuer)
        self.assertEqual(result['status'],'WAIT_24H_FROM_LAST_SAVED')
        issuer.assert_not_called()

    def test_atomic_claim_race_allows_only_first(self):
        db=SQLiteDB()
        scope=mod.vault_mod.scope_for('key')
        self.assertTrue(mod.acquire_attempt(db,scope,NOW))
        self.assertFalse(mod.acquire_attempt(db,scope,NOW+timedelta(minutes=1)))
    def test_next_kst_day_but_under_24h_blocked(self):
        db=SQLiteDB()
        scope=mod.vault_mod.scope_for('key')
        start=datetime(2026,11,12,14,55,tzinfo=UTC)  # 23:55 KST
        later=datetime(2026,11,12,15,5,tzinfo=UTC)  # 00:05 KST next day
        self.assertTrue(mod.acquire_attempt(db,scope,start))
        self.assertFalse(mod.acquire_attempt(db,scope,later))
    def test_same_kst_day_after_24h_impossible_but_guarded(self):
        db=SQLiteDB()
        scope=mod.vault_mod.scope_for('key')
        self.assertTrue(mod.acquire_attempt(db,scope,NOW))
        self.assertFalse(mod.acquire_attempt(db,scope,NOW+timedelta(hours=23)))
    def test_failed_tokenP_retries_once_after_delay(self):
        db=SQLiteDB()
        issuer=Mock(side_effect=RuntimeError('provider opaque details'))
        result=mod.maintain(db,'key','secret',now=NOW,issue_enabled=True,issue_once=issuer)
        self.assertEqual(result['status'],'ISSUE_FAILED_RETRY_AFTER_30M')
        early=mod.maintain(db,'key','secret',now=NOW+timedelta(minutes=20),issue_enabled=True,issue_once=issuer)
        self.assertEqual(early['status'],'ALREADY_ATTEMPTED_KST_DAY_OR_24H')
        retry=mod.maintain(db,'key','secret',now=NOW+timedelta(minutes=31),issue_enabled=True,issue_once=issuer)
        self.assertEqual(retry['status'],'ISSUE_FAILED_FINAL')
        final=mod.maintain(db,'key','secret',now=NOW+timedelta(minutes=90),issue_enabled=True,issue_once=issuer)
        self.assertEqual(final['status'],'ALREADY_ATTEMPTED_KST_DAY_OR_24H')
        self.assertEqual(issuer.call_count,2)
        self.assertNotIn('provider opaque',str(result))
    def test_token_saved_but_audit_failure_never_retries(self):
        db=SQLiteDB()
        db.fail_put=True
        issuer=Mock(return_value=('secret',(NOW+timedelta(hours=24)).isoformat()))
        self.assertEqual(mod.maintain(db,'key','secret',now=NOW,issue_enabled=True,issue_once=issuer)['status'],'VAULT_SAVE_FAILED_NO_RETRY')
        self.assertEqual(mod.maintain(db,'key','secret',now=NOW+timedelta(minutes=5),issue_enabled=True,issue_once=issuer)['status'],'ALREADY_ATTEMPTED_KST_DAY_OR_24H')
        self.assertEqual(issuer.call_count,1)
    def test_bad_metadata_fails_closed(self):
        db=SQLiteDB({'saved_at_utc':'NOT-A-DATE','expires_at_utc':'2026-11-12T00:00:00Z'})
        issuer=Mock()
        self.assertEqual(mod.maintain(db,'key','secret',now=NOW,issue_enabled=True,issue_once=issuer)['status'],'INVALID_TOKEN_METADATA')
        issuer.assert_not_called()
    def test_corrupted_cache_never_issues(self):
        db=SQLiteDB(metadata(NOW-timedelta(hours=5),NOW+timedelta(hours=19)))
        db.get=Mock(side_effect=mod.vault_mod.VaultError('DECRYPT_FAILED'))
        issuer=Mock()
        self.assertEqual(mod.maintain(db,'key','secret',now=NOW,issue_enabled=True,issue_once=issuer)['status'],'TOKEN_CACHE_DECRYPT_FAILED')
        issuer.assert_not_called()
    def test_database_failure_never_contacts_provider(self):
        db=SQLiteDB()
        issuer=Mock()
        def fail(*_): raise mod.vault_mod.VaultError('D1_NETWORK_UNAVAILABLE')
        db.query=fail
        with self.assertRaisesRegex(mod.vault_mod.VaultError,'D1_NETWORK_UNAVAILABLE'):
            mod.maintain(db,'key','secret',now=NOW,issue_enabled=True,issue_once=issuer)
        issuer.assert_not_called()

if __name__=='__main__': unittest.main()

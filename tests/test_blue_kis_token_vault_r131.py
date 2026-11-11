import importlib.util
import sys
import unittest
from pathlib import Path
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

S = Path(__file__).resolve().parents[1] / 'scripts' / 'blue_kis_token_vault_r131.py'
spec = importlib.util.spec_from_file_location('blue_kis_token_vault_r131', S)
vault = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = vault
spec.loader.exec_module(vault)

class FakeDB:
    def __init__(self, cached=None):
        self.cached=cached
        self.saved=[]
        self.checked=False
    def ensure_table(self): self.checked=True
    def get(self,*args): return self.cached
    def put(self,*args): self.saved.append(args)

class TokenVaultTests(unittest.TestCase):
    def test_encrypt_roundtrip_and_tamper_detect(self):
        c=vault.encrypt_token('secret bearer token','key','secret')
        self.assertNotIn('secret bearer token',c)
        self.assertEqual(vault.decrypt_token(c,'key','secret'),'secret bearer token')
        with self.assertRaises(vault.VaultError):vault.decrypt_token(c,'key','other-secret')

    def test_scope_independent_per_appkey(self):
        self.assertNotEqual(vault.scope_for('accountA'),vault.scope_for('accountB'))

    def test_cache_only_never_issues_when_empty(self):
        db=FakeDB()
        with patch.object(vault,'issue_new_token_once') as issue:
            with self.assertRaisesRegex(vault.VaultError,'CACHE_EMPTY_OR_EXPIRED_NO_ISSUANCE'):
                vault.obtain_token('key','secret',vault=db)
            issue.assert_not_called()
        self.assertTrue(db.checked)

    def test_cached_token_always_reused_even_allow_new(self):
        db=FakeDB('EXISTING_TOKEN')
        with patch.object(vault,'issue_new_token_once') as issue:
            got,origin=vault.obtain_token('key','secret',allow_new=True,vault=db)
            self.assertEqual((got,origin),('EXISTING_TOKEN','CACHE'))
            issue.assert_not_called()

    def test_explicit_issuance_one_call_and_persist(self):
        db=FakeDB()
        exp=(datetime.now(timezone.utc)+timedelta(hours=23)).isoformat()
        with patch.object(vault,'issue_new_token_once',return_value=('NEW_TOKEN',exp)) as issue:
            got, origin=vault.obtain_token('key','secret',allow_new=True,vault=db)
            self.assertEqual((got,origin),('NEW_TOKEN','NEW_EXPLICIT'))
            issue.assert_called_once()
            self.assertEqual(len(db.saved),1)

    def test_expiry_buffer(self):
        shortly=(datetime.now(timezone.utc)+timedelta(minutes=2)).isoformat()
        self.assertFalse(vault.valid_until(shortly))
        tomorrow=(datetime.now(timezone.utc)+timedelta(hours=23)).isoformat()
        self.assertTrue(vault.valid_until(tomorrow))

if __name__=='__main__':unittest.main()

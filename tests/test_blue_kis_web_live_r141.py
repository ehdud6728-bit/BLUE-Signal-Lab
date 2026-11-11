"""Offline integration/contract checks. No KIS calls, no cloud network calls."""
import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
SCRIPTS=ROOT/'scripts'
sys.path.insert(0,str(SCRIPTS))
KST=timezone(timedelta(hours=9))

# If the real R1.3.1 source is not in this patch-only ZIP, inject inert modules.
if not (SCRIPTS/'blue_kis_closing_r13.py').exists():
    r13=types.ModuleType('blue_kis_closing_r13')
    class Failure(Exception):pass
    r13.Failure=Failure
    r13.kst_now=lambda:datetime.now(KST)
    def parse_quote(c,b,dt,label):
        raw=b['output']
        return {'price':int(raw['stck_prpr']),'open':int(raw['stck_oprc']),
            'high':int(raw['stck_hgpr']),'low':int(raw['stck_lwpr']),
            'accumulated_volume':int(raw['acml_vol']),
            'change_from_eod_pct':1,'day_range_position_pct':20,
            'eod_asof':c['eod_date'],'eod_close':c['eod_close'],
            'eod_signals':c['eod_signals']}
    r13.parse_quote=parse_quote
    r13.choose_candidates=lambda rows,n:rows[:n]
    sys.modules[r13.__name__]=r13
if not (SCRIPTS/'blue_kis_token_vault_r131.py').exists():
    vault=types.ModuleType('blue_kis_token_vault_r131')
    class VaultError(Exception):pass
    vault.VaultError=VaultError
    vault.obtain_token=lambda *a,**kw:('FAKE_TOKEN','CACHE')
    sys.modules[vault.__name__]=vault

spec=importlib.util.spec_from_file_location('blue_r141',SCRIPTS/'blue_kis_web_live_r141.py')
r141=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=r141
spec.loader.exec_module(r141)

class FakeDB:
    def __init__(self):self.calls=[]
    def query(self,s,params=None):self.calls.append((s,params));return []

class TestR141(unittest.TestCase):
    def at(self,h,m=0,s=0,day=11):return datetime(2026,11,day,h,m,s,tzinfo=KST)
    def test_pre_session(self):
        self.assertEqual(r141.market_phases(self.at(8)),(('NX','NXT_PRE'),))
        self.assertEqual(r141.market_phases(self.at(8,49)),(('NX','NXT_PRE'),))
        self.assertEqual(r141.market_phases(self.at(8,50)),())
        self.assertEqual(r141.market_phases(self.at(8,55)),())
    def test_regular_and_opening_boundary(self):
        self.assertEqual(r141.market_phases(self.at(9)),(('J','KRX_REGULAR'),))
        self.assertEqual(len(r141.market_phases(self.at(9,0,30))),2)
        self.assertEqual(r141.market_phases(self.at(15,19)),(('J','KRX_REGULAR'),('NX','NXT_MAIN')))
        self.assertEqual(r141.market_phases(self.at(15,20)),())
        self.assertEqual(r141.market_phases(self.at(15,30)),())
    def test_after_market_end(self):
        self.assertEqual(r141.market_phases(self.at(15,40)),(('NX','NXT_AFTER'),))
        self.assertEqual(r141.market_phases(self.at(16)),(('J','KRX_AFTER'),('NX','NXT_AFTER')))
        self.assertEqual(r141.market_phases(self.at(19,59)),(('J','KRX_AFTER'),('NX','NXT_AFTER')))
        self.assertEqual(r141.market_phases(self.at(20)),())
        self.assertEqual(r141.market_phases(self.at(13,day=14)),())
    def test_separate_d1_tables_and_no_order_tables(self):
        db=FakeDB();r141.ensure_tables(db)
        sql='\n'.join(s for s,_ in db.calls)
        self.assertIn('PRIMARY KEY(trade_date,market,code)',sql)
        self.assertIn('blue_kis_live_history_r141',sql)
        self.assertNotIn('UPDATE signals',sql)
        self.assertNotIn('DELETE FROM runs',sql)
    def test_quote_market_and_stale_provider_date_rejected(self):
        cand={'code':'005930','name':'삼성전자','eod_date':'2026-11-10','eod_close':99,'eod_signals':'BB20'}
        good={'rt_cd':'0','output':{'stck_prpr':'100','stck_oprc':'99','stck_hgpr':'101','stck_lwpr':'98','acml_vol':'1000','stck_bsop_date':'20261111'}}
        q=r141.parse_market_quote(cand,'NX','NXT_PRE',good,self.at(8,5),99)
        self.assertEqual(q['market'],'NX')
        self.assertTrue(q['reported_trade_day_matches_today'])
        self.assertFalse(q['exchange_tick_time_verified'])
        self.assertEqual(q['phase'],'NXT_PRE')
        old={'rt_cd':'0','output':dict(good['output'],stck_bsop_date='20261110')}
        with self.assertRaisesRegex(r141.MarketError,'PROVIDER_TRADE_DAY_MISMATCH'):
            r141.parse_market_quote(cand,'NX','NXT_PRE',old,self.at(8,5),99)
        missing={'rt_cd':'0','output':dict(good['output'],stck_bsop_date='')}
        q=r141.parse_market_quote(cand,'NX','NXT_PRE',missing,self.at(8,5),99)
        self.assertIsNone(q['reported_trade_day_matches_today'])
    def test_krx_nxt_one_ticker_two_records(self):
        db=FakeDB();now=self.at(16,5)
        def quote(m,phase):return {'code':'005930','market':m,'phase':phase,'trade_date_kst':'2026-11-11',
            'received_at_utc':now.astimezone(timezone.utc).isoformat(),
            'price':100,'accumulated_volume':9}
        r141.write_quotes(db,[quote('J','KRX_AFTER'),quote('NX','NXT_AFTER')],now)
        self.assertEqual(len(db.calls),4)
        sql,params=db.calls[0]
        self.assertIn('ON CONFLICT(trade_date,market,code)',sql)
        self.assertEqual(params[1],'J')
        self.assertEqual(params[6],'NX')
    def test_duplicate_market_code_fails_before_d1_write(self):
        db=FakeDB();now=self.at(16)
        q={'code':'005930','market':'J','trade_date_kst':'2026-11-11',
           'received_at_utc':now.astimezone(timezone.utc).isoformat(),
           'price':10,'accumulated_volume':9,'phase':'KRX_AFTER'}
        with self.assertRaisesRegex(r141.MarketError,'BAD_QUOTE_BATCH_ROW'):
            r141.write_quotes(db,[q,q],now)
        self.assertEqual(db.calls,[])
    def test_dry_run_no_network_and_outside_market(self):
        class A:limit=12;dry_run=True
        with tempfile.TemporaryDirectory() as folder:
            A.out=folder;db=FakeDB()
            rc=r141.run(A,clock=lambda:self.at(8),database=db)
            self.assertEqual(rc,0);self.assertEqual(db.calls,[])
            self.assertEqual(json.loads((Path(folder)/'AUDIT.json').read_text())['status'],'DRY_RUN_NO_NETWORK')
            A.dry_run=False
            rc=r141.run(A,clock=lambda:self.at(8,50),database=db)
            self.assertEqual(rc,0);self.assertEqual(db.calls,[])
    def test_token_cache_only_not_issued_if_expired(self):
        class A:limit=12;dry_run=False
        with tempfile.TemporaryDirectory() as folder:
            A.out=folder;db=FakeDB()
            with patch.dict(os.environ,{'KIS_APP_KEY':'fake-key','KIS_APP_SECRET':'fake-secret'}), \
                patch.object(r141.vault,'obtain_token',side_effect=r141.vault.VaultError('CACHE_EMPTY_OR_EXPIRED_NO_ISSUANCE')) as obtain:
                rc=r141.run(A,clock=lambda:self.at(8,5),database=db)
            self.assertEqual(rc,0)
            self.assertEqual(obtain.call_args.kwargs['allow_new'],False)
            self.assertEqual(json.loads((Path(folder)/'AUDIT.json').read_text())['status'],'PAUSED_TOKEN_EMPTY_OR_EXPIRED')
    def test_workflow_cron_and_no_issue_flag(self):
        text=(ROOT/'.github/workflows/blue_kis_web_live_r14.yml').read_text()
        self.assertIn("'*/5 23 * * 0-4'",text)
        self.assertIn("'*/5 0-10 * * 1-5'",text)
        self.assertNotIn('--allow-new-token',text)
        self.assertIn('scripts/blue_kis_web_live_r141.py',text)

if __name__=='__main__':unittest.main()

import importlib.util
import json
import sys
import tempfile
import types
import unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
from unittest.mock import patch

script_dir=Path(__file__).resolve().parents[1]/'scripts'
sys.path.insert(0,str(script_dir))
# Local standalone tests use inert substitutes; CI repository uses actual R1.3.1 modules.
try:
    import blue_kis_closing_r13
except ImportError:
    module=types.ModuleType('blue_kis_closing_r13')
    module.Failure=type('Failure',(Exception,),{})
    module.kst_now=lambda:datetime.now(timezone(timedelta(hours=9)))
    module.parse_quote=lambda c,b,now,label: {'price':100,'open':100,'high':101,'low':99,'accumulated_volume':1000,'change_from_eod_pct':1.0,'day_range_position_pct':50,'eod_asof':'2026-11-10','eod_close':99,'eod_signals':'BB20'}
    sys.modules[module.__name__]=module
try:
    import blue_kis_token_vault_r131
except ImportError:
    module=types.ModuleType('blue_kis_token_vault_r131')
    module.VaultError=type('VaultError',(Exception,),{})
    module.obtain_token=lambda *a,**kw: None
    sys.modules[module.__name__]=module

spec=importlib.util.spec_from_file_location('blue_r14',script_dir/'blue_kis_web_live_r14.py')
r14=importlib.util.module_from_spec(spec);sys.modules[spec.name]=r14;spec.loader.exec_module(r14)
KST=timezone(timedelta(hours=9))

class FakeDB:
    def __init__(self):self.calls=[]
    def query(self,sql,params=None):self.calls.append((sql,params));return []

class R14Tests(unittest.TestCase):
    def test_schedule_window(self):
        self.assertTrue(r14.in_window(datetime(2026,11,11,13,0,tzinfo=KST)))
        self.assertTrue(r14.in_window(datetime(2026,11,11,15,25,tzinfo=KST)))
        self.assertFalse(r14.in_window(datetime(2026,11,11,15,26,tzinfo=KST)))
        self.assertFalse(r14.in_window(datetime(2026,11,14,14,tzinfo=KST)))
    def test_ensure_tables_are_isolated_from_eod(self):
        db=FakeDB();r14.ensure_live_tables(db)
        text='\n'.join(x[0] for x in db.calls)
        self.assertIn('blue_kis_live_quotes_r14',text)
        self.assertIn('blue_kis_live_history_r14',text)
        self.assertNotIn('DROP TABLE',text)
        self.assertNotIn('UPDATE signals',text)
    def test_prepared_batch_quotes_and_history(self):
        db=FakeDB();now=datetime(2026,11,11,13,10,tzinfo=KST)
        vals=[dict(code=code,trade_date_kst='2026-11-11',received_at_utc='2026-11-11T04:10:00+00:00',price=100,accumulated_volume=900) for code in ('005930','000660')]
        r14.save_quotes(db,vals,now)
        self.assertEqual(len(db.calls),4)
        self.assertEqual(len(db.calls[0][1]),8)
        self.assertEqual(len(db.calls[1][1]),10)
        self.assertTrue('?' in db.calls[0][0]);self.assertIn('ON CONFLICT',db.calls[0][0])
    def test_holiday_or_missed_schedule_never_touches_cloud(self):
        class Args:limit=12;force_probe=False
        with tempfile.TemporaryDirectory() as folder:
            Args.out=folder
            db=FakeDB()
            ret=r14.run(Args,clock=lambda:datetime(2026,11,11,12,59,tzinfo=KST),database=db)
            self.assertEqual(ret,0);self.assertEqual(db.calls,[])
            self.assertEqual(json.loads((Path(folder)/'AUDIT.json').read_text())['status'],'SKIPPED_OUTSIDE_WINDOW')
    def test_cache_only_pause_never_issues_token(self):
        class Args:limit=12;force_probe=False
        with tempfile.TemporaryDirectory() as folder:
            Args.out=folder
            db=FakeDB()
            with patch.dict(r14.os.environ,{'KIS_APP_KEY':'fake','KIS_APP_SECRET':'fake'}),\
                patch.object(r14.vault,'obtain_token',side_effect=r14.vault.VaultError('CACHE_EMPTY_OR_EXPIRED_NO_ISSUANCE')) as get:
                ret=r14.run(Args,clock=lambda:datetime(2026,11,11,13,1,tzinfo=KST),database=db)
            self.assertEqual(ret,0)
            self.assertEqual(get.call_args.kwargs['allow_new'],False)
            self.assertEqual(json.loads((Path(folder)/'AUDIT.json').read_text())['status'],'PAUSED_TOKEN_EMPTY_OR_EXPIRED')
    def test_quote_data_has_no_credentials_or_claimed_exchange_timestamp(self):
        now=datetime(2026,11,11,13,10,tzinfo=KST)
        c={'code':'005930','name':'삼성전자','eod_close':99,'eod_date':'2026-11-10','eod_signals':'BB20'}
        q={'rt_cd':'0','output':{'stck_prpr':'100','stck_oprc':'100','stck_hgpr':'101','stck_lwpr':'99','acml_vol':'1000'}}
        got=r14.safe_quote('005930',c,q,now,123)
        self.assertFalse(got['exchange_tick_time_verified'])
        self.assertNotIn('token',str(got).lower())
        self.assertEqual(got['code'],'005930')
        with self.assertRaises(r14.LiveError):r14.safe_quote('../bad',c,q,now,123)

if __name__=='__main__':unittest.main()

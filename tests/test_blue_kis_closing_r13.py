import csv
import importlib.util
import io
import json
import sys
import tempfile
import unittest
import zipfile
from datetime import date, datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'blue_kis_closing_r13.py'
spec = importlib.util.spec_from_file_location('r13', SCRIPT)
r13 = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = r13
spec.loader.exec_module(r13)


def mini_artifact(asof='2026-11-10', verified=True):
    audit = {'data_phase': 'SAME_DAY_EOD_VERIFIED' if verified else 'UNVERIFIED',
             'intraday_verified': False,'target_day_source':'KRX pykrx verified account daily',
             'asof':asof,'matched_stocks':2}
    fieldnames=['code','date','data_frequency','intraday_verified','signals','close','name','amount_ratio20','volume_ratio20']
    rows=[{'code':'005930','date':asof,'data_frequency':'EOD_DAILY','intraday_verified':'False',
           'signals':'BB20,ENV40','close':'195000','name':'삼성전자','amount_ratio20':'1.5','volume_ratio20':'2'},
          {'code':'000660','date':asof,'data_frequency':'EOD_DAILY','intraday_verified':'False',
           'signals':'BB20','close':'1150000','name':'SK하이닉스','amount_ratio20':'1.2','volume_ratio20':'1.2'}]
    f=io.StringIO();w=csv.DictWriter(f, fieldnames=fieldnames);w.writeheader();w.writerows(rows)
    archive=io.BytesIO()
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('AUDIT.json',json.dumps(audit))
        z.writestr('signals.csv',f.getvalue())
    return archive.getvalue()


class R13Tests(unittest.TestCase):
    def test_actual_verified_eod_artifact_schema(self):
        audit, rows = r13.parse_eod_artifact(mini_artifact(),date(2026,11,11))
        self.assertEqual(audit['asof'],'2026-11-10')
        self.assertEqual(len(rows),2)
        selected=r13.choose_candidates(rows,2)
        self.assertEqual(selected[0]['code'],'005930')
        self.assertEqual(selected[0]['eod_signals'],'BB20,ENV40')

    def test_no_future_eod_or_unverified_source(self):
        with self.assertRaisesRegex(r13.Failure, 'EOD_ASOF_STALE_OR_FUTURE'):
            r13.parse_eod_artifact(mini_artifact('2026-11-11'),date(2026,11,11))
        with self.assertRaisesRegex(r13.Failure, 'EOD_NOT_VERIFIED'):
            r13.parse_eod_artifact(mini_artifact(verified=False),date(2026,11,11))

    def test_stale_eod_rejected(self):
        with self.assertRaisesRegex(r13.Failure,'EOD_ASOF_STALE_OR_FUTURE'):
            r13.parse_eod_artifact(mini_artifact('2026-10-20'),date(2026,11,11))

    def test_bad_quote_fails_closed(self):
        c={'code':'005930','name':'삼성전자','eod_close':195000,'eod_date':'2026-11-10','eod_signals':'BB20'}
        good={'output':{'stck_prpr':'196800','stck_oprc':'197100','stck_hgpr':'198000','stck_lwpr':'195000','acml_vol':'2379544','prdy_ctrt':'1.1'}}
        quote=r13.parse_quote(c,good,datetime(2026,11,11,9,41,tzinfo=r13.KST),'probe')
        self.assertEqual(quote['price'],196800)
        self.assertFalse(quote['exchange_tick_time_verified'])
        self.assertAlmostEqual(quote['change_from_eod_pct'],0.9231,places=4)
        bad={'output':dict(good['output'],stck_hgpr='190000')}
        with self.assertRaisesRegex(r13.Failure,'QUOTE_INCONSISTENT'):
            r13.parse_quote(c,bad,datetime.now(r13.KST),'probe')

    def test_time_day_enforcement(self):
        rows={'output2':[{'stck_bsop_date':'20261110','stck_cntg_hour':'093000','stck_prpr':'100'},
                         {'stck_bsop_date':'20261111','stck_cntg_hour':'093100','stck_prpr':'101'}]}
        bars=r13.parse_minute_bars('005930',rows,date(2026,11,11),datetime.now(r13.KST),'probe')
        self.assertEqual(len(bars),1)
        self.assertEqual(bars[0]['bar_time'],'093100')

    def test_one_token_per_client_reused_for_multiple_calls(self):
        responses=[{'access_token':'SECRET_VALUE'},
                   {'rt_cd':'0','output':{}},{'rt_cd':'0','output':{}}]
        with patch.object(r13,'http_json',side_effect=responses) as api, patch.object(r13.time,'sleep'):
            client=r13.KISClient('a_fake_key','a_fake_secret')
            client.quote('005930');client.quote('000660')
            self.assertEqual(api.call_count,3)
            self.assertEqual(client.requests,2)
            self.assertEqual(api.call_args_list[0].args[2],'/oauth2/tokenP')
            self.assertNotIn('SECRET_VALUE',str(client.requests))

    def test_session_slots(self):
        now=datetime(2026,11,11,14,14,tzinfo=r13.KST)
        self.assertEqual([x[0] for x in r13._next_slots(now)],['14:30','15:00','15:15','15:23'])
        self.assertTrue(r13.time_band(r13.dtime(15,25)).startswith('CLOSING_AUCTION'))

    def test_off_session_is_not_verified_market_live(self):
        self.assertTrue(r13.time_band(r13.dtime(16,0)).startswith('OFF_REGULAR'))


if __name__=='__main__':
    unittest.main()

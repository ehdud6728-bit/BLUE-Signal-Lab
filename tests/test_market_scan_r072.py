import sys
import unittest
from pathlib import Path
from datetime import date
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from market_scan_r072 import krx_day, SourcePending, backfill
import pandas as pd

class MockReply:
    def __init__(self,rows):self.rows=rows
    def raise_for_status(self):return None
    def json(self):return {'OutBlock_1':self.rows,'respCode':'0'}
class MockSession:
    def get(self,url,params,headers,timeout):
        begin=0 if 'stk_' in url else 500
        date_str=params['basDd']
        rows=[]
        for i in range(begin,begin+450):
            rows.append({'ISU_CD':f'{i:06d}','ISU_NM':f'Test {i}',
                         'BAS_DD':date_str,'TDD_OPNPRC':'1,000',
                         'TDD_HGPRC':'1,200','TDD_LWPRC':'900',
                         'TDD_CLSPRC':'1,100','ACC_TRDVOL':'10,000',
                         'ACC_TRDVAL':'10,500,000'})
        return MockReply(rows)

class OnDemandTests(unittest.TestCase):
    def test_krx_date_response(self):
        d=krx_day(date(2026,11,9),'dummy-key',session=MockSession())
        self.assertEqual(len(d),900)
        self.assertEqual(set(d['Market']),{'KOSPI','KOSDAQ'})
        self.assertEqual(d['Close'].iloc[0],1100)
    def test_missing_key_is_explicit(self):
        with self.assertRaisesRegex(SourcePending,'KRX_AUTH_KEY_MISSING'):
            krx_day(date(2026,11,9),'',session=MockSession())
    def test_backfill_date_exact(self):
        d=pd.DataFrame([{'Date':pd.Timestamp('2026-11-06'),'Code':f'{i:06d}',
                         'Name':str(i),'Open':100,'High':100,'Low':100,'Close':100,
                         'Volume':100,'Amount':10000,
                         'Market':'KOSPI' if i<1000 else 'KOSDAQ'}
                        for i in range(2000)])
        upgraded,added=backfill(d,date(2026,11,9),'dummy-key',session=MockSession())
        self.assertEqual(added,['2026-11-09'])
        self.assertEqual(int(sum(pd.to_datetime(upgraded.Date).dt.date==date(2026,11,9))),900)
    def test_existing_date_not_requested(self):
        d=pd.DataFrame([{'Date':pd.Timestamp('2026-11-06'),'Code':f'{i:06d}',
                         'Name':str(i),'Open':100,'High':100,'Low':100,'Close':100,
                         'Volume':100,'Amount':10000,
                         'Market':'KOSPI' if i<1000 else 'KOSDAQ'}
                        for i in range(2000)])
        unchanged,added=backfill(d,date(2026,11,6),'')
        self.assertEqual(len(unchanged),2000)
        self.assertEqual(added,[])
if __name__=='__main__':unittest.main()

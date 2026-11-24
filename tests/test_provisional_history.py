import sys
from pathlib import Path
import unittest
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from provisional_history import prepare

class HistoryTests(unittest.TestCase):
    def fixture(self):
        days=pd.bdate_range(end="2026-11-23",periods=230)
        rows=[(d,"000001","Sample","KOSPI",100,110,90,105,1000,105000) for d in days]
        rows.extend((days[-1],str(i).zfill(6),"Sample","KOSPI",100,110,90,105,1000,105000) for i in range(2,1701))
        return pd.DataFrame(rows,columns=["Date","Code","Name","Market","Open","High","Low","Close","Volume","Amount"])
    def test_reference_and_future_exclusion(self):
        raw=self.fixture()
        future=raw.iloc[:1].copy()
        future["Date"]=pd.Timestamp("2026-11-24")
        def upgrade(base,target,today,provider,key,**kwargs):
            self.assertEqual(base.Date.max(),pd.Timestamp(target))
            self.assertTrue(kwargs["force_exact_day"])
            return base,[str(target)],"mock exact KRX"
        _,meta=prepare(pd.concat([raw,future]),"2026-11-23","openapi","",upgrade)
        self.assertEqual(meta["sessions"],230)
        self.assertFalse(meta["calendar_verified"])
    def test_short_history_rejected(self):
        raw=self.fixture()
        with self.assertRaisesRegex(ValueError,"INSUFFICIENT_PRIOR_HISTORY"):
            prepare(raw[raw.Date.eq(raw.Date.max())],"2026-11-23","openapi","",lambda base,*a,**k:(base,[],"mock"))
    def test_incomplete_reference_rejected(self):
        raw=self.fixture()
        with self.assertRaisesRegex(ValueError,"INCOMPLETE_REFERENCE"):
            prepare(raw[raw.Code.eq("000001")],"2026-11-23","openapi","",lambda base,*a,**k:(base,[],"mock"))
if __name__=="__main__":unittest.main()

import sys
from pathlib import Path
import unittest
import tempfile,json
from unittest.mock import Mock
import pandas as pd
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from provisional_history import prepare,load_versioned_marcap

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
    def test_versioned_raw_cache_hit_integrity_and_revision(self):
        years=[2025,2026]; revision="a"*40
        session=Mock()
        def response(url,timeout):
            self.assertIn("/"+revision+"/",url)
            r=Mock();r.content=url.encode();return r
        session.get.side_effect=response
        def reader(stream):
            return pd.DataFrame({"blob":[stream.read().decode()]})
        with tempfile.TemporaryDirectory() as tmp:
            raw,hashes,state=load_versioned_marcap(years,revision,tmp,session,reader)
            self.assertEqual(state,"MISS")
            self.assertEqual(session.get.call_count,2)
            hit,h2,state=load_versioned_marcap(years,revision,tmp,session,reader)
            self.assertEqual(state,"HIT")
            self.assertEqual(session.get.call_count,2)
            pd.testing.assert_frame_equal(raw,hit)
            self.assertEqual(hashes,h2)
            (Path(tmp)/"marcap-2025.parquet").write_bytes(b"corrupt")
            repaired,h3,state=load_versioned_marcap(years,revision,tmp,session,reader)
            self.assertEqual(state,"MISS")
            self.assertEqual(session.get.call_count,4)
            self.assertEqual(hashes,h3)
            pd.testing.assert_frame_equal(raw,repaired)
            revision="b"*40
            changed,h4,state=load_versioned_marcap(years,revision,tmp,session,reader)
            self.assertEqual(state,"MISS")
            self.assertEqual(session.get.call_count,6)
            self.assertNotEqual(hashes,h4)
            self.assertTrue(changed.blob.str.contains(revision).all())
    def test_failed_download_never_returns_stale_or_partial_cache(self):
        session=Mock()
        def response(url,timeout):
            if "2026" in url:raise RuntimeError("network failure")
            r=Mock();r.content=b"first file";return r
        session.get.side_effect=response
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(RuntimeError,"network failure"):
                load_versioned_marcap([2025,2026],"a"*40,tmp,session,lambda f:pd.DataFrame({"x":[1]}))
            self.assertFalse((Path(tmp)/"manifest.json").exists())
            with self.assertRaisesRegex(ValueError,"INVALID_MARCAP_REVISION"):
                load_versioned_marcap([2025,2026],"master",tmp,session)
if __name__=="__main__":unittest.main()

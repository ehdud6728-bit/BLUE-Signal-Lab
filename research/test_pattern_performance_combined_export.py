import unittest
from pattern_performance_combined import analyze
from pattern_performance_combined_export import convert
class ExportTests(unittest.TestCase):
    def fixture(self):
        days=["2026-11-02","2026-11-03"]
        s=dict(format="BLUE_TURSO_EXIT_SOURCE_V1",audits_readback_verified=True,asof_day=days[-1],eod_days=[dict(day=d,expected=1,actual=1) for d in days],research_audited_dates=days,signals=[dict(day=days[0],code="024720",names=["ENV20"])],bars=[dict(day=days[0],code="024720",market="KOSPI",open=90,high=100,low=90,close=100),dict(day=days[1],code="024720",market="KOSPI",open=100,high=120,low=100,close=120)])
        e=dict(format="BLUE_COMBINED_FACTORS_V1",asof=days[-1],rows=[dict(day=days[0],code="024720",rsi_gc=True,ma_down=True)])
        r=analyze(s,e);r.update(source_sha256="a"*64,factors_sha256="b"*64)
        return r,dict(asof=days[-1])
    def test_aggregate_only_and_stale(self):
        r,s=self.fixture();out=convert(r,s)
        self.assertEqual(len(out["rows"]),240)
        self.assertTrue(all(x["scope"]=="MARKET" for x in out["rows"]))
        self.assertNotIn("focus_stock",out)
        with self.assertRaises(ValueError):convert(r,{"asof":"2026-11-01"})
    def test_partition_and_missing(self):
        r,s=self.fixture()
        row=next(x for x in r["rows"] if x["scope"]=="MARKET" and x["base"]=="ENV20" and x["condition"]=="LONG_BULL" and x["sampling"]=="ALL_EVENTS" and x["entry_basis"]=="NEXT_OPEN" and x["horizon"]==1)
        row["all"]["mean_pct"]=21
        with self.assertRaises(ValueError):convert(r,s)
        r,s=self.fixture();r["rows"].pop()
        with self.assertRaises(ValueError):convert(r,s)
if __name__=="__main__":unittest.main()

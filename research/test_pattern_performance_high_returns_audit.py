import unittest
from pattern_performance_high_returns_audit import verify,candle_tags,stats
from fractions import Fraction
class AuditTests(unittest.TestCase):
    def test_exact_target(self):
        self.assertEqual(stats([("2026-11-02","000001",Fraction(20))],20)["hits"],1)
        self.assertEqual(candle_tags(dict(open=100,high=110,low=90,close=108))["CANDLE"],"BULL")
    def test_recompute_and_corruption(self):
        days=["2026-11-02","2026-11-03","2026-11-04","2026-11-05"]
        source=dict(format="BLUE_TURSO_EXIT_SOURCE_V1",audits_readback_verified=True,asof_day=days[-1],eod_days=[dict(day=d,expected=1,actual=1) for d in days],research_audited_dates=days,signals=[dict(day=days[0],code="000001",names=["ENV20"])],bars=[dict(day=days[0],code="000001",open=96,high=110,low=90,close=100),dict(day=days[1],code="000001",open=120,high=120,low=120,close=120)])
        a=dict(n=1,dates=1,stocks=1,hits=1,hit_pct=100,median_return_pct=20)
        z=dict(n=0,dates=0,stocks=0,hits=0,hit_pct=None,median_return_pct=None)
        r=dict(window=28,horizon=1,outcome="CLOSE",target_pct=20,pattern="ENV20|BULL",feature="CLOSE_POSITION",value="CLOSE_MID",train=a,train_control=z,holdout=z,holdout_control=z)
        report=dict(asof=days[-1],rows=[r])
        out=verify(source,report,"a"*64)
        self.assertEqual(out["checked"],1);self.assertEqual(out["failed"],0)
        r["train"]={**a,"hits":0}
        self.assertEqual(verify(source,report,"a"*64)["failed"],1)
if __name__=="__main__":unittest.main()

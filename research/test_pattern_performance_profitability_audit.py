import unittest
from pattern_performance_profitability_audit import verify,metrics
from pattern_performance_phase1 import summarize
from datetime import date

class AuditTests(unittest.TestCase):
    def fixture(self):
        days=["2026-11-02","2026-11-03"]
        bars=[];signals=[];base=[];candles=[]
        for code,end in (("000001",120),("000002",80)):
            bars.extend([dict(day=days[0],code=code,open=90,high=100,low=90,close=100),dict(day=days[1],code=code,open=end,high=end,low=end,close=end)])
            signals.append(dict(day=days[0],code=code,names=["ENV20"]))
            base.append((code,date.fromisoformat(days[0]),"ENV20",100,{1:end}))
            candles.append((code,date.fromisoformat(days[0]),"ENV20|LONG_BULL",100,{1:end}))
        source=dict(format="BLUE_TURSO_EXIT_SOURCE_V1",audits_readback_verified=True,asof_day=days[-1],eod_days=[dict(day=d,expected=2,actual=2) for d in days],research_audited_dates=days,bars=bars,signals=signals)
        report=dict(schema="BLUE_PATTERN_PERFORMANCE_AUDITED_V1",asof=days[-1],research_window_sessions=2,research_window_start=days[0],rankings=summarize(base),candle_rankings=summarize(candles))
        return source,report
    def test_exact_profit_and_risk(self):
        v=metrics([("d","a",100,120),("d","b",100,80),("e","c",100,100)])
        self.assertEqual(v["mean_return_pct"],0)
        self.assertEqual(v["return_profile"]["target_20_pct"],33.33)
        self.assertEqual(v["return_profile"]["profit_factor"],1)
        self.assertEqual(v["return_profile"]["worst_5pct_mean_pct"],-20)
    def test_reconstruct_complete_cohort_and_detect_errors(self):
        s,r=self.fixture()
        a=verify(s,r,"a"*64,"b"*64)
        self.assertEqual((a["checked"],a["failed"]),(2,0))
        r["rankings"][0]["return_profile"]["profit_factor"]=2
        self.assertEqual(verify(s,r,"a"*64,"b"*64)["failed"],1)
        r["rankings"]=[]
        self.assertEqual(verify(s,r,"a"*64,"b"*64)["failed"],1)
    def test_missing_endpoint_not_filled(self):
        s,r=self.fixture();s["bars"].pop()
        self.assertEqual(verify(s,r,"a"*64,"b"*64)["failed"],2)
if __name__=="__main__":unittest.main()

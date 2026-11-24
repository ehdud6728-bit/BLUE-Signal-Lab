import unittest
from pattern_performance_windows import monitor
class TestMonitor(unittest.TestCase):
    def test_incomplete_and_matured(self):
        days=["2026-11-20","2026-11-23","2026-11-24"]
        s=dict(asof_day=days[-1],eod_days=[dict(day=d) for d in days],bars=[dict(day=d,code="000001",close=100+i*10) for i,d in enumerate(days)],signals=[dict(day=d,code="000001",names=["P"]) for d in days])
        w=monitor(s)["windows"]
        self.assertEqual(w[-1]["actual_sessions"],3)
        r=w[0]["rows"][0]
        self.assertIsNone(r["frequency_delta"])
        self.assertEqual(r["performance"][0]["sample_count"],2)
        self.assertEqual(r["performance"][0]["unobserved"],1)
        self.assertIsNone(r["performance"][3]["positive_pct"])
    def test_compound_and_missing_coverage(self):
        days=["2026-11-16","2026-11-17","2026-11-18","2026-11-19","2026-11-20","2026-11-23"]
        s=dict(asof_day=days[-1],eod_days=[dict(day=d) for d in days],research_audited_dates=days[:-1],bars=[dict(day=d,code="000001",open=100,high=120,low=90,close=110,amount=100) for d in days],signals=[dict(day=d,code="000001",names=["P"]) for d in days[:-1]])
        w=monitor(s)["windows"][0]
        self.assertEqual(w["current_covered"],2)
        self.assertEqual(w["prior_covered"],3)
        r=next(r for r in w["rows"] if r["pattern"]=="P|BULL|CLOSE_MID")
        self.assertIsNone(r["frequency_delta"])
        self.assertIsNone(r["performance"][0]["rate_delta_pp"])
        self.assertEqual(r["performance"][0]["prior"]["sample_count"],2)
if __name__=="__main__":
    unittest.main()

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
if __name__=="__main__":
    unittest.main()

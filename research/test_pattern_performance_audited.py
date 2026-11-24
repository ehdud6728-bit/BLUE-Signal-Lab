import unittest
from pattern_performance_audited import analyze, candle, market_regime

class TestAudited(unittest.TestCase):
    def test_features(self):
        self.assertEqual(candle(dict(open=100,high=110,low=100,close=109)), "LONG_BULL")
        self.assertEqual(candle(dict(open=108,high=110,low=90,close=109)), "DOJI")
        self.assertEqual(market_regime(dict(matched5=90,universe=100,up5=60)), "BROAD_UP")
        self.assertEqual(market_regime(dict(matched5=70,universe=100,up5=60)), "UNKNOWN")
    def test_exact_session_missing(self):
        days=["2026-11-02","2026-11-03","2026-11-04","2026-11-05","2026-11-06","2026-11-09"]
        source={"format":"BLUE_TURSO_EXIT_SOURCE_V1","audits_readback_verified":True,
                "asof_day":days[-1],"research_audited_days":1,"research_excluded_days":[],
                "eod_days":[{"day":d,"expected":1700,"actual":1700} for d in days],
                "signals":[{"day":days[0],"code":"00088K","names":["ENV20"]}],
                "bars":[{"day":days[i],"code":"00088K","close":p} for i,p in [(0,100),(4,150),(5,110)]]}
        result=analyze(source)
        self.assertEqual(result["missing_by_horizon"][3],1)
        self.assertEqual(result["rankings"][0]["horizon_trading_days"],5)
        self.assertEqual(result["rankings"][0]["mean_return_pct"],10)
        self.assertEqual(result["missing_by_horizon"][20],1)

if __name__=="__main__":
    unittest.main()

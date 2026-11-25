import unittest
from pattern_performance_phase1 import return_profile
from pattern_performance_profitability_export import convert
class ProfitabilityTests(unittest.TestCase):
    def test_low_win_high_payoff(self):
        p=return_profile([10]*4+[-3]*6)
        self.assertEqual(p["win_count"],4)
        self.assertEqual(p["mean_gain_pct"],10)
        self.assertEqual(p["mean_loss_pct"],-3)
        self.assertEqual(p["payoff_ratio"],3.333)
        self.assertEqual(p["profit_factor"],2.222)
        self.assertEqual(p["target_10_pct"],40)
        self.assertEqual(p["worst_5pct_mean_pct"],-3)
    def test_zero_and_undefined_ratios(self):
        self.assertIsNone(return_profile([0,2])["profit_factor"])
        self.assertIsNone(return_profile([-2,0])["payoff_ratio"])
        self.assertEqual(return_profile([-2,0])["profit_factor"],0)
        self.assertEqual(return_profile([0])["flat_count"],1)
        self.assertEqual(return_profile([100*(120/100-1)])["target_20_pct"],100)
    def test_export_without_rate_filter(self):
        r=dict(pattern="ENV20_LOWER_TOUCH",horizon_trading_days=3,sample_count=40,distinct_signal_dates=5,distinct_stocks=10,positive_return_probability_pct=40,mean_return_pct=2.2,median_return_pct=-3,min_return_pct=-3,return_profile=return_profile([10]*16+[-3]*24))
        report=dict(schema="BLUE_PATTERN_PERFORMANCE_AUDITED_V1",status="RESEARCH_ONLY_NO_PRODUCTION_PROMOTION",asof="2026-11-24",research_window_sessions=28,rankings=[r])
        snap=dict(asof="2026-11-24",audited_sessions=28)
        self.assertEqual(len(convert(report,snap)["rows"]),1)
        self.assertEqual(convert(report,snap)["rows"][0]["up_pct"],40)
        with self.assertRaises(ValueError):convert(report,{**snap,"asof":"2026-11-25"})
        proof=dict(schema="BLUE_PROFITABILITY_AUDIT_V1",asof=report["asof"],sessions=28,source_sha256="a"*64,report_sha256="b"*64,failed=0,checked=1,unsupported=0,scope="INDEPENDENT_CALCULATION_SAME_SOURCE_ONLY",checks=[["rankings",r["pattern"],3]])
        self.assertEqual(convert(report,snap,proof)["rows"][0]["calculation_audit"],"RECOMPUTED_MATCH")
        with self.assertRaises(ValueError):convert(report,snap,{**proof,"checks":[]})
        with self.assertRaises(ValueError):convert(report,snap,{**proof,"failed":1})
        report["rankings"][0]["sample_count"]=29
        self.assertEqual(convert(report,snap)["rows"],[])
if __name__=="__main__":unittest.main()

import unittest
from datetime import date,timedelta
from price_path_readiness import readiness,evaluate_fixed_distribution,quantile

def fixture():
    days=[(date(2026,11,2)+timedelta(days=i)).isoformat() for i in range(8)]
    return dict(format="BLUE_TURSO_EXIT_SOURCE_V1",storage="TURSO",audits_readback_verified=True,
        asof_day=days[-1],eod_days=[dict(day=d,expected=1700,actual=1700) for d in days],
        research_audited_dates=days,research_audited_days=8,research_excluded_days=[],
        signals=[dict(day=d,code="005930",names=["ENV20_LOWER_TOUCH"]) for d in days],
        bars=[dict(day=d,code="005930",open=100,high=105,low=95,close=100) for d in days],
        trading_calendar_verified=False,corporate_actions_verified=False)

class ReadinessTests(unittest.TestCase):
    def test_no_future_overlap_and_pending(self):
        r=readiness(fixture())
        self.assertEqual(r["holdout_start"],"2026-11-08")
        h=r["report"][0]
        self.assertEqual((h["train"]["n"],h["embargo"],h["holdout"]["n"],h["pending"]),(5,1,1,1))
        self.assertFalse(h["sample_floor_met"])
        self.assertFalse(r["forecast_enabled"])
        self.assertFalse(r["calendar_verified"])
        self.assertEqual(r["report"][-1]["pending"],8)
    def test_missing_intermediate_bar(self):
        s=fixture()
        s["signals"].pop(2)
        s["bars"].pop(2)
        r=readiness(s)
        self.assertEqual(r["report"][1]["missing_path"],2)
        self.assertFalse(r["forecast_enabled"])
    def test_invalid_source_and_duplicate(self):
        for mutate in [lambda s:s["bars"].append(s["bars"][0]),lambda s:s["signals"].append(s["signals"][0]),lambda s:s["eod_days"][0].update(actual=1699)]:
            s=fixture();mutate(s)
            with self.assertRaises(ValueError):readiness(s)
    def test_synthetic_quantile_and_baseline_metrics(self):
        self.assertEqual(quantile([0,10,20],.1),2)
        r=evaluate_fixed_distribution([0,10,20],[0,10,20])
        self.assertEqual((r["p10"],r["p50"],r["p90"]),(2,10,18))
        self.assertAlmostEqual(r["mae_pp"],20/3)
        self.assertEqual(r["zero_return_mae_pp"],10)
        self.assertAlmostEqual(r["interval_coverage"],1/3)
        self.assertEqual(r["interval_width_pp"],16)
        self.assertAlmostEqual(r["interval_score_pp"],16+40/3)
    def test_proof_flags_never_enable_live_forecast(self):
        s=fixture();s.update(trading_calendar_verified=True,corporate_actions_verified=True)
        self.assertFalse(readiness(s)["forecast_enabled"])

if __name__=="__main__":unittest.main()

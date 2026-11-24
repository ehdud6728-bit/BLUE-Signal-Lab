import unittest
from pattern_performance_web_snapshot import recommendations

class RecommendationTest(unittest.TestCase):
    def test_thresholds(self):
        base=dict(pattern="ENV20_LOWER_TOUCH|BULL",horizon_trading_days=3,sample_count=30,distinct_signal_dates=5,distinct_stocks=10,positive_return_probability_pct=70,mean_return_pct=1,median_return_pct=1)
        for change,tier in [({}, "SHORT_RECOMMENDATION"),({"sample_count":29},"WATCH"),({"distinct_signal_dates":4},"WATCH"),({"distinct_stocks":9},"WATCH")]:
            self.assertEqual(recommendations({"candle_rankings":[{**base,**change}]})[0]["tier"],tier)
        for change in ({"positive_return_probability_pct":69.99},{"mean_return_pct":0},{"median_return_pct":-1}):
            self.assertEqual(recommendations({"candle_rankings":[{**base,**change}]}),[])
        for pattern in ("ENV20|UNKNOWN", "ENV20|BULL|MARKET_UNKNOWN"):
            self.assertEqual(recommendations({"detail_rankings":[{**base,"pattern":pattern}]}),[])
if __name__=="__main__":
    unittest.main()

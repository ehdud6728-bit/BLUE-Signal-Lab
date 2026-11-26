import unittest
from datetime import date,timedelta
from pattern_performance_full_universe import study,features
def fixture():
    days=[(date(2026,10,1)+timedelta(days=i)).isoformat() for i in range(32)]
    bars=[]
    for i,d in enumerate(days):
        p=200-i
        if i==24:p=200
        bars.append(dict(day=d,code="000001",market="KOSPI",open=p,high=p+1,low=p-1,close=p,amount=100))
    src=dict(schema="BLUE_FULL_UNIVERSE_SOURCE_V1",cutoff=days[-1],days=[dict(day=d,rows=1,signal_status="COUNT_AND_PAYLOAD_HASH_METADATA_MATCH") for d in days],bars=bars,signals=[],original_eod_hashes_recomputed=True)
    b=dict(schema="BLUE_BENCHMARK_DAILY_STATES_V1",cutoff=days[-1],markets=[dict(market=m,days=[dict(day=d,state="UP_CONFIRMED",index_trend="UP") for d in days]) for m in ("KOSPI","KOSDAQ")])
    return src,b
class TestFull(unittest.TestCase):
    def test_down_stock_in_up_market_and_no_stored_signal(self):
        s,b=fixture();r=study(s,b)
        self.assertEqual(r["coverage"]["ELIGIBLE"],12)
        self.assertTrue(any(x["prior_stock_direction"]=="DOWN" and x["market_state"]=="UP_CONFIRMED" and x["feature"]=="NO_STORED_SIGNAL" for x in r["rows"]))
        self.assertTrue(any(x["feature"]=="MA20_FIRST_CROSS" for x in r["rows"]))
        self.assertTrue(all(x["sample_count"]+x["pending"]+x["missing_path"]==x["events"] for x in r["rows"]))
    def test_missing_index_date_and_future_independence(self):
        s,b=fixture();h=s["bars"][:25];stock,f=features(h)
        self.assertEqual(stock,"DOWN")
        s["bars"][-1].update(open=500,close=500,high=501,low=499)
        self.assertEqual(features(h),(stock,f))
        b["markets"][0]["days"].pop(15)
        self.assertLess(study(s,b)["coverage"].get("ELIGIBLE",0),12)
    def test_count_mismatch_rejected(self):
        s,b=fixture();s["bars"].pop()
        with self.assertRaisesRegex(ValueError,"BAD_UNIVERSE_COUNT"):study(s,b)
if __name__=="__main__":unittest.main()

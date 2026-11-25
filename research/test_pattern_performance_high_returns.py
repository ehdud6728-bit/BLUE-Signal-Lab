import unittest
from datetime import date,timedelta
from pattern_performance_high_returns import analyze,features,conditions,compare

class HighReturnTests(unittest.TestCase):
    def test_compare_disjoint_and_missing(self):
        rows=[(0,"000001",11,{"X":"A"}),(1,"000002",-5,{"X":"B"}),(2,"000003",20,{})]
        a,b,lift=compare(rows,"X","A",10)
        self.assertEqual((a["n"],b["n"],lift),(1,1,100))
    def test_fixed_membership_features_not_rediscovered(self):
        f={"CANDLE":"BULL","CLOSE_POSITION":"CLOSE_MID","AMOUNT_5":"2_3"}
        pairs=dict(conditions("ENV20_LOWER_TOUCH",f))
        self.assertEqual(pairs["ENV20_LOWER_TOUCH|BULL|CLOSE_MID"],{"CANDLE","CLOSE_POSITION"})
    def test_high_touch_separate_from_close_and_future_not_feature(self):
        ds=[(date(2026,9,1)+timedelta(days=i)).isoformat() for i in range(60)]
        bars=[];signals=[]
        # High-price group closes flat but touches +20% after day 30. Other
        # group has identical candles without high touches. Signal-day feature
        # is absolute turnover; future highs are never passed to features.
        for i,d in enumerate(ds):
            for j in range(20):
                c=f"{j:06d}"
                bars.append(dict(day=d,code=c,open=100,high=125 if j<10 and i%2 else 100,low=100,close=100,amount=30_000_000_000 if j<10 else 1_000_000_000))
                if i%2==0:signals.append(dict(day=d,code=c,names=["ENV20_LOWER_TOUCH"]))
        src=dict(format="BLUE_TURSO_EXIT_SOURCE_V1",audits_readback_verified=True,asof_day=ds[-1],eod_days=[dict(day=d,expected=20,actual=20) for d in ds],research_audited_dates=ds,bars=bars,signals=signals)
        out=analyze(src)
        rows=[r for r in out["rows"] if r["pattern"]=="ENV20_LOWER_TOUCH" and r["feature"]=="AMOUNT_ABSOLUTE" and r["window"]==60 and r["horizon"]==1 and r["target_pct"]==20]
        self.assertEqual(len(rows),1)
        r=rows[0];self.assertEqual(r["outcome"],"HIGH")
        self.assertEqual(r["train"]["hit_pct"],100)
        self.assertEqual(r["train_control"]["hit_pct"],0)
        self.assertEqual(r["status"],"HOLDOUT_AGREES_EXPLORATORY")
        self.assertTrue(all(x["outcome"]!="CLOSE" for x in out["rows"]))
        self.assertTrue(all(x["feature"]!="CANDLE" for x in out["rows"] if "|" in x["pattern"] and "|FLAT" in x["pattern"]))
        src["research_audited_dates"]=ds[1:]
        with self.assertRaises(ValueError):analyze(src)
if __name__=="__main__":unittest.main()

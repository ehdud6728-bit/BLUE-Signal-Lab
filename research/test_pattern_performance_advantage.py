import unittest
from datetime import date,timedelta
from pattern_performance_advantage import research,compare,features,outcomes,HORIZONS

def bar(c,o=None,h=None,l=None,amount=100):
    return dict(close=c,open=c if o is None else o,high=c+5 if h is None else h,low=c-5 if l is None else l,amount=amount)

class AdvantageTests(unittest.TestCase):
    def test_threshold_ambiguity_and_missing_paths(self):
        self.assertEqual(outcomes(100,[bar(100,100,104,94)])[1],"AMBIGUOUS")
        self.assertEqual(outcomes(100,[bar(103,103,104,94)])[1],"TARGET")
        self.assertEqual(outcomes(100,[bar(95,95,104,94)])[1],"STOP")
        self.assertIsNone(outcomes(100,[bar(100),None]))
        self.assertEqual(outcomes(100,[bar(100,100,101,99)])[1],"NO_TOUCH")

    def test_known_controls_and_same_date_only(self):
        rows=[(0,"000001",{"x":True},{1:(4,"TARGET")}),
              (0,"000002",{"x":False},{1:(-5,"STOP")}),
              (0,"000003",{"x":None},{1:(9,"TARGET")}),
              (1,"000004",{"x":True},{1:(8,"TARGET")}),
              (0,"000005",{"x":False},{1:None}),
              (2,"000006",{"x":False},{1:(3,"TARGET")})]
        r=compare(rows,"x",1,0,3)
        self.assertEqual(r["condition"]["n"],1)
        self.assertEqual(r["control"]["n"],1)
        self.assertEqual(r["matched_baseline"]["up_pct"],50)
        self.assertEqual(r["unknown_feature_n"],1)
        self.assertEqual(r["missing_outcome_n"],1)
        self.assertEqual(r["unmatched_condition_n"],1)
        self.assertEqual(r["equal_date_uplift_pp"],100)
        self.assertEqual(r["exclusion_tradeoff"]["missed_first_target"],1)
        self.assertEqual(r["exclusion_tradeoff"]["avoided_first_stop"],0)

    def test_features_no_missing_turnover_as_control(self):
        b=bar(100,98,104,96,amount=None)
        f=features(b,[bar(99)]*20,None)
        self.assertIsNone(f["AMOUNT_20_GE_2"])
        self.assertIsNone(f["BULL_AMOUNT_20_GE_2"])
        self.assertIsNone(f["MARKET_BROAD_UP"])
        self.assertTrue(f["BULL_CLOSE_MID"])

    def test_end_to_end_chronology_and_research_only(self):
        days=[(date(2026,1,1)+timedelta(days=i)).isoformat() for i in range(60)]
        bars=[];signals=[]
        for i,d in enumerate(days):
            for j in range(20):
                code=f"{j:06d}"
                c=1000+10*i if j<10 else 2000-10*i
                bars.append(dict(day=d,code=code,**bar(c,c-4 if j<10 else c+4,c+6,c-6)))
                signals.append(dict(day=d,code=code,names=["ENV20"]))
        source=dict(format="BLUE_TURSO_EXIT_SOURCE_V1",asof_day=days[-1],audits_readback_verified=True,
            eod_days=[dict(day=d,expected=20,actual=20) for d in days],research_audited_dates=days,bars=bars,signals=signals)
        result=research(source)
        self.assertEqual(result["status"],"RESEARCH_ONLY_NO_PRODUCTION_PROMOTION")
        selected=[r for r in result["rows"] if r["window"]==60 and r["horizon"]==3 and r["condition"]=="BULL"]
        self.assertEqual(len(selected),1)
        r=selected[0]
        self.assertEqual(r["direction"],"UPSIDE")
        self.assertEqual(r["status"],"HOLDOUT_AGREES_EXPLORATORY")
        self.assertEqual(r["train"]["condition"]["n"],390)
        self.assertEqual(r["holdout"]["condition"]["n"],150)
        self.assertEqual(r["holdout"]["uplift_vs_baseline_pp"],50)
        source["signals"].append(source["signals"][0])
        with self.assertRaisesRegex(ValueError,"invalid audited signal"):
            research(source)

if __name__=="__main__":
    unittest.main()

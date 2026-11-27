import unittest,json
from fractions import Fraction as F
from env20_case_features import outcome,features,aggregate,study,select_cases,encode
from test_pattern_performance_forward import fixture
def b(o,h,l,c):return dict(open=o,high=h,low=l,close=c,market="KOSPI",amount=100,day="2026-10-01")
class Cases(unittest.TestCase):
    def test_high_not_close_and_before_target_order(self):
        a=b(100,104,99,100);p=[b(100,106,96,99),b(99,100,80,85)]
        g=dict(stop=F(95),resistance=F(110))
        r=outcome(a,p,g,2)
        self.assertTrue(r["hit5"]);self.assertEqual(r["peak_pct"],6);self.assertEqual(r["trough_pct"],-20)
        self.assertEqual(r["label"],"TARGET_BEFORE_SUPPORT")
        self.assertEqual(r["adverse_before_target_worst_bound_pct"],-4)
        self.assertEqual(r["adverse_before_target_best_bound_pct"],0)
        self.assertEqual(outcome(a,[b(100,104,94,101),b(101,106,99,102)],g,2)["label"],"SUPPORT_BEFORE_TARGET")
        self.assertEqual(outcome(a,[b(100,106,94,101)],g,1)["label"],"ORDER_UNKNOWN")
    def test_feature_unknown_and_prior_only(self):
        a=b(99,105,95,100)
        f,raw=features(a,{},lambda n:None,["RSI_GC"],"UNKNOWN","UNKNOWN")
        self.assertEqual(f["PIVOT_LOW_TREND"],"UNKNOWN")
        self.assertEqual(f["STORED_RSI_TAG"],"PRESENT")
        self.assertEqual(f["STORED_SLOW_TAG"],"NOT_IN_SAVED_TAGS")
    def test_full_report_and_separate_case_paths(self):
        src,bench=fixture();d=src["days"][21]["day"]
        src["signals"]=[dict(day=d,code="000001",names=["ENV20_LOWER_TOUCH"])]
        f=dict(schema="BLUE_ENV20_PULLBACK_FACTORS_V1",cutoff=src["cutoff"],rows=[dict(day=d,code="000001",ma_down=True,ma_chart_consistent=True,record_sha256="a"*64)])
        r,c,o=study(src,bench,f)
        self.assertEqual(len(c),1);self.assertEqual(len(o),1);self.assertEqual(r["summary"]["ALL"]["n"],1)
        self.assertTrue(all(z["day"]<=d for z in c[0]["pre_bars"]))
        self.assertTrue(all(z["day"]>d for z in o[0]["post_bars"]))
        self.assertEqual(o[0]["horizons"]["20"]["status"],"PENDING")
        self.assertEqual(r["summary"]["POST_FREEZE_DATES"]["n"],0)
        json.dumps([r,c,o],default=encode,allow_nan=False)
    def test_exact_prefix_keeps_four_sessions_without_changing_horizons(self):
        src,bench=fixture();d=src["days"][-5]["day"]
        src["signals"]=[dict(day=d,code="000001",names=["ENV20_LOWER_TOUCH"])]
        f=dict(schema="BLUE_ENV20_PULLBACK_FACTORS_V1",cutoff=src["cutoff"],rows=[dict(day=d,code="000001",ma_down=True,ma_chart_consistent=True,record_sha256="a"*64)])
        r,c,o=study(src,bench,f);a=o[0]
        self.assertEqual(len(a["landmark_bars"]),4)
        self.assertEqual(len(a["post_bars"]),3)
        self.assertEqual(a["horizons"]["5"]["status"],"PENDING")
        self.assertEqual(a["landmark_end_status"],"PENDING")
        self.assertEqual(set(a["landmark_source_hashes"]),{z["day"] for z in a["landmark_bars"]})
    def test_exact_prefix_stops_at_missing_calendar_and_discontinuity(self):
        for mode in ("calendar","symbol","jump"):
            src,bench=fixture();d="2026-10-16"
            if mode!="calendar":
                d=src["days"][-5]["day"];q=src["days"][-3]["day"]
                if mode=="symbol":next(z for z in src["bars"] if z["day"]==q)["code"]="000002"
                else:
                    z=next(z for z in src["bars"] if z["day"]==q)
                    for key in ("open","high","low","close"):z[key]*=2
            src["signals"]=[dict(day=d,code="000001",names=["ENV20_LOWER_TOUCH"])]
            f=dict(schema="BLUE_ENV20_PULLBACK_FACTORS_V1",cutoff=src["cutoff"],rows=[dict(day=d,code="000001",ma_down=True,ma_chart_consistent=True,record_sha256="a"*64)])
            _,_,out=study(src,bench,f);a=out[0]
            self.assertEqual(len(a["landmark_bars"]),1,mode)
            self.assertEqual(a["landmark_end_status"],dict(calendar="DATE_WINDOW_MISSING",symbol="MISSING_PATH",jump="DISCONTINUITY_REVIEW")[mode])
    def test_split_stays_fixed_when_history_expands(self):
        from copy import deepcopy
        src,bench=fixture();d=src["days"][21]["day"]
        src["signals"]=[dict(day=d,code="000001",names=["ENV20_LOWER_TOUCH"])]
        f=dict(schema="BLUE_ENV20_PULLBACK_FACTORS_V1",cutoff=src["cutoff"],rows=[dict(day=d,code="000001",ma_down=True,ma_chart_consistent=True,record_sha256="a"*64)])
        before=study(src,bench,f)[0]
        prior="2026-09-30";row=deepcopy(src["days"][0]);row["day"]=prior;src["days"].insert(0,row)
        bar=deepcopy(src["bars"][0]);bar["day"]=prior;src["bars"].insert(0,bar)
        for m in bench["markets"]:m["days"].insert(0,dict(day=prior,state="DOWN_CONFIRMED",index_trend="DOWN"))
        after=study(src,bench,f)[0]
        self.assertEqual(after["source_days"],before["source_days"]+1)
        self.assertEqual(before["split_day"],"2026-11-09");self.assertEqual(after["split_day"],before["split_day"])
        self.assertEqual(study(src,bench,f,split_day="2026-10-20")[0]["split_day"],"2026-10-20")
        with self.assertRaises(ValueError):study(src,bench,f,split_day="2026-02-30")
    def test_preserve_success_opportunities(self):
        a=[dict(id=str(i),day="d",code=str(i),phase="TRAIN",outcome=dict(hit5=i<3,peak_pct=6 if i<3 else 2,trough_pct=-4,label="TARGET_BEFORE_SUPPORT" if i<3 else "MISS")) for i in range(5)]
        r=aggregate(a[:2],a);self.assertEqual(r["hit_pct"],100);self.assertEqual(r["retained_hits_pct"],66.667);self.assertEqual(r["excluded_misses_pct"],100)
        self.assertEqual(select_cases(a),select_cases(list(reversed(a))))
if __name__=="__main__":unittest.main()

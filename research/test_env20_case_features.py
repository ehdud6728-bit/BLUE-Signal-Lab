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
    def test_preserve_success_opportunities(self):
        a=[dict(id=str(i),day="d",code=str(i),phase="TRAIN",outcome=dict(hit5=i<3,peak_pct=6 if i<3 else 2,trough_pct=-4,label="TARGET_BEFORE_SUPPORT" if i<3 else "MISS")) for i in range(5)]
        r=aggregate(a[:2],a);self.assertEqual(r["hit_pct"],100);self.assertEqual(r["retained_hits_pct"],66.667);self.assertEqual(r["excluded_misses_pct"],100)
        self.assertEqual(select_cases(a),select_cases(list(reversed(a))))
if __name__=="__main__":unittest.main()

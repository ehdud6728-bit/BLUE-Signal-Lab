import unittest
from pattern_performance_high_returns_export import convert
def fixture():
    a=dict(n=40,dates=8,stocks=20,hits=24,hit_pct=60,median_return_pct=12)
    b=dict(n=40,dates=8,stocks=20,hits=8,hit_pct=20,median_return_pct=2)
    empty=dict(n=0,dates=0,stocks=0,hits=0,hit_pct=None,median_return_pct=None)
    r=dict(window=28,horizon=3,outcome="HIGH",target_pct=10,pattern="ENV20_LOWER_TOUCH",feature="AMOUNT_5",value="2_3",status="INSUFFICIENT_HOLDOUT",train=a,train_control=b,train_lift_pp=40,holdout=empty,holdout_control=empty,holdout_lift_pp=None)
    return dict(schema="BLUE_HIGH_RETURN_PROFILES_V1",asof="2026-11-24",available_sessions=28,windows=[dict(window=w,actual_sessions=28,covered_sessions=24,train_sessions=19,holdout_sessions=9) for w in (28,60)],rows=[r])
class ProfileExport(unittest.TestCase):
    def test_missing_and_alignment(self):
        d=fixture();s=dict(asof=d["asof"])
        a=convert(d,s);self.assertEqual(a["published_rows"],1)
        self.assertIsNone(a["rows"][0]["holdout_lift_pp"])
        self.assertEqual(a["coverage"][0]["total"],1)
        with self.assertRaises(ValueError):convert(d,dict(asof="2026-11-25"))
        d["rows"][0]["train_lift_pp"]=41
        with self.assertRaises(ValueError):convert(d,s)
    def test_bound_preserves_count_and_no_unknown_fields(self):
        d=fixture();base=d["rows"][0]
        d["rows"]=[dict(base,pattern="PATTERN_"+str(i),code="000001") for i in range(40)]
        a=convert(d,dict(asof=d["asof"]))
        self.assertEqual(a["source_rows"],40);self.assertEqual(a["published_rows"],30)
        self.assertNotIn("code",a["rows"][0])
if __name__=="__main__":unittest.main()

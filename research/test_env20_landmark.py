import unittest
from env20_landmark import study,feature_at,shape
def b(day,o,h,l,c,v=100):
    return dict(day=day,open=o,high=h,low=l,close=c,volume=v,amount=v*100)
class Landmark(unittest.TestCase):
    def test_future_excludes_landmark_and_already_hit(self):
        c=dict(id="x",day="2026-10-01",code="000001",pre_bars=[b("2026-10-01",100,101,99,100)],geometry=dict(stop=95,resistance=105))
        path=[b("2026-10-02",100,106,99,100),b("2026-10-03",101,109,99,106),b("2026-10-04",106,111,102,110)]
        r=study(dict(schema="BLUE_ENV20_CASE_FEATURES_V6",asof="2026-10-04",split_day="2026-10-04"),[c],[dict(id="x",post_bars=path)])
        q=[z for z in r["rows"] if z["landmark"]==1 and z["future_sessions"]==1 and z["phase"]=="ALL" and z["feature"]=="BASELINE"]
        self.assertFalse(any(z["target_pct"]==5 for z in q));a=next(z for z in q if z["target_pct"]==10);self.assertEqual(a["cohort"],"AFTER_PREVIOUS_TARGET");self.assertEqual(a["hit"],0)
        q=[z for z in r["rows"] if z["landmark"]==2 and z["future_sessions"]==1 and z["phase"]=="ALL" and z["target_pct"]==10 and z["feature"]=="BASELINE"];self.assertEqual(q[0]["hit"],1)
    def test_missing_volume_unknown_and_frozen_support(self):
        p=b("2026-10-01",100,101,99,100);p.pop("volume")
        c=dict(pre_bars=[p],geometry=dict(stop=95,resistance=105))
        f=feature_at(c,[b("2026-10-02",100,101,94,98)])
        self.assertEqual(f["VOLUME_VS_PREV"],"UNKNOWN");self.assertEqual(f["FROZEN_SUPPORT"],"TOUCH_RECLAIM");self.assertEqual(f["MA20"],"UNKNOWN")
    def test_missing_paths_not_misses_and_ids(self):
        c=dict(id="x",day="2026-10-01",code="000001",pre_bars=[b("2026-10-01",100,101,99,100)])
        r=dict(schema="BLUE_ENV20_CASE_FEATURES_V6",asof="2026-10-02",split_day="2026-10-02")
        self.assertEqual(study(r,[c],[dict(id="x",post_bars=[b("2026-10-02",100,101,99,100)])])["rows"],[])
        with self.assertRaises(ValueError):study(r,[c],[])
    def test_exact_four_day_window_and_empty_coverage(self):
        c=dict(id="x",day="2026-10-01",code="000001",pre_bars=[b("2026-10-01",100,101,99,100)])
        path=[b("2026-10-0"+str(i),100,101,99,100) for i in range(2,6)]
        r=dict(schema="BLUE_ENV20_CASE_FEATURES_V6",asof="2026-10-05",split_day="2026-10-02")
        result=study(r,[c],[dict(id="x",post_bars=path[:3],landmark_bars=path,landmark_path_version=1)])
        self.assertEqual(result["path_basis"],"EXACT_CONTIGUOUS_PREFIX")
        self.assertTrue(any(z["landmark"]==1 and z["future_sessions"]==3 for z in result["rows"]))
        empty=study(r,[c],[dict(id="x",post_bars=[])])
        self.assertEqual(len(empty["coverage"]),20)
        self.assertTrue(all(z["n"]==1 and z["status"]=="NO_COMPLETE_PATH" for z in empty["coverage"]))
if __name__=="__main__":unittest.main()

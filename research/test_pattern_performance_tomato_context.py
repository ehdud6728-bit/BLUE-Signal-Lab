import unittest
from test_pattern_performance_forward import fixture
from pattern_performance_tomato_context import study,outcome,summarize_opportunity,first_touch_order,technical_candidates,stop_at_entry
from fractions import Fraction
class TestTomato(unittest.TestCase):
    def test_same_setup_tomato_and_non_tomato_and_latest_not_scored(self):
        s,b=fixture();ds=[s["days"][5]["day"],s["days"][-1]["day"]]
        s["signals"]=[dict(day=d,code="000001",names=["RSI_GC"]) for d in ds]
        rows=[]
        for d,status in zip(ds,["BELOW_THRESHOLD","TOMATO"]):
            rows.append(dict(day=d,status="ORIGINAL_SIGNAL_PAYLOAD_HASH_MATCH",rows=[dict(code="000001",market="KOSPI",selection=dict(status=status,setup="RSI_GC"),stored_ma_arrangement="DOWN")]))
        out=study(s,b,dict(schema="BLUE_TOMATO_CONTEXT_SOURCE_V1",cutoff=s["cutoff"],floor=8,threshold=70,days=rows))
        self.assertTrue(any(r["tomato_status"]=="BELOW_THRESHOLD" and r["sample_count"]==1 for r in out["rows"]))
        self.assertTrue(all(r["sample_count"]==0 and r["pending"]==1 for r in out["rows"] if r["cohort"]=="LATEST_UNFROZEN_CANDIDATE"))
        self.assertTrue(any(r["context"]=="AMOUNT_20_AUDITED" and r["value"]=="UNKNOWN" for r in out["rows"]))
    def test_peak_and_terminal_are_not_confused(self):
        path=[dict(open=10000,high=10300,low=9500,close=10000),
              dict(open=10000,high=12000,low=9800,close=11500)]
        path += [dict(open=11000,high=11000,low=9800,close=9800)]*8
        r=summarize_opportunity([("2026-10-01","000001",outcome(path),"OBSERVED")])
        self.assertEqual(r["peak_high_pct"]["mean"],20)
        self.assertEqual(r["trough_low_pct"]["mean"],-5)
        self.assertEqual(r["terminal_close_pct"]["mean"],-2)
        self.assertEqual(r["terminal_close_pct"]["positive_pct"],0)
        self.assertEqual(r["peak_high_pct"]["above_entry_pct"],100)
        self.assertEqual(r["peak_to_end_giveback_pp"]["mean"],22)
        self.assertEqual(r["first_peak_observation"]["median"],2)
        self.assertEqual(r["target_high_reach"]["3"]["median_first_day"],1)
        self.assertEqual(r["target_high_reach"]["20"]["hit_pct"],100)
        self.assertEqual(r["target_high_reach"]["10"]["mean_prior_full_days_low_pct"],-5)
        self.assertEqual(r["target_high_reach"]["10"]["hit_day_low_below_entry_count"],1)
    def test_exact_target_and_missing_window(self):
        a=outcome([dict(open=10000,high=10999,low=10000,close=10000)])
        b=outcome([dict(open=10000,high=11000,low=10000,close=10000)])
        r=summarize_opportunity([("d1","a",a,"OBSERVED"),("d2","b",b,"OBSERVED"),("d3","c",None,"MISSING_PATH"),("d4","d",None,"PENDING")])
        self.assertEqual(r["target_high_reach"]["10"]["hit_pct"],50)
        self.assertEqual(r["sample_count"],2)
        self.assertEqual(r["pending"],1)
        self.assertEqual(r["missing_path"],1)
        self.assertIsNone(summarize_opportunity([("d","a",None,"PENDING")])["peak_high_pct"]["mean"])
    def test_study_uses_full_path_high_and_preserves_missing(self):
        s,b=fixture();d=s["days"][5]["day"]
        s["signals"]=[dict(day=d,code="000001",names=["RSI_GC"])]
        ds=[x["day"] for x in b["markets"][0]["days"]];i=ds.index(d)
        for row in s["bars"]:
            if row["day"] in ds[i+1:i+11]:
                row.update(open=10000,high=10000,low=9800,close=9800)
            if row["day"]==ds[i+2]:row["high"]=12000
        tom=dict(schema="BLUE_TOMATO_CONTEXT_SOURCE_V1",cutoff=s["cutoff"],floor=8,threshold=70,days=[dict(day=d,status="ORIGINAL_SIGNAL_PAYLOAD_HASH_MATCH",rows=[dict(code="000001",market="KOSPI",selection=dict(status="TOMATO",setup="RSI_GC"),stored_ma_arrangement="DOWN")])])
        r=study(s,b,tom)
        row=next(x for x in r["rows"] if x["horizon"]==10 and x["context"]=="BASELINE")
        self.assertEqual(row["peak_high_pct"]["mean"],20)
        self.assertEqual(row["terminal_close_pct"]["mean"],-2)
        self.assertEqual(row["target_high_reach"]["10"]["hit_pct"],100)
        pooled=next(x for x in r["pooled_rows"] if x["horizon"]==10)
        self.assertEqual(pooled["sample_count"],1)
        sr=next(x for x in r["scaleout_rows"] if x["horizon"]==10 and x["group"]=="EXACT_SETUP" and x["initial_stop"]=="SIGNAL_LOW")
        self.assertEqual(sr["observed"],1)
        self.assertEqual(sr["available"],0)
        self.assertEqual(pooled["technical_stop_order"]["SIGNAL_LOW"]["targets"]["10"]["counts"]["TARGET_FIRST"],1)
        self.assertEqual(pooled["technical_stop_order"]["LOWER_VOLUME_PROFILE"]["available"],0)
        row20=next(x for x in r["rows"] if x["horizon"]==20 and x["context"]=="BASELINE")
        self.assertEqual(row20["missing_path"],1)
        self.assertIsNone(row20["peak_high_pct"]["mean"])
    def test_first_touch_order_within_day_and_gap(self):
        first=dict(open=10000,high=10200,low=9900,close=10000)
        dual=dict(open=10000,high=10500,low=9500,close=10000)
        self.assertEqual(first_touch_order([dual],5,9500),("SAME_DAY_UNKNOWN",1))
        self.assertEqual(first_touch_order([first,dict(open=10500,high=10600,low=9400,close=9600)],5,9500),("TARGET_FIRST",2))
        self.assertEqual(first_touch_order([first,dict(open=9500,high=10600,low=9400,close=10500)],5,9500),("STOP_FIRST",2))
        self.assertEqual(first_touch_order([dict(open=10000,high=10499,low=9501,close=10000)],5,9500),("NEITHER",None))
        self.assertEqual(first_touch_order([dict(open=10000,high=10500,low=9501,close=10000),dual],5,9500),("TARGET_FIRST",1))
        self.assertEqual(first_touch_order([dict(open=10000,high=10499,low=9500,close=10000),dual],5,9500),("STOP_FIRST",1))
    def test_order_bounds_exclude_pending_missing_and_never_resolve_dual(self):
        from pattern_performance_tomato_context import STOP_METHODS
        candidates={k:(None,"UNAVAILABLE") for k in STOP_METHODS}
        candidates["SIGNAL_LOW"]=(Fraction(9500),"READY")
        paths=[[dict(open=10000,high=h,low=l,close=10000)] for h,l in [(10500,9700),(10400,9500),(10600,9400),(10400,9600)]]
        events=[("d"+str(i),str(i),outcome(p,candidates),"OBSERVED") for i,p in enumerate(paths)]
        events += [("d4","4",None,"PENDING"),("d5","5",None,"MISSING_PATH")]
        r=summarize_opportunity(events)["technical_stop_order"]["SIGNAL_LOW"]
        self.assertEqual(r["available"],4)
        self.assertEqual(r["median_risk_pct"],5)
        q=r["targets"]["5"]
        self.assertEqual(q["counts"],dict(TARGET_FIRST=1,STOP_FIRST=1,SAME_DAY_UNKNOWN=1,NEITHER=1))
        self.assertEqual(q["target_first_lower_pct"],25)
        self.assertEqual(q["target_first_upper_pct"],50)
        self.assertIsNone(summarize_opportunity([("d","x",None,"PENDING")])["technical_stop_order"]["SIGNAL_LOW"]["targets"]["5"]["target_first_lower_pct"])
    def test_atr_pivot_and_signal_levels_use_only_known_dates(self):
        ds=[str(i) for i in range(21)]
        bars={(d,"000001"):dict(market="KOSPI",open=100,high=105,low=95,close=100) for d in ds}
        bars[("16","000001")]["low"]=90
        c=technical_candidates(ds[:20],bars,"000001","KOSPI")
        self.assertEqual(c["ATR14_SMA_2"],(Fraction(145,14),"READY"))
        self.assertEqual(c["CONFIRMED_SWING_LOW_10"],(Fraction(90),"READY"))
        self.assertEqual(c["SIGNAL_LOW"],(Fraction(95),"READY"))
        stops=stop_at_entry(c,100)
        self.assertEqual(stops["ATR14_SMA_2"][0],Fraction(555,7))
        self.assertEqual(stop_at_entry(c,90)["SIGNAL_LOW"],(None,"ENTRY_AT_OR_BELOW_STOP"))
        bars[("20","000001")]["low"]=1
        self.assertEqual(technical_candidates(ds[:20],bars,"000001","KOSPI"),c)
        del bars[("10","000001")]
        self.assertEqual(technical_candidates(ds[:20],bars,"000001","KOSPI")["ATR14_SMA_2"][1],"INSUFFICIENT_OR_ZERO_ATR")
if __name__=="__main__":unittest.main()

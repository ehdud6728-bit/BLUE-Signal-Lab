import unittest
from test_pattern_performance_forward import fixture
from pattern_performance_tomato_context import study,outcome,summarize_opportunity
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
        row20=next(x for x in r["rows"] if x["horizon"]==20 and x["context"]=="BASELINE")
        self.assertEqual(row20["missing_path"],1)
        self.assertIsNone(row20["peak_high_pct"]["mean"])
if __name__=="__main__":unittest.main()

import unittest
from datetime import date,timedelta
from pattern_performance_forward import candidate,score
def fixture():
    ds=[(date(2026,10,1)+timedelta(days=i)).isoformat() for i in range(30)]
    days=[d for i,d in enumerate(ds) if i!=17]
    bars=[dict(day=d,code="000001",market="KOSPI",open=100+i,high=101+i,low=99+i,close=100+i,amount=100) for i,d in enumerate(days)]
    src=dict(schema="BLUE_FULL_UNIVERSE_SOURCE_V1",cutoff=ds[-1],days=[dict(day=d,rows=1,sha256="a"*64,source="KRX_OPENAPI_EXACT_DAY_VERIFIED",signal_status="COUNT_AND_PAYLOAD_HASH_METADATA_MATCH") for d in days],bars=bars,signals=[],original_eod_hashes_recomputed=True)
    bench=dict(schema="BLUE_BENCHMARK_DAILY_STATES_V1",cutoff=ds[-1],markets=[dict(market=m,days=[dict(day=d,state="DOWN_CONFIRMED",index_trend="DOWN") for d in ds]) for m in ("KOSPI","KOSDAQ")])
    return src,bench
class TestForward(unittest.TestCase):
    def test_feature_specific_history_and_missing_dates(self):
        s,b=fixture();r=candidate(s,b,"a"*40);f=r["rows"][0]["features"]
        self.assertEqual(r["date_diagnostics"][0]["missing_krx_eod_dates"],["2026-10-18"])
        self.assertEqual(r["date_diagnostics"][0]["aligned_trailing_dates"],12)
        self.assertIsNone(f["MA20_FIRST_CROSS"])
        self.assertTrue(f["UP_DAY"]);self.assertEqual(r["rows"][0]["prior"],"UP")
        self.assertEqual(r["rows"][0]["legacy"],"NO_STORED_ROW")
    def test_no_same_capture_day_outcome_and_missing_path(self):
        s,b=fixture();r=candidate(s,b,"a"*40)
        r.update(captured_at="2026-10-30T23:00:00Z",capture_day="2026-10-31")
        self.assertEqual(score(s,b,[r])["outcome_status"],{"PENDING":5})
        for d in ("2026-10-31","2026-11-01"):
            for m in b["markets"]:m["days"].append(dict(day=d,state="DOWN_CONFIRMED",index_trend="DOWN"))
        s["cutoff"]=b["cutoff"]="2026-11-01"
        s["days"].append(dict(day="2026-11-01",rows=1,sha256="b"*64,source="KRX_OPENAPI_EXACT_DAY_VERIFIED",signal_status="MISSING_AUDIT"))
        s["bars"].append(dict(day="2026-11-01",code="000001",market="KOSPI",open=100,high=111,low=90,close=110,amount=100))
        out=score(s,b,[r]);self.assertEqual(out["outcome_status"],{"OBSERVED":1,"PENDING":4})
        row=next(x for x in out["rows"] if x["feature"]=="BASELINE" and x["horizon"]==1)
        self.assertEqual(row["mean_pct"],10.0)
    def test_no_revised_source(self):
        s,b=fixture();r=candidate(s,b,"a"*40);r.update(captured_at="2026-10-30T23:00:00Z",capture_day="2026-10-31")
        s["days"][-1]["sha256"]="b"*64
        with self.assertRaisesRegex(ValueError,"SOURCE_HASH_CHANGED"):score(s,b,[r])
if __name__=="__main__":unittest.main()

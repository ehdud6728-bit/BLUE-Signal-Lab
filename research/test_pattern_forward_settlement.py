import unittest
from pattern_forward_settlement import settlements
from pattern_performance_forward import candidate
from test_pattern_performance_forward import fixture
def setup():
    s,b=fixture()
    r=candidate(s,b,"a"*40)
    r.update(captured_at="2026-10-30T23:00:00Z",capture_day="2026-10-31")
    return s,b,r
def add(s,b,d,bar=True,index=True):
    if index:
        for m in b["markets"]:m["days"].append(dict(day=d,state="DOWN_CONFIRMED",index_trend="DOWN"))
    if bar:
        s["days"].append(dict(day=d,rows=1,sha256="b"*64,source="KRX_OPENAPI_EXACT_DAY_VERIFIED",signal_status="MISSING_AUDIT"))
        s["bars"].append(dict(day=d,code="000001",market="KOSPI",open=100,high=105,low=95,close=99,amount=100))
    s["cutoff"]=b["cutoff"]=d
class Settlement(unittest.TestCase):
    def test_pending_and_exact_maturity(self):
        s,b,r=setup()
        self.assertEqual(settlements(s,b,[r])["diagnostics"],{"PENDING":5})
        add(s,b,"2026-10-31");add(s,b,"2026-11-01")
        a=settlements(s,b,[r]);self.assertEqual(len(a["records"]),1)
        row=a["records"][0];self.assertEqual(row["entry_day"],"2026-11-01")
        self.assertEqual(row["pooled"]["target_high_reach"]["5"]["hits"],1)
        self.assertEqual(row["pooled"]["terminal_close_pct"]["mean"],-1)
        self.assertEqual(row["coverage"],"COMPLETE_SYMBOL_PATHS")
        add(s,b,"2026-11-02");self.assertEqual(settlements(s,b,[r])["records"][0],row)
    def test_missing_intervening_day_blocks(self):
        s,b,r=setup();add(s,b,"2026-10-31",bar=False);add(s,b,"2026-11-01")
        out=settlements(s,b,[r]);self.assertEqual(out["records"],[])
        self.assertEqual(out["diagnostics"]["DATE_ALIGNMENT_BLOCKED"],1)
    def test_partial_missing_symbol_and_changed_source(self):
        s,b,r=setup();r["rows"].append({**r["rows"][0],"code":"000002"})
        add(s,b,"2026-10-31");add(s,b,"2026-11-01")
        row=settlements(s,b,[r])["records"][0]
        self.assertEqual(row["coverage"],"PARTIAL_SYMBOL_PATHS")
        self.assertEqual(row["pooled"]["sample_count"],1);self.assertEqual(row["pooled"]["missing_path"],1)
        s["days"][-3]["sha256"]="c"*64
        with self.assertRaisesRegex(ValueError,"SOURCE_HASH_CHANGED"):settlements(s,b,[r])
if __name__=="__main__":unittest.main()

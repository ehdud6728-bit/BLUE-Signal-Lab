import unittest
from test_pattern_performance_forward import fixture
from pattern_performance_tomato_context import study
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
if __name__=="__main__":unittest.main()

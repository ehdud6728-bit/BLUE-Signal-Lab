import json,unittest
from pattern_performance_private_cases import build,bucket,rsi_recompute
class CaseTests(unittest.TestCase):
    def fixture(self):
        days=["2026-11-02","2026-11-03","2026-11-04","2026-11-05"]
        bars=[];signals=[];factors=[]
        for code,ends,rsi,ma in [("000001",[110,120,120,120],35,True),("000002",[110,90,90,90],65,True),("000003",[110,100,100,100],45,False)]:
            for i,d in enumerate(days):
                o=100
                c=ends[i]
                bars.append(dict(day=d,code=code,market="KOSPI",open=o,high=max(o,c),low=min(o,c),close=c))
            signals.append(dict(day=days[0],code=code,names=["ENV20"],stock_name_at_signal="synthetic"))
            factors.append(dict(day=days[0],code=code,rsi_gc=True,ma_down=ma,rsi_value=rsi,rsi_signal=rsi-2,prior_rsi=rsi-3,prior_rsi_signal=rsi-2,rsi_delta3=3,rsi_delta5=6,rsi_gap=2,rsi_prior5_min=28,record_sha256="a"*64))
        s=dict(format="BLUE_TURSO_EXIT_SOURCE_V1",audits_readback_verified=True,asof_day=days[-1],eod_days=[dict(day=d,expected=3,actual=3) for d in days],research_audited_dates=days,signals=signals,bars=bars)
        e=dict(format="BLUE_COMBINED_FACTORS_V1",asof=days[-1],rows=factors)
        return s,e
    def test_case_returns_and_partitions(self):
        s,e=self.fixture();out=build(s,e,"a"*64,"b"*64)
        m=json.loads(out["manifest"]);g=next(x for x in m["groups"] if x["base"]=="ENV20" and x["group"]=="JOINT")
        self.assertEqual(g["total"],2)
        h=g["horizons"]["3"]
        self.assertEqual(h["complete"],2);self.assertEqual(h["stats"]["NEXT_OPEN"]["all"]["mean_pct"],5)
        self.assertEqual(h["stats"]["NEXT_OPEN"]["all"]["up_pct"],50)
        self.assertEqual(g["horizons"]["5"]["pending"],2)
        self.assertEqual(sum(b["all"]["n"] for b in h["bands"]["RSI"]),2)
        self.assertEqual(m["quality"]["rsi_audit_insufficient_audited_history"],3)
        p=next(p for p in out["pages"] if p["base"]=="ENV20" and p["group"]=="JOINT")
        cases=json.loads(p["payload"]);self.assertEqual(cases[0]["outcomes"]["3"]["next_open_return"],20)
        self.assertEqual(cases[1]["outcomes"]["3"]["next_open_return"],-10)
        self.assertEqual(cases[0]["indicators"]["rsi_value"],35)
    def test_missing_price_and_unknown_rsi(self):
        s,e=self.fixture();s["bars"]=[b for b in s["bars"] if not(b["code"]=="000001" and b["day"]=="2026-11-04")]
        e["rows"][1]["rsi_value"]=None
        m=json.loads(build(s,e,"a"*64,"b"*64)["manifest"])
        g=next(x for x in m["groups"] if x["base"]=="ENV20" and x["group"]=="JOINT")
        self.assertEqual(g["horizons"]["3"]["missing"],1)
        self.assertEqual(next(b for b in g["horizons"]["3"]["bands"]["RSI"] if b["band"]=="UNKNOWN")["all"]["n"],1)
    def test_rsi_warmup_and_boundaries(self):
        self.assertIsNone(rsi_recompute([100]*119))
        self.assertEqual(rsi_recompute(list(range(1,121))),(100,100,100,100))
        self.assertEqual(rsi_recompute([100]*120),(50,50,50,50))
        self.assertEqual(bucket("RSI",30),"30_40");self.assertEqual(bucket("RSI",70),"GE70")
if __name__=="__main__":unittest.main()

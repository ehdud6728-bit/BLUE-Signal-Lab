import unittest
from pattern_performance_combined import analyze,thin
class CombinedTests(unittest.TestCase):
    def test_matched_groups_and_entry(self):
        days=["2026-11-02","2026-11-03","2026-11-04","2026-11-05","2026-11-06"]
        bars=[];signals=[];factors=[]
        for j,c in enumerate(("024720","000001","000002")):
            for i,d in enumerate(days):
                bars.append(dict(day=d,code=c,market="KOSPI",open=100 if i==0 else 120,high=110 if i==0 else 125,low=99 if i==0 else 100,close=109 if i==0 else 110))
            signals.append(dict(day=days[0],code=c,names=["ENV20"]))
            factors.append(dict(day=days[0],code=c,rsi_gc=True if j==0 else False if j==1 else None,ma_down=True))
        s=dict(format="BLUE_TURSO_EXIT_SOURCE_V1",audits_readback_verified=True,asof_day=days[-1],eod_days=[dict(day=d,expected=3,actual=3) for d in days],research_audited_dates=days,signals=signals,bars=bars)
        e=dict(format="BLUE_COMBINED_FACTORS_V1",asof=days[-1],rows=factors)
        out=analyze(s,e)
        rows=[r for r in out["rows"] if r["scope"]=="MARKET" and r["base"]=="ENV20" and r["sampling"]=="ALL_EVENTS" and r["horizon"]==3]
        get=lambda g,b:next(r for r in rows if r["condition"]==g and r["entry_basis"]==b)
        self.assertEqual(get("LONG_BULL","NEXT_OPEN")["all"]["n"],2)
        self.assertEqual(get("JOINT","NEXT_OPEN")["all"]["n"],1)
        self.assertEqual(get("LONG_BULL_NOT_JOINT","NEXT_OPEN")["all"]["n"],1)
        self.assertAlmostEqual(get("JOINT","NEXT_OPEN")["all"]["mean_pct"],-8.333,3)
        self.assertAlmostEqual(get("JOINT","SIGNAL_CLOSE")["all"]["mean_pct"],.917,3)
        self.assertEqual(out["quality"]["unknown_factor_stock_days"],1)
        self.assertTrue(all(r["all"]["n"]==0 for r in out["rows"] if r["base"]=="ENV20_LOWER_TOUCH"))
    def test_cooldown(self):
        self.assertEqual(thin([(0,"A"),(9,"A"),(10,"A"),(9,"B")]),[(0,"A"),(9,"B"),(10,"A")])
if __name__=="__main__":unittest.main()

import unittest
from datetime import date,timedelta
from pattern_performance_market_regime import study

def fixture():
    days=[(date(2026,10,1)+timedelta(days=i)).isoformat() for i in range(15)]
    breadth=[]
    for i,d in enumerate(days):
        for s,n in (("ALL",1700),("KOSPI",850),("KOSDAQ",850)):
            breadth.append(dict(day=d,scope=s,universe=n,matched5=n if i>=5 else 0,up5=n*6//10 if i>=5 else 0,down5=n*3//10 if i>=5 else 0))
    return dict(format="BLUE_TURSO_EXIT_SOURCE_V1",audits_readback_verified=True,asof_day=days[-1],eod_days=[dict(day=d,expected=1700,actual=1700) for d in days],research_audited_dates=days,research_audited_days=len(days),market_breadth_by_day=breadth,signals=[dict(day=days[i],code="000001",names=["ENV20"]) for i in (0,5,8,9,11,14)],bars=[dict(day=d,code="000001",market="KOSPI",close=100+i) for i,d in enumerate(days)])
def row(report,segment,h,scope="ALL",regime="BROAD_UP"):
    return next(g for r in report["rows"] if (r["segment"],r["horizon"],r["scope"])==(segment,h,scope) for g in r["groups"] if g["regime"]==regime)
class TestRegime(unittest.TestCase):
    def test_split_and_unknown(self):
        r=study(fixture())
        self.assertEqual(r["regime_days"]["ALL"]["UNKNOWN"],5)
        self.assertEqual(row(r,"EARLY",2)["sample_count"],1)
        self.assertEqual(row(r,"EARLY",2)["pending"],2)
        self.assertEqual(row(r,"LATE",2)["sample_count"],1)
        self.assertEqual(row(r,"ALL",1,regime="UNKNOWN")["sample_count"],1)
        self.assertFalse(row(r,"ALL",1)["descriptive_sample_sufficient"])
    def test_missing_middle(self):
        s=fixture();s["bars"].pop(6)
        r=study(s)
        self.assertEqual(row(r,"EARLY",2)["missing_path"],1)
        self.assertEqual(row(r,"EARLY",2)["sample_count"],0)
    def test_invalid_breadth(self):
        s=fixture();s["market_breadth_by_day"][0]["up5"]=1
        with self.assertRaisesRegex(ValueError,"INVALID_BREADTH_COUNT"):study(s)
    def test_future_breadth_not_used(self):
        s=fixture();r=study(s)
        for x in s["market_breadth_by_day"]:
            if x["day"]>=s["eod_days"][10]["day"]:x["up5"]=0
        self.assertEqual(row(r,"EARLY",2),row(study(s),"EARLY",2))
if __name__=="__main__":unittest.main()

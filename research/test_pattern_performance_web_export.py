import unittest
from pattern_performance_web_export import compare, typescript

def row(pattern, rate):
    return dict(group="detail_rankings",pattern=pattern,horizon_trading_days=3,tier="SHORT_RECOMMENDATION",positive_return_probability_pct=rate)

def snap(day, rows):
    return dict(asof=day,audited_sessions=28,rows={"ENV20":[[3,30,5,70,1,1]]},recommendations=rows)

class ExportTest(unittest.TestCase):
    def test_changes(self):
        a=snap("2026-11-20",[row("A",70),row("B",80),row("C",75),row("D",75)])
        b=snap("2026-11-23",[row("A",76),row("B",74),row("C",76),row("E",80)])
        self.assertEqual([r["status"] for r in compare(a,b)["changes"]],["STRENGTHENED","WEAKENED","MAINTAINED","REMOVED","NEW"])
        self.assertIn("RECENT_RECOMMENDATIONS",typescript(b))
        with self.assertRaises(ValueError):
            compare(b,a)
        with self.assertRaises(ValueError):
            typescript(snap("2026-11-23",[row("A",70),row("A",75)]))
if __name__=="__main__":
    unittest.main()

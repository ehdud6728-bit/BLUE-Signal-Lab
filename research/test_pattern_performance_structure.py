import unittest
from pattern_performance_structure import structure,study
from test_pattern_performance_market_regime import fixture

def bar(p):
    return dict(market="KOSPI",open=p,high=p+1,low=p-1,close=p)
class TestStructure(unittest.TestCase):
    def test_box_breakout_vs_prebreak(self):
        h=[bar(x) for x in [100,101,102,103,105,110,111,110,111,110,110]]
        self.assertEqual(structure(h),"PRIOR_RISE_IN_BOX")
        self.assertEqual(structure(h[:-1]+[bar(115)]),"PRIOR_RISE_BREAKOUT")
        self.assertEqual(structure(h[:-1]+[bar(105)]),"PRIOR_RISE_BREAKDOWN")
        self.assertEqual(structure(h[:-1]+[None]),"UNKNOWN")
    def test_outcome_does_not_change_signal_structure(self):
        s=fixture()
        for b in s["bars"]:b.update(open=b["close"],high=b["close"]+1,low=b["close"]-1)
        r=study(s)
        self.assertEqual(sum(r["states"].values()),len(s["signals"]))
        self.assertEqual(r["states"]["UNKNOWN"],4)
        self.assertTrue(r["rows"])
        self.assertTrue(all(x["sample_count"]+x["pending"]+x["missing_path"]==x["events"] for x in r["rows"]))
if __name__=="__main__":unittest.main()

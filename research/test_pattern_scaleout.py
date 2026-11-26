import unittest
from fractions import Fraction as F
from pattern_scaleout import simulate,case,summarize,POLICIES
def b(o,h,l,c):return dict(open=o,high=h,low=l,close=c)
class Scaleout(unittest.TestCase):
    def test_conservation_and_weighted_returns(self):
        p=[b(100,110,99,108),b(108,120,106,118),b(118,130,116,125)]
        r=simulate(p,90,5,"40_30_30_ATR_TRAIL")
        self.assertEqual(r["ret"],F(35,2))
        self.assertEqual([x[1] for x in r["fills"]],[40,30,30])
        self.assertEqual(r["exit_day"],3)
    def test_stop_first_and_gap_open(self):
        r=simulate([b(100,120,89,115)],90,5,"40_30_30_ATR_TRAIL")
        self.assertEqual(r["ret"],-10);self.assertEqual(r["ambiguous"],1)
        r=simulate([b(100,104,99,102),b(120,125,85,100)],90,5,"40_30_30_ATR_TRAIL")
        self.assertEqual(r["ret"],7)
        self.assertEqual(r["ambiguous"],0)
        self.assertEqual([x[1] for x in r["fills"]],[40,30,30])
    def test_lagged_trailing_stop_and_gap(self):
        p=[b(100,120,95,115),b(105,109,100,101)]
        r=simulate(p,90,5,"HALF_1R_ATR_TRAIL")
        self.assertEqual(r["ret"],F(15,2))
        self.assertTrue(r["gap_stop"])
        self.assertEqual(r["fills"][-1][0],2)
        self.assertEqual(simulate(p,90,5,"HALF_1R_HOLD")["ret"],F(11,2))
    def test_all_policies_full_path_and_matched_sample(self):
        p=[b(100,111,99,105)]
        v={k:simulate(p,90,5,k) for k in POLICIES}
        events=[("d","x",{"SIGNAL_LOW":(v,"READY")},"OBSERVED"),("e","y",{"SIGNAL_LOW":(None,"ATR_NOT_AVAILABLE")},"OBSERVED"),("f","z",None,"PENDING")]
        s=summarize(events,"SIGNAL_LOW")
        self.assertEqual(s["available"],1);self.assertEqual(s["observed"],2)
        self.assertEqual(s["policies"]["FULL_1R"]["paired_delta_vs_full_1r_pp"],0)
        self.assertEqual(s["policies"]["HALF_1R_HOLD"]["paired_delta_vs_full_1r_pp"],-2.5)
        self.assertFalse(s["sample_floor_met"])
    def test_percent_targets_independent_of_initial_risk(self):
        p=[b(100,103,99,101),b(101,105,100,102)]
        for stop in (90,98):
            self.assertEqual(simulate(p,stop,5,"FULL_3P")["ret"],3)
            self.assertEqual(simulate(p,stop,5,"FULL_5P")["ret"],5)
            self.assertEqual(simulate(p,stop,5,"70_30_3P_5P")["ret"],F(18,5))
        self.assertEqual(simulate(p,90,5,"HALF_3P_ATR_TRAIL")["ret"],F(3,2))
    def test_simple_target_gap_and_ambiguity(self):
        self.assertEqual(simulate([b(100,105,89,101)],90,5,"FULL_3P")["ret"],-10)
        r=simulate([b(100,102,99,101),b(106,108,89,95)],90,5,"FULL_5P")
        self.assertEqual(r["ret"],5);self.assertEqual(r["ambiguous"],0)
    def test_matched_fixed_target_deltas(self):
        p=[b(100,105,99,104)]
        v={k:simulate(p,90,5,k) for k in POLICIES}
        s=summarize([("d","x",{"SIGNAL_LOW":(v,"READY")},"OBSERVED")],"SIGNAL_LOW")["policies"]
        self.assertEqual(s["FULL_5P"]["paired_delta_vs_full_3p_pp"],2)
        self.assertEqual(s["FULL_3P"]["aggregate_positive_peak_capture_pct"],60)
        self.assertEqual(s["FULL_3P"]["complete_target_exit_count"],1)
if __name__=="__main__":unittest.main()

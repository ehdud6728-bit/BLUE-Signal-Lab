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
if __name__=="__main__":unittest.main()

import unittest
from fractions import Fraction as F
from env20_pullback_study import entry_choice,simulate,summary
def b(o,h,l,c):return dict(open=o,high=h,low=l,close=c)
class Pullback(unittest.TestCase):
    def test_limit_and_confirmation_no_future_entry(self):
        p=[b(100,110,98,99),b(99,103,96,100),b(101,106,100,105)]
        self.assertEqual(entry_choice(p,100,("LIMIT",3,3)),(1,97,False))
        self.assertEqual(entry_choice(p,100,("CONFIRM",3,3)),(2,101,True))
        self.assertIsNone(entry_choice(p,100,("LIMIT",7,3)))
    def test_intraday_limit_cannot_use_pre_entry_high(self):
        p=[b(100,110,97,98),b(98,101,96,100)]
        r=simulate(p,100,90,F(3),("LIMIT",3,3),"SIGNAL_LOW",3)
        self.assertEqual(r["exit_day"],2)
        self.assertEqual(r["ret"],3)
        a=simulate([b(100,110,89,100)],100,90,F(3),("LIMIT",3,3),"SIGNAL_LOW",3)
        self.assertEqual(a["reason"],"STOP_TOUCH");self.assertTrue(a["ambiguous"])
    def test_gap_and_invalid_stop(self):
        a=simulate([b(94,99,92,95)],100,95,F(3),("LIMIT",3,3),"SIGNAL_LOW",3)
        self.assertEqual(a["status"],"STOP_UNAVAILABLE_OR_ENTRY_BELOW_STOP")
        a=simulate([b(100,101,99,100),b(90,106,89,101)],100,95,F(3),("IMMEDIATE",0,0),"SIGNAL_LOW",3)
        self.assertEqual(a["ret"],-10)
    def test_missed_signal_in_denominator(self):
        x=simulate([b(100,104,99,103)],100,95,F(3),("IMMEDIATE",0,0),"SIGNAL_LOW",3)
        s=summary([("d","x",x),("d","y",dict(status="NO_ENTRY",ret=None))])
        self.assertEqual(s["fill_pct"],50);self.assertEqual(s["net_trade_mean_pct"],2.7);self.assertEqual(s["net_per_signal_pct"],1.35)
        self.assertFalse(s["sample_floor_met"])
if __name__=="__main__":unittest.main()

import unittest
from fractions import Fraction as F
from env20_structural_entry import levels,choose,opportunity,summarize,study
from test_pattern_performance_forward import fixture
def b(o,h,l,c):return dict(open=o,high=h,low=l,close=c,market="KOSPI",amount=100)
class Structural(unittest.TestCase):
    def test_frozen_prior_levels_and_missing(self):
        a=[b(100,102,99,100) for _ in range(25)]
        a[-5]=b(95,99,90,96);a[-1]=b(97,108,80,105)
        r=levels(a[-1],lambda n:a[-n:] if len(a)>=n else None)
        self.assertEqual(r["PRIOR5_LOW"],(90,"READY"));self.assertEqual(r["SIGNAL_LOW"],(80,"READY"))
        self.assertEqual(r["CONFIRMED_SWING_LOW_10"],(90,"READY"))
        self.assertEqual(r["BULL_BODY_MID"],(101,"READY"))
        self.assertEqual(levels(a[-1],lambda n:None)["MA5"][1],"HISTORY_OR_STRUCTURE_UNAVAILABLE")
    def test_no_pre_entry_high_and_exact_entry_window(self):
        p=[b(100,140,98,100),b(100,130,90,95),b(96,105,94,100),b(100,111,98,101)]
        status,e=choose(p,F(95),"LIMIT");self.assertEqual(e,(1,95,False))
        x=opportunity(p,e,F(95),100,2,"ENTRY_WINDOW")
        self.assertEqual(x["peak_lower"],F(200,19));self.assertEqual(x["peak_upper"],F(700,19))
        self.assertEqual(x["targets"][15],(None,1));self.assertEqual(x["peak_day"],2)
        self.assertEqual(opportunity(p,e,F(95),100,3,"ENTRY_WINDOW")["peak_lower"],F(320,19))
        self.assertEqual(opportunity(p,e,F(95),100,2,"SIGNAL_WINDOW")["peak_lower"],0)
    def test_reclaim_no_lookahead_and_gap(self):
        p=[b(100,110,90,105),b(94,120,90,100)]
        self.assertEqual(choose(p,F(95),"RECLAIM"),("RECLAIM_GAP_BELOW_LEVEL",None))
        self.assertEqual(choose(p[:1],F(95),"RECLAIM"),("CONFIRMATION_TOO_LATE",None))
        p[1]=b(100,110,98,101);self.assertEqual(choose(p,F(95),"RECLAIM")[1],(1,100,True))
    def test_report_full_path_and_same_signals(self):
        src,bench=fixture();day=src["days"][21]["day"]
        src["signals"]=[dict(day=day,code="000001",names=["ENV20_LOWER_TOUCH"])]
        f=dict(schema="BLUE_ENV20_PULLBACK_FACTORS_V1",cutoff=src["cutoff"],rows=[dict(day=day,code="000001",ma_down=True,ma_chart_consistent=True,record_sha256="a"*64)])
        r=study(src,bench,f)
        self.assertEqual(r["inverse_chart_match_signals"],1)
        a=[x for x in r["rows"] if x["basis"]=="SIGNAL_WINDOW" and x["horizon"]==3 and x["context_feature"]=="ALL" and x["phase"]=="ALL" and x["level"]=="SIGNAL_LOW"]
        self.assertEqual(len(a),3);self.assertTrue(all(x["eligible_signals"]==1 for x in a))
        self.assertEqual(next(x for x in a if x["entry"]=="LIMIT")["entered"],0)
        self.assertEqual(next(x for x in a if x["entry"]=="IMMEDIATE")["entered"],1)
        self.assertTrue(all(isinstance(x["key"],list) for x in r["coverage"]))
        self.assertEqual([x for x in r["coverage"] if x["key"]==["ENTRY_WINDOW","20","PENDING"]],[{"key":["ENTRY_WINDOW","20","PENDING"],"count":1}])
        self.assertFalse(any(x["basis"]=="ENTRY_WINDOW" and x["horizon"]==20 for x in r["rows"]))
if __name__=="__main__":unittest.main()

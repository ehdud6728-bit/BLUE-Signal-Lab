import unittest
from fractions import Fraction as F
from env20_technical_room import geometry,room,order,evaluate,study,RULES,resistance
from test_pattern_performance_forward import fixture
def b(o,h,l,c):return dict(open=o,high=h,low=l,close=c,market="KOSPI",amount=100)
def lv():return {"SIGNAL_LOW":(F(95),"READY"),"BULL_BODY_MID":(F(98),"READY"),"PRIOR5_LOW":(F(90),"READY")}
class TechnicalRoom(unittest.TestCase):
    def test_frozen_geometry_and_gap_no_rebase(self):
        g=geometry(F(100),lv(),{"SIGNAL_HIGH":F(110),"MA20":F(120)})
        self.assertEqual(g["stop"],95);self.assertEqual(room(F(100),g)["rr"],2)
        self.assertIsNone(room(F(94),g))
        v=evaluate("IMMEDIATE_RR2",[b(94,110,90,100)],b(98,110,95,100),lv(),{"SIGNAL_HIGH":F(110)},True,1,"SIGNAL_WINDOW")
        self.assertEqual(v["status"],"ENTRY_GEOMETRY_INVALID")
        self.assertIsNone(v["op"])
    def test_first_touch_and_intraday_ambiguity(self):
        e=(0,F(100),True)
        self.assertEqual(order([b(100,106,96,104)],e,1,"SIGNAL_WINDOW",F(95),F(105)),"TARGET_FIRST")
        self.assertEqual(order([b(100,106,94,104)],e,1,"SIGNAL_WINDOW",F(95),F(105)),"AMBIGUOUS")
        self.assertEqual(order([b(100,104,94,100),b(100,110,99,109)],e,2,"SIGNAL_WINDOW",F(95),F(105)),"SUPPORT_FIRST")
        p=[b(103,110,99,101),b(100,104,94,96)]
        self.assertEqual(order(p,(0,F(100),False),1,"SIGNAL_WINDOW",F(95),F(105)),"POSSIBLE_TARGET_ONLY")
        self.assertEqual(order(p,(0,F(100),False),2,"SIGNAL_WINDOW",F(95),F(105)),"AMBIGUOUS")
        self.assertEqual(order([b(103,110,99,106)],(0,F(100),False),1,"SIGNAL_WINDOW",F(95),F(105)),"TARGET_FIRST")
    def test_resistance_exact_stored_price(self):
        x={"supply":{"status":"STORED_ESTIMATE","reference_price":105.25}}
        self.assertEqual(resistance(b(99,110,95,100),lambda n:None,x)["STORED_UPPER_SUPPLY"],F(421,4))
        self.assertNotIn("STORED_UPPER_SUPPLY",resistance(b(99,110,95,100),lambda n:None,{"supply":{"status":"STORED_ESTIMATE","distance_pct":5}}))
    def test_report_matched_denominator_and_pending(self):
        src,bench=fixture();d=src["days"][21]["day"]
        src["signals"]=[dict(day=d,code="000001",names=["ENV20_LOWER_TOUCH"])]
        f=dict(schema="BLUE_ENV20_PULLBACK_FACTORS_V1",cutoff=src["cutoff"],rows=[dict(day=d,code="000001",ma_down=True,ma_chart_consistent=True,record_sha256="a"*64)])
        r=study(src,bench,f)
        a=[x for x in r["rows"] if x["basis"]=="SIGNAL_WINDOW" and x["horizon"]==3 and x["phase"]=="ALL" and x["context_feature"]=="ALL"]
        self.assertEqual(len(a),len(RULES));self.assertTrue(all(x["signals"]==1 for x in a))
        self.assertEqual(next(x for x in a if x["rule"]=="IMMEDIATE_RR2")["status_counts"],{"GEOMETRY_UNAVAILABLE":1})
        self.assertEqual(next(x for x in a if x["rule"]=="IMMEDIATE")["entered"],1)
        self.assertFalse(any(x["basis"]=="ENTRY_WINDOW" and x["horizon"]==20 for x in r["rows"]))
if __name__=="__main__":unittest.main()

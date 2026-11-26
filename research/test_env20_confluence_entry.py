import unittest
from fractions import Fraction as F
from env20_confluence_entry import cluster,rule_choice,summarize_rules,study,RULES,FAMILIES,before_target
from env20_structural_entry import opportunity
from test_pattern_performance_forward import fixture
def lv(**kwargs):
    return {k:(F(kwargs[k]),"READY") if k in kwargs else (None,"UNAVAILABLE") for k in FAMILIES}
class Confluence(unittest.TestCase):
    def test_distinct_families_and_no_chain(self):
        self.assertIsNone(cluster(lv(PRIOR5_LOW=90,PRIOR10_LOW=90,CONFIRMED_SWING_LOW_10=90),F(8)))
        a=cluster(lv(SIGNAL_LOW=90,PRIOR5_LOW=92,MA20_X_0_8=94),F(8))
        self.assertEqual(a["price"],94);self.assertEqual(a["bottom"],92);self.assertEqual(a["families"],2)
        self.assertIsNone(cluster(lv(SIGNAL_LOW=90,PRIOR5_LOW=90),None))
    def test_rule_only_signal_information(self):
        x=lv(BULL_BODY_MID=98,BULL_OPEN=96,SIGNAL_LOW=92,MA20_X_0_8=90)
        self.assertEqual(rule_choice("CANDLE_RULE","BULL",x,None)[0],"IMMEDIATE")
        self.assertEqual(rule_choice("CANDLE_RULE","LONG_BULL",x,None),("LIMIT",98,"BULL_BODY_MID"))
        self.assertEqual(rule_choice("CANDLE_RULE_NO_TRADE_BEAR","BEAR",x,None)[0],"SKIP")
        self.assertEqual(rule_choice("CONFLUENCE_LIMIT","BULL",x,None)[0],"UNAVAILABLE")
    def test_all_signal_denominator(self):
        p=[dict(open=100,high=106,low=94,close=100)]
        e=(0,F(100),True);o=opportunity(p,e,F(100),100,1,"SIGNAL_WINDOW")
        a=before_target(p,e,1,"SIGNAL_WINDOW",o)
        self.assertEqual(a,-6)
        s=summarize_rules([("d","x",None,"ENTERED",o,o,None,a),("d","y",None,"UNAVAILABLE",None,o,None,None)])
        self.assertEqual(s["target_reach"]["5"]["confirmed_pct_of_eligible_signals"],50)
        self.assertEqual(s["target5_delta_pp"],-50);self.assertEqual(s["target5_with_adverse_ge_5pct_count"],1)
        self.assertIsNone(s["level_discount_pct"]["mean"])
    def test_actual_report_contract_and_pending(self):
        src,bench=fixture();d=src["days"][21]["day"]
        src["signals"]=[dict(day=d,code="000001",names=["ENV20_LOWER_TOUCH"])]
        f=dict(schema="BLUE_ENV20_PULLBACK_FACTORS_V1",cutoff=src["cutoff"],rows=[dict(day=d,code="000001",ma_down=True,ma_chart_consistent=True,record_sha256="a"*64)])
        r=study(src,bench,f)
        a=[x for x in r["rows"] if x["basis"]=="SIGNAL_WINDOW" and x["horizon"]==3 and x["phase"]=="ALL" and x["context_feature"]=="ALL"]
        self.assertEqual(len(a),len(RULES));self.assertTrue(all(x["eligible_signals"]==1 for x in a))
        self.assertEqual(next(x for x in a if x["rule"]=="CONFLUENCE_LIMIT")["status_counts"],{"UNKNOWN_HISTORY":1})
        self.assertFalse(any(x["basis"]=="ENTRY_WINDOW" and x["horizon"]==20 for x in r["rows"]))
if __name__=="__main__":unittest.main()

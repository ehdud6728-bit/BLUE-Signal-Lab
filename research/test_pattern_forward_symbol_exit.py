import unittest
from fractions import Fraction as F
from pattern_forward_symbol_exit import exits,evaluate,summarize
from pattern_forward_settlement import settlements
from test_pattern_forward_settlement import setup,add
def b(o,h,l,c):return dict(open=o,high=h,low=l,close=c)
class SymbolExit(unittest.TestCase):
    def test_independent_targets_and_stop_first(self):
        path=[b(100,104,99,102),b(102,105,99,101)]
        self.assertEqual(exits(path,F(95),3),(3,1,"TARGET",False))
        self.assertEqual(exits(path,F(95),5),(5,2,"TARGET",False))
        self.assertEqual(exits([b(100,105,94,103)],F(95),3),(-5,1,"STOP_TOUCH",True))
        self.assertEqual(exits([b(100,102,99,101),b(106,108,90,100)],F(95),5),(5,2,"TARGET",False))
        self.assertEqual(exits([b(100,102,99,101),b(90,106,89,100)],F(95),5),(-10,2,"STOP_GAP",False))
    def test_bundle_same_window_and_missing_path(self):
        s,b,r=setup();r["rows"].append({**r["rows"][0],"code":"000002"})
        add(s,b,"2026-10-31");add(s,b,"2026-11-01")
        detail=[];base=settlements(s,b,[r],symbol_records=detail)["records"][0]
        self.assertEqual(len(detail),1);x=detail[0]
        self.assertEqual(x["observation_days"],base["observation_days"])
        self.assertEqual(x["pooled"],base["pooled"])
        self.assertEqual(x["symbol_rows"][1]["status"],"MISSING_PATH")
        self.assertEqual(x["exit_summary"]["missing_path"],1)
        self.assertEqual(x["exit_summary"]["methods"]["SIGNAL_LOW"]["available"],0) # future entry below signal low
        self.assertEqual(x["exit_summary"]["methods"]["ATR14_SMA_1_5"]["coverage"],{"ATR_HISTORY_NOT_FROZEN":1})
    def test_unfrozen_history_never_used(self):
        from pattern_forward_symbol_exit import levels
        ds=["2026-10-%02d"%i for i in range(1,16)]
        bars={(d,"000001"):dict(day=d,market="KOSPI",open=100,high=102,low=98,close=100) for d in ds}
        s=dict(source_day=ds[-1],source_hashes={d:"a"*64 for d in ds});r=dict(code="000001",market="KOSPI")
        self.assertEqual(levels(s,r,bars,{"KOSPI":ds},100)["ATR14_SMA_1_5"],(94,"READY"))
        del s["source_hashes"][ds[0]]
        self.assertEqual(levels(s,r,bars,{"KOSPI":ds},100)["ATR14_SMA_1_5"],(None,"ATR_HISTORY_NOT_FROZEN"))
if __name__=="__main__":unittest.main()

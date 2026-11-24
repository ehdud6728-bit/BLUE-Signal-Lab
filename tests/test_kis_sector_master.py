import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from kis_sector_master import parse_master,SPECS

class MasterTests(unittest.TestCase):
    def test_layout_and_flags(self):
        for market,(_,tail,widths,flags) in SPECS.items():
            self.assertEqual(sum(widths),tail)
            vals=[" "*w for w in widths]
            vals[:5]=["ST","1","0002","0003","0003"]
            for i,v in zip(flags,["N","N","N","00","0","N"]): vals[i]=v
            prefix="005930".ljust(9)+"KR7005930003"+"테스트"
            build=lambda:prefix+"".join(v.ljust(w) for v,w in zip(vals,widths))
            self.assertEqual(parse_master(build(),market)[0]["sectors"],["0002","0003"])
            vals[flags[0]]="Y"
            self.assertEqual(parse_master(build(),market),[])
    def test_short_record(self):
        with self.assertRaisesRegex(ValueError,"MASTER_ROW_SHORT"):
            parse_master("bad","KOSPI")

if __name__=="__main__":
    unittest.main()

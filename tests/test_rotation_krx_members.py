import sys
import unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from rotation_krx_members import resolve
from kis_sector_master import index_tags, SPECS

class FakeStock:
    def get_index_ticker_list(self, day, market):
        assert day=="20261123"
        return ["1010","1011"] if market=="KOSPI" else ["2010"]
    def get_index_ticker_name(self,ticker):
        return {"1010":"코스피 복합지수","1011":"코스피 다른지수","2010":"코스닥 복합지수"}[ticker]
    def get_index_portfolio_deposit_file(self,ticker,day,alternative):
        assert ticker=="1010" and day=="20261123" and alternative is False
        return ["000001","000002"]

class MembershipTests(unittest.TestCase):
    def test_exact_name_and_no_fuzzy_lookup(self):
        groups=[dict(market="KOSPI",code="3010",name="복합지수"),dict(market="KOSPI",code="3011",name="복합지수 관련")]
        r=resolve(dict(day="2026-11-23",groups=groups),FakeStock(),lambda _:None)
        self.assertEqual(r["groups"][0]["members"],["000001","000002"])
        self.assertEqual(r["groups"][1]["reason"],"NO_EXACT_INDEX_NAME")
    def test_documented_flags(self):
        for market,(_,_,widths,_) in SPECS.items():
            fields=[""]*len(widths)
            fields[1]="1"
            if market=="KOSPI":
                fields[8]="6";fields[16]="Y"
                self.assertEqual(set(index_tags(fields,market)),{"KOSPI_LARGE","KOSPI200","KOSPI200_금융","KRX반도체"})
            else:
                fields[25]="Y";fields[11]="Y"
                self.assertEqual(set(index_tags(fields,market)),{"KOSDAQ_LARGE","KOSDAQ150","KRX반도체"})

if __name__=="__main__":
    unittest.main()

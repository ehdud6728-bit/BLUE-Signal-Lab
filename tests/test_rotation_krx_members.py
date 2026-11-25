import sys
import unittest
from datetime import date, timedelta
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

class CrossStock:
    def __init__(self):
        self.dates=[date(2026,10,29)+timedelta(days=i) for i in range(26)]
        self.calls=[]
        self.names={"2001":"코스닥","2002":"코스닥 일반","3001":"KRX 통합테마","4001":"별도 테마"}
    def get_index_ticker_list(self, day, market):
        assert day=="20261123"
        return {"KOSDAQ":["2001","2002"],"KRX":["3001"],"테마":["4001"]}[market]
    def get_index_ticker_name(self,ticker):
        return self.names[ticker]
    def get_index_ohlcv(self,start,end,ticker):
        assert (start,end)==("20261029","20261123")
        return {"종가":{d:100 if ticker=="2001" else 100+i for i,d in enumerate(self.dates)}}
    def get_index_portfolio_deposit_file(self,ticker,day,alternative):
        self.calls.append((ticker,day,alternative))
        return ["000001","000002"]

class CrossMembershipTests(unittest.TestCase):
    def group(self,stock):
        ratio=[(100+i)/100 for i in range(26)]
        rel=lambda n,i:100*(ratio[i]/ratio[i-n]-1)
        return dict(market="KOSDAQ",code="6296",name="KRX 통합테마",
            benchmark_days=[d.isoformat() for d in stock.dates],
            benchmark=dict(day="2026-11-23",close=100,change5_pct=0),
            trend=dict(day="2026-11-23",rs5=rel(5,25),rs10=rel(10,25),rs20=rel(20,25),momentum=rel(10,25)-rel(10,20)))
    def test_cross_scope_exact_label_and_history(self):
        stock=CrossStock()
        group=self.group(stock)
        result=resolve(dict(day="2026-11-23",groups=[group]),stock,lambda _:None)
        item=result["groups"][0]
        self.assertEqual(item["identity_basis"],"CROSS_EXACT_NAME_AND_RELATIVE_HISTORY")
        self.assertEqual(item["krx_scope"],"KRX")
        self.assertEqual(stock.calls,[("3001","20261123",False)])
        self.assertEqual(result["catalog_counts"],{"KOSDAQ":2,"KRX":1,"테마":1})
    def test_cross_scope_mismatch_and_ambiguity_refused(self):
        stock=CrossStock()
        group=self.group(stock)
        group["trend"]["rs10"]+=1
        item=resolve(dict(day="2026-11-23",groups=[group]),stock,lambda _:None)["groups"][0]
        self.assertEqual(item["reason"],"INDEX_HISTORY_MISMATCH")
        self.assertEqual(stock.calls,[])
        group=self.group(stock)
        stock.names["4001"]="KRX 통합테마"
        item=resolve(dict(day="2026-11-23",groups=[group]),stock,lambda _:None)["groups"][0]
        self.assertEqual(item["reason"],"AMBIGUOUS_INDEX_NAME")
        self.assertEqual(stock.calls,[])

if __name__=="__main__":
    unittest.main()

"""Read-only dated KRX industry source and theme catalog for frozen Nov discovery study.
Never use current membership as historical; no DB access, no raw provider body.
"""
import argparse
import contextlib
import hashlib
import io
import json
import re
import time
from pathlib import Path

DAYS=("2026-11-16","2026-11-17","2026-11-18","2026-11-19","2026-11-20","2026-11-23","2026-11-24","2026-11-25","2026-11-26")
MARKETS=("KOSPI","KOSDAQ")
CODE=re.compile(r"[0-9A-Z]{6}")
def need(ok,reason):
    if not ok: raise ValueError(reason)
def clean(v):
    return isinstance(v,str) and bool(v.strip()) and len(v)<=100 and not any(ord(c)<32 for c in v)
def canonical(x):
    return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False).encode()
def normalize(df,day,market):
    need(all(k in df.columns for k in ("종목명","업종명","종가")),"INDUSTRY_COLUMNS_MISSING")
    need(400<=len(df)<=5000,"INDUSTRY_COUNT_INVALID")
    rows=[];seen=set()
    for code,r in df.iterrows():
        code=str(code)
        need(CODE.fullmatch(code) and code not in seen,"INDUSTRY_CODE_INVALID")
        seen.add(code)
        name,sector,close=r["종목명"],r["업종명"],r["종가"]
        need(clean(name),"INDUSTRY_NAME_INVALID")
        need(isinstance(close,(int,float)) or hasattr(close,"item"),"INDUSTRY_CLOSE_INVALID")
        p=int(close);need(p==close and p>=0,"INDUSTRY_CLOSE_INVALID")
        # Null/placeholder industry is explicitly unclassified.
        industry=sector.strip() if clean(sector) and sector.strip() not in ("0","-","미분류") else None
        rows.append({"day":day,"market":market,"code":code,"name":name.strip(),"industry":industry,"close":p})
    return sorted(rows,key=lambda x:x["code"])
def theme_catalog(stock,day):
    codes=stock.get_index_ticker_list(day.replace("-",""),market="테마")
    need(isinstance(codes,list) and 0<len(codes)<=600 and len(codes)==len(set(codes)),"THEME_CATALOG_INVALID")
    rows=[]
    for code in codes:
        need(isinstance(code,str) and re.fullmatch(r"[0-9]{4,6}",code),"THEME_CODE_INVALID")
        label=stock.get_index_ticker_name(code)
        need(clean(label),"THEME_NAME_INVALID")
        rows.append({"index_code":code,"name":label.strip()})
    return sorted(rows,key=lambda x:x["index_code"])
def collect(stock,wait=time.sleep):
    industries=[];catalogs=[];coverage=[]
    for day in DAYS:
        for market in MARKETS:
            wait(1.1)
            try:
                rows=normalize(stock.get_market_sector_classifications(day.replace("-",""),market),day,market)
                industries.extend(rows)
                coverage.append({"day":day,"market":market,"status":"RECEIVED_NOT_PRICE_VERIFIED","rows":len(rows),"classified":sum(r["industry"] is not None for r in rows),"sha256":hashlib.sha256(canonical(rows)).hexdigest()})
            except Exception:
                coverage.append({"day":day,"market":market,"status":"UNAVAILABLE","rows":0})
        wait(1.1)
        try:
            rows=theme_catalog(stock,day)
            catalogs.append({"day":day,"status":"RECEIVED_CATALOG_ONLY","indices":rows,"sha256":hashlib.sha256(canonical(rows)).hexdigest()})
        except Exception:
            catalogs.append({"day":day,"status":"UNAVAILABLE","indices":[]})
    return {"schema":"BLUE_DATED_CLASSIFICATION_SOURCE_V1","source":"KRX_VIA_PYKRX_1_2_9","requested_days":list(DAYS),"industry_coverage":coverage,"industry_rows":industries,"theme_catalogs":catalogs,"writes":0,"limitations":["Requested-date classification; verify close against immutable KRX EOD before joining. No current KIS master fallback.","Theme catalogs are NOT constituent lists; no stock theme membership asserted.","Missing classification is unknown; no inference from company name."]}
def self_test():
    import pandas as pd
    d=pd.DataFrame({"종목명":["테스트"]*400,"업종명":["서비스업"]*399+["0"],"종가":[100]*400},index=[str(i).zfill(6) for i in range(400)])
    a=normalize(d,DAYS[0],"KOSPI")
    assert len(a)==400 and a[-1]["industry"] is None and a[0]["close"]==100
    for bad in (d.iloc[:3],d.rename(columns={"종가":"가격"}),d.set_axis(["000001"]*400)):
        try: normalize(bad,DAYS[0],"KOSPI")
        except ValueError: pass
        else: raise AssertionError("invalid industry accepted")
    class Fake:
        def get_market_sector_classifications(self,date,market): return d
        def get_index_ticker_list(self,date,market): return ["1234"]
        def get_index_ticker_name(self,code): return "테스트 테마"
    a=collect(Fake(),lambda _:None)
    assert len(a["industry_coverage"])==18 and len(a["industry_rows"])==7200 and len(a["theme_catalogs"])==9
    assert all(c["status"]=="RECEIVED_CATALOG_ONLY" for c in a["theme_catalogs"])
    print("BLUE_DATED_CLASSIFICATION_TESTS 6")
if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--test",action="store_true")
    p.add_argument("--output",type=Path)
    args=p.parse_args()
    if args.test:self_test()
    else:
        need(args.output is not None,"OUTPUT_REQUIRED")
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            from pykrx import stock
            result=collect(stock)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_bytes(canonical(result)+b"\n")
        print("BLUE_DATED_CLASSIFICATION_RESULT",json.dumps({"coverage":result["industry_coverage"],"theme_catalogs":[{"day":c["day"],"status":c["status"],"count":len(c["indices"])} for c in result["theme_catalogs"]],"writes":0},ensure_ascii=False))

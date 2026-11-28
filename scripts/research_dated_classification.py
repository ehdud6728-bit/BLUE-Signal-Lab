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
def probe_index_scope(stock,day,scope,wait=time.sleep):
    # Diagnose retrieval, list validity and name lookup separately. Never
    # print raw provider payloads, exceptions, URLs or account information.
    row={"day":day,"scope":scope,"stage":"LIST","status":"UNAVAILABLE","count":0,"sample":[]}
    wait(1.1)
    try:
        codes=stock.get_index_ticker_list(day.replace("-",""),market=scope)
    except Exception as exc:
        row["reason"]="LIST_CALL_FAILED"
        row["exception_type"]=type(exc).__name__
        return row
    if not isinstance(codes,list):
        row["reason"]="LIST_WRONG_TYPE";return row
    row["count"]=len(codes)
    if not codes:
        row["reason"]="LIST_EMPTY";return row
    if len(codes)>600:
        row["reason"]="LIST_TOO_LARGE";return row
    if any(not isinstance(code,str) or not re.fullmatch(r"[0-9]{4,6}",code) for code in codes):
        row["reason"]="LIST_CODE_FORMAT";return row
    if len(set(codes))!=len(codes):
        row["reason"]="LIST_DUPLICATE";return row
    row.update(stage="NAME",status="CATALOG_LIST_RECEIVED",index_codes=sorted(codes),list_sha256=hashlib.sha256(canonical(sorted(codes))).hexdigest())
    # Only a bounded sample: KRX family contains broad and thematic indices.
    # No sample name or catalog is a stock membership assertion.
    for code in sorted(codes)[:5]:
        wait(1.1)
        item={"index_code":code,"name":None}
        try:
            label=stock.get_index_ticker_name(code)
            if clean(label): item.update(name=label.strip(),status="RECEIVED")
            else:item.update(status="INVALID_NAME")
        except Exception as exc:
            item.update(status="NAME_CALL_FAILED",exception_type=type(exc).__name__)
        row["sample"].append(item)
    row["reason"]=None
    row["sample_names_received"]=sum(x["status"]=="RECEIVED" for x in row["sample"])
    return row

def theme_probe(stock,wait=time.sleep):
    # Endpoint controls and requested-date probe, not a substitute for a
    # historical constituent list. Stop after this small diagnostic sample.
    rows=[probe_index_scope(stock,day,scope,wait) for day in (DAYS[0],DAYS[-1]) for scope in ("테마","KRX","KOSPI","KOSDAQ")]
    return {"schema":"BLUE_DATED_THEME_PROBE_V1","source":"KRX_VIA_PYKRX_1_2_9","checks":rows,"writes":0,
        "limitations":["Only first and last discovery dates and up to five name lookups per scope/date.","Requested date is not an independent historical membership proof.","KRX family includes broad and other indices; never classify all as themes.","No constituent membership, no investment results, no DB write."]}

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
    p=theme_probe(Fake(),lambda _:None)
    assert len(p["checks"])==8 and all(x["sample_names_received"]==1 for x in p["checks"])
    class Empty(Fake):
        def get_index_ticker_list(self,date,market): return []
    assert probe_index_scope(Empty(),DAYS[0],"테마",lambda _:None)["reason"]=="LIST_EMPTY"
    class Dup(Fake):
        def get_index_ticker_list(self,date,market): return ["1234","1234"]
    assert probe_index_scope(Dup(),DAYS[0],"테마",lambda _:None)["reason"]=="LIST_DUPLICATE"
    class BadCode(Fake):
        def get_index_ticker_list(self,date,market): return ["bad"]
    assert probe_index_scope(BadCode(),DAYS[0],"테마",lambda _:None)["reason"]=="LIST_CODE_FORMAT"
    class BadName(Fake):
        def get_index_ticker_name(self,code): raise RuntimeError("PRIVATE_PROVIDER_DETAIL")
    probe=probe_index_scope(BadName(),DAYS[0],"테마",lambda _:None)
    assert probe["status"]=="CATALOG_LIST_RECEIVED" and probe["sample"][0]["status"]=="NAME_CALL_FAILED" and "PRIVATE_PROVIDER_DETAIL" not in json.dumps(probe)
    class CallFail(Fake):
        def get_index_ticker_list(self,date,market): raise RuntimeError("PRIVATE_PROVIDER_DETAIL")
    probe=probe_index_scope(CallFail(),DAYS[0],"테마",lambda _:None)
    assert probe["reason"]=="LIST_CALL_FAILED" and "PRIVATE_PROVIDER_DETAIL" not in json.dumps(probe)
    print("BLUE_DATED_CLASSIFICATION_TESTS 12")
if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--test",action="store_true")
    p.add_argument("--theme-probe",action="store_true")
    p.add_argument("--output",type=Path)
    args=p.parse_args()
    if args.test:self_test()
    else:
        need(args.output is not None,"OUTPUT_REQUIRED")
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            from pykrx import stock
            result=theme_probe(stock) if args.theme_probe else collect(stock)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_bytes(canonical(result)+b"\n")
        if args.theme_probe:
            print("BLUE_DATED_THEME_PROBE_RESULT",json.dumps({"checks":[{k:v for k,v in row.items() if k not in ("index_codes","sample")} for row in result["checks"]],"writes":0},ensure_ascii=False))
        else: print("BLUE_DATED_CLASSIFICATION_RESULT",json.dumps({"coverage":result["industry_coverage"],"theme_catalogs":[{"day":c["day"],"status":c["status"],"count":len(c["indices"])} for c in result["theme_catalogs"]],"writes":0},ensure_ascii=False))

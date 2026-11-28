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
import math
from datetime import date, timedelta
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
def valid_index_code(code,scope):
    # Theme identifier can contain a provider group prefix. Keep it opaque;
    # never coerce to int, pad, strip or infer a replacement.
    return isinstance(code,str) and bool(re.fullmatch(r"[0-9A-Za-z]{4,12}" if scope=="테마" else r"[0-9]{4,6}",code))

def theme_catalog(stock,day):
    codes=stock.get_index_ticker_list(day.replace("-",""),market="테마")
    need(isinstance(codes,list) and 0<len(codes)<=600 and len(codes)==len(set(codes)),"THEME_CATALOG_INVALID")
    rows=[]
    for code in codes:
        need(valid_index_code(code,"테마"),"THEME_CODE_INVALID")
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
    if any(not valid_index_code(code,scope) for code in codes):
        row["reason"]="LIST_CODE_FORMAT"
        row["invalid_shapes"]=[{"type":type(code).__name__,"length":len(code) if isinstance(code,str) else None,"ascii_alnum":code.isascii() and code.isalnum() if isinstance(code,str) else False} for code in codes if not valid_index_code(code,scope)][:10]
        return row
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

def collect_theme_members(stock,wait=time.sleep,days=DAYS):
    # Dates are explicit; never substitute the latest constituents or a
    # previous trading day. The endpoint returns codes, not effective dates.
    # Keep historical identity and independent verification unresolved.
    groups=[];coverage=[];names={}
    for day in days:
        wait(1.1)
        try:
            codes=stock.get_index_ticker_list(day.replace("-",""),market="테마")
            need(isinstance(codes,list) and 0<len(codes)<=100 and all(valid_index_code(c,"테마") for c in codes) and len(set(codes))==len(codes),"THEME_LIST_INVALID")
        except Exception as exc:
            coverage.append({"day":day,"status":"CATALOG_UNAVAILABLE","exception_type":type(exc).__name__,"catalog_count":0,"members_received":0})
            continue
        n=0
        for code in sorted(codes):
            row={"day":day,"index_code":code,"name":None,"status":"UNAVAILABLE","members":[]}
            if code not in names:
                wait(1.1)
                try:
                    label=stock.get_index_ticker_name(code)
                    if clean(label):names[code]=label.strip()
                except Exception:
                    pass
            if code not in names:
                row["reason"]="NAME_UNAVAILABLE";groups.append(row);continue
            row["name"]=names[code]
            wait(1.1)
            try:
                members=stock.get_index_portfolio_deposit_file(code,day.replace("-",""),alternative=False)
                need(isinstance(members,list) and 0<len(members)<=3000 and all(isinstance(c,str) and CODE.fullmatch(c) for c in members) and len(set(members))==len(members),"THEME_MEMBERS_INVALID")
                members=sorted(members)
                row.update(status="REQUESTED_DATE_MEMBERS_UNVERIFIED",members=members,member_count=len(members),sha256=hashlib.sha256(canonical(members)).hexdigest())
                n+=1
            except Exception as exc:
                row.update(reason="MEMBERS_UNAVAILABLE_OR_INVALID",exception_type=type(exc).__name__)
            groups.append(row)
        coverage.append({"day":day,"status":"REQUESTED_DATE_SOURCE_ONLY" if n==len(codes) else "PARTIAL_OR_UNAVAILABLE","catalog_count":len(codes),"members_received":n,"catalog_sha256":hashlib.sha256(canonical(sorted(codes))).hexdigest()})
    return {"schema":"BLUE_DATED_THEME_MEMBERS_V1","source":"KRX_VIA_PYKRX_1_2_9","requested_days":list(days),"coverage":coverage,"groups":groups,"writes":0,
        "limitations":["Provider catalog/name metadata may be current; dated member request without fallback does not independently prove historical membership.","All constituent lists must be joined to dated KRX universe and checked for date/identity before use. Unknown groups are not nonmembership.","KRX theme index family is not an exhaustive commercial theme taxonomy. No DB writes or performance ranking."]}

PRIOR_DAYS=("2026-11-09","2026-11-10","2026-11-11","2026-11-12","2026-11-13")
def expected_index_days():
    # Exact weekdays within the already audited 2026-10-12..11-26 interval.
    start=date(2026,10,12);end=date(2026,11,26)
    return [(start+timedelta(days=i)).isoformat() for i in range((end-start).days+1) if (start+timedelta(days=i)).weekday()<5]

def context_source(stock,wait=time.sleep):
    rows=[];coverage=[];indices=[]
    for day in PRIOR_DAYS:
        for market in MARKETS:
            wait(1.1)
            try:
                a=normalize(stock.get_market_sector_classifications(day.replace("-",""),market),day,market)
                rows.extend(a)
                coverage.append({"day":day,"market":market,"status":"RECEIVED_NOT_PRICE_VERIFIED","rows":len(a),"classified":sum(r["industry"] is not None for r in a),"sha256":hashlib.sha256(canonical(a)).hexdigest()})
            except Exception as exc:
                coverage.append({"day":day,"market":market,"status":"UNAVAILABLE","rows":0,"exception_type":type(exc).__name__})
    dates=expected_index_days()
    for market,code,labels in (("KOSPI","1001",("코스피","코스피지수","KOSPI")),("KOSDAQ","2001",("코스닥","코스닥지수","KOSDAQ"))):
        item={"market":market,"index_code":code,"status":"UNAVAILABLE","series":[]}
        try:
            wait(1.1)
            name=stock.get_index_ticker_name(code)
            need(isinstance(name,str) and name.replace(" ","").upper() in labels,"INDEX_IDENTITY")
            wait(1.1)
            df=stock.get_index_ohlcv(dates[0].replace("-",""),dates[-1].replace("-",""),code)
            need("종가" in df.columns,"INDEX_COLUMNS")
            series=[]
            for ix,val in df["종가"].items():
                d=ix.strftime("%Y-%m-%d");p=float(val)
                need(math.isfinite(p) and p>0,"INDEX_PRICE")
                series.append({"day":d,"close":p})
            need([x["day"] for x in series]==dates,"INDEX_CALENDAR_MISMATCH")
            item.update(name=name,status="RECEIVED_NOT_INDEPENDENTLY_VERIFIED",series=series,sha256=hashlib.sha256(canonical(series)).hexdigest())
        except Exception as exc:
            item.update(reason=str(exc) if type(exc) is ValueError and str(exc) in ("INDEX_IDENTITY","INDEX_COLUMNS","INDEX_PRICE","INDEX_CALENDAR_MISMATCH") else "INDEX_UNAVAILABLE",exception_type=type(exc).__name__)
        indices.append(item)
    return {"schema":"BLUE_MARKET_CONTEXT_SOURCE_V1","source":"KRX_VIA_PYKRX_1_2_9","requested_prior_days":list(PRIOR_DAYS),"expected_index_days":dates,"industry_coverage":coverage,"industry_rows":rows,"indices":indices,"writes":0,
        "limitations":["Prior five dates only, not a replacement for previously frozen nine dates.","Official index close series requested with exact calendar and identity, independent price verification still needed.","Equal-weight breadth is distinct from official index trend; no future outcomes or recommendations."]}

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
    class Alpha(Fake):
        def get_index_ticker_list(self,date,market): return ["A123","0012"] if market=="테마" else ["1234"]
        def get_index_portfolio_deposit_file(self,code,date,alternative=True):
            assert alternative is False and date=="20261116" and code in ("A123","0012")
            return ["000002","000001"]
    assert valid_index_code("A123","테마") and not valid_index_code("A123","KRX") and not valid_index_code("../A123","테마")
    assert [x["index_code"] for x in theme_catalog(Alpha(),DAYS[0])]==["0012","A123"]
    assert probe_index_scope(Alpha(),DAYS[0],"테마",lambda _:None)["count"]==2
    m=collect_theme_members(Alpha(),lambda _:None,days=[DAYS[0]])
    assert m["coverage"][0]["members_received"]==2 and all(x["members"]==["000001","000002"] and x["status"]=="REQUESTED_DATE_MEMBERS_UNVERIFIED" for x in m["groups"])
    class BadMembers(Alpha):
        def get_index_portfolio_deposit_file(self,code,date,alternative=True): return ["000001","000001"]
    m=collect_theme_members(BadMembers(),lambda _:None,days=[DAYS[0]])
    assert m["coverage"][0]["members_received"]==0 and all(x["members"]==[] for x in m["groups"])
    class MissingNames(Alpha):
        def get_index_ticker_name(self,code): return None
        def get_index_portfolio_deposit_file(self,*args,**kwargs): raise AssertionError("must not call")
    m=collect_theme_members(MissingNames(),lambda _:None,days=[DAYS[0]])
    assert all(x["reason"]=="NAME_UNAVAILABLE" for x in m["groups"])
    class Context(Fake):
        def get_index_ticker_name(self,code):return {"1001":"코스피","2001":"코스닥"}[code]
        def get_index_ohlcv(self,start,end,code):
            assert start=="20261012" and end=="20261126"
            return pd.DataFrame({"종가":[100.0]*len(expected_index_days())},index=pd.to_datetime(expected_index_days()))
    ctx=context_source(Context(),lambda _:None)
    assert len(ctx["industry_coverage"])==10 and len(ctx["industry_rows"])==4000
    assert len(expected_index_days())==34 and all(len(x["series"])==34 for x in ctx["indices"])
    class BadCalendar(Context):
        def get_index_ohlcv(self,*args):return super().get_index_ohlcv(*args).iloc[:-1]
    assert all(x["reason"]=="INDEX_CALENDAR_MISMATCH" for x in context_source(BadCalendar(),lambda _:None)["indices"])
    class BadIdentity(Context):
        def get_index_ticker_name(self,code):return "다른 지수"
    assert all(x["reason"]=="INDEX_IDENTITY" for x in context_source(BadIdentity(),lambda _:None)["indices"])
    print("BLUE_DATED_CLASSIFICATION_TESTS 22")
if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--test",action="store_true")
    p.add_argument("--theme-probe",action="store_true")
    p.add_argument("--theme-members",action="store_true")
    p.add_argument("--context-source",action="store_true")
    p.add_argument("--output",type=Path)
    args=p.parse_args()
    if args.test:self_test()
    else:
        need(args.output is not None,"OUTPUT_REQUIRED")
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            from pykrx import stock
            result=context_source(stock) if args.context_source else collect_theme_members(stock) if args.theme_members else theme_probe(stock) if args.theme_probe else collect(stock)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_bytes(canonical(result)+b"\n")
        if args.context_source:
            print("BLUE_MARKET_CONTEXT_SOURCE_RESULT",json.dumps({"coverage":result["industry_coverage"],"indices":[{k:v for k,v in x.items() if k!="series"} | {"count":len(x["series"])} for x in result["indices"]],"writes":0},ensure_ascii=False))
        elif args.theme_members:
            print("BLUE_DATED_THEME_MEMBERS_RESULT",json.dumps({"coverage":result["coverage"],"writes":0},ensure_ascii=False))
        elif args.theme_probe:
            print("BLUE_DATED_THEME_PROBE_RESULT",json.dumps({"checks":[{k:v for k,v in row.items() if k not in ("index_codes","sample")} for row in result["checks"]],"writes":0},ensure_ascii=False))
        else: print("BLUE_DATED_CLASSIFICATION_RESULT",json.dumps({"coverage":result["industry_coverage"],"theme_catalogs":[{"day":c["day"],"status":c["status"],"count":len(c["indices"])} for c in result["theme_catalogs"]],"writes":0},ensure_ascii=False))

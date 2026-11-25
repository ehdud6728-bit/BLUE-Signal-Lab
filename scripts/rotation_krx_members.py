"""Exact-name KRX index membership, including cross-market and theme families.
Cross-family results additionally require dated index-performance agreement.
No fuzzy matching, no holiday fallback, no credentials or raw provider bodies.
"""
import contextlib
import io
import json
import math
import re
import sys
import time
import unicodedata

def norm(x):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", x)).upper()

def series(stock, ticker, dates, wait):
    wait(1)
    df=stock.get_index_ohlcv(dates[0].replace("-",""),dates[-1].replace("-",""),ticker)
    values={}
    for index,value in df["종가"].items():
        key=index.strftime("%Y-%m-%d")
        v=float(value)
        if key in values or not math.isfinite(v) or v<=0:
            raise ValueError("BAD_INDEX_HISTORY")
        values[key]=v
    if sorted(values)!=dates:
        raise ValueError("INDEX_DATE_MISMATCH")
    return [values[d] for d in dates]

def verify_relative(group,ticker,stock,wait,cache):
    dates=group.get("benchmark_days")
    expected=group.get("trend")
    benchmark=group.get("benchmark")
    if not isinstance(dates,list) or len(dates)!=26 or dates!=sorted(set(dates)) or not all(isinstance(d,str) and re.fullmatch(r"20\d{2}-\d{2}-\d{2}",d) for d in dates) or not isinstance(expected,dict) or not isinstance(benchmark,dict):
        return "INDEX_HISTORY_PROOF_REQUIRED"
    if dates[-1]!=expected.get("day") or dates[-1]!=benchmark.get("day"):
        return "INDEX_HISTORY_PROOF_REQUIRED"
    try:
        market=group["market"]
        base_id={"KOSPI":"1001","KOSDAQ":"2001"}[market]
        label=norm(stock.get_index_ticker_name(base_id))
        if label not in ({"코스피","코스피지수","KOSPI"} if market=="KOSPI" else {"코스닥","코스닥지수","KOSDAQ"}):
            return "INDEX_BENCHMARK_IDENTITY_MISMATCH"
        def load(code):
            key=(code,tuple(dates))
            if key not in cache: cache[key]=series(stock,code,dates,wait)
            return cache[key]
        base=load(base_id)
        if abs(base[-1]-float(benchmark["close"]))>0.05 or abs(100*(base[-1]/base[-6]-1)-float(benchmark["change5_pct"]))>0.05:
            return "INDEX_BENCHMARK_IDENTITY_MISMATCH"
        ratio=[a/b for a,b in zip(load(ticker),base)]
        rel=lambda n,i:100*(ratio[i]/ratio[i-n]-1)
        observed={"rs5":rel(5,25),"rs10":rel(10,25),"rs20":rel(20,25),"momentum":rel(10,25)-rel(10,20)}
        if not all(math.isfinite(float(expected[k])) and abs(v-float(expected[k]))<=0.05 for k,v in observed.items()):
            return "INDEX_HISTORY_MISMATCH"
        return None
    except Exception:
        return "INDEX_HISTORY_UNAVAILABLE"

def resolve(request, stock, wait=time.sleep):
    day=request["day"]
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}",day):
        raise ValueError("BAD_DAY")
    groups=request["groups"]
    if not isinstance(groups,list) or len(groups)>24:
        raise ValueError("BAD_GROUPS")
    catalog={}
    prices={}
    output=[]
    def load_catalog(scope):
        if scope in catalog: return catalog[scope]
        try:
            wait(1)
            tickers=stock.get_index_ticker_list(day.replace("-",""),market=scope)
            if not isinstance(tickers,list) or len(tickers)>600 or not tickers:
                raise ValueError("BAD_CATALOG")
            names={}
            for ticker in tickers:
                if not isinstance(ticker,str) or not re.fullmatch(r"\d{4,6}",ticker):
                    raise ValueError("BAD_TICKER")
                label=stock.get_index_ticker_name(ticker)
                if not isinstance(label,str) or not label.strip():
                    raise ValueError("BAD_NAME")
                names.setdefault(norm(label),set()).add(ticker)
            catalog[scope]=names
        except Exception:
            catalog[scope]=None
        return catalog[scope]
    for group in groups:
        market,code,name=group["market"],group["code"],group["name"]
        if market not in ("KOSPI","KOSDAQ") or not re.fullmatch(r"\d{4,5}",code) or not isinstance(name,str) or not name.strip() or len(name)>70:
            raise ValueError("BAD_GROUP")
        item={"market":market,"code":code,"status":"MISSING","reason":"NO_EXACT_INDEX_NAME","members":[]}
        names=load_catalog(market)
        if names is None:
            item["reason"]="KRX_CATALOG_UNAVAILABLE"
            output.append(item);continue
        prefix="코스피" if market=="KOSPI" else "코스닥"
        key=norm(name)
        keys={key,norm(prefix+name),norm(market+name)}
        local_ids=set().union(*(names.get(k,set()) for k in keys))
        chosen=None
        if len(local_ids)==1:
            chosen=(market,next(iter(local_ids)))
        elif len(local_ids)>1:
            item["reason"]="AMBIGUOUS_INDEX_NAME"
        else:
            # Across families only the exact full label is accepted, never a
            # prefix-stripped label, fuzzy spelling or the KIS numeric code.
            cross={}
            for scope in ("KRX","테마"):
                extra=load_catalog(scope)
                if extra is not None:
                    for ticker in extra.get(key,set()):
                        cross.setdefault(ticker,[]).append(scope)
            if len(cross)>1:
                item["reason"]="AMBIGUOUS_INDEX_NAME"
            elif len(cross)==1:
                ticker,scopes=next(iter(cross.items()))
                if len(scopes)!=1:
                    item["reason"]="AMBIGUOUS_INDEX_NAME"
                elif any(catalog.get(s) is None for s in ("KRX","테마")):
                    item["reason"]="KRX_CROSS_CATALOG_INCOMPLETE"
                else:
                    problem=verify_relative(group,ticker,stock,wait,prices)
                    if problem:item["reason"]=problem
                    else:chosen=(scopes[0],ticker)
            elif any(catalog.get(s) is None for s in ("KRX","테마")):
                item["reason"]="KRX_CROSS_CATALOG_INCOMPLETE"
        if chosen:
            scope,ticker=chosen
            try:
                wait(1)
                codes=stock.get_index_portfolio_deposit_file(ticker,day.replace("-",""),alternative=False)
                if not isinstance(codes,list) or not codes or len(codes)>3000 or any(not isinstance(x,str) or not re.fullmatch(r"[0-9A-Z]{6}",x) for x in codes) or len(set(codes))!=len(codes):
                    raise ValueError("BAD_CONSTITUENTS")
                item.update(status="AVAILABLE",reason=None,members=sorted(codes),krx_code=ticker,krx_scope=scope,identity_basis="LOCAL_EXACT_NAME" if scope==market else "CROSS_EXACT_NAME_AND_RELATIVE_HISTORY")
            except Exception:
                item["reason"]="KRX_CONSTITUENTS_UNAVAILABLE"
        output.append(item)
    return {"day":day,"groups":output,"catalog_counts":{scope:None if names is None else sum(len(ids) for ids in names.values()) for scope,names in catalog.items()}}

if __name__=="__main__":
    try:
        request=json.load(sys.stdin)
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            from pykrx import stock
            result=resolve(request,stock)
        print(json.dumps(result,ensure_ascii=False))
    except Exception:
        print(json.dumps({"error":"KRX_LOOKUP_UNAVAILABLE"}))

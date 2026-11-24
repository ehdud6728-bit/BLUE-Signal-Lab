"""Bounded KRX constituent lookup for unmatched KIS index names.
No fuzzy matching, no date fallback, no credentials or response bodies logged.
"""
import contextlib
import io
import json
import re
import sys
import time
import unicodedata

def norm(x):
    return re.sub(r"\s+", "", unicodedata.normalize("NFKC", x)).upper()

def resolve(request, stock, wait=time.sleep):
    day=request["day"]
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}",day):
        raise ValueError("BAD_DAY")
    groups=request["groups"]
    if not isinstance(groups,list) or len(groups)>24:
        raise ValueError("BAD_GROUPS")
    catalog={}
    output=[]
    for group in groups:
        market,code,name=group["market"],group["code"],group["name"]
        if market not in ("KOSPI","KOSDAQ") or not re.fullmatch(r"\d{4,5}",code) or not isinstance(name,str) or len(name)>70:
            raise ValueError("BAD_GROUP")
        item={"market":market,"code":code,"status":"MISSING","reason":"NO_EXACT_INDEX_NAME","members":[]}
        if market not in catalog:
            try:
                tickers=stock.get_index_ticker_list(day.replace("-",""),market=market)
                if not isinstance(tickers,list) or not tickers or len(tickers)>200:
                    raise ValueError("BAD_CATALOG")
                names={}
                for ticker in tickers:
                    if not isinstance(ticker,str) or not re.fullmatch(r"\d{4,6}",ticker):
                        continue
                    label=stock.get_index_ticker_name(ticker)
                    if isinstance(label,str) and label.strip():
                        names.setdefault(norm(label),set()).add(ticker)
                catalog[market]=names
            except Exception:
                catalog[market]=None
        names=catalog[market]
        if names is None:
            item["reason"]="KRX_CATALOG_UNAVAILABLE"
        else:
            # A market prefix is an explicit context; never remove it from
            # arbitrary index families, e.g. KOSPI200 and KOSPI150.
            prefix="코스피" if market=="KOSPI" else "코스닥"
            key=norm(name)
            keys={key,norm(prefix+name),norm(market+name)}
            ids=set().union(*(names.get(k,set()) for k in keys))
            if len(ids)==1:
                ticker=next(iter(ids))
                try:
                    wait(1)
                    codes=stock.get_index_portfolio_deposit_file(ticker,day.replace("-",""),alternative=False)
                    if not isinstance(codes,list) or not codes or len(codes)>3000 or any(not isinstance(x,str) or not re.fullmatch(r"[0-9A-Z]{6}",x) for x in codes) or len(set(codes))!=len(codes):
                        raise ValueError("BAD_CONSTITUENTS")
                    item.update(status="AVAILABLE",reason=None,members=sorted(codes),krx_code=ticker)
                except Exception:
                    item["reason"]="KRX_CONSTITUENTS_UNAVAILABLE"
            elif len(ids)>1:
                item["reason"]="AMBIGUOUS_INDEX_NAME"
        output.append(item)
    return {"day":day,"groups":output}

if __name__=="__main__":
    try:
        request=json.load(sys.stdin)
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            from pykrx import stock
            result=resolve(request,stock)
        print(json.dumps(result,ensure_ascii=False))
    except Exception:
        print(json.dumps({"error":"KRX_LOOKUP_UNAVAILABLE"}))

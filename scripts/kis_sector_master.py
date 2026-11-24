"""Read current KIS stock-master industry classification (not historical membership).
Official KIS parser uses CP949, trailing fixed-width fields and 9/12-char identifiers.
Use TLS verification, bounded zip reads and no extraction to the filesystem.
"""
import argparse
import io
import json
import re
import urllib.request
import zipfile
import hashlib
from datetime import datetime, timezone, timedelta
from pathlib import Path

SPECS = {
    "KOSPI": ("kospi", 227, [2,1,4,4,4,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,9,5,5,1,1,1,2,1,1,1,2,2,2,3,1,3,12,12,8,15,21,2,7,1,1,1,1,1,9,9,9,5,9,8,9,3,1,1,1], (33,34,35,36,53,19)),
    "KOSDAQ": ("kosdaq", 221, [2,1,4,4,4,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,9,5,5,1,1,1,2,1,1,1,2,2,2,3,1,3,12,12,8,15,21,2,7,1,1,1,1,9,9,9,5,9,8,9,3,1,1,1], (31,32,33,34,51,14)),
}

def parse_master(text, market):
    _, tail, widths, flags = SPECS[market]
    if sum(widths) != tail:
        raise ValueError("MASTER_LAYOUT_INVALID")
    rows, seen = [], set()
    for line in text.splitlines():
        if not line.strip():
            continue
        if len(line) <= tail + 21:
            raise ValueError("MASTER_ROW_SHORT")
        prefix, rest = line[:-tail], line[-tail:]
        code, name = prefix[:9].strip(), prefix[21:].strip()
        fields, pos = [], 0
        for w in widths:
            fields.append(rest[pos:pos+w].strip())
            pos += w
        if not re.fullmatch(r"[0-9A-Z]{6}", code):
            continue
        if code in seen:
            raise ValueError("MASTER_DUPLICATE_CODE")
        seen.add(code)
        # Include common domestic stocks only, excluding SPAC, halted,
        # liquidation, management and market-warning flags.
        if fields[0] != "ST" or not name or len(name)>100:
            continue
        halt, liquidation, managed, warning, preferred, spac = [fields[i] for i in flags]
        if (halt,liquidation,managed,warning,preferred,spac) != ("N","N","N","00","0","N"):
            continue
        sectors = sorted(set(str(int(x)).zfill(4) for x in fields[2:5] if re.fullmatch(r"\d{4}",x) and int(x)>0))
        if sectors:
            rows.append(dict(market=market,code=code,name=name,sectors=sectors))
    return rows

def download(market):
    name=SPECS[market][0]
    url=f"https://new.real.download.dws.co.kr/common/master/{name}_code.mst.zip"
    with urllib.request.urlopen(url,timeout=30) as r:
        data=r.read(8*1024*1024+1)
    if len(data)>8*1024*1024:
        raise ValueError("MASTER_ZIP_TOO_LARGE")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        candidates=[x for x in z.infolist() if x.filename==f"{name}_code.mst"]
        if len(candidates)!=1 or candidates[0].file_size>12*1024*1024:
            raise ValueError("MASTER_ZIP_LAYOUT")
        text=z.read(candidates[0]).decode("cp949",errors="strict")
    rows=parse_master(text,market)
    if len(rows)<100 or len(rows)>5000:
        raise ValueError("MASTER_COVERAGE_INVALID")
    return rows,hashlib.sha256(data).hexdigest()

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--output",type=Path,required=True)
    args=p.parse_args()
    rows,hashes=[],{}
    for market in SPECS:
        r,h=download(market);rows.extend(r);hashes[market]=h
    now=datetime.now(timezone.utc)
    payload=dict(schema="BLUE_KIS_STOCK_MASTER_V1",observed_at_utc=now.isoformat(),receipt_day=(now+timedelta(hours=9)).date().isoformat(),hashes=hashes,rows=rows)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(payload,ensure_ascii=False),encoding="utf-8")
    print("BLUE_MASTER_COUNTS",json.dumps({m:sum(x["market"]==m for x in rows) for m in SPECS}))

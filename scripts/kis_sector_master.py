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
    "KOSPI": ("kospi", 227, [2,1,4,4,4,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,9,5,5,1,1,1,2,1,1,1,2,2,2,3,1,3,12,12,8,15,21,2,7,1,1,1,1,1,9,9,9,5,9,8,9,3,1,1,1], (34,35,36,37,54,19)),
    "KOSDAQ": ("kosdaq", 221, [2,1,4,4,4,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,9,5,5,1,1,1,2,1,1,1,2,2,2,3,1,3,12,12,8,15,21,2,7,1,1,1,1,9,9,9,5,9,8,9,3,1,1,1], (29,30,31,32,49,14)),
}

# Only documented membership flags, not guessed numeric aliases.
def index_tags(fields, market):
    tags=[]
    if market=="KOSPI":
        size={"1":"KOSPI_LARGE","2":"KOSPI_MID","3":"KOSPI_SMALL"}.get(fields[1])
        if size: tags.append(size)
        sector={"1":"건설","2":"중공업","3":"철강소재","4":"에너지화학","5":"정보통신","6":"금융","7":"필수소비재","8":"자유소비재","9":"산업재","A":"건강관리","B":"커뮤니케이션서비스"}.get(fields[8])
        if sector: tags.extend(["KOSPI200","KOSPI200_"+sector])
        flags={5:"KOSPI_MANUFACTURING",9:"KOSPI100",10:"KOSPI50",14:"KRX100",15:"KRX자동차",16:"KRX반도체",17:"KRX바이오",18:"KRX은행",20:"KRX에너지화학",21:"KRX철강",23:"KRX미디어통신",24:"KRX건설",26:"KRX증권",27:"KRX선박",28:"KRX보험",29:"KRX운송"}
    else:
        size={"1":"KOSDAQ_LARGE","2":"KOSDAQ_MID","3":"KOSDAQ_SMALL"}.get(fields[1])
        if size: tags.append(size)
        flags={5:"KOSDAQ_VENTURE",9:"KRX100",10:"KRX자동차",11:"KRX반도체",12:"KRX바이오",13:"KRX은행",15:"KRX에너지화학",16:"KRX철강",18:"KRX미디어통신",19:"KRX건설",21:"KRX증권",22:"KRX선박",23:"KRX보험",24:"KRX운송",25:"KOSDAQ150"}
    tags.extend(name for i,name in flags.items() if fields[i]=="Y")
    return sorted(set(tags))

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
        tags=index_tags(fields,market)
        if sectors or tags:
            rows.append(dict(market=market,code=code,name=name,sectors=sectors,index_tags=tags))
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

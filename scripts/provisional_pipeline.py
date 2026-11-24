"""Read-only integration of exported KIS quotes and prepared prior history."""
import argparse,json
from pathlib import Path
import pandas as pd
from provisional_pattern_scan import scan_provisional

def run(history_path,quote_prefix,day,now,output):
    prefix=Path(quote_prefix)
    meta=json.loads(Path(str(prefix)+".meta.json").read_text())
    history_meta=json.loads(Path(str(history_path)+".meta.json").read_text())
    if meta["reference"]!=history_meta["reference"]:
        raise ValueError("REFERENCE_MISMATCH")
    quotes=json.loads(Path(str(prefix)+".quotes.json").read_text())
    if not quotes:
        raise ValueError("NO_VALID_KIS_QUOTES")
    history=pd.read_csv(history_path,dtype={"Code":str})
    result=scan_provisional(history,quotes,day,meta["reference"],now)
    result["history_metadata"]=history_meta
    result["quote_coverage"]=meta
    result["pattern_confirmed"]=False
    Path(output).write_text(json.dumps(result,ensure_ascii=False,default=str,allow_nan=False))
    return result

if __name__=="__main__":
    p=argparse.ArgumentParser()
    for k in ("history","quote-prefix","day","now","output"):p.add_argument("--"+k,required=True)
    a=p.parse_args()
    r=run(a.history,a.quote_prefix,a.day,a.now,a.output)
    print("PROVISIONAL_SCAN",r["day"],"observed",r["observed"],"eligible",r["eligible"],"matches",len(r["items"]))

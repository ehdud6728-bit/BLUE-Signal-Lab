"""Export audited radar and dated recommendation changes for web display."""
import argparse,json
from pathlib import Path

def export(windows, archive):
    latest=json.loads((archive/"latest.json").read_text())
    if windows["asof"]!=latest["asof"]:
        raise ValueError("radar and recommendation dates differ")
    history=[]
    for path in sorted(archive.glob("????-??-??.changes.json"),reverse=True)[:30]:
        d=json.loads(path.read_text())
        history.append(dict(asof=d["asof"],previous_asof=d["previous_asof"],changes=[{k:r[k] for k in ("group","pattern","horizon","status","rate_delta_pp")} for r in d["changes"]]))
    return "// Generated from audited research.\nexport const RADAR_DATA: unknown = "+json.dumps(windows,ensure_ascii=False,allow_nan=False)+";\nexport const RADAR_HISTORY: unknown = "+json.dumps(history,ensure_ascii=False,allow_nan=False)+";\n"

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--windows",type=Path,required=True)
    p.add_argument("--archive",type=Path,required=True)
    p.add_argument("--output",type=Path,required=True)
    a=p.parse_args()
    a.output.write_text(export(json.loads(a.windows.read_text()),a.archive),encoding="utf-8")

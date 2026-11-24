import argparse,json
from pathlib import Path
def export(data,snapshot):
    if data["asof"]!=snapshot["asof"]:
        raise ValueError("discovery snapshot date mismatch")
    return "// Generated exploratory research; not production recommendations.\nexport const DIRECTIONAL_DISCOVERY: unknown = "+json.dumps(data,ensure_ascii=False,allow_nan=False)+";\n"
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for name in ("input","snapshot","output"): p.add_argument("--"+name,type=Path,required=True)
    a=p.parse_args()
    a.output.write_text(export(json.loads(a.input.read_text()),json.loads(a.snapshot.read_text())),encoding="utf-8")

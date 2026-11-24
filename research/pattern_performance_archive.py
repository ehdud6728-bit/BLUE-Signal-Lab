"""Stage dated research snapshots without replacing a newer or same-day archive."""
import argparse
import json
from pathlib import Path
from datetime import date
from pattern_performance_web_export import compare, typescript

def stage(current, root):
    day = date.fromisoformat(current["asof"]).isoformat()
    if day != current["asof"]:
        raise ValueError("invalid asof")
    typescript(current)
    root.mkdir(parents=True, exist_ok=True)
    dated = root / (day + ".json")
    latest = root / "latest.json"
    previous = json.loads(latest.read_text()) if latest.exists() else None
    if previous and previous["asof"] >= day:
        return False
    if dated.exists():
        raise ValueError("archive already exists")
    changes = compare(previous, current) if previous else {"asof":day,"previous_asof":None,"changes":[]}
    def write(path, value):
        path.write_text(json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2)+"\n", encoding="utf-8")
    write(dated,current)
    write(root / (day + ".changes.json"),changes)
    write(latest,current)
    write(root / "changes.json",changes)
    return True

if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--input",type=Path,required=True)
    p.add_argument("--archive",type=Path,required=True)
    a=p.parse_args()
    print("NEW_SNAPSHOT" if stage(json.loads(a.input.read_text()),a.archive) else "UNCHANGED")

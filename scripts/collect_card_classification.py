"""Collect one explicitly dated card classification, no DB writes."""
import argparse, contextlib, io
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from research_dated_classification import collect, collect_theme_members, canonical

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--day",required=True)
    p.add_argument("--out",type=Path,required=True)
    args=p.parse_args()
    day=date.fromisoformat(args.day)
    today=datetime.now(timezone(timedelta(hours=9))).date()
    if day.isoformat()!=args.day or day>today or day.weekday()>=5:
        raise SystemExit("INVALID_CLASSIFICATION_DAY")
    with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
        from pykrx import stock
        industries=collect(stock,days=(args.day,))
        themes=collect_theme_members(stock,days=(args.day,))
    args.out.mkdir(parents=True,exist_ok=True)
    (args.out/"source.json").write_bytes(canonical(industries)+b"\n")
    (args.out/"theme-members.json").write_bytes(canonical(themes)+b"\n")
    print("BLUE_CARD_CLASSIFICATION_SOURCE",args.day,len(industries["industry_rows"]),len(themes["groups"]))
if __name__=="__main__":
    main()

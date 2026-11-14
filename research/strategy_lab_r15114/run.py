"""Run with: python -m research.strategy_lab_r15114.run --daily-csv daily.csv --asof YYYY-MM-DD --out /tmp/lab.json
or: python -m research.strategy_lab_r15114.run --minute-csv minute.csv --out /tmp/minutes.json
"""
from __future__ import annotations
import argparse,csv,json
from pathlib import Path
import pandas as pd
from .daily import run_daily_study
from .intraday import run_intraday_study


def main():
    p=argparse.ArgumentParser(description='BLUE strategy lab; CSV research, NO D1 writes, orders or provider requests')
    g=p.add_mutually_exclusive_group(required=True)
    g.add_argument('--daily-csv',type=Path);g.add_argument('--minute-csv',type=Path)
    p.add_argument('--asof',help='Mandatory for EOD study YYYY-MM-DD')
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args()
    if a.daily_csv:
        if not a.asof:p.error('--asof required for --daily-csv')
        # dtype preserves KRX 6-digit stock codes.
        data=pd.read_csv(a.daily_csv,dtype={'code':str,'Code':str})
        result=run_daily_study(data,a.asof)
    else:
        with a.minute_csv.open(encoding='utf-8-sig',newline='') as f:rows=list(csv.DictReader(f))
        result=run_intraday_study(rows)
    a.out.parent.mkdir(parents=True,exist_ok=True)
    a.out.write_text(json.dumps(result,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    print('BLUE_LAB_RESEARCH_ONLY',result['version'],'event_count',len(result['events']),'output',a.out)

if __name__=='__main__':main()

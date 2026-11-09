#!/usr/bin/env python3
"""R0.6: extend unchanged R0.5 scanner with names and experimental supply proxy.
This is NOT a reproduction of Stock-Hunter's audited Volume Profile algorithm.
"""
import argparse
import json
from pathlib import Path
import numpy as np
import pandas as pd
from market_scan import load_marcap,normalise,scan,export


def nearest_upper_supply(prices:pd.DataFrame, target:pd.Timestamp):
    """Research-only 120-previous-bar typical-price volume histogram, 1% price bins.
    Returns nearest meaningful overhead bin centre distance, or None.
    No actual transaction-level volume at price and NO validated resistance claim.
    """
    prior=prices.loc[prices.date.lt(target)].tail(120)
    if len(prior)<100:return None
    close=float(prices.loc[prices.date.eq(target),'close'].iloc[-1])
    if close<=0:return None
    typical=(prior.high+prior.low+prior.close)/3
    width=max(close*.01,.01)
    bin_number=np.floor(typical.astype(float)/width).astype('int64')
    hist=prior.groupby(bin_number)['volume'].sum()
    if hist.empty or hist.max()<=0:return None
    strong=hist.loc[hist.ge(hist.max()*.25)]
    overhead=[(int(k)+.5)*width for k in strong.index if (int(k)+.5)*width>close]
    if not overhead:return None
    return round((min(overhead)/close-1)*100,5)


def scan_r06(raw,asof):
    rows,audit=scan(raw,asof)
    clean=normalise(raw)
    target=pd.Timestamp(audit['asof'])
    # Name is descriptive metadata, not an input to signal calculation.
    name_column=next((k for k in raw.columns if k.lower()=='name'),None)
    names={}
    if name_column:
        src=raw.copy()
        if 'Code' in src.columns:
            src['normalized_code']=src['Code'].astype(str).str.replace(r'\.0$','',regex=True).str.zfill(6)
            if 'Date' in src.columns:
                src['source_day']=pd.to_datetime(src['Date'])
                src=src.loc[src.source_day.le(target)].sort_values('source_day')
            names=src.drop_duplicates('normalized_code',keep='last').set_index('normalized_code')[name_column].to_dict()
    by_code={code:group for code,group in clean.groupby('code',sort=False)}
    found_names=0;computed=0
    for row in rows:
        name=names.get(row['code']);row['name']=str(name).strip() if pd.notna(name) and str(name).strip() else ''
        if row['name']:found_names+=1
        val=nearest_upper_supply(by_code[row['code']],target)
        row['distance_to_nearest_supply_pct']=val if val is not None else ''
        row['profile_status']='DAILY_TYPICAL_PRICE_PROXY_V1' if val is not None else 'NO_OVERHEAD_CLUSTER_ESTIMATE'
        row['profile_method']='120 PRIOR trading bars; typical price weighted by daily volume; 1pct bins; >=25pct max bin'
        if val is not None:computed+=1
    audit['names_found']=found_names
    audit['supply_proxy_computed']=computed
    audit['supply_profile_warning']='Unadjusted daily typical-price histogram; NOT transaction volume-at-price or certified Stock-Hunter VP. Use for research only.'
    return rows,audit


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--date',default='latest');p.add_argument('--out',default='output')
    p.add_argument('--years',default='2025,2026');p.add_argument('--local-data-dir')
    args=p.parse_args()
    raw,hashes=load_marcap([int(y) for y in args.years.split(',')],args.local_data_dir)
    rows,audit=scan_r06(raw,args.date)
    export(rows,audit,args.out,hashes)
    print(json.dumps(audit,ensure_ascii=False,indent=2))
if __name__=='__main__':main()

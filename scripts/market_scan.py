#!/usr/bin/env python3
"""Research-only full KOSPI/KOSDAQ daily signal scanner.

Input: yearly FinanceData/marcap parquet snapshots from an external public repository.
No orders, no modification of Stock-Hunter; only EOD OHLCV and past bars.
Calculations are research proxies; original named studies need independent parity checks.
"""
import argparse
import hashlib
import json
from datetime import date, datetime, timezone
from pathlib import Path
import numpy as np
import pandas as pd

URL = 'https://raw.githubusercontent.com/FinanceData/marcap/master/data/marcap-{}.parquet'
PERIODS = (20, 30, 40)

def load_marcap(years, local_dir=None):
    frames, hashes = [], {}
    for year in years:
        if local_dir:
            source = Path(local_dir) / f'marcap-{year}.parquet'
            blob = source.read_bytes()
        else:
            import requests
            response = requests.get(URL.format(year), timeout=90)
            response.raise_for_status()
            blob = response.content
        hashes[str(year)] = hashlib.sha256(blob).hexdigest()
        from io import BytesIO
        frames.append(pd.read_parquet(BytesIO(blob)))
    return pd.concat(frames, ignore_index=True), hashes

def normalise(raw):
    d = raw.copy()
    if 'Date' not in d.columns and d.index.name == 'Date':
        d = d.reset_index()
    required = ['Date', 'Code', 'Open', 'High', 'Low', 'Close', 'Volume', 'Amount', 'Market']
    missing = [c for c in required if c not in d.columns]
    if missing: raise ValueError('Missing columns: ' + str(missing))
    d = d.rename(columns={x:x.lower() for x in required})
    d['date'] = pd.to_datetime(d['date'], errors='raise').dt.normalize()
    d['code'] = d['code'].astype(str).str.replace(r'\.0$', '', regex=True).str.zfill(6)
    d = d[d['market'].astype(str).str.upper().isin(['KOSPI','KOSDAQ'])].copy()
    for col in ('open','high','low','close','volume','amount'):
        d[col] = pd.to_numeric(d[col], errors='coerce')
    good = (d[['open','high','low','close']] > 0).all(axis=1) & d[['open','high','low','close','volume','amount']].notna().all(axis=1)
    good &= d['high'].ge(d[['open','close','low']].max(axis=1)) & d['low'].le(d[['open','close','high']].min(axis=1))
    d = d[good].copy()
    if d.duplicated(['code','date']).any(): raise ValueError('Duplicate code/date in source')
    return d.sort_values(['code','date']).reset_index(drop=True)

def wilder_rsi(close, period=14):
    change = close.diff()
    gain = change.clip(lower=0).ewm(alpha=1/period, adjust=False, min_periods=period).mean()
    loss = (-change.clip(upper=0)).ewm(alpha=1/period, adjust=False, min_periods=period).mean()
    rs = gain / loss.replace(0,np.nan)
    rsi = 100 - 100/(1+rs)
    return rsi.where(loss.ne(0),100).where(~((loss.eq(0)) & (gain.eq(0))),50)

def stochastic(d,n=14,k=3,slow=3):
    lo=d.low.rolling(n,min_periods=n).min();hi=d.high.rolling(n,min_periods=n).max()
    span=hi-lo
    fast=(100*(d.close-lo)/span).where(span.ne(0),50.0).clip(0,100).where(lo.notna())
    sk=fast.rolling(k,min_periods=k).mean()
    sd=sk.rolling(slow,min_periods=slow).mean()
    return sk,sd,(sk.shift().le(sd.shift()) & sk.gt(sd) & sd.shift().notna()).fillna(False)

def body_cross(d,line, requires_falling=False):
    body = d.close-d.open
    hit = (d.close.shift().le(line.shift()) & d.open.lt(line) & d.close.gt(line) &
           body.gt(0) & ((line-d.open)/body.replace(0,np.nan)).ge(.2) &
           ((d.close-line)/body.replace(0,np.nan)).ge(.2) & (100*body/d.open).ge(.5))
    if requires_falling: hit &= line.lt(line.shift())
    return hit.fillna(False)

def enrich(g):
    d=g.copy().reset_index(drop=True)
    for n in PERIODS:
        r=d.close.rolling(n,min_periods=n); m=r.mean(); s=r.std(ddof=0)
        for mult,shift,suffix in [(2.,26,''),(1.8,20,'_ALT')]:
            upper=(m+mult*s).shift(shift); lower=(m-mult*s).shift(shift)
            d[f'BB{n}_UPPER{suffix}']=upper
            d[f'BB{n}_LOWER{suffix}']=lower
            d[f'BB{n}_UPPER_SIGNAL{suffix}']=body_cross(d,upper,True)
            d[f'BB{n}_LOWER_SIGNAL{suffix}']=body_cross(d,lower,True)
        d[f'ma{n}']=m
    for n in (20,40):
        mid=d.close.rolling(n,min_periods=n).mean()
        d[f'ENV{n}_MID']=mid
        d[f'ENV{n}_SIGNAL']=body_cross(d,mid,False)
    for n in (60,112,224):d[f'ma{n}']=d.close.rolling(n,min_periods=n).mean()
    d['rsi']=wilder_rsi(d.close)
    d['rsi_signal']=d.rsi.rolling(9,min_periods=9).mean()
    d['rsi_gc']=(d.rsi.shift().le(d.rsi_signal.shift())&d.rsi.gt(d.rsi_signal)).fillna(False)
    for n,k,slow in [(14,3,3),(12,5,5),(20,12,12)]:
        sk,sd,gc=stochastic(d,n,k,slow)
        prefix=f'slow_{n}_{k}_{slow}'
        d[prefix+'_k'],d[prefix+'_d'],d[prefix+'_gc']=sk,sd,gc
    for n in (20,60,120,224):
        d[f'prior_high_{n}']=d.high.shift(1).rolling(n,min_periods=n).max()
        d[f'headroom_{n}']=100*(d[f'prior_high_{n}']/d.close-1)
    d['amount_ratio20']=d.amount/d.amount.shift(1).rolling(20,min_periods=20).mean()
    d['volume_ratio20']=d.volume/d.volume.shift(1).rolling(20,min_periods=20).mean()
    d['gap_abs_pct']=100*(d.open/d.close.shift()-1).abs()
    return d

def _num(x):
    try:
        if pd.notna(x) and np.isfinite(float(x)):return round(float(x),5)
    except (ValueError,TypeError):pass
    return None

def scan(raw, asof=None):
    prices=normalise(raw)
    if prices.empty:raise ValueError('No KOSPI/KOSDAQ valid prices')
    latest=prices.date.max().date()
    target=latest if asof in (None,'latest') else date.fromisoformat(asof)
    if target>latest:raise ValueError(f'Requested {target} newer than available {latest}')
    prices=prices[prices.date.dt.date.le(target)].copy()
    if not prices.date.dt.date.eq(target).any():raise ValueError(f'{target} not present in source; no silent fallback')
    # All available source symbols on as-of date; insufficient history is recorded, not silently treated as no signal.
    current=prices.loc[prices.date.dt.date.eq(target)]
    observed=int(len(current))
    matches=[]; insufficient=0; suspicious=0
    for code,group in prices.groupby('code',sort=False):
        if group.date.iloc[-1].date()!=target:continue
        d=enrich(group)
        row=d.iloc[-1]
        if len(d)<250 or not np.isfinite(row.get('ma224',np.nan)):
            insufficient+=1;continue
        if _num(row.gap_abs_pct) is not None and row.gap_abs_pct>=40:
            suspicious+=1;continue # split/gap review: not enough evidence for a valid signal
        flags=[]
        for n in PERIODS:
            if bool(row[f'BB{n}_UPPER_SIGNAL']):flags.append(f'BB{n}')
            if bool(row[f'BB{n}_LOWER_SIGNAL']):flags.append(f'BB{n}_LOWER')
            if bool(row[f'BB{n}_UPPER_SIGNAL_ALT']):flags.append(f'BB{n}_ALT')
            if bool(row[f'BB{n}_LOWER_SIGNAL_ALT']):flags.append(f'BB{n}_LOWER_ALT')
        for n in (20,40):
            if bool(row[f'ENV{n}_SIGNAL']):flags.append(f'ENV{n}')
        if not flags:continue
        fields={k:_num(row.get(k)) for k in ['rsi','rsi_signal','slow_14_3_3_k','slow_14_3_3_d','slow_12_5_5_k','slow_12_5_5_d','slow_20_12_12_k','slow_20_12_12_d','amount_ratio20','volume_ratio20','ma20','ma40','ma60','ma112','ma224','prior_high_20','prior_high_60','prior_high_120','prior_high_224','headroom_20','headroom_60','headroom_120','headroom_224']}
        fields.update({'rsi_gc':bool(row.rsi_gc), 'slow_14_3_3_gc':bool(row.slow_14_3_3_gc),'slow_12_5_5_gc':bool(row.slow_12_5_5_gc),'slow_20_12_12_gc':bool(row.slow_20_12_12_gc),'market':str(row.market),'source':'FinanceData/marcap', 'profile_status':'NOT_COMPUTED', 'parity_status':'UNVERIFIED'})
        matches.append(dict(code=code,date=str(target),signals=','.join(flags),close=_num(row.close),distance_to_nearest_supply_pct='',**fields))
    audit={'asof':str(target),'source_latest_date':str(latest),'observed_stocks':observed,'insufficient_history':insufficient,'suspicious_gap_excluded':suspicious,'eligible_stocks':observed-insufficient-suspicious,'matched_stocks':len(matches),'signal_events':sum(len(x['signals'].split(',')) for x in matches),'universe':'KOSPI+KOSDAQ','note':'Unadjusted prices and original 500-stock study parity not yet certified; this is discovery research only'}
    return matches,audit

def export(matches,audit,out_dir,hashes):
    import csv
    out=Path(out_dir);out.mkdir(parents=True,exist_ok=True)
    # Reuse existing CSV->D1 converter field names; store all research metadata in extras_json.
    fields=['code','date','signals','close','distance_to_nearest_supply_pct']
    fields.extend(sorted(set().union(*(set(r)-set(fields) for r in matches)))) if matches else None
    with (out/'signals.csv').open('w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=fields,extrasaction='ignore');w.writeheader();w.writerows(matches)
    with (out/'daily_counts.csv').open('w',encoding='utf-8',newline='') as f:
        w=csv.DictWriter(f,fieldnames=['date','observed_stocks','signal_events','matched_stocks']);w.writeheader();w.writerow(dict(date=audit['asof'],observed_stocks=audit['observed_stocks'],signal_events=audit['signal_events'],matched_stocks=audit['matched_stocks']))
    audit['source_sha256_by_year']=hashes
    (out/'AUDIT.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')

def main():
    p=argparse.ArgumentParser();p.add_argument('--date',default='latest');p.add_argument('--out',default='out/market_scan');p.add_argument('--local-data-dir');p.add_argument('--years',default='2025,2026');args=p.parse_args()
    raw,hashes=load_marcap([int(y) for y in args.years.split(',')],args.local_data_dir)
    matches,audit=scan(raw,args.date);export(matches,audit,args.out,hashes)
    print(json.dumps(audit,ensure_ascii=False,indent=2))
if __name__=='__main__': main()

#!/usr/bin/env python3
"""BLUE Signal Lab R0.8: on-demand historic KRX backfill for marcap gaps.

Requires the *user-approved* KRX Open API `stk_bydd_trd` and `ksq_bydd_trd`
services and GitHub Actions secret KRX_AUTH_KEY. Does not change Stock-Hunter.
Never substitutes an earlier date for the requested trading date.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta, datetime
import hashlib
import json
import os
import re
import sys

import pandas as pd
import requests

from market_scan import load_marcap, normalise, export
from market_scan_r08_diagnostics import scan_r08

KRX = 'https://data-dbg.krx.co.kr/svc/apis/sto/'
COLS = ['Date', 'Code', 'Name', 'Open', 'High', 'Low', 'Close', 'Volume', 'Amount', 'Market']
API = [('KOSPI', 'stk_bydd_trd'), ('KOSDAQ', 'ksq_bydd_trd')]


class SourcePending(Exception):
    """A date-specific source is missing or not yet available, not a signal=0 result."""


def _int(v):
    # KRX uses strings with thousands separators. '-'/blank means no trade.
    if v is None or str(v).strip() in ('', '-'):
        return None
    try:
        return float(str(v).replace(',', '').strip())
    except ValueError:
        return None


def krx_day(day: date, auth_key: str, session=requests) -> pd.DataFrame:
    if not auth_key:
        raise SourcePending('KRX_AUTH_KEY_MISSING: KRX Open API key and both services approval required')
    frames=[]
    for market, endpoint in API:
        try:
            resp = session.get(KRX+endpoint, params={'basDd': day.strftime('%Y%m%d')},
                               headers={'AUTH_KEY': auth_key}, timeout=30)
            resp.raise_for_status()
            data=resp.json()
        except (requests.RequestException, ValueError) as e:
            raise SourcePending(f'KRX_UNAVAILABLE: {market} {type(e).__name__}') from e
        if not isinstance(data, dict):
            raise SourcePending(f'KRX_BAD_RESPONSE: {market}')
        # Vendor errors must not be interpreted as a holiday with 0 records.
        if data.get('respCode') not in (None,'','0','00','000','0000',0):
            raise SourcePending(f'KRX_API_ERROR: {market} code={data.get("respCode")}')
        values=data.get('OutBlock_1')
        if values is None:
            # Some clients use alternate case; non-standard response = error.
            raise SourcePending(f'KRX_BAD_RESPONSE: {market} missing OutBlock_1')
        if not isinstance(values, list):
            raise SourcePending(f'KRX_BAD_RESPONSE: {market} invalid OutBlock_1')
        rows=[]
        for v in values:
            if not isinstance(v,dict): continue
            code=str(v.get('ISU_CD') or '').strip()
            if not re.fullmatch(r'\d{6}',code): continue
            asof=str(v.get('BAS_DD') or '').replace('-','')
            if asof and asof != day.strftime('%Y%m%d'): continue
            nums={dest: _int(v.get(origin)) for dest,origin in
                  [('Open','TDD_OPNPRC'),('High','TDD_HGPRC'),
                   ('Low','TDD_LWPRC'),('Close','TDD_CLSPRC'),
                   ('Volume','ACC_TRDVOL'),('Amount','ACC_TRDVAL')]}
            if any(x is None for x in nums.values()): continue
            if min(nums['Open'],nums['High'],nums['Low'],nums['Close']) <= 0: continue
            rows.append({'Date':pd.Timestamp(day),'Code':code,
                         'Name':str(v.get('ISU_NM') or '').strip(),
                         'Market':market,**nums})
        frames.append(pd.DataFrame(rows,columns=COLS))
    # Refuse a partial response (including one market empty) rather than
    # claiming an incomplete all-market scan is a valid result.
    if len(frames)!=2 or any(len(x)<400 for x in frames):
        raise SourcePending(f'KRX_DATE_NOT_AVAILABLE: {day.isoformat()} (KOSPI/KOSDAQ incomplete)')
    final=pd.concat(frames,ignore_index=True)
    if final.duplicated(['Date','Code']).any():
        raise SourcePending(f'KRX_DUPLICATES: {day.isoformat()}')
    return final


def backfill(raw: pd.DataFrame, target: date, key: str, session=requests,
             max_days: int=45) -> tuple[pd.DataFrame,list[str]]:
    source=normalise(raw)
    if source.empty:
        raise SourcePending('MARCAP_NO_VALID_RECORDS')
    latest=source['date'].max().date()
    # Historical as-of date is already present in marcap, no additional API.
    if target <= latest:
        at=source.loc[source.date.dt.date.eq(target)]
        if len(at)>=1700:
            return raw,[]
        # Missing or incomplete historical day: fetch the *exact* requested day.
        fetch_days=[target]
    else:
        gap=(target-latest).days
        if gap>max_days:
            raise SourcePending(f'BACKFILL_TOO_LARGE: {gap} calendar days; first refresh base marcap')
        fetch_days=[latest+timedelta(days=i) for i in range(1,gap+1)
                    if (latest+timedelta(days=i)).weekday()<5]
    additions=[];added=[]
    for d in fetch_days:
        try:
            f=krx_day(d,key,session=session)
        except SourcePending as e:
            # If an intermediate weekday was a holiday, no data is expected.
            # But do not swallow source/authentication/network problems.
            if d!=target and str(e).startswith('KRX_DATE_NOT_AVAILABLE:'):
                continue
            raise
        additions.append(f);added.append(d.isoformat())
    if not additions:
        return raw,[]
    result=raw.copy()
    if 'Date' not in result.columns and result.index.name=='Date':
        result=result.reset_index()
    add=pd.concat(additions,ignore_index=True)
    # If the baseline has any rows on a date with incomplete coverage, replace
    # that entire day's rows with the verified complete KRX daily snapshot.
    base_dates=pd.to_datetime(result['Date']).dt.date
    result=result.loc[~base_dates.isin([x.date() for x in add['Date']])]
    for col in result.columns:
        if col not in add.columns: add[col]=None
    result=pd.concat([result,add[result.columns]],ignore_index=True)
    return result,added


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--date',default='latest')
    p.add_argument('--years',default='2025,2026')
    p.add_argument('--out',default='output')
    p.add_argument('--local-data-dir')
    args=p.parse_args()
    raw,hashes=load_marcap([int(y) for y in args.years.split(',')],args.local_data_dir)
    latest=normalise(raw).date.max().date()
    target=latest if args.date=='latest' else date.fromisoformat(args.date)
    # Do not accidentally allow a future date or incomplete current-day data.
    kst_today=(datetime.utcnow()+timedelta(hours=9)).date()
    if target>=kst_today:
        raise SourcePending('SOURCE_PENDING: Requested current/future date needs a completed market session')
    upgraded, days=backfill(raw,target,os.getenv('KRX_AUTH_KEY',''))
    rows,audit=scan_r08(upgraded,target.isoformat())
    # Record source provenance accurately for every matched row.
    target_source=('KRX Open API daily (backfill)' if target.isoformat() in days
                   else 'FinanceData/marcap daily')
    for row in rows:
        row['source']=target_source
        row['data_frequency']='EOD_DAILY'
    audit['target_day_source']=target_source
    audit['supplemental_source']='KRX Open API (unadjusted daily prices)' if days else None
    audit['supplemental_dates']=days
    if days:
        supplement=upgraded[pd.to_datetime(upgraded['Date']).dt.date.isin(
            {date.fromisoformat(x) for x in days})].sort_values(['Date','Code'])
        audit['supplemental_rows']=len(supplement)
        audit['supplemental_sha256']=hashlib.sha256(
            supplement[COLS].to_csv(index=False).encode('utf-8')).hexdigest()
    audit['source_policy']='MARCAP_BASELINE_PLUS_KRX_BACKFILL; KRX statistical data, no lookahead'
    export(rows,audit,args.out,hashes)
    print(json.dumps(audit,ensure_ascii=False,indent=2))

if __name__=='__main__':
    try: main()
    except SourcePending as e:
        print('SOURCE_PENDING:',str(e),file=sys.stderr)
        sys.exit(20)

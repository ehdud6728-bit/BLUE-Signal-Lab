#!/usr/bin/env python3
"""Read-only, 36-symbol historical repair for the four immutable KRX v2 days.

KRX ticker history is attempted first; existing KIS token is a second source.
This tool never writes Turso/D1 or issues a KIS token. Imported bars are only
research inputs, never confirmed KRX target-day EOD observations.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import time

import pandas as pd

REPLAY_DAYS = ('2026-11-10', '2026-11-13', '2026-11-16', '2026-11-17')
EXACT_EOD_HASHES = {
    '2026-11-10':'95d71aa2bf812a475d6df5cfa38a47f51d9bd0531295ef2995630aefcc7343a4',
    '2026-11-13':'8cecfc0206fb980229c7304472351940730179bf906bad0590ee3fadf06200bd',
    '2026-11-16':'d4fa2ab696466fc2f34c6c1a3f25ad8cc56bfddf7104bd12f4209c8cc9fbb9e6',
    '2026-11-17':'a223d591c06bb87f9a5c2fb0d803d2dea035e31285a9fd0f658ae56bf5986c9f',
}
EXACT_MARCAP_HASHES = {
    '2025':'2bfd93c217eb74263bc5020b23fa6debb6b02531c11eaccc2826639bc191559e',
    '2026':'699c5d8e58f6c4e041c2e33018b6bc9e0c3882c79db1d07fc9b3a29df8dc5d2b',
}
# Pinned from BLUE_RESEARCH_V2_PREFLIGHT_44899355187. Distinct from a provider
# ticker list, this is the exact missing history set proven on all four days.
EXACT_MISSING_BARS = {
    **dict.fromkeys(('003380','009520','035760','035900','036830','036930',
       '046890','056190','058470','064760','067160','069080','078340',
       '086450','131970','137400','141080','195940','196170','200130',
       '214150','214450','222800','237690','240810','247540','253450',
       '272290','293490','403870'),1),
    **dict.fromkeys(('041510','086520','140860','222080','357780'),107),
    '122870':244,
}
START, END = '2025-08-01', '2026-11-09'  # Always before the earliest replay day
SOURCE_KRX = 'KRX_PYKRX_TICKER_HISTORY_UNADJUSTED'
SOURCE_KIS = 'KIS_REST_TICKER_HISTORY_UNADJUSTED'
SOURCE_SET = {SOURCE_KRX, SOURCE_KIS}
CODE = re.compile(r'[0-9A-Z]{6}\Z')
HASH = re.compile(r'[a-f0-9]{64}\Z')
FIELDS = ('open', 'high', 'low', 'close', 'volume', 'amount')
KIS_ENDPOINT = 'https://openapi.koreainvestment.com:9443/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice'


def plan_coverage(reports: list[dict]) -> dict:
    """Plan only the *same* missing histories, from four proven audit reports."""
    if len(reports) != len(REPLAY_DAYS):
        raise ValueError('TARGETED_HISTORY_WRONG_DAY_COUNT')
    baseline = None
    sha_years = None
    for day, report in zip(REPLAY_DAYS, reports):
        rows = report.get('missing_candidates')
        if (report.get('format') != 'BLUE_RESEARCH_V2_HISTORY_COVERAGE_V1' or
                report.get('day') != day or report.get('status') != 'BLOCKED_INSUFFICIENT_HISTORY' or
                report.get('candidate_count') != 50 or not isinstance(rows, list) or len(rows) != 50 or
                report.get('verified_source') != 'KRX_PYKRX_EXACT_DAY_VERIFIED' or
                report.get('eod_day_sha256') != EXACT_EOD_HASHES[day] or
                not isinstance(report.get('eod_count'), int) or report['eod_count'] < 1700):
            raise ValueError('TARGETED_HISTORY_COVERAGE_INVALID')
        current = {r['code']: r['history_bars'] for r in rows if
                   isinstance(r, dict) and CODE.fullmatch(str(r.get('code', ''))) and
                   type(r.get('history_bars')) is int and r['history_bars'] >= 1 and
                   r.get('meets_250_bar_threshold') is (r['history_bars'] >= 250)}
        if len(current) != 50 or baseline is not None and current != baseline:
            raise ValueError('TARGETED_HISTORY_UNIVERSE_CHANGED')
        baseline = current
        if sha_years is None:
            sha_years = report.get('source_sha256_by_year')
        if report.get('source_sha256_by_year') != sha_years:
            raise ValueError('TARGETED_HISTORY_MARCAP_CHANGED')
    if sha_years != EXACT_MARCAP_HASHES:
        raise ValueError('TARGETED_HISTORY_MARCAP_INVALID')
    needed = {code: bars for code, bars in sorted(baseline.items()) if bars < 250}
    if needed != EXACT_MISSING_BARS:
        raise ValueError('TARGETED_HISTORY_EXPECTED_36_NOT_MET')
    return {
        'format': 'BLUE_RESEARCH_V2_TARGETED_HISTORY_PLAN_V1',
        'days': list(REPLAY_DAYS), 'source_sha256_by_year': sha_years,
        'eod_day_sha256': {r['day']:r['eod_day_sha256'] for r in reports},
        'history_start': START, 'history_end': END,
        'target_codes': list(needed), 'baseline_bars': needed,
        'target_count': len(needed), 'writes': 0,
    }


def validate_row(row: dict, plan: dict) -> dict:
    code, stamp, source = row.get('code'), row.get('day'), row.get('source')
    if (code not in plan['target_codes'] or not isinstance(stamp, str) or
            not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', stamp) or
            not START <= stamp <= END or source not in SOURCE_SET):
        raise ValueError('TARGETED_HISTORY_ROW_IDENTITY_INVALID')
    try:
        if date.fromisoformat(stamp).isoformat() != stamp:
            raise ValueError('TARGETED_HISTORY_DATE_INVALID')
    except ValueError as exc:
        raise ValueError('TARGETED_HISTORY_DATE_INVALID') from exc
    values = {}
    for col in FIELDS:
        raw = row.get(col)
        if type(raw) is not int or raw <= 0 or raw >= 2**63:
            raise ValueError('TARGETED_HISTORY_PRICE_INVALID')
        values[col] = raw
    if values['low'] > min(values['open'], values['close']) or values['high'] < max(values['open'], values['close']):
        raise ValueError('TARGETED_HISTORY_OHLC_INVALID')
    return {'code': code, 'day': stamp, 'source': source, **values}


def _from_krx(code: str, stock=None) -> list[dict]:
    if stock is None:
        from pykrx import stock
    import contextlib
    import io
    with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
        frame = stock.get_market_ohlcv_by_date(START.replace('-',''), END.replace('-',''), code, adjusted=False)
    if frame is None or not isinstance(frame, pd.DataFrame):
        raise ValueError('KRX_HISTORY_UNAVAILABLE')
    columns = {'시가':'open','고가':'high','저가':'low','종가':'close','거래량':'volume','거래대금':'amount'}
    if not set(columns).issubset(frame.columns):
        raise ValueError('KRX_HISTORY_SCHEMA_INVALID')
    output = []
    for idx, rec in frame.iterrows():
        if int(rec['거래량']) <= 0:
            continue  # suspended/no-trade days are not 250 usable bars
        raw = {'code':code,'day':pd.Timestamp(idx).strftime('%Y-%m-%d'),'source':SOURCE_KRX,
               **{v:int(rec[k]) for k,v in columns.items()}}
        output.append(raw)
    return output


def _from_kis(code: str, token: str, key: str, secret: str, session=None, pause=None) -> list[dict]:
    if not token or not key or not secret:
        raise ValueError('KIS_HISTORY_CACHED_TOKEN_MISSING')
    if session is None:
        import requests
        session = requests
    if pause is None:
        pause = time.sleep
    # Query 11/10 too: a KIS-only ticker history needs one independent
    # same-day KRX EOD anchor before earlier KIS bars can be used in research.
    anchor_end = REPLAY_DAYS[0].replace('-','')
    end = anchor_end
    start = START.replace('-', '')
    output = []
    seen = set()
    for page in range(7):  # provider max 100 bars/call; bounded, never open-ended
        query = {'FID_COND_MRKT_DIV_CODE':'J','FID_INPUT_ISCD':code,
                 'FID_INPUT_DATE_1':start,'FID_INPUT_DATE_2':end,
                 'FID_PERIOD_DIV_CODE':'D','FID_ORG_ADJ_PRC':'1'}  # original prices
        res = session.get(KIS_ENDPOINT,params=query,headers={
            'authorization':'Bearer '+token,'appkey':key,'appsecret':secret,
            'tr_id':'FHKST03010100','custtype':'P'},timeout=25)
        if res.status_code == 429:
            raise ValueError('KIS_HISTORY_RATE_LIMIT')
        if res.status_code != 200:
            raise ValueError('KIS_HISTORY_HTTP_UNAVAILABLE')
        body = res.json()
        if body.get('msg_cd') == 'EGW00201':
            raise ValueError('KIS_HISTORY_RATE_LIMIT')
        if body.get('rt_cd') != '0' or not isinstance(body.get('output2'),list):
            raise ValueError('KIS_HISTORY_PROVIDER_REJECTED')
        rows = body['output2']
        if not rows:
            break
        last = None
        for item in rows:
            stamp = str(item.get('stck_bsop_date',''))
            if not re.fullmatch(r'20\d{6}',stamp) or stamp < start or stamp > end:
                raise ValueError('KIS_HISTORY_DATE_OUT_OF_RANGE')
            if last is not None and stamp >= last:
                raise ValueError('KIS_HISTORY_PAGE_NOT_DESCENDING')
            last = stamp
            if stamp in seen:
                raise ValueError('KIS_HISTORY_DUPLICATE_DAY')
            seen.add(stamp)
            if int(item.get('acml_vol') or 0) <= 0:
                continue
            output.append({'code':code,'day':date.fromisoformat(stamp).isoformat(),
                           'source':SOURCE_KIS,
                           **{dst:int(item[src]) for src,dst in (
                               ('stck_oprc','open'),('stck_hgpr','high'),
                               ('stck_lwpr','low'),('stck_clpr','close'),
                               ('acml_vol','volume'),('acml_tr_pbmn','amount'))}})
        if len(rows)<100 or last <= start:
            break
        end=(date.fromisoformat(last)-timedelta(days=1)).strftime('%Y%m%d')
        pause(1.75)
    return output


def collect(plan: dict, krx=None, kis=None, pause=None,
            anchor_quotes: dict[str,dict]|None=None) -> tuple[bytes,dict]:
    """Per-code KRX first, KIS for no/insufficient KRX only. No DB access."""
    if pause is None:
        pause=time.sleep
    records=[]
    statuses={}
    for idx,code in enumerate(plan['target_codes']):
        if idx:
            pause(1.75)
        try:
            krx_rows=(krx or _from_krx)(code)
            accepted=[validate_row(row,plan) for row in krx_rows]
            if len({r['day'] for r in accepted}) != len(accepted):
                raise ValueError('KRX_HISTORY_DUPLICATE_DAY')
            status='KRX_VALID'
        except Exception:
            accepted=[]
            status='KRX_UNAVAILABLE'
        if len(accepted)<249:
            try:
                fetched=(kis or _from_kis)(
                    code,os.environ.get('BLUE_RESEARCH_KIS_TOKEN',''),
                    os.environ.get('KIS_APP_KEY',''),os.environ.get('KIS_APP_SECRET',''))
                anchor=[r for r in fetched if r['day']==REPLAY_DAYS[0]]
                expected=(anchor_quotes or {}).get(code)
                if len(anchor)!=1 or not expected or any(
                        type(anchor[0].get(col)) is not int or anchor[0][col]!=expected[col]
                        for col in FIELDS):
                    raise ValueError('KIS_HISTORY_KRX_EOD_ANCHOR_MISMATCH')
                candidate=[validate_row(r,plan) for r in fetched if r['day']<=END]
                if len({r['day'] for r in candidate})!=len(candidate):
                    raise ValueError('KIS_HISTORY_DUPLICATE_DAY')
                if len(candidate)>len(accepted):
                    accepted=candidate
                    status='KIS_SECONDARY'
            except Exception as exc:
                if str(exc)=='KIS_HISTORY_RATE_LIMIT':
                    raise  # stop the entire job, don't hammer rate limits
                status += '_KIS_UNAVAILABLE'
        statuses[code]={'source':(accepted[0]['source'] if accepted else 'NONE'),
                        'bars':len(accepted),'status':status,
                        'history_before_first_replay_ready':len(accepted)>=249}
        records.extend(accepted)
        print('BLUE_V2_HISTORY_SYMBOL',code, 'bars='+str(len(accepted)),status,flush=True)
    records.sort(key=lambda r:(r['code'],r['day']))
    blob=b''.join((json.dumps(r,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode('utf8') for r in records)
    manifest={'format':'BLUE_RESEARCH_V2_TARGETED_HISTORY_V1',
              'plan':plan,'source_sha256':hashlib.sha256(blob).hexdigest(),
              'row_count':len(records),'by_code':statuses,'writes':0,
              'all_codes_249_prior_bars':all(s['history_before_first_replay_ready'] for s in statuses.values())}
    return blob,manifest


def load_and_merge(raw: pd.DataFrame, root: str|Path, target: date) -> tuple[pd.DataFrame,str]:
    """Strictly validate byte-hashed research history; never replace MARCAP dates."""
    path=Path(root)
    manifest=json.loads((path/'manifest.json').read_text(encoding='utf8'))
    payload=(path/'history.jsonl').read_bytes()
    plan=manifest.get('plan')
    if (manifest.get('format')!='BLUE_RESEARCH_V2_TARGETED_HISTORY_V1' or
            not isinstance(plan,dict) or plan.get('format')!='BLUE_RESEARCH_V2_TARGETED_HISTORY_PLAN_V1' or
            plan.get('days') != list(REPLAY_DAYS) or
            plan.get('history_start')!=START or plan.get('history_end')!=END or
            plan.get('baseline_bars') != EXACT_MISSING_BARS or
            plan.get('target_codes') != sorted(EXACT_MISSING_BARS) or
            plan.get('source_sha256_by_year') != EXACT_MARCAP_HASHES or
            plan.get('eod_day_sha256') != EXACT_EOD_HASHES or
            not HASH.fullmatch(str(manifest.get('source_sha256',''))) or
            hashlib.sha256(payload).hexdigest()!=manifest['source_sha256'] or
            manifest.get('writes')!=0 or manifest.get('row_count',-1)<0 or
            len(payload)>5_000_000):
        raise ValueError('TARGETED_HISTORY_MANIFEST_INVALID')
    lines=payload.splitlines()
    if len(lines)!=manifest['row_count']:
        raise ValueError('TARGETED_HISTORY_ROW_COUNT_INVALID')
    seen=set()
    records=[]
    for line in lines:
        row=validate_row(json.loads(line),plan)
        key=(row['code'],row['day'])
        if key in seen:
            raise ValueError('TARGETED_HISTORY_DUPLICATE_DAY')
        seen.add(key)
        if row['day']>=target.isoformat():
            raise ValueError('TARGETED_HISTORY_FUTURE_LEAK')
        records.append({'Date':pd.Timestamp(row['day']),'Code':row['code'],
                        'Name':'','Market':'KOSDAQ',**{k.title():row[k] for k in FIELDS}})
    # The MARCAP baseline always wins on shared historical dates. Detect
    # conflicting unadjusted data instead of silently mixing split-adjustments.
    base=raw.reset_index() if 'Date' not in raw and raw.index.name=='Date' else raw.copy()
    base['Code']=base['Code'].astype(str).str.replace(r'\.0$','',regex=True).str.zfill(6)
    base['Date']=pd.to_datetime(base['Date'])
    existing=base.loc[base.Code.isin(plan['target_codes'])].set_index(['Code','Date'])
    appended=[]
    for rec in records:
        key=(rec['Code'],rec['Date'])
        if key in existing.index:
            old=existing.loc[key]
            if any(int(old[col])!=rec[col] for col in ('Open','High','Low','Close','Volume','Amount')):
                raise ValueError('TARGETED_HISTORY_MARCAP_PRICE_CONFLICT')
        else:
            appended.append(rec)
    for col in base.columns:
        if col not in ('Date','Code','Name','Market', 'Open','High','Low','Close','Volume','Amount'):
            for rec in appended:
                rec[col]=None
    augmented=pd.concat([base,pd.DataFrame(appended,columns=base.columns)],ignore_index=True)
    return augmented,manifest['source_sha256']


def reuse_prior_exact_eod(raw: pd.DataFrame, root: str|Path, target: date) -> tuple[pd.DataFrame,dict]:
    """Fill verified earlier v2 days from original Turso hashes, not a new provider."""
    from turso_history_replay_source import load_verified_day
    from market_scan_r11 import merge_verified_days
    imported={}
    for day in REPLAY_DAYS:
        if day >= target.isoformat():
            continue
        folder=Path(root)/day/'eod'
        manifest=json.loads((folder/'manifest.json').read_text(encoding='utf8'))
        digest=manifest['days'][0]['sha256']
        if digest != EXACT_EOD_HASHES[day]:
            raise ValueError('TARGETED_HISTORY_PRIOR_EOD_HASH_INVALID')
        verified,_=load_verified_day(folder,date.fromisoformat(day))
        raw=merge_verified_days(raw,target,[verified],[day])
        imported[day]=digest
    return raw, imported


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--mode',choices=('plan','collect'),required=True)
    p.add_argument('--coverage-root',default='')
    p.add_argument('--plan',default='')
    p.add_argument('--anchor-eod-dir',default='')
    p.add_argument('--out',required=True)
    args=p.parse_args()
    if args.mode=='plan':
        if not args.coverage_root:raise ValueError('TARGETED_HISTORY_COVERAGE_REQUIRED')
        reports=[json.loads((Path(args.coverage_root)/day/'coverage.json').read_text(encoding='utf8')) for day in REPLAY_DAYS]
        plan=plan_coverage(reports)
        dest=Path(args.out);dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_text(json.dumps(plan,ensure_ascii=False,sort_keys=True,indent=2)+'\n',encoding='utf8')
        print('BLUE_V2_HISTORY_PLAN',plan['target_count'],'symbols; KRX first, KIS secondary, no DB writes')
    else:
        plan=json.loads(Path(args.plan).read_text(encoding='utf8'))
        if plan.get('format')!='BLUE_RESEARCH_V2_TARGETED_HISTORY_PLAN_V1' or len(plan.get('target_codes',[]))!=36:
            raise ValueError('TARGETED_HISTORY_PLAN_INVALID')
        if not args.anchor_eod_dir:
            raise ValueError('TARGETED_HISTORY_KIS_ANCHOR_REQUIRED')
        from turso_history_replay_source import load_verified_day
        anchor_day=date.fromisoformat(REPLAY_DAYS[0])
        first_manifest=json.loads((Path(args.anchor_eod_dir)/'manifest.json').read_text(encoding='utf8'))
        if first_manifest['days'][0]['sha256']!=EXACT_EOD_HASHES[REPLAY_DAYS[0]]:
            raise ValueError('TARGETED_HISTORY_KIS_ANCHOR_HASH_INVALID')
        first,_=load_verified_day(args.anchor_eod_dir,anchor_day)
        quotes={str(row.Code):{col:int(getattr(row,col.title())) for col in FIELDS}
                for row in first.itertuples() if row.Code in plan['target_codes']}
        if len(quotes)!=36:
            raise ValueError('TARGETED_HISTORY_KIS_ANCHOR_MISSING_CODES')
        blob,manifest=collect(plan,anchor_quotes=quotes)
        dest=Path(args.out);dest.mkdir(parents=True,exist_ok=True)
        (dest/'history.jsonl').write_bytes(blob)
        (dest/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,sort_keys=True,indent=2)+'\n',encoding='utf8')
        print('BLUE_V2_HISTORY_COLLECTION',manifest['row_count'],'bars',
              'ready='+str(manifest['all_codes_249_prior_bars']), 'DB_WRITES=0')


if __name__=='__main__':main()

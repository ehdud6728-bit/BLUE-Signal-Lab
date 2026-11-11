#!/usr/bin/env python3
"""BLUE R1.4.1 KIS REST KRX/NXT phase-aware snapshots, CACHE ONLY.

No token issuance, orders, EOD table writes, or silent market aggregation.
A request timestamp is NOT an exchange execution timestamp.  Rate limits and
exchange holidays are subject to the provider; cron schedules are best effort.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, time as dtime, timedelta, timezone
from pathlib import Path

import blue_kis_closing_r13 as r13
import blue_kis_token_vault_r131 as vault

KST = timezone(timedelta(hours=9))
UTC = timezone.utc
LATEST = 'blue_kis_live_quotes_r141'
HISTORY = 'blue_kis_live_history_r141'
MAX_STOCKS = 20  # 2 market calls per stock in overlap; cap server request load


class MarketError(Exception):
    """Sanitized errors only. Never echo provider payloads or credentials."""


def market_phases(instant: datetime) -> tuple[tuple[str, str], ...]:
    """Active *continuous* sessions only, all times KST. No exchange holiday claim.

    KRX auction windows 15:20-15:30 and NXT post-close opening auction
    15:30-15:40 are not represented as continuous trades.
    """
    local = instant.astimezone(KST)
    if local.weekday() >= 5:
        return ()
    t = local.time()
    if dtime(8) <= t < dtime(8, 50):
        return (('NX', 'NXT_PRE'),)
    if dtime(9) <= t < dtime(9, 0, 30):
        return (('J', 'KRX_REGULAR'),)
    if dtime(9, 0, 30) <= t < dtime(15, 20):
        return (('J', 'KRX_REGULAR'), ('NX', 'NXT_MAIN'))
    if dtime(15, 40) <= t < dtime(16):
        return (('NX', 'NXT_AFTER'),)
    if dtime(16) <= t < dtime(20):
        return (('J', 'KRX_AFTER'), ('NX', 'NXT_AFTER'))
    return ()


def ensure_tables(db):
    db.query('''CREATE TABLE IF NOT EXISTS blue_kis_live_quotes_r141 (
      trade_date TEXT NOT NULL, market TEXT NOT NULL, code TEXT NOT NULL,
      received_at_utc TEXT NOT NULL, payload_json TEXT NOT NULL,
      PRIMARY KEY(trade_date,market,code))''')
    db.query('''CREATE TABLE IF NOT EXISTS blue_kis_live_history_r141 (
      trade_date TEXT NOT NULL,market TEXT NOT NULL, code TEXT NOT NULL,
      received_at_utc TEXT NOT NULL, price INTEGER NOT NULL,
      volume INTEGER NOT NULL, phase TEXT NOT NULL,
      PRIMARY KEY(trade_date,market,code,received_at_utc))''')
    db.query('''CREATE INDEX IF NOT EXISTS idx_blue_kis_r141_day
      ON blue_kis_live_history_r141(trade_date,market,code)''')


def parse_market_quote(candidate: dict, market: str, phase: str, body: dict,
                       received: datetime, source_run: int) -> dict:
    code = str(candidate.get('code') or '')
    if market not in ('J', 'NX') or not re.fullmatch(r'[0-9A-Z]{6}', code):
        raise MarketError('INVALID_MARKET_OR_TICKER')
    if str(body.get('rt_cd', '')) != '0':
        raise MarketError('KIS_RESPONSE_NOT_OK')
    try:
        base = r13.parse_quote(candidate, body, received.astimezone(KST), 'r141-'+phase)
    except r13.Failure as exc:
        raise MarketError(str(exc)) from None
    raw = body.get('output')
    if not isinstance(raw, dict):
        raise MarketError('INVALID_OUTPUT')
    trade_day = str(raw.get('stck_bsop_date') or '')
    today = received.astimezone(KST).strftime('%Y%m%d')
    # Explicitly mismatched vendor business dates must never be published as current-day data.
    if trade_day and trade_day != today:
        raise MarketError('PROVIDER_TRADE_DAY_MISMATCH')
    tick_clock = str(raw.get('stck_cntg_hour') or '')
    return {
        'code':code,'name':str(candidate.get('name') or '')[:70],
        'market':market,'market_label':'KRX' if market=='J' else 'NXT',
        'phase':phase,'trade_date_kst':received.astimezone(KST).date().isoformat(),
        'received_at_utc':received.astimezone(UTC).isoformat(timespec='seconds'),
        'price':base['price'],'open':base['open'],'high':base['high'],
        'low':base['low'],'accumulated_volume':base['accumulated_volume'],
        'change_from_eod_pct':base['change_from_eod_pct'],
        'day_range_position_pct':base['day_range_position_pct'],
        'eod_asof':base['eod_asof'],'eod_close':base['eod_close'],
        'eod_signals':base['eod_signals'],'source_krx_run_id':source_run,
        'reported_trade_date':trade_day or None,
        'reported_trade_day_matches_today': True if trade_day else None,
        'reported_trade_clock':tick_clock if re.fullmatch(r'\d{6}',tick_clock) else None,
        'exchange_tick_time_verified':False,
        'market_phase_verified':False,
        'source':'KIS_REST_INQUIRE_PRICE', 'research_only':True,
    }


def write_quotes(db, quotes: list[dict], observed: datetime):
    if not quotes or len(quotes) > MAX_STOCKS*2:
        raise MarketError('BAD_QUOTE_BATCH_SIZE')
    day = observed.astimezone(KST).date().isoformat()
    keys = set()
    bind_latest=[];bind_history=[]
    for q in quotes:
        key=(q['market'],q['code'])
        if (q['trade_date_kst']!=day or q['market'] not in ('J','NX') or key in keys
                or not re.fullmatch(r'[0-9A-Z]{6}',q['code'])):
            raise MarketError('BAD_QUOTE_BATCH_ROW')
        keys.add(key)
        bind_latest.extend([day,q['market'],q['code'],q['received_at_utc'],
                            json.dumps(q,ensure_ascii=False,separators=(',',':'))])
        bind_history.extend([day,q['market'],q['code'],q['received_at_utc'],
                             str(q['price']),str(q['accumulated_volume']),q['phase']])
    # Cloudflare D1 restricts bind parameters to 100 PER statement.
    # Latest uses 5 parameters/row; history uses 7. The history limit is
    # floor(100/7)=14 rows. Split both inserts into identical 14-row chunks.
    # Validate the full batch before issuing any D1 write (above).
    D1_BIND_LIMIT = 100
    HISTORY_BIND_FIELDS = 7
    LATEST_BIND_FIELDS = 5
    batch_rows = D1_BIND_LIMIT // HISTORY_BIND_FIELDS
    for offset in range(0, len(quotes), batch_rows):
        count = min(batch_rows, len(quotes) - offset)
        v = ','.join('(?,?,?,?,?)' for _ in range(count))
        db.query(f'''INSERT INTO {LATEST} (trade_date,market,code,received_at_utc,payload_json)
          VALUES {v} ON CONFLICT(trade_date,market,code) DO UPDATE SET
          received_at_utc=excluded.received_at_utc,payload_json=excluded.payload_json
          WHERE excluded.received_at_utc>{LATEST}.received_at_utc''',
          bind_latest[offset*LATEST_BIND_FIELDS:(offset+count)*LATEST_BIND_FIELDS])
        h = ','.join('(?,?,?,?,?,?,?)' for _ in range(count))
        db.query(f'''INSERT INTO {HISTORY}
          (trade_date,market,code,received_at_utc,price,volume,phase)
          VALUES {h} ON CONFLICT(trade_date,market,code,received_at_utc) DO NOTHING''',
          bind_history[offset*HISTORY_BIND_FIELDS:(offset+count)*HISTORY_BIND_FIELDS])
    cutoff=(observed.astimezone(KST).date()-timedelta(days=20)).isoformat()
    db.query(f'DELETE FROM {LATEST} WHERE trade_date<?',[cutoff])
    db.query(f'DELETE FROM {HISTORY} WHERE trade_date<?',[cutoff])


def get_market_quote(client, market, ticker):
    return client.get('/uapi/domestic-stock/v1/quotations/inquire-price','FHKST01010100',{
        'FID_COND_MRKT_DIV_CODE':market,'FID_INPUT_ISCD':ticker})


def run(args, clock=None, database=None, get_candidates=None, client_factory=None):
    now=(clock or r13.kst_now)()
    audit={'phase':'BLUE_KIS_R141_READ_ONLY','started_at_kst':now.astimezone(KST).isoformat(timespec='seconds'),
           'planned_cadence':'5min best-effort, 08:00-20:00 KST on trading days',
           'token_issuance_allowed':False,'orders_enabled':False,'status':'STARTED','published':0}
    path=Path(args.out);path.mkdir(parents=True,exist_ok=True)
    try:
        if args.dry_run:
            audit['status']='DRY_RUN_NO_NETWORK';return 0
        phases=market_phases(now)
        if not phases:
            audit['status']='SKIPPED_NO_CONTINUOUS_MARKET';return 0
        limit=int(args.limit)
        if limit<1 or limit>MAX_STOCKS:
            raise MarketError('INVALID_STOCK_LIMIT')
        db=database if database is not None else vault.D1Vault()
        ensure_tables(db)
        appkey=os.environ.get('KIS_APP_KEY','').strip()
        appsecret=os.environ.get('KIS_APP_SECRET','').strip()
        if not appkey or not appsecret:
            raise MarketError('KIS_SECRETS_MISSING')
        try:
            token,origin=vault.obtain_token(appkey,appsecret,allow_new=False,vault=db)
        except vault.VaultError as exc:
            if str(exc)=='CACHE_EMPTY_OR_EXPIRED_NO_ISSUANCE':
                audit['status']='PAUSED_TOKEN_EMPTY_OR_EXPIRED';return 0
            raise MarketError('TOKEN_VAULT_'+str(exc)) from None
        if origin!='CACHE':
            raise MarketError('UNEXPECTED_NON_CACHE_TOKEN')
        fetch = get_candidates if get_candidates is not None else r13.fetch_latest_verified_eod
        eod,rows,source_run=fetch(now.astimezone(KST).date(),os.environ.get('GITHUB_TOKEN',''))
        candidates=r13.choose_candidates(rows,limit)
        if not candidates:raise MarketError('NO_KRX_CANDIDATES')
        client=(client_factory or r13.KISClient)(appkey,appsecret,token)
        quotes=[];errors=[]
        for market,phase in phases:
            for c in candidates:
                try:
                    reply=get_market_quote(client,market,c['code'])
                    quotes.append(parse_market_quote(c,market,phase,reply,(clock or r13.kst_now)(),source_run))
                except (r13.Failure,MarketError) as exc:
                    errors.append({'market':market,'code':c['code'],'error':str(exc)})
        audit['markets']=[x[0] for x in phases]
        audit['candidate_count']=len(candidates)
        audit['source_krx_run_id']=source_run
        audit['source_eod_date']=eod.get('asof')
        audit['request_count']=getattr(client,'requests',None)
        audit['token_source']='CACHE'
        audit['token_issued_this_run']=False
        audit['failed_count']=len(errors)
        audit['failed']=errors[:40]
        if not quotes:
            audit['status']='NO_VALID_QUOTES_MARKET_OR_PROVIDER_UNVERIFIED'
            return 0  # e.g., holidays or unsupported venue; no stale data gets published
        write_quotes(db,quotes,now)
        audit['published']=len(quotes)
        audit['status']='OK' if not errors else 'PARTIAL_QUOTES'
        print('BLUE_R141 status=%s saved=%s failures=%s token_source=CACHE issued=false' %
              (audit['status'],len(quotes),len(errors)))
        return 0
    except (MarketError,vault.VaultError,r13.Failure) as exc:
        audit['status']='FAILED';audit['error_code']=str(exc)
        print('BLUE_R141_FAILED code='+str(exc),file=sys.stderr)
        return 2
    except Exception:
        audit['status']='FAILED';audit['error_code']='UNEXPECTED_ERROR'
        print('BLUE_R141_FAILED code=UNEXPECTED_ERROR',file=sys.stderr)
        return 2
    finally:
        audit['ended_at_kst']=(clock or r13.kst_now)().astimezone(KST).isoformat(timespec='seconds')
        (path/'AUDIT.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--limit',type=int,default=12)
    p.add_argument('--dry-run',action='store_true',help='test execution without any network calls')
    p.add_argument('--out',default='output/kis_r141')
    return run(p.parse_args())

if __name__=='__main__':sys.exit(main())

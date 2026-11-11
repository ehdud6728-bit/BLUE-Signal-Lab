#!/usr/bin/env python3
"""BLUE R1.3: KRX verified EOD candidates -> KIS intraday research snapshots.

READ ONLY. No order endpoints, no D1 mutation, no direct changes to Stock-Hunter.
Secrets/HTTP bodies/tokens are never printed or saved. Requires Python 3.11+.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import sys
import time
import zipfile
from datetime import date, datetime, time as dtime, timedelta, timezone
from pathlib import Path
from urllib import error, parse, request

KST = timezone(timedelta(hours=9))
REPO = 'ehdud6728-bit/BLUE-Signal-Lab'
GH_API = 'https://api.github.com'
KIS = 'https://openapi.koreainvestment.com:9443'
RUN_WORKFLOW = 'blue_market_scan_research_only.yml'
MAX_BYTES = 12_000_000
MIN_GAP_SECONDS = 0.40
SLOTS = ('14:00', '14:30', '15:00', '15:15', '15:23')
SAFE_CODE = re.compile(r'^[A-Za-z0-9_-]{1,40}$')
TICKER = re.compile(r'^[0-9A-Z]{6}$')

class Failure(Exception):
    """Only pass constant or sanitized codes. Never raw provider details."""


def kst_now() -> datetime:
    return datetime.now(KST)


def safe_code(s) -> str:
    s = str(s or '')
    return s if SAFE_CODE.fullmatch(s) else 'UNKNOWN'


def http_json(method, base, path, headers=None, params=None, body=None, tries=2):
    url = base + path
    if params:
        url += '?' + parse.urlencode(params)
    encoded = json.dumps(body).encode('utf-8') if body is not None else None
    h = dict(headers or {})
    for attempt in range(tries):
        req = request.Request(url, headers=h, data=encoded, method=method)
        try:
            with request.urlopen(req, timeout=18) as resp:
                payload = resp.read(MAX_BYTES + 1)
            if len(payload) > MAX_BYTES:
                raise Failure('RESPONSE_TOO_LARGE')
            result = json.loads(payload.decode('utf-8'))
            if not isinstance(result, dict):
                raise Failure('INVALID_RESPONSE_SHAPE')
            return result
        except error.HTTPError as exc:
            try:
                err_body = json.loads(exc.read(4096).decode('utf-8'))
                err_id = safe_code(err_body.get('msg_cd'))
            except (ValueError, UnicodeError, AttributeError):
                err_id = 'UNKNOWN'
            if exc.code in (429, 500, 502, 503, 504) and attempt + 1 < tries:
                time.sleep(2 + attempt * 3)
                continue
            raise Failure(f'HTTP_{exc.code}_{err_id}') from None
        except (error.URLError, TimeoutError, OSError):
            if attempt + 1 < tries:
                time.sleep(2)
                continue
            raise Failure('NETWORK_ERROR') from None
        except (ValueError, UnicodeError):
            raise Failure('INVALID_RESPONSE_JSON') from None
    raise Failure('RETRY_EXHAUSTED')


def get_json_with_size(url: str, headers: dict, max_bytes: int) -> bytes:
    req = request.Request(url, headers=headers, method='GET')
    # Do not forward the GitHub bearer token on redirects to artifact storage hosts.
    class DropCrossHostAuth(request.HTTPRedirectHandler):
        def redirect_request(self, r, fp, code, msg, hdrs, newurl):
            outgoing = super().redirect_request(r, fp, code, msg, hdrs, newurl)
            if outgoing and parse.urlsplit(newurl).hostname != parse.urlsplit(r.full_url).hostname:
                for key in ('Authorization', 'authorization'):
                    outgoing.remove_header(key)
                    outgoing.unredirected_hdrs.pop(key, None)
            return outgoing
    opener = request.build_opener(DropCrossHostAuth)
    try:
        with opener.open(req, timeout=30) as resp:
            contents = resp.read(max_bytes + 1)
        if len(contents) > max_bytes:
            raise Failure('ARTIFACT_TOO_LARGE')
        return contents
    except (error.HTTPError, error.URLError, TimeoutError, OSError):
        raise Failure('GITHUB_ARTIFACT_DOWNLOAD_FAILED') from None


def gh_headers(token: str) -> dict:
    result = {'Accept': 'application/vnd.github+json', 'User-Agent': 'BLUE-R13-RESEARCH-ONLY'}
    if token:
        result['Authorization'] = 'Bearer ' + token
    return result


def parse_eod_artifact(blob: bytes, today: date, max_age_days=5) -> tuple[dict, list[dict]]:
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            members = {m.filename: m for m in z.infolist()}
            if not {'AUDIT.json', 'signals.csv'}.issubset(members):
                raise Failure('EOD_FILES_MISSING')
            if members['signals.csv'].file_size > 2_000_000 or members['AUDIT.json'].file_size > 30_000:
                raise Failure('EOD_FILES_TOO_LARGE')
            audit = json.loads(z.read('AUDIT.json').decode('utf-8'))
            content = z.read('signals.csv').decode('utf-8-sig')
        if audit.get('data_phase') != 'SAME_DAY_EOD_VERIFIED' or audit.get('intraday_verified') is not False:
            raise Failure('EOD_NOT_VERIFIED')
        if 'KRX' not in audit.get('target_day_source', ''):
            raise Failure('EOD_WRONG_SOURCE')
        asof = date.fromisoformat(audit['asof'])
        age = (today - asof).days
        if age <= 0 or age > max_age_days:
            raise Failure('EOD_ASOF_STALE_OR_FUTURE')
        rows = list(csv.DictReader(io.StringIO(content)))
        if len(rows) != int(audit.get('matched_stocks', -1)) or not rows:
            raise Failure('EOD_ROW_COUNT_MISMATCH')
        if len(rows) > 5000:
            raise Failure('EOD_UNIVERSE_TOO_LARGE')
        seen = set()
        clean = []
        for row in rows:
            code = str(row.get('code', '')).strip().upper()
            if not TICKER.fullmatch(code) or code in seen:
                raise Failure('EOD_TICKER_INVALID')
            if row.get('date') != audit['asof'] or row.get('data_frequency') != 'EOD_DAILY':
                raise Failure('EOD_ROW_DATE_MISMATCH')
            if row.get('intraday_verified', '').lower() != 'false':
                raise Failure('EOD_ROW_PHASE_MISMATCH')
            seen.add(code)
            clean.append(row)
        return audit, clean
    except (zipfile.BadZipFile, UnicodeError, ValueError, KeyError, TypeError, OSError):
        raise Failure('EOD_ARTIFACT_INVALID') from None


def fetch_latest_verified_eod(today: date, gh_token: str) -> tuple[dict, list[dict], int]:
    headers = gh_headers(gh_token)
    listing = http_json('GET', GH_API, f'/repos/{REPO}/actions/workflows/{RUN_WORKFLOW}/runs',
                        headers, {'status': 'success', 'per_page': '30'}, tries=2)
    runs = listing.get('workflow_runs', [])
    if not isinstance(runs, list):
        raise Failure('GITHUB_RUNS_INVALID')
    for run in runs:
        run_id = run.get('id')
        if not isinstance(run_id, int) or run.get('conclusion') != 'success':
            continue
        info = http_json('GET', GH_API, f'/repos/{REPO}/actions/runs/{run_id}/artifacts',
                         headers, {'per_page': '50'})
        artifacts = info.get('artifacts', [])
        if not isinstance(artifacts, list):
            continue
        for art in artifacts:
            if art.get('expired') or not str(art.get('name','')).startswith('BLUE_R11_EOD_VERIFIED_'):
                continue
            url = art.get('archive_download_url', '')
            if not url.startswith(f'https://api.github.com/repos/{REPO}/actions/artifacts/'):
                continue
            try:
                blob = get_json_with_size(url, headers, 12_000_000)
                audit, candidates = parse_eod_artifact(blob, today)
                return audit, candidates, run_id
            except Failure as exc:
                # An older backfill can occur; inspect other successful runs.
                if str(exc) == 'EOD_ASOF_STALE_OR_FUTURE':
                    continue
                raise
    raise Failure('VERIFIED_PREVIOUS_EOD_NOT_FOUND')


def numeric(s, fallback=None):
    try:
        if s is None or str(s).strip() == '':
            return fallback
        return float(s)
    except (ValueError, TypeError):
        return fallback


def choose_candidates(rows: list[dict], limit: int) -> list[dict]:
    """Stable *coverage priority*, not a predicted-return/entry score."""
    def priority(row):
        sig = [s for s in row.get('signals','').split(',') if s.strip()]
        amount = numeric(row.get('amount_ratio20'), 0) or 0
        volume = numeric(row.get('volume_ratio20'), 0) or 0
        return (-len(sig), -min(amount, 999), -min(volume, 999), row['code'])
    selection = sorted(rows, key=priority)[:limit]
    return [{
        'code': row['code'], 'name': row.get('name', ''),
        'eod_date': row['date'], 'eod_close': numeric(row.get('close')),
        'eod_signals': row.get('signals', ''),
        'eod_amount_ratio20': numeric(row.get('amount_ratio20')),
        'eod_volume_ratio20': numeric(row.get('volume_ratio20')),
        'eod_supply_distance_pct': numeric(row.get('distance_to_nearest_supply_pct')),
    } for row in selection]


class KISClient:
    def __init__(self, appkey: str, secret: str, token: str):
        # FAIL CLOSED: a client can never request a new token implicitly.
        if not isinstance(token, str) or not token:
            raise Failure('TOKEN_NOT_PROVIDED')
        self.appkey, self.secret = appkey, secret
        self.token = token
        self.last = 0.0
        self.requests = 0

    def get(self, path: str, tr_id: str, params: dict) -> dict:
        elapsed = time.monotonic() - self.last
        if self.last and elapsed < MIN_GAP_SECONDS:
            time.sleep(MIN_GAP_SECONDS - elapsed)
        self.last = time.monotonic()
        self.requests += 1
        result = http_json('GET', KIS, path,
            {'Content-Type':'application/json', 'Accept':'application/json',
             'authorization':'Bearer '+self.token, 'appkey':self.appkey,
             'appsecret':self.secret, 'tr_id':tr_id, 'custtype':'P'},
            params=params)
        if str(result.get('rt_cd','')) != '0':
            raise Failure('KIS_REJECTED_' + safe_code(result.get('msg_cd')))
        return result

    def quote(self, code: str) -> dict:
        return self.get('/uapi/domestic-stock/v1/quotations/inquire-price', 'FHKST01010100',
                        {'FID_COND_MRKT_DIV_CODE':'J','FID_INPUT_ISCD':code})

    def minute(self, code: str, time_hhmmss: str) -> dict:
        return self.get('/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice', 'FHKST03010200',
                        {'FID_COND_MRKT_DIV_CODE':'J', 'FID_INPUT_ISCD':code,
                         'FID_INPUT_HOUR_1': time_hhmmss,
                         'FID_PW_DATA_INCU_YN':'N','FID_ETC_CLS_CODE':''})

    def program(self, code: str) -> dict:
        return self.get('/uapi/domestic-stock/v1/quotations/program-trade-by-stock', 'FHPPG04650101',
                        {'FID_COND_MRKT_DIV_CODE':'J', 'FID_INPUT_ISCD':code})

    def volume_rank(self) -> dict:
        # Official KIS example: domestic_stock/volume_rank; supplementary only.
        return self.get('/uapi/domestic-stock/v1/quotations/volume-rank', 'FHPST01710000',
                        {'FID_COND_MRKT_DIV_CODE':'J','FID_COND_SCR_DIV_CODE':'20171',
                         'FID_INPUT_ISCD':'0000','FID_DIV_CLS_CODE':'1',
                         'FID_BLNG_CLS_CODE':'3',
                         'FID_TRGT_CLS_CODE':'111111111',
                         'FID_TRGT_EXLS_CLS_CODE':'0000000000',
                         'FID_INPUT_PRICE_1':'0','FID_INPUT_PRICE_2':'10000000',
                         'FID_VOL_CNT':'0','FID_INPUT_DATE_1':''})

    def closing_expected(self, area: str) -> dict:
        return self.get('/uapi/domestic-stock/v1/quotations/exp-closing-price', 'FHKST117300C0',
                        {'FID_COND_MRKT_DIV_CODE':'J', 'FID_INPUT_ISCD':area,
                         'FID_RANK_SORT_CLS_CODE':'0', 'FID_COND_SCR_DIV_CODE':'11173',
                         'FID_BLNG_CLS_CODE':'0'})


def parse_quote(candidate: dict, body: dict, dt: datetime, label: str) -> dict:
    o = body.get('output')
    if not isinstance(o, dict):
        raise Failure('QUOTE_OUTPUT_MISSING')
    try:
        price = int(o['stck_prpr'])
        vol = int(o['acml_vol'])
        opn, high, low = (int(o[x]) for x in ('stck_oprc','stck_hgpr','stck_lwpr'))
    except (ValueError, TypeError, KeyError):
        raise Failure('QUOTE_INVALID_NUMERIC') from None
    if price <= 0 or vol < 0 or min(opn,high,low) <= 0 or high < low or not low <= price <= high:
        raise Failure('QUOTE_INCONSISTENT')
    eod_close = candidate['eod_close']
    return {
        'code':candidate['code'], 'name':candidate['name'],
        'slot':label, 'received_at_kst':dt.isoformat(timespec='seconds'),
        'price':price, 'open':opn, 'high':high, 'low':low,
        'accumulated_volume':vol,
        # Official KIS original fields; avoid inferring currency units or point-in-time freshness.
        'accumulated_trade_value_raw':o.get('acml_tr_pbmn'),
        'change_pct_reported':numeric(o.get('prdy_ctrt')),
        'volume_vs_previous_day_pct_reported':numeric(o.get('prdy_vrss_vol_rate')),
        'foreign_net_buy_qty_reported':numeric(o.get('frgn_ntby_qty')),
        'program_net_buy_qty_reported':numeric(o.get('pgtr_ntby_qty')),
        'market_warning_code':str(o.get('mrkt_warn_cls_code') or ''),
        'trading_halt_code':str(o.get('temp_stop_yn') or ''),
        'eod_asof':candidate['eod_date'], 'eod_close':eod_close,
        'eod_signals':candidate['eod_signals'],
        'change_from_eod_pct':round((price / eod_close - 1)*100,4) if eod_close and eod_close > 0 else None,
        'day_range_position_pct':round((price-low)/(high-low)*100,2) if high>low else None,
        'exchange_tick_time_verified':False,
        'research_only':True,
    }


def parse_minute_bars(code: str, body: dict, trade_day: date, dt: datetime, label: str) -> list[dict]:
    rows = body.get('output2', [])
    if not isinstance(rows, list):
        raise Failure('MINUTE_OUTPUT_INVALID')
    extracted = []
    for row in rows[:30]:
        if not isinstance(row, dict):
            continue
        day = str(row.get('stck_bsop_date',''))
        clock = str(row.get('stck_cntg_hour',''))
        if day != trade_day.strftime('%Y%m%d') or not re.fullmatch(r'\d{6}', clock):
            continue
        extracted.append({'code':code,'slot':label, 'received_at_kst':dt.isoformat(timespec='seconds'),
                          'bar_date':day,'bar_time':clock,
                          'price':numeric(row.get('stck_prpr')),
                          'open':numeric(row.get('stck_oprc')),
                          'high':numeric(row.get('stck_hgpr')),
                          'low':numeric(row.get('stck_lwpr')),
                          'minute_volume_raw':numeric(row.get('cntg_vol')),
                          'provider':'KIS_INQUIRE_TIME_ITEMCHARTPRICE'})
    return extracted


def parse_limited_provider_rows(body: dict, fields: tuple[str,...], max_rows=40) -> list[dict]:
    output = body.get('output', [])
    if not isinstance(output, list):
        return []
    return [{key:r.get(key) for key in fields if key in r}
            for r in output[:max_rows] if isinstance(r,dict)]


def append_jsonl(path: Path, rows: list[dict]):
    if not rows:
        return
    with path.open('a',encoding='utf-8') as f:
        for row in rows:
            f.write(json.dumps(row,ensure_ascii=False, separators=(',',':'))+'\n')


def time_band(t: dtime) -> str:
    if dtime(9) <= t < dtime(15,20):
        return 'CONTINUOUS_SESSION_OR_MARKET_STATUS_UNVERIFIED'
    if dtime(15,20) <= t < dtime(15,30):
        return 'CLOSING_AUCTION_EXPECTED_NOT_FINAL'
    return 'OFF_REGULAR_SESSION_OR_MARKET_STATUS_UNVERIFIED'


def take_snapshot(client: KISClient, candidates: list[dict], out: Path, label: str,
                  enable_enrichment: bool, top_enrich: int = 3) -> dict:
    now = kst_now()
    slot_type = time_band(now.time())
    success, failures = [], []
    for cand in candidates:
        try:
            body = client.quote(cand['code'])
            success.append(parse_quote(cand,body,kst_now(),label))
        except Failure as exc:
            failures.append({'code':cand['code'],'endpoint':'inquire-price','error':str(exc)})
    append_jsonl(out/'quotes.jsonl',success)
    # Heavy supplementary calls are constrained to the highest EOD-priority candidates.
    enrichment = {'minute_bars':0,'program_responses':0,'rank_rows':0,'auction_rows':0}
    if enable_enrichment and slot_type.startswith('CONTINUOUS'):
        for cand in candidates[:top_enrich]:
            try:
                dt = kst_now()
                body = client.minute(cand['code'],dt.strftime('%H%M%S'))
                bars = parse_minute_bars(cand['code'],body,dt.date(),kst_now(),label)
                append_jsonl(out/'minute_bars.jsonl',bars)
                enrichment['minute_bars'] += len(bars)
            except Failure as exc:
                failures.append({'code':cand['code'],'endpoint':'minute','error':str(exc)})
        # Validate provider schema before interpreting any program trade figures.
        for cand in candidates[:top_enrich]:
            try:
                body = client.program(cand['code'])
                raw = body.get('output', [])
                if isinstance(raw, list):
                    enrichment['program_responses'] += 1
                    fields = sorted({key for row in raw[:5] if isinstance(row,dict) for key in row})[:100]
                    append_jsonl(out/'program_schema.jsonl',[{'code':cand['code'],'slot':label,
                        'row_count':len(raw),'available_fields':fields,
                        'interpretation':'UNVERIFIED_SCHEMA_ONLY'}])
            except Failure as exc:
                failures.append({'code':cand['code'],'endpoint':'program','error':str(exc)})
    if enable_enrichment and slot_type.startswith('CONTINUOUS') and label in ('probe', '14:30'):
        try:
            body = client.volume_rank()
            rows = parse_limited_provider_rows(body,
                ('stck_shrn_iscd','hts_kor_isnm','acml_vol','acml_tr_pbmn','prdy_ctrt'),40)
            append_jsonl(out/'volume_rank.jsonl',[
                {'slot':label,'market':'KRX','observed_at_kst':kst_now().isoformat(), **x}
                for x in rows])
            enrichment['rank_rows'] += len(rows)
        except Failure as exc:
            failures.append({'code':'MARKET','endpoint':'volume_rank','error':str(exc)})
    if enable_enrichment and slot_type.startswith('CLOSING_AUCTION'):
        for area in ('0001', '1001'):
            try:
                body = client.closing_expected(area)
                items = parse_limited_provider_rows(body,
                    ('stck_shrn_iscd','hts_kor_isnm','stck_prpr','prdy_ctrt','cntg_vol'))
                append_jsonl(out/'auction_expected.jsonl',[
                    {'market_area':area,'slot':label, 'expected_not_final':True, **i} for i in items])
                enrichment['auction_rows'] += len(items)
            except Failure as exc:
                failures.append({'code':area,'endpoint':'exp_closing_price','error':str(exc)})
    return {'label':label,'snapshot_at_kst':kst_now().isoformat(timespec='seconds'),
            'data_phase':slot_type,'quote_success':len(success),'quote_failure':len(candidates)-len(success),
            'enrichment':enrichment,'failures':failures}


def _next_slots(now: datetime):
    for label in SLOTS:
        hour,minute = map(int,label.split(':'))
        scheduled = now.replace(hour=hour,minute=minute,second=0,microsecond=0)
        if scheduled >= now - timedelta(seconds=30):
            yield label, scheduled


def run(args):
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    now = kst_now()
    audit = {'phase':'BLUE_R13_KIS_RESEARCH_ONLY','mode':args.mode,
             'started_at_kst':now.isoformat(timespec='seconds'),
             'data_trading_day_kst':now.date().isoformat(),
             'KIS_TOKEN_REUSE':'PERSISTENT_ENCRYPTED_D1','orders_enabled':False,
             'd1_market_writes_enabled':False,'d1_token_vault_writes_enabled':True,'intraday_verified':False,'snapshots':[],'status':'STARTED'}
    try:
        if args.mode == 'session':
            if now.weekday() >= 5 or not dtime(13,40) <= now.time() < dtime(15,24):
                raise Failure('SESSION_START_OUTSIDE_ALLOWED_WINDOW')
        if args.source == 'verified-eod':
            eod, stocks, run_id = fetch_latest_verified_eod(now.date(),os.environ.get('GITHUB_TOKEN',''))
            audit['candidate_source']={'kind':'KRX_VERIFIED_EOD_ARTIFACT','asof':eod['asof'],
                'source_run_id':run_id,'matched_stocks':len(stocks),'eod_data_phase':eod['data_phase']}
            candidates=choose_candidates(stocks,args.limit)
        else:
            # Use only for initial endpoint checks, never for a real candidate recommendation.
            examples=[('005930','삼성전자'),('000660','SK하이닉스'),('006400','삼성SDI')]
            candidates=[{'code':c,'name':n,'eod_date':None,'eod_close':None,'eod_signals':''}
                        for c,n in examples]
            audit['candidate_source']={'kind':'FIXED_3_STOCK_SMOKE_ONLY','asof':None}
        if not candidates:
            raise Failure('CANDIDATES_EMPTY')
        audit['candidate_count']=len(candidates)
        audit['candidate_selection_policy']='EOD_SIGNAL_COUNT_AND_ACTIVITY_COVERAGE_PRIORITY_NOT_ENTRY_SIGNAL'
        (out/'candidates.json').write_text(json.dumps(candidates,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        appkey=os.environ.get('KIS_APP_KEY','').strip()
        appsecret=os.environ.get('KIS_APP_SECRET','').strip()
        if not appkey or not appsecret:
            raise Failure('KIS_SECRETS_MISSING')
        # Token vault reads encrypted ciphertext from the existing Cloudflare D1.
        # An API issuance happens ONLY with an explicit allow-new-token input.
        import blue_kis_token_vault_r131 as token_vault
        try:
            token, token_origin = token_vault.obtain_token(
                appkey, appsecret, allow_new=args.allow_new_token
            )
        except token_vault.VaultError as exc:
            raise Failure('KIS_VAULT_' + str(exc)) from None
        audit['token_source'] = token_origin  # non-secret metadata only
        audit['token_issued_this_run'] = (token_origin == 'NEW_EXPLICIT')
        client=KISClient(appkey,appsecret,token)
        if args.mode == 'probe':
            audit['snapshots'].append(take_snapshot(client,candidates,out,'probe',args.enrich))
        else:
            future=list(_next_slots(kst_now()))
            if not future:
                raise Failure('SESSION_NO_SLOTS_LEFT')
            for label,scheduled in future:
                delay=(scheduled-kst_now()).total_seconds()
                if delay>0: time.sleep(delay)
                # A scheduled run may have been delayed. Do not mislabel a late quote.
                actual=kst_now()
                if actual-scheduled>timedelta(minutes=2):
                    audit['snapshots'].append({'label':label,'status':'MISSED_LATE','observed_at_kst':actual.isoformat()})
                    continue
                audit['snapshots'].append(take_snapshot(client,candidates,out,label,args.enrich))
                audit['status']='IN_PROGRESS'
                (out/'AUDIT.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        audit['kis_read_requests']=client.requests
        successes=sum(s.get('quote_success',0) for s in audit['snapshots'])
        audit['total_quote_rows']=successes
        expected = sum(s.get('quote_success',0)+s.get('quote_failure',0) for s in audit['snapshots'])
        audit['status'] = ('NO_VALID_QUOTES' if successes == 0 else
                           'PARTIAL_QUOTES' if successes < expected else 'OK')
        print(f'BLUE_R13_RESULT status={audit["status"]} quotes={successes} '
              f'snapshots={len(audit["snapshots"])} kis_requests={client.requests} '
              f'source={audit["candidate_source"]["kind"]}')
        return 0 if audit['status']=='OK' else 2
    except Failure as exc:
        audit['status']='FAILED'
        audit['failure_code']=str(exc)
        print('BLUE_R13_FAILED code='+str(exc),file=sys.stderr)
        return 2
    except Exception:
        audit['status']='FAILED'
        audit['failure_code']='UNEXPECTED_ERROR'
        print('BLUE_R13_FAILED code=UNEXPECTED_ERROR',file=sys.stderr)
        return 2
    finally:
        audit['finished_at_kst']=kst_now().isoformat(timespec='seconds')
        (out/'AUDIT.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mode',choices=('probe','session'),default='probe')
    p.add_argument('--source',choices=('verified-eod','sample'),default='verified-eod')
    p.add_argument('--limit',type=int,default=12)
    p.add_argument('--enrich',action='store_true',help='additional minute/program/auction API schema probes')
    p.add_argument('--allow-new-token',action='store_true',
                   help='EXPLICIT ONLY: issue ONE KIS token if no valid cached token exists')
    p.add_argument('--out',default='output/kis_r13')
    args=p.parse_args()
    if not 1<=args.limit<=100:
        p.error('--limit must be in 1..100')
    if args.mode=='session' and args.source=='sample':
        p.error('session mode requires independently verified previous EOD candidates')
    return run(args)

if __name__=='__main__':
    sys.exit(main())

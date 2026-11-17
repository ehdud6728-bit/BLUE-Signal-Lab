#!/usr/bin/env python3
"""Write isolated, versioned D1 analysis records without modifying search signals.

Runs only when the operator explicitly enables publish_diagnostic_only.
Large JSON values use bounded SQL statements suitable for Wrangler D1.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from append_chart_sql_r10 import quoted, MAX_STATEMENT_BYTES, MAX_ROW_BYTES

SCHEMA = '''CREATE TABLE IF NOT EXISTS blue_symbol_analysis_v1 (
 run_id TEXT NOT NULL, code TEXT NOT NULL, day TEXT NOT NULL,
 source TEXT NOT NULL, quality_status TEXT NOT NULL,
 diagnosis_json TEXT NOT NULL, chart_json TEXT NOT NULL, stats_json TEXT NOT NULL,
 created_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (run_id,code,day)
);
CREATE INDEX IF NOT EXISTS idx_symbol_analysis_v1_lookup
 ON blue_symbol_analysis_v1(code,day,created_at_utc);
CREATE TABLE IF NOT EXISTS blue_symbol_directory_v1 (
 code TEXT PRIMARY KEY, name TEXT NOT NULL, market TEXT NOT NULL,
 asof_day TEXT NOT NULL, updated_at_utc TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_blue_symbol_directory_v1_name
 ON blue_symbol_directory_v1(name);'''


def directory_statements(directory: dict) -> list[str]:
    day = str(directory.get('asof', ''))
    symbols = directory.get('symbols')
    if not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', day) or not isinstance(symbols, list):
        raise ValueError('Invalid symbol directory')
    if not 1200 <= len(symbols) <= 10000:
        raise ValueError('Unexpected stock directory size')
    seen: set[str] = set()
    statements: list[str] = []
    batch: list[str] = []

    def flush() -> None:
        if not batch:
            return
        sql = ('INSERT INTO blue_symbol_directory_v1(code,name,market,asof_day) VALUES '\
               + ','.join(batch) + ' ON CONFLICT(code) DO UPDATE SET '
               'name=excluded.name,market=excluded.market,asof_day=excluded.asof_day,'
               'updated_at_utc=CURRENT_TIMESTAMP '
               'WHERE excluded.asof_day>=blue_symbol_directory_v1.asof_day;')
        if len(sql.encode('utf-8')) > MAX_STATEMENT_BYTES:
            raise ValueError('Directory SQL too large')
        statements.append(sql)
        batch.clear()

    for item in symbols:
        code = str(item.get('code', ''))
        name = str(item.get('name', '')).strip()
        market = str(item.get('market', ''))
        if not re.fullmatch(r'[0-9A-Z]{6}', code) or not 0 < len(name) <= 100 \
                or market not in ('KOSPI', 'KOSDAQ') or code in seen:
            raise ValueError('Invalid or duplicate stock directory entry')
        seen.add(code)
        batch.append('(' + ','.join(map(quoted, (code, name, market, day))) + ')')
        if len(batch) >= 30:
            flush()
    flush()
    return statements


def statements(item: dict, run_id: str) -> list[str]:
    code, day = str(item['code']), str(item['day'])
    if not re.fullmatch(r'[0-9A-Z]{6}', code) or not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', day):
        raise ValueError('Invalid symbol/date')
    if item['diagnosis'].get('code') != code or item['diagnosis'].get('asof') != day:
        raise ValueError('Diagnostic key mismatch')
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,80}', run_id):
        raise ValueError('Invalid run id')
    source = str(item['source'])[:120]
    quality = str(item['quality_status'])
    if quality not in ('CORPORATE_ACTION_REVIEW_REQUIRED','UNADJUSTED_RESEARCH_ONLY',
                       'VERIFIED_CORPORATE_ACTION_ADJUSTED'):
        raise ValueError('Unknown quality status')
    chart = item.get('chart')
    if quality == 'VERIFIED_CORPORATE_ACTION_ADJUSTED' and (
        item.get('price_adjusted') is not True or
        not isinstance(chart, dict) or chart.get('price_adjusted') is not True):
        raise ValueError('Corporate action adjustment metadata mismatch')
    if chart is not None:
        bars = chart.get('bars')
        if chart.get('asof') != day or not isinstance(bars,list) or any(
                not isinstance(b,dict) or not isinstance(b.get('t'),str) or b['t'] > day
                for b in bars):
            raise ValueError('Future or invalid chart bars')
    payloads = {col:json.dumps(item.get(field), ensure_ascii=False,
                                separators=(',',':'), allow_nan=False)
                for col,field in (('diagnosis_json','diagnosis'),('chart_json','chart'),('stats_json','stats'))}
    if sum(len(x.encode('utf-8')) for x in payloads.values()) > MAX_ROW_BYTES:
        raise ValueError('Symbol analysis too large for D1')
    where = f'run_id={quoted(run_id)} AND code={quoted(code)} AND day={quoted(day)}'
    result = [f'INSERT INTO blue_symbol_analysis_v1 '
              '(run_id,code,day,source,quality_status,diagnosis_json,chart_json,stats_json) '
              f'VALUES({quoted(run_id)},{quoted(code)},{quoted(day)},{quoted(source)},{quoted(quality)},\'\',\'\',\'\') '
              'ON CONFLICT(run_id,code,day) DO UPDATE SET '
              'source=excluded.source,quality_status=excluded.quality_status,'
              "diagnosis_json='',chart_json='',stats_json='',created_at_utc=CURRENT_TIMESTAMP;"]
    for column, value in payloads.items():
        pos = 0
        while pos < len(value):
            end = min(len(value),pos+12000)
            while end > pos:
                sql = f'UPDATE blue_symbol_analysis_v1 SET {column}={column}||{quoted(value[pos:end])} WHERE {where};'
                if len(sql.encode('utf-8')) <= MAX_STATEMENT_BYTES:
                    break
                end = pos+(end-pos)//2
            if end <= pos:
                raise ValueError('Unable to chunk JSON')
            result.append(sql)
            pos = end
    if any(len(x.encode('utf-8')) > MAX_STATEMENT_BYTES for x in result):
        raise ValueError('D1 SQL statement too large')
    return result


def write_sql(input_path: str, output_path: str, run_id: str,
              directory_path: str | None = None) -> int:
    item = json.loads(Path(input_path).read_text(encoding='utf-8'))
    pieces = statements(item,run_id)
    if directory_path:
        directory = json.loads(Path(directory_path).read_text(encoding='utf-8'))
        if directory.get('asof') != item['day']:
            raise ValueError('Directory and diagnosis dates differ')
        pieces += directory_statements(directory)
    Path(output_path).write_text(SCHEMA+'\n'+'\n'.join(pieces)+'\n',encoding='utf-8')
    return len(pieces)


def append_directory_only(directory_path: str, target_sql: str) -> int:
    """Add a verified-date name index to the existing EOD D1 publication.

    The caller must first complete the EOD validation step. Retain inactive
    historical tickers; never bulk-delete names after an incomplete session.
    """
    directory = json.loads(Path(directory_path).read_text(encoding='utf-8'))
    statements_sql = directory_statements(directory)
    path = Path(target_sql)
    if not path.is_file():
        raise ValueError('Verified EOD SQL must exist before directory append')
    with path.open('a', encoding='utf-8') as stream:
        stream.write('\n' + SCHEMA + '\n' + '\n'.join(statements_sql) + '\n')
    return len(statements_sql)


if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--input')
    p.add_argument('--out')
    p.add_argument('--run-id')
    p.add_argument('--directory',help='As-of full market stock name index (independent table)')
    p.add_argument('--append-to', help='Append only the name directory to verified full-market D1 SQL')
    args=p.parse_args()
    if args.append_to:
        if not args.directory or args.input or args.out or args.run_id:
            p.error('--append-to requires --directory and does not accept diagnostic arguments')
        print('BLUE_SYMBOL_DIRECTORY_SQL', append_directory_only(args.directory,args.append_to))
    else:
        if not args.input or not args.out or not args.run_id:
            p.error('diagnostic mode requires --input, --out and --run-id')
        print('BLUE_SYMBOL_DIAGNOSTIC_SQL',write_sql(args.input,args.out,args.run_id,args.directory))

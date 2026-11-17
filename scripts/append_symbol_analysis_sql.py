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
 ON blue_symbol_analysis_v1(code,day,created_at_utc);'''


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
    if quality not in ('CORPORATE_ACTION_REVIEW_REQUIRED','UNADJUSTED_RESEARCH_ONLY'):
        raise ValueError('Unknown quality status')
    chart = item.get('chart')
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


def write_sql(input_path: str, output_path: str, run_id: str) -> int:
    item = json.loads(Path(input_path).read_text(encoding='utf-8'))
    pieces = statements(item,run_id)
    Path(output_path).write_text(SCHEMA+'\n'+'\n'.join(pieces)+'\n',encoding='utf-8')
    return len(pieces)


if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--input',required=True)
    p.add_argument('--out',required=True)
    p.add_argument('--run-id',required=True)
    args=p.parse_args()
    print('BLUE_SYMBOL_DIAGNOSTIC_SQL',write_sql(args.input,args.out,args.run_id))

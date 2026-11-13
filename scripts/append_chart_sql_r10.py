#!/usr/bin/env python3
"""Append complete EOD chart/evidence JSON as D1-safe small SQL statements.

Do NOT discard any bars, horizons or case histories: the original JSON is
reconstructed byte-for-byte in its existing chart_snapshots columns. Each SQL
statement is small even when a chart or stats JSON exceeds D1's 100KB SQL cap.
"""
import argparse
import json
import re
from pathlib import Path

SCHEMA = '''CREATE TABLE IF NOT EXISTS chart_snapshots (
  run_id TEXT NOT NULL,
  code TEXT NOT NULL,
  day TEXT NOT NULL,
  chart_json TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id,code,day)
);
CREATE INDEX IF NOT EXISTS idx_chart_snapshots_day_code ON chart_snapshots(day,code);'''

# 12,000 Unicode code points can be up to 48KiB of UTF-8 even before quote
# escaping (SQLite SQL-literal quotes double). On pathological all-quote data,
# split further by actual UTF-8 query length instead of assuming ASCII.
MAX_STATEMENT_BYTES = 80000
MAX_ROW_BYTES = 1800000


def quoted(value):
    return "'" + str(value).replace("'", "''") + "'"


def statements_for_item(run_id, item):
    code = str(item['code'])
    day = str(item['day'])
    if not re.fullmatch(r'[0-9A-Z]{6}', code):
        raise ValueError('Invalid chart ticker')
    if not re.fullmatch(r'20\d{2}-\d{2}-\d{2}', day):
        raise ValueError('Invalid chart date')
    chart = json.dumps(item['chart'], ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    stats = json.dumps(item['stats'], ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    if len(chart.encode('utf-8')) + len(stats.encode('utf-8')) > MAX_ROW_BYTES:
        raise ValueError(f'Chart row exceeds safe D1 row size: {code} {day}')
    where = f'run_id={quoted(run_id)} AND code={quoted(code)} AND day={quoted(day)}'
    upsert = (f'INSERT INTO chart_snapshots(run_id,code,day,chart_json,stats_json) '
              f'VALUES({quoted(run_id)},{quoted(code)},{quoted(day)},\'\',\'\') '
              f'ON CONFLICT(run_id,code,day) DO UPDATE SET '
              "chart_json='',stats_json='',created_at=CURRENT_TIMESTAMP;")
    yield upsert
    for column, value in (('chart_json', chart), ('stats_json', stats)):
        pos = 0
        while pos < len(value):
            hi = min(len(value), pos + 12000)
            statement = None
            while hi > pos:
                piece = value[pos:hi]
                statement = f'UPDATE chart_snapshots SET {column}={column}||{quoted(piece)} WHERE {where};'
                if len(statement.encode('utf-8')) <= MAX_STATEMENT_BYTES:
                    break
                hi = pos + (hi - pos) // 2
            if hi <= pos or statement is None:
                raise ValueError('Could not make a safe SQL chunk')
            yield statement
            pos = hi


def append(src, sql, run_id):
    if not re.fullmatch(r'[A-Za-z0-9._-]{1,80}', run_id):
        raise ValueError('Invalid run_id')
    inp, target = Path(src), Path(sql)
    rows, seen, statement_count = [], set(), 0
    for line in inp.read_text(encoding='utf-8').splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        key = item['code'], item['day']
        if key in seen:
            raise ValueError('duplicate symbol/day')
        seen.add(key)
        pieces = list(statements_for_item(run_id, item))
        if any(len(s.encode('utf-8')) > MAX_STATEMENT_BYTES for s in pieces):
            raise ValueError('D1 SQL statement unexpectedly exceeded 80KB')
        rows.extend(pieces)
        statement_count += len(pieces)
    # Build and validate the entire import before touching the caller's SQL file.
    with target.open('a', encoding='utf-8') as stream:
        stream.write('\n' + SCHEMA + '\n')
        stream.write('\n'.join(rows) + '\n')
    print('BLUE_EOD_D1_SAFE_CHUNKS', 'snapshots=', len(seen), 'statements=', statement_count)
    return len(seen)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--input', required=True)
    p.add_argument('--sql', required=True)
    p.add_argument('--run-id', required=True)
    a = p.parse_args()
    print('CHART SNAPSHOTS ADDED', append(a.input, a.sql, a.run_id))

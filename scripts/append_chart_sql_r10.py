#!/usr/bin/env python3
"""Append matched-symbol as-of charts/conditional evidence to existing D1 import SQL.
Each snapshot is a single compact D1 row, not thousands of duplicate price writes.
"""
import argparse,json,re
from pathlib import Path

SCHEMA='''CREATE TABLE IF NOT EXISTS chart_snapshots (
  run_id TEXT NOT NULL,
  code TEXT NOT NULL,
  day TEXT NOT NULL,
  chart_json TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id,code,day)
);
CREATE INDEX IF NOT EXISTS idx_chart_snapshots_day_code ON chart_snapshots(day,code);'''


def quoted(x):return "'"+str(x).replace("'","''")+"'"

def append(src,sql,run_id):
    if not re.fullmatch('[A-Za-z0-9._-]{1,80}',run_id):raise ValueError('Invalid run_id')
    inp=Path(src);target=Path(sql)
    rows=[];seen=set()
    for line in inp.read_text(encoding='utf-8').splitlines():
        if not line.strip():continue
        item=json.loads(line)
        key=(item['code'],item['day'])
        if key in seen:raise ValueError('duplicate symbol/day')
        seen.add(key)
        values=[quoted(run_id),quoted(item['code']),quoted(item['day']),
                quoted(json.dumps(item['chart'],ensure_ascii=False,separators=(',',':'))),
                quoted(json.dumps(item['stats'],ensure_ascii=False,separators=(',',':')))]
        q='INSERT INTO chart_snapshots(run_id,code,day,chart_json,stats_json) VALUES('+','.join(values)+') ON CONFLICT(run_id,code,day) DO UPDATE SET chart_json=excluded.chart_json, stats_json=excluded.stats_json, created_at=CURRENT_TIMESTAMP;'
        if len(q.encode('utf-8'))>90000:raise ValueError('Chart SQL statement too large for D1 100KB limit')
        rows.append(q)
    # No historical rows lost; older run IDs are retained, selected via current run.
    with target.open('a',encoding='utf-8') as f:
        f.write('\n'+SCHEMA+'\n')
        f.write('\n'.join(rows)+'\n')
    return len(rows)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--sql',required=True);p.add_argument('--run-id',required=True)
    a=p.parse_args(); print('CHART SNAPSHOTS ADDED',append(a.input,a.sql,a.run_id))

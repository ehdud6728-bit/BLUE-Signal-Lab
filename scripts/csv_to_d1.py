#!/usr/bin/env python3
"""Offline D1 SQL import builder for BLUE Signal Lab R0.3 outputs.
No network; never changes Stock-Hunter repo. Import output via wrangler d1 execute.
"""
import argparse,csv,json,re,sqlite3,hashlib
from pathlib import Path
from datetime import datetime,timezone

FIELDS=('code','date','signals','close','distance_to_nearest_supply_pct')
def q(value):
    if value is None:return 'NULL'
    return "'"+str(value).replace("'","''")+"'"
def numeric(v):
    if v is None or str(v).strip().lower() in ('','nan','none','null'):return 'NULL'
    n=float(v)
    import math
    if not math.isfinite(n):return 'NULL'
    return repr(n)
def iso_date(s):
    try:
        return datetime.strptime(s,'%Y-%m-%d').date().isoformat()
    except ValueError: raise ValueError('Invalid ISO date: '+repr(s))
def export(src,out,run_id,source,is_demo=False):
    src,out=Path(src),Path(out)
    with (src/'signals.csv').open(newline='',encoding='utf-8-sig') as f:rows=list(csv.DictReader(f))
    with (src/'daily_counts.csv').open(newline='',encoding='utf-8-sig') as f:counts=list(csv.DictReader(f))
    if not re.fullmatch('[A-Za-z0-9._-]{1,80}',run_id):raise ValueError('Invalid run_id')
    if rows and not set(FIELDS).issubset(rows[0]):raise ValueError('R0.3 signals.csv columns mismatch')
    if counts and not {'date','observed_stocks','signal_events','matched_stocks'}.issubset(counts[0]):raise ValueError('R0.3 daily_counts.csv columns mismatch')
    all_dates=[iso_date(r['date']) for r in rows+counts]
    latest=max(all_dates) if all_dates else None
    data=['BEGIN TRANSACTION;',f'DELETE FROM signals WHERE run_id={q(run_id)};',f'DELETE FROM daily_counts WHERE run_id={q(run_id)};',f'DELETE FROM runs WHERE run_id={q(run_id)};']
    data.append('INSERT INTO runs(run_id,created_at,source,latest_price_date,notes,is_demo) VALUES('+','.join([q(run_id),q(datetime.now(timezone.utc).isoformat()),q(source),q(latest),q('R0.3 CSV import; historical signal results, not live market data'),str(int(is_demo))])+');')
    seen=set()
    for r in rows:
        d=iso_date(r['date']);key=(r['code'],d)
        if key in seen:raise ValueError('Duplicate code/day, refusing silent overwrite: '+str(key))
        seen.add(key)
        names=','.join(sorted(set(s.strip().upper() for s in r['signals'].split(',') if s.strip())))
        extras={k:v for k,v in r.items() if k not in FIELDS and v is not None}
        values=[q(run_id),q(r['code']),q(d),q(names),numeric(r['close']),numeric(r['distance_to_nearest_supply_pct']),q(json.dumps(extras,ensure_ascii=False,separators=(',',':')))]
        data.append('INSERT INTO signals(run_id,code,day,signal_names,close_price,supply_distance_pct,extras_json) VALUES('+','.join(values)+');')
    seen_dates=set()
    for r in counts:
        d=iso_date(r['date'])
        if d in seen_dates:raise ValueError('Duplicate daily date: '+d)
        seen_dates.add(d)
        values=[q(run_id),q(d)]+[str(int(r[k])) for k in ('observed_stocks','signal_events','matched_stocks')]
        data.append('INSERT INTO daily_counts(run_id,day,observed_stocks,signal_events,matched_stocks) VALUES('+','.join(values)+');')
    data.append('COMMIT;')
    out.parent.mkdir(parents=True,exist_ok=True);out.write_text('\n'.join(data)+'\n',encoding='utf-8')
    return {'run_id':run_id,'signal_rows':len(rows),'days':len(counts),'latest_date':latest,'sql_bytes':out.stat().st_size,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--input-dir',required=True);a.add_argument('--out',required=True);a.add_argument('--run-id',required=True);a.add_argument('--source',required=True);a.add_argument('--demo',action='store_true');p=a.parse_args()
    print(json.dumps(export(p.input_dir,p.out,p.run_id,p.source,p.demo),ensure_ascii=False,indent=2))

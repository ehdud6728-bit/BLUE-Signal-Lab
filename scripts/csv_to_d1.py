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
def pattern_highlights(src):
    """Provenance-backed in-sample pattern metrics and actual historical signal dates.

    No 70% cut-off is imposed here: the display threshold is configurable.
    n>=3 is the analysis minimum; n<8 must be clearly labelled low-support.
    The dates are ONLY those of
    matured cases emitted by chart_research_r10, never the current search date.
    """
    path=Path(src)/'chart_snapshots.jsonl'
    if not path.is_file():return {}
    found={}
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.strip():continue
        item=json.loads(line)
        candidates=[]
        for setup in item.get('stats',{}).get('setups',[]):
            h=setup.get('horizons',{}).get('10',{})
            n=h.get('n',0);up=h.get('up_pct')
            if not isinstance(n,int) or n<3 or not isinstance(up,(int,float)) or not 0<=up<=100:
                continue
            median=h.get('median_return_pct')
            mean=h.get('mean_return_pct')
            candidates.append((float(up),float(median) if isinstance(median,(int,float)) else -10000,
                               float(mean) if isinstance(mean,(int,float)) else -10000,
                               n,str(setup.get('label','')),h.get('cases',[])))
        if not candidates:continue
        p,med,avg,n,label,cases=max(candidates,key=lambda x:x[:4])
        evidence={
            'r159_pattern_up_10d':p,'r159_pattern_n_10d':n,
            'r159_pattern_median_10d':None if med==-10000 else med,
            'r159_pattern_mean_10d':None if avg==-10000 else avg,
            'r159_pattern_label_10d':label[:150]}
        day=item.get('day','')
        valid=[]
        if isinstance(cases,list):
            for case in cases[-12:]:
                if not isinstance(case,dict):continue
                d=case.get('signal_day')
                if isinstance(d,str) and re.fullmatch(r'20\d{2}-\d{2}-\d{2}',d) and d<=day:
                    valid.append(d)
        evidence['r159_pattern_signal_days_10d_json']=json.dumps(sorted(set(valid))[-12:],ensure_ascii=False,separators=(',',':'))
        found[(item['code'],day)]=evidence
    return found


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
    highlighted=pattern_highlights(src)
    for r in rows:
        d=iso_date(r['date']);key=(r['code'],d)
        if key in seen:raise ValueError('Duplicate code/day, refusing silent overwrite: '+str(key))
        seen.add(key)
        names=','.join(sorted(set(s.strip().upper() for s in r['signals'].split(',') if s.strip())))
        extras={k:v for k,v in r.items() if k not in FIELDS and v is not None}
        extras.update(highlighted.get((r['code'],d),{}))
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

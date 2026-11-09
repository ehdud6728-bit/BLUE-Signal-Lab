"""R0.3: single-date or multi-date BLUE candidate search with reusable indicators.
Inputs are user supplied historical OHLCV. No live market downloader, no writes to original repo.
"""
from __future__ import annotations
import argparse
import html
import json
from pathlib import Path
import time
import pandas as pd
from engine import read_prices, run

SIGNALS=('BB20','BB30','BB40','ENV20','ENV40')

def select_window(prices, *, date=None, start=None, end=None, latest=False):
    """Return (start,end,mode,observed_days), rejecting ambiguous selections.

    A named single date must be a trading date in supplied file, not nearest day.
    A range includes only observed dates; does not fabricate holidays.
    """
    selected = int(date is not None)+int(latest)+int(start is not None or end is not None)
    if selected != 1:
        raise ValueError('Choose exactly one: --date YYYY-MM-DD, --latest, or --start AND --end')
    if prices.empty: raise ValueError('No price rows')
    days=pd.DatetimeIndex(prices.date.unique()).sort_values()
    if latest:
        d=days[-1];return d,d,'latest',[d]
    if date is not None:
        d=pd.Timestamp(date).normalize()
        if d not in days:
            raise ValueError(f'No OHLCV records for {d.date()} (holiday, trading halt or missing dataset). No nearest-day substitution.')
        return d,d,'single',[d]
    if not start or not end: raise ValueError('Both --start and --end are required for range search')
    a=pd.Timestamp(start).normalize();b=pd.Timestamp(end).normalize()
    if a>b:raise ValueError('Start date must be <= end date')
    listed=list(days[(days>=a)&(days<=b)])
    if not listed:raise ValueError('No observed trading dates in specified range')
    return a,b,'range',listed

def search(prices, *, date=None,start=None,end=None,latest=False, signals=SIGNALS,require='any',profile_days=120):
    a,b,mode,observed=select_window(prices,date=date,start=start,end=end,latest=latest)
    signals=tuple(dict.fromkeys(signals))
    if not signals or set(signals)-set(SIGNALS):
        raise ValueError('Select one or more valid signals: '+','.join(SIGNALS))
    # Restrict source rows to as-of final search day before indicator calculations.
    # This also makes accidental future-dependent research code easier to detect.
    eligible=prices.loc[prices.date<=b].copy()
    result=run(eligible,a,b,signals=signals,require=require,profile_days=profile_days)
    if result.empty:
        result=pd.DataFrame(columns=['code','date','signals','close','distance_to_nearest_supply_pct'])
    result=result.sort_values(['date','code'],kind='stable').reset_index(drop=True)
    counts=result.groupby('date').agg(candidates=('code','size'),stocks=('code','nunique')).to_dict('index') if len(result) else {}
    daily=pd.DataFrame([{'date':d.strftime('%Y-%m-%d'),'observed_stocks':int(eligible.loc[eligible.date==d,'code'].nunique()),'signal_events':int(counts.get(d.strftime('%Y-%m-%d'),{}).get('candidates',0)),'matched_stocks':int(counts.get(d.strftime('%Y-%m-%d'),{}).get('stocks',0))} for d in observed])
    return result,daily,{'mode':mode,'requested_start':a.strftime('%Y-%m-%d'),'requested_end':b.strftime('%Y-%m-%d'),'observed_dates':len(observed),'signals':list(signals),'require':require,'profile_days':profile_days,'signal_events':len(result),'distinct_stocks':int(result.code.nunique()) if len(result) else 0,'market_data_latest':prices.date.max().strftime('%Y-%m-%d'),'market_data_source':'supplied input OHLCV, NOT real-time KRX'}

def make_html(results, daily, meta, path):
    """Self-contained browser report. Sort and filter on already computed results."""
    rows=[]
    for r in results.itertuples(index=False):
        d=r._asdict()
        def val(k):
            x=d.get(k)
            return '' if pd.isna(x) else str(round(float(x),3)) if isinstance(x,(int,float)) else str(x)
        rows.append({'date':val('date'),'code':val('code'),'signals':val('signals'), 'close':val('close'), 'rsi14':val('rsi14'), 'supply_gap':val('distance_to_nearest_supply_pct'), 'supply_strength':val('supply_zone_strength'), 'slow_gc':val('SLOW_14_3_3_GC')})
    payload=json.dumps(rows,ensure_ascii=False,allow_nan=False).replace('<','\\u003c')
    days=json.dumps(daily.to_dict('records'),ensure_ascii=False,allow_nan=False).replace('<','\\u003c')
    title=html.escape(f"BLUE Signal Lab R0.3 | {meta['requested_start']} ~ {meta['requested_end']}")
    doc='''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>__TITLE__</title>
<style>body{font-family:system-ui,sans-serif;max-width:1220px;margin:24px auto;padding:0 18px;color:#172b4d;background:#f8fafc}h1{color:#164d9e}.sub{color:#64748b}.controls{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}.controls label{display:grid;gap:4px;font-size:13px}input,select{font:inherit;padding:9px;border:1px solid #cbd5e1;border-radius:7px;background:white}table{border-collapse:collapse;width:100%;background:white;font-size:13px}td,th{padding:10px;border-bottom:1px solid #e2e8f0;text-align:right}th:first-child,td:first-child,th:nth-child(2),td:nth-child(2),th:nth-child(3),td:nth-child(3){text-align:left}th{background:#eaf2ff;position:sticky;top:0}.scroll{overflow:auto;max-height:70vh;border:1px solid #e2e8f0;border-radius:10px}section{margin-top:25px} .note{background:#fff7ed;padding:12px;border-radius:9px;font-size:13px}.n{font-weight:700}</style>
<h1>BLUE Signal Lab <small>R0.3</small></h1><p class="sub">__TITLE__ · RESEARCH ONLY · 입력한 OHLCV 파일 기준</p><p class="note">이 보고서는 실행 당시 검색 결과를 표시합니다. 브라우저 필터는 다시 계산하거나 실시간으로 시세를 조회하지 않습니다. 매물대는 일봉 기반 추정치입니다.</p>
<div class="controls"><label>날짜<select id="date"><option value="">전체 날짜</option></select></label><label>종목코드<input id="code" placeholder="예: 005930"></label><label>신호<select id="signal"><option value="">전체 신호</option><option>BB20</option><option>BB30</option><option>BB40</option><option>ENV20</option><option>ENV40</option></select></label></div><p id="count" class="n"></p>
<div class="scroll"><table><thead><tr><th>날짜</th><th>종목</th><th>BLUE 신호</th><th>종가</th><th>RSI14</th><th>상단 매물대까지 %</th><th>매물대 강도</th><th>Slow GC(14,3,3)</th></tr></thead><tbody id="rows"></tbody></table></div>
<section><h2>일자별 검색 요약</h2><div class="scroll"><table><thead><tr><th>날짜</th><th>시세 있는 종목</th><th>신호 건수</th><th>검색된 종목</th></tr></thead><tbody id="days"></tbody></table></div></section>
<script>const rows=__ROWS__;const days=__DAYS__;const dat=document.querySelector('#date'), code=document.querySelector('#code'),sig=document.querySelector('#signal');for(const d of days){const o=document.createElement('option');o.value=d.date;o.textContent=d.date;dat.appendChild(o)};
const safe=x=>String(x??'');const tr=(a)=>{const tr=document.createElement('tr');for(const v of a){const td=document.createElement('td');td.textContent=safe(v);tr.appendChild(td)}return tr};for(const d of days)document.querySelector('#days').appendChild(tr([d.date,d.observed_stocks,d.signal_events,d.matched_stocks]));function refresh(){const view=rows.filter(r=>(!dat.value||r.date===dat.value)&&(!code.value||r.code.includes(code.value.trim()))&&(!sig.value||r.signals.split('|').includes(sig.value)));const tbody=document.querySelector('#rows');tbody.replaceChildren();for(const r of view.slice(0,3000))tbody.appendChild(tr([r.date,r.code,r.signals,r.close,r.rsi14,r.supply_gap,r.supply_strength,r.slow_gc]));document.querySelector('#count').textContent=view.length+'건'+(view.length>3000?' (화면에는 앞 3,000건만 표시)':'');}for(const el of [dat,code,sig])el.addEventListener('input',refresh);refresh();</script></html>'''
    doc=doc.replace('__TITLE__',title).replace('__ROWS__',payload).replace('__DAYS__',days)
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True);p.write_text(doc,encoding='utf-8');return p

def main(argv=None):
    ap=argparse.ArgumentParser(description='BLUE Signal Lab R0.3 date/range scanner')
    ap.add_argument('--prices',required=True)
    group=ap.add_mutually_exclusive_group(required=True)
    group.add_argument('--date',help='Historical single day, exact YYYY-MM-DD')
    group.add_argument('--latest',action='store_true',help='Latest observed date in supplied file')
    group.add_argument('--start',help='Inclusive range start YYYY-MM-DD (requires --end)')
    ap.add_argument('--end',help='Inclusive range end')
    ap.add_argument('--signals',default=','.join(SIGNALS))
    ap.add_argument('--require',choices=['any','all'],default='any')
    ap.add_argument('--profile-days',type=int,default=120)
    ap.add_argument('--outdir',default='blue_r03_results')
    args=ap.parse_args(argv)
    if bool(args.start)!=bool(args.end):ap.error('For range search specify --start AND --end')
    if args.end and not args.start:ap.error('--end only valid with --start')
    source=read_prices(args.prices)
    t=time.perf_counter()
    try:
        result,daily,meta=search(source,date=args.date,latest=args.latest,start=args.start,end=args.end,signals=args.signals.split(','),require=args.require,profile_days=args.profile_days)
    except ValueError as e:ap.error(str(e))
    meta['elapsed_seconds']=round(time.perf_counter()-t,3)
    out=Path(args.outdir);out.mkdir(parents=True,exist_ok=True)
    result.to_csv(out/'signals.csv',index=False)
    daily.to_csv(out/'daily_counts.csv',index=False)
    (out/'run_metadata.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
    make_html(result,daily,meta,out/'search_report.html')
    print(f"{meta['mode']}: {meta['requested_start']}..{meta['requested_end']} | days={len(daily)}, signals={len(result)}, stocks={meta['distinct_stocks']} | {meta['elapsed_seconds']}s")
    print(out.resolve())
if __name__=='__main__':main()

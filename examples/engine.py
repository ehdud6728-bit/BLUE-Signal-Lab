"""BLUE Signal Lab R0: standalone read-only research scanner.

References: Stock-Hunter blue20_effective_lines_research and
blue20_threeway_audit. Never writes to Stock-Hunter production paths.
Requires pandas/numpy; user provides dated OHLCV prices (no fabricated prices).
"""
from __future__ import annotations
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
from volume_profile import build_profile, profile_metrics

BANDS=(20,30,40)
VARIANTS=((2.0,26),(1.8,20))
HORIZONS=(5,10,20,40,60)
STOCH_CONFIGS=((14,3,3),(12,5,5),(20,12,12))

def read_prices(path):
    p=Path(path)
    if p.suffix=='.parquet': d=pd.read_parquet(p)
    else: d=pd.read_csv(p,dtype={'code':str})
    needed={'date','code','open','high','low','close','volume'}
    if needed-set(d.columns): raise ValueError('Missing required columns '+str(sorted(needed-set(d.columns))))
    d=d.copy();d['code']=d.code.astype(str).str.replace(r'\.0$','',regex=True).str.zfill(6)
    d['date']=pd.to_datetime(d.date).dt.normalize()
    if d[['code','date']].duplicated().any(): raise ValueError('Duplicate code/date')
    for k in ['open','high','low','close','volume']:
        d[k]=pd.to_numeric(d[k],errors='raise')
    if 'amount' in d.columns: d['amount']=pd.to_numeric(d.amount,errors='coerce')
    else: d['amount']=np.nan
    if not np.isfinite(d[['open','high','low','close','volume']].to_numpy()).all():raise ValueError('Nonfinite OHLCV')
    if (d[['open','high','low','close']]<=0).any().any() or (d.volume<0).any():raise ValueError('Invalid price/volume')
    if (d.high<d[['open','close','low']].max(axis=1)).any() or (d.low>d[['open','close','high']].min(axis=1)).any():raise ValueError('Invalid OHLC geometry')
    return d.sort_values(['code','date']).reset_index(drop=True)

def body_class(o,h,c,line):
    if not np.isfinite(line) or c<=o or h<=line:return 'NONE'
    if o>=line:return 'GAP_ABOVE'
    if c<=line:return 'WICK_ONLY'
    body=c-o
    if (line-o)/body>=.2 and (c-line)/body>=.2 and 100*body/o>=.5:return 'CLEAR_BODY'
    return 'MICRO_BODY'

def slow_stochastic(g, period=14, k_smooth=3, d_smooth=3):
    """Match Stock-Hunter blue20_effective_lines_research/vendor/multifactor.py."""
    lo=g.low.rolling(period,min_periods=period).min()
    hi=g.high.rolling(period,min_periods=period).max()
    span=hi-lo
    fast=(100*(g.close-lo)/span).where(span.ne(0),50.0).clip(0,100)
    fast=fast.where(lo.notna())
    slowk=fast.rolling(k_smooth,min_periods=k_smooth).mean()
    slowd=slowk.rolling(d_smooth,min_periods=d_smooth).mean()
    cross=(slowk.shift(1).le(slowd.shift(1)) & slowk.gt(slowd) & slowd.shift(1).notna()).fillna(False)
    return slowk,slowd,cross

def add_indicators(g):
    g=g.copy().sort_values('date').reset_index(drop=True)
    c=g.close
    for n in (5,20,30,40,60,112,120,224):g[f'MA{n}']=c.rolling(n,min_periods=n).mean()
    for n in BANDS:
        mean=c.rolling(n,min_periods=n).mean();std=c.rolling(n,min_periods=n).std(ddof=0)
        for mult,shift in VARIANTS:
            tag=f'BB{n}_K{str(mult).replace(".","p")}_S{shift}'
            g[tag+'_UPPER']=(mean+mult*std).shift(shift)
            g[tag+'_LOWER']=(mean-mult*std).shift(shift)
            g[tag+'_MID']=mean.shift(shift)
    for n in (20,40):
        g[f'ENV{n}_MID']=g[f'MA{n}']
        g[f'ENV{n}_UPPER']=g[f'MA{n}']*1.1
        g[f'ENV{n}_LOWER']=g[f'MA{n}']*.9
    # Wilder RSI14 with SMA9 signal, using an EWM seeded from the first 14 gains/losses.
    delta=c.diff();gain=delta.clip(lower=0);loss=(-delta).clip(lower=0)
    def wilder(x,n=14):
        out=np.full(len(x),np.nan);v=x.to_numpy(dtype=float)
        if len(v)<=n:return pd.Series(out,index=x.index)
        avg=np.nanmean(v[1:n+1]);out[n]=avg
        for k in range(n+1,len(v)):
            avg=(avg*(n-1)+v[k])/n;out[k]=avg
        return pd.Series(out,index=x.index)
    ag=wilder(gain);al=wilder(loss);rs=ag/al.replace(0,np.nan)
    g['RSI14']=100-100/(1+rs)
    g.loc[(al==0)&(ag>0),'RSI14']=100
    g.loc[(al==0)&(ag==0),'RSI14']=50
    g['RSI_SIGNAL9']=g.RSI14.rolling(9,min_periods=9).mean()
    ema12=c.ewm(span=12,adjust=False).mean();ema26=c.ewm(span=26,adjust=False).mean()
    g['MACD']=ema12-ema26;g['MACD_SIGNAL']=g.MACD.ewm(span=9,adjust=False).mean();g['MACD_HIST']=g.MACD-g.MACD_SIGNAL
    for period,ks,ds in STOCH_CONFIGS:
        tag=f'SLOW_{period}_{ks}_{ds}'
        g[tag+'_K'],g[tag+'_D'],g[tag+'_GC']=slow_stochastic(g,period,ks,ds)
    g['VOLUME_RATIO20']=g.volume/g.volume.shift(1).rolling(20,min_periods=20).mean().replace(0,np.nan)
    for n in (20,60,120,224):g[f'PRIOR_HIGH{n}']=g.high.shift(1).rolling(n,min_periods=n).max()
    line_cols=[col for col in g if col.endswith(('_UPPER','_LOWER','_MID')) and (col.startswith(('BB','ENV')))]
    for col in line_cols:
        g[f'DIST_{col}_PCT']=100*(c/g[col]-1)
    for n in (20,60,112,224):g[f'DIST_MA{n}_PCT']=100*(c/g[f'MA{n}']-1)
    return g

def profile_above(g,idx,lookback=120,bins=48):
    """Legacy columns maintained plus R0.2 volume profile features."""
    profile=build_profile(g,idx,lookback,bins)
    result=profile_metrics(profile)
    result.update(vp_above_pct=profile['distance_to_supply_pct'],
                  vp_upper_zone_volume_share=profile['upper_volume_share'])
    return result

def scan_one(g,start,end,signals=None,require='any',profile_days=120):
    signals=set(signals or ['BB20','BB30','BB40','ENV20','ENV40'])
    output=[];c=g.close
    for i in range(len(g)):
        r=g.iloc[i];dt=r.date
        if dt<pd.Timestamp(start) or dt>pd.Timestamp(end):continue
        labels=[];details=[]
        for n in BANDS:
            if f'BB{n}' not in signals:continue
            for k,s in VARIANTS:
                tag=f'BB{n}_K{str(k).replace(".","p")}_S{s}'
                for side in ('UPPER','LOWER'):
                    col=f'{tag}_{side}';v=r[col]
                    if i<1 or not np.isfinite(v):continue
                    prevline=g[col].iloc[i-1];prevclose=c.iloc[i-1]
                    # original shifted-line precondition: line falling, previous close <= previous line
                    if not np.isfinite(prevline) or not (v<prevline and prevclose<=prevline):continue
                    cls=body_class(float(r.open),float(r.high),float(r.close),float(v))
                    if cls=='CLEAR_BODY':
                        labels.append(f'BB{n}');details.append(f'{col}:CLEAR_BODY')
        for n in (20,40):
            if f'ENV{n}' not in signals or i<1:continue
            col=f'ENV{n}_MID';line=r[col];prev=g[col].iloc[i-1]
            if np.isfinite(line) and np.isfinite(prev) and c.iloc[i-1]<=prev and body_class(float(r.open),float(r.high),float(r.close),float(line))=='CLEAR_BODY':
                labels.append(f'ENV{n}');details.append(f'{col}:CLEAR_BODY')
        matched=set(labels)
        if not matched or (require=='all' and matched!=signals):continue
        p=profile_above(g,i,profile_days)
        record=dict(code=r.code,date=dt.strftime('%Y-%m-%d'),signals='|'.join(sorted(matched)),signal_detail='|'.join(details),close=float(r.close),volume=float(r.volume),volume_ratio20=r.VOLUME_RATIO20,rsi14=r.RSI14,macd_hist=r.MACD_HIST,**p)
        for period,ks,ds in STOCH_CONFIGS:
            tag=f'SLOW_{period}_{ks}_{ds}'
            record[tag+'_K']=r[tag+'_K']
            record[tag+'_D']=r[tag+'_D']
            record[tag+'_GC']=bool(r[tag+'_GC'])
            record[tag+'_BULL']=bool(pd.notna(r[tag+'_K']) and pd.notna(r[tag+'_D']) and r[tag+'_K']>r[tag+'_D'])
        for n in (20,60,120,224):
            h=r[f'PRIOR_HIGH{n}'];record[f'prior_high{n}']=h;record[f'gap_to_prior_high{n}_pct']=100*(h/r.close-1) if pd.notna(h) else np.nan
        for n in (20,40,60,112,224):
            m=r.get(f'MA{n}',np.nan);record[f'ma{n}_dist_pct']=100*(r.close/m-1) if pd.notna(m) else np.nan
        for n in (20,30,40):
            for k,s in VARIANTS:
                tag=f'BB{n}_K{str(k).replace(".","p")}_S{s}'
                record[f'{tag}_UPPER_dist_pct']=r[f'DIST_{tag}_UPPER_PCT']
        for n in (20,40):record[f'env{n}_mid_dist_pct']=r[f'DIST_ENV{n}_MID_PCT']
        output.append(record)
    return output

def run(data,start,end,signals=None,require='any',profile_days=120):
    if pd.Timestamp(start)>pd.Timestamp(end):raise ValueError('start after end')
    if require not in ('any','all'):raise ValueError('require must be any or all')
    if profile_days<20:raise ValueError('profile_days must be >=20')
    out=[]
    for _,g in data.groupby('code',sort=False):
        g=add_indicators(g);out.extend(scan_one(g,start,end,signals,require,profile_days))
    return pd.DataFrame(out)

def forward_diagnostics(data,results,horizons=HORIZONS):
    """Post-signal descriptive labels ONLY; never input to run(). No entry fill assumptions."""
    out=results.copy()
    if out.empty:return out
    groups={code:g.sort_values('date').reset_index(drop=True) for code,g in data.groupby('code')}
    for h in horizons:
        out[f'fwd_close_{h}d_pct']=np.nan;out[f'fwd_status_{h}d']='RIGHT_CENSORED'
    for i,r in out.iterrows():
        g=groups[r.code];pos=g.index[g.date==pd.Timestamp(r.date)]
        if len(pos)!=1:continue
        j=int(pos[0]);p=float(g.close.iloc[j])
        for h in horizons:
            if j+h<len(g):
                out.at[i,f'fwd_close_{h}d_pct']=100*(float(g.close.iloc[j+h])/p-1)
                out.at[i,f'fwd_status_{h}d']='OBSERVED_ROW_COUNT_NOT_VERIFIED_CALENDAR'
    return out

def main():
    a=argparse.ArgumentParser(description='BLUE Signal Lab R0.2 research-only scan')
    a.add_argument('--prices',required=True);a.add_argument('--start');a.add_argument('--end')
    a.add_argument('--today',action='store_true',help='Use latest date present in input (not wall clock)')
    a.add_argument('--signals',default='BB20,BB30,BB40,ENV20,ENV40')
    a.add_argument('--require',choices=['any','all'],default='any');a.add_argument('--profile-days',type=int,default=120)
    a.add_argument('--out',default='blue_signal_lab_results.csv');a.add_argument('--diagnostics',action='store_true')
    args=a.parse_args();d=read_prices(args.prices)
    if args.today:
        end=d.date.max().strftime('%Y-%m-%d');start=end
    else:
        if not args.start or not args.end:a.error('Provide --start and --end, or --today')
        start,end=args.start,args.end
    r=run(d,start,end,[s.strip() for s in args.signals.split(',') if s.strip()],args.require,args.profile_days)
    if args.diagnostics:r=forward_diagnostics(d,r)
    out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True);r.to_csv(out,index=False)
    print(f'Signals: {len(r)}  period={start}..{end}  output={out}')
if __name__=='__main__':main()

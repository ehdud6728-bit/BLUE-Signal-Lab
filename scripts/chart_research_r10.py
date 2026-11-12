#!/usr/bin/env python3
"""BLUE R1.0 multi-factor evidence + truthful EOD OHLCV charts.

Exploratory stock-specific event study, NOT an optimized trading strategy.
No future bars beyond asof, no fixed hand-picked winning patterns, no forecast
without adequate samples, no claims about industry leaders without sector data.
Existing BLUE scan criteria are untouched.
"""
from __future__ import annotations

from itertools import combinations
import json
from pathlib import Path
import numpy as np
import pandas as pd
from market_scan import normalise, enrich

HORIZONS = (5, 10, 20)
COOLDOWN = 10
MIN_SUPPORT = 8
MAX_ANCHORS = 6
MAX_CONTEXT = 9
LABELS = {
 'BB20':'BLUE20 기본 상단 돌파','BB30':'BLUE30 기본 상단 돌파','BB40':'BLUE40 기본 상단 돌파',
 'BB20_ALT':'BLUE20 대체 상단 돌파','BB30_ALT':'BLUE30 대체 상단 돌파','BB40_ALT':'BLUE40 대체 상단 돌파',
 'BB20_LOWER':'BLUE20 기본 하단선 돌파','BB30_LOWER':'BLUE30 기본 하단선 돌파','BB40_LOWER':'BLUE40 기본 하단선 돌파',
 'BB20_LOWER_ALT':'BLUE20 대체 하단선 돌파','BB30_LOWER_ALT':'BLUE30 대체 하단선 돌파','BB40_LOWER_ALT':'BLUE40 대체 하단선 돌파',
 'ENV20_UP':'ENV20 중심선 상향 돌파','ENV40_UP':'ENV40 중심선 상향 돌파',
 'ENV20_DOWN':'ENV20 중심선 하향 이탈','ENV40_DOWN':'ENV40 중심선 하향 이탈',
 'RSI_GC':'RSI 골든크로스','RSI_DC':'RSI 데드크로스',
 'SLOW_14_GC':'Slow(14,3,3) 골든크로스','SLOW_14_DC':'Slow(14,3,3) 데드크로스',
 'SLOW_12_GC':'Slow(12,5,5) 골든크로스','SLOW_20_GC':'Slow(20,12,12) 골든크로스',
 'MACD_GC':'MACD 골든크로스','MACD_DC':'MACD 데드크로스',
 'HIGH20_BREAK':'직전 20일 고점 돌파',
 'MA_UP':'정배열 (MA20>MA40>MA60)','MA_DOWN':'역배열 (MA20<MA40<MA60)',
 'MA_TO_UP':'정배열 전환 (전일 미정배열 → 당일 정배열)',
 'MA112_CROSS':'112일 이동평균선 종가 상향 돌파',
 'MA224_CROSS':'224일 이동평균선 종가 상향 돌파',
 'CLOSE_ABOVE_MA20':'종가 20일선 위','CLOSE_BELOW_MA20':'종가 20일선 아래',
 'MA20_RISING':'20일선 상승 중','MA20_FALLING':'20일선 하락 중',
 'RSI_ABOVE50':'RSI 50 이상','RSI_BELOW40':'RSI 40 미만','RSI_OVER70':'RSI 70 이상',
 'SLOW_BULL':'Slow(14,3,3) %K > %D','SLOW_OVERSOLD':'Slow %K 20 이하',
 'MACD_POSITIVE':'MACD 0 이상','MACD_HIST_RISING':'MACD 히스토그램 개선',
 'VOLUME_SURGE':'거래량 20일 평균 1.5배 이상','VOLUME_QUIET':'거래량 20일 평균 0.7배 이하',
 'AMOUNT_SURGE':'거래대금 20일 평균 1.5배 이상','NEAR_SUPPLY':'추정 상단 매물대 3% 이내',
 'STRONG_SUPPLY':'상단 매물대 상대 강도 70% 이상','VOLATILITY_HIGH':'20일 변동성 확대',
 'BASELINE':'단순 거래일 기준선(10일 간격)',
}


def fnum(x, nd=3):
    try:
        z=float(x)
        return round(z,nd) if np.isfinite(z) else None
    except (ValueError,TypeError):
        return None


def _supply_features(d):
    """Historical *proxy* of daily typical-price/volume, not true volume-at-price.
    All price/volume observations strictly earlier than signal date.
    """
    n=len(d);distance=np.full(n,np.nan);relative=np.full(n,np.nan)
    hi=d.high.to_numpy(dtype=float);lo=d.low.to_numpy(dtype=float)
    cl=d.close.to_numpy(dtype=float);vol=d.volume.to_numpy(dtype=float)
    typ=(hi+lo+cl)/3
    for i in range(120,n):
        width=cl[i]*.01
        if width<=0:continue
        bins=np.floor(typ[i-120:i]/width).astype(np.int64)
        uniq,inv=np.unique(bins,return_inverse=True)
        weights=np.bincount(inv,weights=vol[i-120:i])
        if len(weights)==0 or weights.max()<=0:continue
        centers=(uniq+.5)*width
        # Match the previous 25%-of-maximum cluster rule, using past bars only.
        eligible=np.where((centers>cl[i])&(weights>=weights.max()*.25))[0]
        if len(eligible)==0:continue
        ix=eligible[np.argmin(centers[eligible])]
        distance[i]=100*(centers[ix]/cl[i]-1)
        relative[i]=100*(weights[ix]/weights.max())
    return distance,relative


def _feature_matrix(d):
    n=len(d);idx=d.index
    yes=lambda v:np.array(pd.Series(v,index=idx).fillna(False),dtype=bool,copy=True)
    f={}
    for days in (20,30,40):
        for suffix in ('','_ALT'):
            tag=f'BB{days}{suffix}'
            f[tag]=yes(d[f'BB{days}_UPPER_SIGNAL{suffix}'])
            f[f'BB{days}_LOWER{suffix}']=yes(d[f'BB{days}_LOWER_SIGNAL{suffix}'])
    for days in (20,40):
        line=d[f'ENV{days}_MID']
        f[f'ENV{days}_UP']=yes(d[f'ENV{days}_SIGNAL'])
        f[f'ENV{days}_DOWN']=yes(d.close.shift().ge(line.shift()) & d.close.lt(line))
    f['RSI_GC']=yes(d.rsi_gc)
    f['RSI_DC']=yes(d.rsi.shift().ge(d.rsi_signal.shift()) & d.rsi.lt(d.rsi_signal))
    for span,pars in [('14',(14,3,3)),('12',(12,5,5)),('20',(20,12,12))]:
        k=d[f'slow_{pars[0]}_{pars[1]}_{pars[2]}_k'];v=d[f'slow_{pars[0]}_{pars[1]}_{pars[2]}_d']
        f['SLOW_'+span+'_GC']=yes(d[f'slow_{pars[0]}_{pars[1]}_{pars[2]}_gc'])
        if span=='14':f['SLOW_14_DC']=yes(k.shift().ge(v.shift()) & k.lt(v))
    macd=d.close.ewm(span=12,adjust=False,min_periods=12).mean()-d.close.ewm(span=26,adjust=False,min_periods=26).mean()
    ms=macd.ewm(span=9,adjust=False,min_periods=9).mean()
    hist=macd-ms
    f['MACD_GC']=yes(macd.shift().le(ms.shift())&macd.gt(ms))
    f['MACD_DC']=yes(macd.shift().ge(ms.shift())&macd.lt(ms))
    f['HIGH20_BREAK']=yes(d.close.gt(d.high.shift().rolling(20,min_periods=20).max()))
    # Current-day state/context variables, not independent entry signals.
    f['MA_UP']=yes(d.ma20.gt(d.ma40)&d.ma40.gt(d.ma60))
    f['MA_DOWN']=yes(d.ma20.lt(d.ma40)&d.ma40.lt(d.ma60))
    f['MA_TO_UP']=yes(f['MA_UP'] & ~np.roll(f['MA_UP'],1))
    f['MA_TO_UP'][0]=False
    for nline in (112,224):
        mline=d[f'ma{nline}']
        f[f'MA{nline}_CROSS']=yes(d.close.shift(1).le(mline.shift(1)) & d.close.gt(mline))
    f['CLOSE_ABOVE_MA20']=yes(d.close.gt(d.ma20))
    f['CLOSE_BELOW_MA20']=yes(d.close.lt(d.ma20))
    f['MA20_RISING']=yes(d.ma20.gt(d.ma20.shift(5)))
    f['MA20_FALLING']=yes(d.ma20.lt(d.ma20.shift(5)))
    f['RSI_ABOVE50']=yes(d.rsi.ge(50))
    f['RSI_BELOW40']=yes(d.rsi.lt(40))
    f['RSI_OVER70']=yes(d.rsi.ge(70))
    f['SLOW_BULL']=yes(d.slow_14_3_3_k.gt(d.slow_14_3_3_d))
    f['SLOW_OVERSOLD']=yes(d.slow_14_3_3_k.le(20))
    f['MACD_POSITIVE']=yes(macd.ge(0))
    f['MACD_HIST_RISING']=yes(hist.gt(hist.shift()))
    f['VOLUME_SURGE']=yes(d.volume_ratio20.ge(1.5))
    f['VOLUME_QUIET']=yes(d.volume_ratio20.le(.7))
    f['AMOUNT_SURGE']=yes(d.amount_ratio20.ge(1.5))
    distance,strength=_supply_features(d)
    f['NEAR_SUPPLY']=np.isfinite(distance)&(distance<=3)
    f['STRONG_SUPPLY']=np.isfinite(strength)&(strength>=70)
    change=(d.high-d.low).to_numpy(dtype=float)
    atr=pd.Series(change,index=d.index).rolling(20,min_periods=20).mean()
    atr_pct=atr/d.close
    f['VOLATILITY_HIGH']=yes(atr_pct.gt(atr_pct.shift(1).rolling(60,min_periods=60).median()*1.3))
    anchors=[k for k in f if k.startswith('BB') or k.startswith('ENV') or
             k in ('RSI_GC','RSI_DC','SLOW_14_GC','SLOW_14_DC','SLOW_12_GC','SLOW_20_GC','MACD_GC','MACD_DC','HIGH20_BREAK',
                   'MA_TO_UP','MA112_CROSS','MA224_CROSS')]
    return f,anchors


def _thin(indices, gap=COOLDOWN):
    previous=-1000;out=[]
    for i in indices:
        if i-previous>=gap:out.append(i);previous=i
    return np.asarray(out,dtype=np.int64)


def _outcomes(d,indices,h):
    n=len(d);i=indices[indices+h<n]
    if len(i)==0:return np.empty(0),np.empty(0),np.empty(0)
    opens=d.open.to_numpy(dtype=float);closes=d.close.to_numpy(dtype=float)
    high=d.high.to_numpy(dtype=float);low=d.low.to_numpy(dtype=float)
    ent=opens[i+1];ex=closes[i+h]
    valid=np.isfinite(ent)&np.isfinite(ex)&(ent>0)
    i=i[valid];ent=ent[valid];ex=ex[valid]
    y=100*(ex/ent-1)
    mae=np.array([100*(low[x+1:x+h+1].min()/p-1) for x,p in zip(i,ent)],dtype=float)
    mfe=np.array([100*(high[x+1:x+h+1].max()/p-1) for x,p in zip(i,ent)],dtype=float)
    return y,mae,mfe


def _summaries(d,indices):
    result={}
    for h in HORIZONS:
        y,mae,mfe=_outcomes(d,indices,h)
        count=len(y)
        entry={'n':count,'up_pct':fnum(100*np.mean(y>0),1) if count else None,
               'down_pct':fnum(100*np.mean(y<0),1) if count else None,
               'mean_return_pct':fnum(np.mean(y),2) if count else None,
               'median_return_pct':fnum(np.median(y),2) if count else None,
               'mean_mae_pct':fnum(np.mean(mae),2) if count else None,
               'mean_mfe_pct':fnum(np.mean(mfe),2) if count else None,
               'small_sample':count<MIN_SUPPORT}
        # Strict time ordering for a validation slice. Never claim validation on <12 total.
        if count>=12:
            k=max(3,int(np.floor(count*.3)))
            entry['holdout']={'n':k,'up_pct':fnum(100*np.mean(y[-k:]>0),1),
                               'mean_return_pct':fnum(np.mean(y[-k:]),2)}
        else:entry['holdout']=None
        result[str(h)]=entry
    return result


def _case_examples(d, indices, horizon, limit=12):
    """Recently completed, cooldown-deduplicated events; share entry/exit prices with outcomes.
    At most 12 examples per setup/horizon to stay below D1 statement size limits.
    """
    size=len(d)
    candidates=indices[indices+horizon<size]
    op=d.open.to_numpy(dtype=float);close=d.close.to_numpy(dtype=float)
    dates=d.date
    cases=[]
    for pos in candidates:
        start=float(op[pos+1]);finish=float(close[pos+horizon])
        if not np.isfinite(start) or not np.isfinite(finish) or start<=0:continue
        cases.append({'signal_day':str(dates.iloc[pos].date()),
                      'entry_day':str(dates.iloc[pos+1].date()),
                      'exit_day':str(dates.iloc[pos+horizon].date()),
                      'return_pct':fnum(100*(finish/start-1),2)})
    return cases[-limit:]


def backtest(history:pd.DataFrame,asof:str):
    """Find actual SAME-DAY active event anchors and up to three contemporaneous
    context factors across all supported technical/volume/supply families.
    Patterns chosen by today's state are *exploratory*, not confirmed predictive.
    """
    s=history.loc[history.date.le(pd.Timestamp(asof))].sort_values('date').reset_index(drop=True)
    if len(s)<260:return {'version':'R10_MULTIFACTOR_V2','asof':asof,'status':'INSUFFICIENT_HISTORY',
                          'history_start':str(s.date.iloc[0].date()) if len(s) else None,'history_end':asof,
                          'active_factors':[],'setups':[], 'baseline':{},'sector_lag':{'status':'NOT_AVAILABLE'}}
    d=enrich(s)
    f,anchor_names=_feature_matrix(d)
    # Include rare MA transitions/crosses before the crowded BB signal family.
    anchor_priority=('MA_TO_UP','MA112_CROSS','MA224_CROSS')
    anchor_now=[n for n in anchor_priority if n in anchor_names and f[n][-1]]
    anchor_now += [name for name in anchor_names if bool(f[name][-1]) and name not in anchor_now]
    anchor_now=anchor_now[:MAX_ANCHORS]
    # Make sure every context family gets an opportunity, instead of listing
    # nine near-identical moving-average flags. Choose stable domain priorities.
    domains=[['VOLUME_SURGE','VOLUME_QUIET'],['AMOUNT_SURGE'],
             ['MA_UP','MA_DOWN'],['MA20_RISING','MA20_FALLING'],
             ['RSI_ABOVE50','RSI_BELOW40','RSI_OVER70'],
             ['SLOW_BULL','SLOW_OVERSOLD'],['MACD_POSITIVE','MACD_HIST_RISING'],
             ['NEAR_SUPPLY','STRONG_SUPPLY'],['VOLATILITY_HIGH'],
             ['CLOSE_ABOVE_MA20','CLOSE_BELOW_MA20']]
    context_now=[]
    for group in domains:
        x=next((name for name in group if f[name][-1]),None)
        if x:context_now.append(x)
        if len(context_now)>=MAX_CONTEXT:break
    current=sorted(set(anchor_now+context_now))
    # Baseline is a coarse within-symbol reference, NOT market/sector matched.
    baseline_i=np.arange(249,max(249,len(d)-20),COOLDOWN,dtype=np.int64)
    baseline=_summaries(d,baseline_i)
    baseline10=baseline.get('10',{})
    candidates=[];attempted=0
    for anchor in anchor_now:
        for k in (0,1,2,3):
            for qualifiers in combinations(context_now,k):
                filters=(anchor,)+qualifiers
                matching=np.logical_and.reduce([f[name] for name in filters])
                eligible=np.flatnonzero(matching)
                eligible=eligible[eligible>=249]
                selected=_thin(eligible)
                attempted+=1
                # Avoid data-mining from 1 or 2 coincidental outcomes.
                if not len(selected):continue
                summary=_summaries(d,selected)
                x=summary['10'];n=x['n']
                if n<3:continue
                base_up=baseline10.get('up_pct')
                diff=fnum(x['up_pct']-base_up,1) if base_up is not None and x['up_pct'] is not None else None
                candidates.append({'code':'+'.join(filters), 'label':' + '.join(LABELS[z] for z in filters),
                    'factors':list(filters),'factor_count':len(filters),'total_signals_seen':len(selected),
                    'horizons':summary,'up_lift_vs_baseline_10d_pp':diff,
                    'quality':'EXPLORATORY' if n>=MIN_SUPPORT else 'INSUFFICIENT_SAMPLE',
                     '_indices':selected})
    # Show genuinely supported setups first, but do not label a post-hoc
    # highest-return group as a proven winner. Avoid near-duplicate candidates.
    # R159: within the exploratory candidates, order by 10d win-rate,
    # then median/mean return; smaller than 8 cases are always ranked behind.
    candidates.sort(key=lambda v:(
        v['quality']=='EXPLORATORY',
        v['horizons']['10']['up_pct'] if v['horizons']['10']['up_pct'] is not None else -1,
        v['horizons']['10']['median_return_pct'] if v['horizons']['10']['median_return_pct'] is not None else -10000,
        v['horizons']['10']['mean_return_pct'] if v['horizons']['10']['mean_return_pct'] is not None else -10000,
        v['horizons']['10']['n'], -v['factor_count']),reverse=True)
    selected=[];keys=set()
    for v in candidates:
        key=tuple(v['factors'])
        if key in keys:continue
        keys.add(key)
        for horizon in HORIZONS:
            v['horizons'][str(horizon)]['cases']=_case_examples(d,v['_indices'],horizon)
        v.pop('_indices',None)
        selected.append(v)
        if len(selected)>=12:break
    return {'version':'R10_MULTIFACTOR_V2','asof':asof,
      'history_start':str(d.date.iloc[0].date()),'history_end':str(d.date.iloc[-1].date()),
      'status':'EXPLORATORY','active_factors':[{'code':x,'label':LABELS[x]} for x in current],
      'candidate_count':attempted,'eligible_candidate_count':len(candidates),'setups':selected,
      'baseline':baseline,'sector_lag':{'status':'NOT_AVAILABLE','reason':'업종 분류·대장주/동종주 일별 시계열 미확보'},
      'method':'As-of current active events + 0-3 context factors (maximum 4 factors), no pre-selected winning pair; next session OPEN to H-th CLOSE, 10-session cooldown per setup, 5/10/20-session windows',
      'limitations':['Only the current stock; selected-today conditions cause data snooping / multiple tests',
        'Fewer than 8 historical cases: insufficient sample, not a probability forecast',
        'Holdout from chronological last 30% only where >=12 cases, still exploratory',
        'Unadjusted EOD OHLCV; no fees/slippage/corporate-action adjustment',
        'Do not treat baseline as a market/sector control; only one stock sampled every 10th eligible day',
        'Overlapping 20-session forward outcomes can remain correlated despite 10-session cooldown',
        'Daily typical-price supply concentration is a proxy, NOT actual volume-at-price',
        'Peer leadership/lag and market index regime require new audited sector/market data',
        'All outcomes exclude bars after the requested date; no future information used']}


def chart_rows(history:pd.DataFrame,asof:str,points=180):
    hist=history.loc[history.date.le(pd.Timestamp(asof))].sort_values('date').reset_index(drop=True)
    d=enrich(hist).tail(points).reset_index(drop=True)
    all_close=hist.close.astype(float)
    macd_all=all_close.ewm(span=12,adjust=False,min_periods=12).mean()-all_close.ewm(span=26,adjust=False,min_periods=26).mean()
    sig_all=macd_all.ewm(span=9,adjust=False,min_periods=9).mean()
    macd=macd_all.tail(len(d)).reset_index(drop=True)
    sig=sig_all.tail(len(d)).reset_index(drop=True)
    records=[]
    for i,row in d.iterrows():
        records.append({'t':str(row.date.date()),'o':fnum(row.open,2),'h':fnum(row.high,2),
          'l':fnum(row.low,2),'c':fnum(row.close,2),'v':int(row.volume),
          'r':fnum(row.rsi,2),'rs':fnum(row.rsi_signal,2),
          'sk':fnum(row.slow_14_3_3_k,2),'sd':fnum(row.slow_14_3_3_d,2),
          'm':fnum(macd.iloc[i],3),'ms':fnum(sig.iloc[i],3),
          'env20':fnum(row.ENV20_MID,2),'env40':fnum(row.ENV40_MID,2),
          'bb40':fnum(row.BB40_UPPER,2),
           'ma112':fnum(row.ma112,2),'ma224':fnum(row.ma224,2)})
    return {'version':'R10_CHART_V1','asof':asof,'data_frequency':'EOD_DAILY',
            'price_adjusted':False,'bars':records}


def generate(raw:pd.DataFrame,matched:list[dict],asof:str,dest:str):
    clean=normalise(raw)
    target=pd.Timestamp(asof)
    clean=clean.loc[clean.date.le(target)]
    selected={x['code'] for x in matched}
    groups={code:g for code,g in clean.loc[clean.code.isin(selected)].groupby('code',sort=False)}
    path=Path(dest);path.parent.mkdir(parents=True,exist_ok=True)
    n=0
    with path.open('w',encoding='utf-8') as out:
        for item in matched:
            code=item['code'];h=groups.get(code)
            if h is None or h.empty or h.date.iloc[-1]!=target:continue
            data={'code':code,'day':asof,'chart':chart_rows(h,asof),'stats':backtest(h,asof)}
            out.write(json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n')
            n+=1
    return n

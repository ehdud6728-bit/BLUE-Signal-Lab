"""Daily strategy lab, strictly as-of and source-provenance-aware.

This module is deliberately independent of production search, D1 and KIS.
Sources: user supplied '엔벨상단눌림특강' p2-3 and
'기준 거래대금 조건검색식' p5. Parameters not in those sources are
clearly marked research assumptions in StudyConfig.
"""
from __future__ import annotations
from dataclasses import asdict, dataclass
from math import isfinite, sqrt
from statistics import mean, median
from typing import Any
import pandas as pd

STRATEGIES=("AMOUNT_500EOK", "ENV20_40_PULLBACK", "AMOUNT_ENV_PULLBACK", "AMOUNT_ENV_SUPPLY")
HORIZONS=(5,10,20)
LABELS={
    "AMOUNT_500EOK":"[연구용 일봉 대체지표] 일 거래대금 500억 이상",
    "ENV20_40_PULLBACK":"ENV(20,40) 상단 접촉 후 7·15·20일선 눌림",
    "AMOUNT_ENV_PULLBACK":"기준 거래대금이 발생한 ENV 상단 접촉 후 눌림",
    "AMOUNT_ENV_SUPPLY":"기준 거래대금 + ENV 눌림 + 상단 매물대 접근",
    "BASELINE_20_STEP":"동일 종목 20거래일 간격 단순 비교군",
}

@dataclass(frozen=True)
class StudyConfig:
    base_amount_krw: int=50_000_000_000  # research EOD proxy for source's 500억 candle (NOT same event)
    env_ma_days: int=20                  # source: period 20, upper 40%
    env_upper_pct: float=40.0
    pullback_ma_days: tuple[int,...]=(7,15,20) # source candidates
    touch_lookback_days: int=30          # research assumption, not source rule
    min_after_touch_days: int=2          # research assumption
    pullback_band_pct: float=1.0        # research assumption
    drawdown_from_touch_high_pct: float=3.0  # research assumption
    overhead_supply_distance_pct: float=5.0 # research assumption
    cooldown_sessions: int=20           # research assumption for overlapping outcomes
    min_historical_days: int=141        # prior 120 volume bars + price history


def _num(x: Any)->float:
    try:
        v=float(x)
        return v if isfinite(v) else float('nan')
    except (TypeError, ValueError):return float('nan')


def validate_daily(raw:pd.DataFrame)->pd.DataFrame:
    """Explicit completed OHLCV + actual traded amount. Never estimate amount=C*V."""
    d=raw.copy()
    d.columns=[str(c).lower() for c in d.columns]
    required={'code','date','open','high','low','close','volume','amount'}
    if not required.issubset(d.columns):
        raise ValueError('Missing daily columns: '+', '.join(sorted(required-set(d.columns))))
    d['date']=pd.to_datetime(d['date'],errors='raise').dt.normalize()
    d['code']=d['code'].astype(str).str.replace(r'\.0$','',regex=True).str.zfill(6)
    if not d['code'].str.fullmatch(r'\d{6}').all():raise ValueError('Daily code must be 6-digit KRX code')
    for col in ('open','high','low','close','volume','amount'):
        d[col]=pd.to_numeric(d[col],errors='raise')
        if not d[col].map(isfinite).all():raise ValueError('Nonfinite '+col)
    if not ((d[['open','high','low','close']]>0).all(axis=1)&(d[['volume','amount']]>=0).all(axis=1)).all():
        raise ValueError('Negative/zero OHLC or negative amount/volume')
    if not (d.high.ge(d[['open','close','low']].max(axis=1))&d.low.le(d[['open','close','high']].min(axis=1))).all():
        raise ValueError('Invalid daily OHLC bounds')
    if d.duplicated(['code','date']).any():raise ValueError('Duplicate code/date')
    return d.sort_values(['code','date']).reset_index(drop=True)


def _near_supply(history:pd.DataFrame,idx:int,close:float,max_distance_pct:float)->dict:
    """Existing verified daily uniform H-L proxy, prior-day volume only."""
    from scripts.supply_profile_r15110 import estimate_supply_profile
    # The source estimator ignores the last row's volume by design.
    p=estimate_supply_profile(history.iloc[max(0,idx-120):idx+1])
    zone=_num(p.get('supply_zone_low'))
    if p.get('supply_profile_status')!='READY' or not isfinite(zone):
        return {'near':False,'grade':'미확인','gap_pct':None}
    gap=(zone/close-1)*100
    return {'near':-1.0<=gap<=max_distance_pct,
            'grade':p.get('supply_strength_grade','미확인'),'gap_pct':round(gap,3)}


def detect_signals_single(raw:pd.DataFrame,asof:str,config:StudyConfig=StudyConfig())->list[dict]:
    """One symbol, ONLY bars <= asof; returns observables, no future outcome."""
    h=raw.loc[raw.date.le(pd.Timestamp(asof))].sort_values('date').reset_index(drop=True)
    if h.empty:return []
    h=h.copy()
    for n in set(config.pullback_ma_days+(config.env_ma_days,)):
        h[f'ma{n}']=h.close.rolling(n,min_periods=n).mean()
    h['env_upper']=h[f'ma{config.env_ma_days}']*(1+config.env_upper_pct/100)
    h['env_touch']=h.high.ge(h.env_upper)&h.env_upper.notna()
    events=[]
    for i in range(config.min_historical_days,len(h)):
        row=h.iloc[i]
        day=str(row.date.date());code=str(row.code)
        if row.amount>=config.base_amount_krw:
            events.append({'code':code,'day':day,'strategy':'AMOUNT_500EOK',
                           'signal_index':i,'amount_krw':int(row.amount),'touch_day':None,
                           'pullback_ma':None,'supply_grade':None,'supply_gap_pct':None})
        # Select most recent historical ENV upper touch, never today and at least 2 bars ago.
        start=max(config.env_ma_days,i-config.touch_lookback_days)
        end=i-config.min_after_touch_days+1
        if end<=start:continue
        earlier=[j for j in range(start,end) if bool(h.iloc[j].env_touch)]
        if not earlier:continue
        touch=earlier[-1];trow=h.iloc[touch]
        if row.close>trow.high*(1-config.drawdown_from_touch_high_pct/100):continue
        touched=[]
        for n in config.pullback_ma_days:
            ma=_num(row[f'ma{n}'])
            if isfinite(ma) and row.low<=ma*(1+config.pullback_band_pct/100) and row.close>=ma*(1-config.pullback_band_pct/100):
                touched.append(n)
        if not touched:continue
        common={'code':code,'day':day,'signal_index':i,'amount_krw':int(row.amount),
                'touch_day':str(trow.date.date()),'pullback_ma':touched,
                'supply_grade':None,'supply_gap_pct':None}
        events.append({**common,'strategy':'ENV20_40_PULLBACK'})
        if trow.amount<config.base_amount_krw:continue
        events.append({**common,'strategy':'AMOUNT_ENV_PULLBACK'})
        zone=_near_supply(h,i,float(row.close),config.overhead_supply_distance_pct)
        if zone['near']:
            events.append({**common,'strategy':'AMOUNT_ENV_SUPPLY',
                           'supply_grade':zone['grade'],'supply_gap_pct':zone['gap_pct']})
    return events


def wilson95(k:int,n:int)->list[float]|None:
    if n<1:return None
    p=k/n;z=1.96;den=1+z*z/n
    m=(p+z*z/(2*n))/den
    e=z*sqrt(p*(1-p)/n+z*z/(4*n*n))/den
    return [round(100*max(0,m-e),1),round(100*min(1,m+e),1)]


def _study_one(h:pd.DataFrame,signals:list[dict],asof:str,config:StudyConfig)->tuple[list[dict],dict]:
    events=[];stats={}
    for strategy in [*STRATEGIES,'BASELINE_20_STEP']:
        selected=[x for x in signals if x['strategy']==strategy]
        if strategy=='BASELINE_20_STEP':
            selected=[{'code':str(h.iloc[i].code),'day':str(h.iloc[i].date.date()),
                'signal_index':i,'strategy':strategy,'amount_krw':int(h.iloc[i].amount),
                'touch_day':None,'pullback_ma':None,'supply_grade':None,'supply_gap_pct':None}
                for i in range(config.min_historical_days,len(h),config.cooldown_sessions)]
        else:
            unique=[];last=-config.cooldown_sessions
            for event in selected:
                if event['signal_index']-last<config.cooldown_sessions:continue
                unique.append(event);last=event['signal_index']
            selected=unique
        for e in selected:
            i=e['signal_index'];record={k:v for k,v in e.items() if k!='signal_index'}
            record['observation_status']='SIGNAL_ONLY'
            record['horizons']={}
            for horizon in HORIZONS:
                if i+horizon>=len(h):continue
                entry=_num(h.iloc[i+1].open)
                future=h.iloc[i+1:i+1+horizon]
                if entry<=0 or len(future)!=horizon:continue
                ret=(float(future.iloc[-1].close)/entry-1)*100
                high=(float(future.high.max())/entry-1)*100
                low=(float(future.low.min())/entry-1)*100
                record['horizons'][str(horizon)]={'entry_day':str(h.iloc[i+1].date.date()),
                    'exit_day':str(future.iloc[-1].date.date()),'return_pct':round(ret,3),
                    'max_favorable_pct':round(high,3),'max_adverse_pct':round(low,3)}
            if record['horizons']:record['observation_status']='HAS_MATURED_HORIZONS'
            events.append(record)
        summary={}
        for n in HORIZONS:
            complete=[x['horizons'][str(n)] for x in events if x['strategy']==strategy and str(n) in x['horizons']]
            gains=[x['return_pct'] for x in complete];wins=sum(x>0 for x in gains);k=len(gains)
            summary[str(n)]={'n_completed':k,'n_signal_events':len(selected),
                'win_freq_pct':round(wins*100/k,1) if k else None,
                'wilson95_freq_pct':wilson95(wins,k),
                'mean_return_pct':round(mean(gains),3) if k else None,
                'median_return_pct':round(median(gains),3) if k else None,
                'mean_max_favorable_pct':round(mean(x['max_favorable_pct'] for x in complete),3) if k else None,
                'mean_max_adverse_pct':round(mean(x['max_adverse_pct'] for x in complete),3) if k else None,
                'data_quality':'LOW_SAMPLE' if k<12 else 'EXPLORATORY_NOT_VALIDATED'}
        stats[strategy]=summary
    return events,stats


def run_daily_study(raw:pd.DataFrame,asof:str,config:StudyConfig=StudyConfig())->dict:
    h=validate_daily(raw)
    target=pd.Timestamp(asof)
    h=h.loc[h.date.le(target)].copy()  # critical time fence
    if h.empty or not h.date.eq(target).any():
        raise ValueError('Requested asof absent from input; no silent fallback')
    all_events=[];per_symbol={}
    for code,g in h.groupby('code',sort=False):
        # Do not require a current bar for symbols with halted days; study only observed history.
        g=g.reset_index(drop=True)
        signals=detect_signals_single(g,asof,config)
        events,summary=_study_one(g,signals,asof,config)
        all_events.extend(events);per_symbol[code]=summary
    # Pooled descriptive table across symbol events; correlation and survivorship remain uncorrected.
    pooled={}
    for strategy in [*STRATEGIES,'BASELINE_20_STEP']:
        windows={}
        subset=[e for e in all_events if e['strategy']==strategy]
        for n in HORIZONS:
            completed=[e['horizons'][str(n)] for e in subset if str(n) in e['horizons']]
            returns=[v['return_pct'] for v in completed]
            k=len(returns);wins=sum(v>0 for v in returns)
            windows[str(n)]={'n_signal_events':len(subset),'n_completed':k,
                'win_freq_pct':round(100*wins/k,1) if k else None,
                'wilson95_freq_pct':wilson95(wins,k),
                'mean_return_pct':round(mean(returns),3) if k else None,
                'median_return_pct':round(median(returns),3) if k else None,
                'mean_max_favorable_pct':round(mean(v['max_favorable_pct'] for v in completed),3) if k else None,
                'mean_max_adverse_pct':round(mean(v['max_adverse_pct'] for v in completed),3) if k else None,
                'status':'LOW_SAMPLE' if k<12 else 'EXPLORATORY_NOT_VALIDATED'}
        pooled[strategy]={'label':LABELS[strategy],'horizons':windows}
    return {'version':'R15114_DAILY_RESEARCH_V1','asof':str(target.date()),
        'source':'INPUT_CSV_EOD_NO_PROVIDER_VERIFICATION','data_frequency':'EOD_DAILY',
        'source_parameters':{'env_period':20,'env_upper_percent':40,'pullback_ma':[7,15,20],
                             'source_candle_reference_500eok':50_000_000_000},
        'adaptation_note':'AMOUNT_500EOK uses completed DAILY turnover as an exploratory proxy; not an observed 500eok intraday baseline candle',
        'research_parameters':asdict(config),'symbol_count':len(per_symbol),
        'events':all_events,'pooled':pooled,'per_symbol':per_symbol,
        'limitations':['과거 분봉/현재 호가와 혼합 금지','신호 당일 조건 판단; 다음 거래일 시가~N일 종가 관측',
            '거래비용·슬리피지·상장폐지·시장/업종 대조군·수정주가 미반영',
            '일봉 고가/저가 균등 분배 매물대는 실체결 가격대별 거래량이 아님',
            '전략 조건은 탐색적이며 성과 검증·투자우위 주장 아님',
            '중복 신호를 20거래일 간격으로 제한; 모든 비교군이 시장 중립은 아님']}

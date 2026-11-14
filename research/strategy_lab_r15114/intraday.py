"""1-minute completed bar -> verified 2/3-minute KRW turnover events.

Data must be interval amount_krw, not day cumulative amount. Missing minutes
are NEVER synthesized. Timezone-aware timestamps mandatory. Continuous KRX
session study 09:00-15:20 KST; excludes final auction and exceptional sessions.
"""
from __future__ import annotations
from datetime import datetime, timedelta, time
from zoneinfo import ZoneInfo
from math import isfinite
from statistics import mean, median
from collections import defaultdict

KST=ZoneInfo('Asia/Seoul')
TRIGGERS=((2,7_000_000_000,'2MIN_70EOK'),(3,10_000_000_000,'3MIN_100EOK'),(3,15_000_000_000,'3MIN_150EOK'))
FOLLOWUP_MINUTES=(10,30)


def _clean(bars:list[dict])->list[dict]:
    valid=[];unique=set()
    for raw in bars:
        if not all(k in raw for k in ('code','timestamp','open','high','low','close','volume','amount_krw')):
            raise ValueError('Require code, timestamp, complete 1m OHLCV and INTERVAL amount_krw')
        ts=datetime.fromisoformat(str(raw['timestamp']))
        if ts.tzinfo is None or ts.utcoffset() is None:raise ValueError('Minute timestamps must be timezone-aware')
        ts=ts.astimezone(KST)
        if ts.second!=0 or ts.microsecond!=0:raise ValueError('Minute timestamp must be at minute start')
        if not (time(9,0)<=ts.time()<time(15,20)):continue
        code=str(raw['code']).zfill(6)
        if len(code)!=6 or not code.isdigit():raise ValueError('Invalid KRX code')
        nums={k:float(raw[k]) for k in ('open','high','low','close','volume','amount_krw')}
        if any(not isfinite(x) for x in nums.values()) or any(nums[k]<=0 for k in ('open','high','low','close')) or nums['volume']<0 or nums['amount_krw']<0:
            raise ValueError('Invalid minute price or turnover')
        if nums['high']<max(nums['open'],nums['low'],nums['close']) or nums['low']>min(nums['open'],nums['high'],nums['close']):
            raise ValueError('Minute OHLC bounds invalid')
        key=(code,ts)
        if key in unique:raise ValueError('Duplicate 1-minute timestamp')
        unique.add(key);valid.append({'code':code,'timestamp':ts,**nums})
    return sorted(valid,key=lambda x:(x['code'],x['timestamp']))


def aggregate_intervals(raw:list[dict],width:int)->list[dict]:
    if width not in (2,3):raise ValueError('Study width must be 2 or 3 minutes')
    bars=_clean(raw)
    groups=defaultdict(list)
    for row in bars:
        ts=row['timestamp'];minutes=ts.hour*60+ts.minute-9*60
        index=minutes//width
        groups[(row['code'],ts.date(),index)].append(row)
    result=[]
    for (code,day,index),items in sorted(groups.items()):
        begin=datetime.combine(day,time(9,0),KST)+timedelta(minutes=index*width)
        if len(items)!=width or any(x['timestamp']!=begin+timedelta(minutes=j) for j,x in enumerate(items)):
            continue  # no fake bars when an API minute is missing
        close_time=items[-1]['timestamp']
        result.append({'code':code,'day':str(day),'from':begin.isoformat(),
            'to':close_time.isoformat(),'interval_minutes':width,
            'open':items[0]['open'],'high':max(x['high'] for x in items),
            'low':min(x['low'] for x in items),'close':items[-1]['close'],
            'volume':sum(x['volume'] for x in items),
            'amount_krw':sum(x['amount_krw'] for x in items)})
    return result


def run_intraday_study(raw:list[dict])->dict:
    bars=_clean(raw)
    # No prospective return can be computed across missing minutes or sessions.
    by_code_day=defaultdict(dict)
    for b in bars:by_code_day[(b['code'],str(b['timestamp'].date()))][b['timestamp']]=b
    aggregates={2:aggregate_intervals(raw,2),3:aggregate_intervals(raw,3)}
    results=[];stats={}
    for width,threshold,name in TRIGGERS:
        candidates=[x for x in aggregates[width] if x['amount_krw']>=threshold]
        # First completed trigger of each symbol/day, no repeated correlated bursts.
        first={}
        for x in candidates:
            key=(x['code'],x['day'])
            if key not in first:first[key]=x
        selected=list(first.values())
        for x in selected:
            end=datetime.fromisoformat(x['to'])
            o={'strategy':name,'code':x['code'],'day':x['day'],
               'start':x['from'],'trigger_end':x['to'],'trigger_close':x['close'],
               'turnover_krw':round(x['amount_krw']), 'horizons':{}}
            daily=by_code_day[(x['code'],x['day'])]
            for h in FOLLOWUP_MINUTES:
                look=[daily.get(end+timedelta(minutes=j)) for j in range(1,h+1)]
                if any(b is None for b in look):continue
                ret=100*(look[-1]['close']/x['close']-1)
                o['horizons'][str(h)]={'return_pct':round(ret,3),
                    'highest_pct':round(100*(max(b['high'] for b in look)/x['close']-1),3),
                    'lowest_pct':round(100*(min(b['low'] for b in look)/x['close']-1),3)}
            o['status']='HAS_MATURED_HORIZONS' if o['horizons'] else 'UNMATURED_OR_GAPPED'
            results.append(o)
        sample={}
        for h in FOLLOWUP_MINUTES:
            r=[x['horizons'][str(h)]['return_pct'] for x in results if x['strategy']==name and str(h) in x['horizons']]
            sample[str(h)]={'n_completed':len(r),'n_triggers':len(selected),
                'win_freq_pct':round(100*sum(x>0 for x in r)/len(r),1) if r else None,
                'median_return_pct':round(median(r),3) if r else None,
                'mean_return_pct':round(mean(r),3) if r else None,
                'status':'LOW_SAMPLE' if len(r)<12 else 'EXPLORATORY_NOT_VALIDATED'}
        stats[name]=sample
    return {'version':'R15114_MINUTE_RESEARCH_V1','source':'INPUT_1M_INTERVAL_OHLCV_UNVERIFIED',
        'events':results,'studies':stats,'triggers':[{'name':name,'minutes':n,'amount_krw':a} for n,a,name in TRIGGERS],
        'limitations':['1분 구간별 거래대금만 입력 가능, 누적 거래대금은 반드시 원천에서 변환·검증',
            '미완성 2/3분봉 및 누락된 후속 분봉 제외; 거래시간 09:00~15:20 일반 연속거래 기준',
            '당일 최초 기준봉만 이벤트 처리; 거래정지·시험일 시간변경·종가 동시호가 제외',
            '장중 관측 시 최초 기준봉 마감 이후의 분봉만 이용해야 함',
            '데이터가 없으면 샘플 0건이며 임의 성공률을 생성하지 않음']}

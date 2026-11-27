"""Apply the existing landmark engine to every saved basic/recommended cohort.
Membership comes from the audited ranking engine, never substring matching.
Aggregate artifact only; current retrospective selection is not historic advice.
"""
import argparse,json,hashlib
from collections import Counter,defaultdict
from fractions import Fraction
from pathlib import Path
from pattern_performance_audited import analyze
from env20_case_features import comparison_split,FIXED_SPLIT_DAY
from env20_landmark import study as landmark

def registry(snapshot):
    if not snapshot.get('rows') or not isinstance(snapshot.get('recommendations'),list):raise ValueError('BAD_SELECTION_SNAPSHOT')
    targets={('rankings',p):dict(group='rankings',pattern=p,roles=['BASIC_PATTERN'],recommendation_horizons=[]) for p in snapshot['rows']}
    watch=Counter()
    for r in snapshot['recommendations']:
        if r['tier']!='SHORT_RECOMMENDATION':watch[r['tier']]+=1;continue
        if r['group'] not in ('rankings','candle_rankings','detail_rankings','turnover_rankings','market_rankings'):raise ValueError('UNSUPPORTED_RECOMMENDATION_GROUP')
        key=r['group'],r['pattern']
        t=targets.setdefault(key,dict(group=key[0],pattern=key[1],roles=[],recommendation_horizons=[]))
        if 'RECOMMENDATION' not in t['roles']:t['roles'].append('RECOMMENDATION')
        if r['horizon_trading_days'] not in t['recommendation_horizons']:t['recommendation_horizons'].append(r['horizon_trading_days'])
    for t in targets.values():t['recommendation_horizons'].sort()
    return targets,dict(watch)

def study(source,snapshot,split_day=FIXED_SPLIT_DAY,case_sink=None):
    split_day=comparison_split(split_day)
    if snapshot['asof']>source['asof_day']:raise ValueError('SELECTION_AFTER_SOURCE')
    # Reconstruct exact original basic/candle/detail/turnover/market cohorts.
    groups={};analyze(source,cohort_sink=groups.update)
    targets,watch=registry(snapshot)
    dates=[x['day'] for x in source['eod_days']];bars={(b['day'],b['code']):b for b in source['bars']}
    audited=set(source['research_audited_dates'])
    if any(s['day'] not in audited for s in source['signals']):raise ValueError('SIGNAL_AUDIT_MISSING')
    selected=defaultdict(set)
    for group,events in groups.items():
        for code,day,pattern,_,_ in events:
            if (group,pattern) in targets:selected[group,pattern].add((day.isoformat(),code))
    cache={}
    def case(d,code):
        if (d,code) in cache:return cache[d,code]
        i=dates.index(d);b=bars[d,code];market=b.get('market');pre=[];path=[];end='MAX_WINDOW'
        def valid(z):
            if not z or z.get('market')!=market:return False
            if not all(type(z.get(k)) is int and z[k]>0 for k in ('open','high','low','close')):return False
            return z['low']<=min(z['open'],z['close'])<=max(z['open'],z['close'])<=z['high']
        if not valid(b):raise ValueError('SIGNAL_OHLC_UNAVAILABLE')
        for day in reversed(dates[max(0,i-59):i+1]):
            z=bars.get((day,code))
            if not valid(z):break
            pre.insert(0,z)
        for day in dates[i+1:i+21]:
            z=bars.get((day,code))
            if not valid(z):end='MISSING_OR_INVALID_PATH';break
            previous=path[-1] if path else b
            if abs(Fraction(z['open'],previous['close'])-1)>=Fraction(2,5):end='DISCONTINUITY_REVIEW';break
            path.append(z)
        else:
            if len(path)<20:end='PENDING'
        c=dict(id=d+'/'+code,day=d,code=code,pre_bars=pre,geometry={})
        o=dict(id=c['id'],post_bars=path,landmark_bars=path,landmark_path_version=1)
        cache[d,code]=(c,o,end);return cache[d,code]
    inventory=[];rows=[];coverage=[]
    for key,t in sorted(targets.items()):
        pairs=[case(d,c) for d,c in sorted(selected[key])]
        if case_sink is not None:case_sink(t,pairs)
        r=landmark(dict(schema='BLUE_PATTERN_CASE_FEATURES_V1',asof=source['asof_day'],split_day=split_day,split_policy='FIXED_EXPLICIT_DAY'),[a for a,_,_ in pairs],[b for _,b,_ in pairs])
        inventory.append(dict(**t,matched_cases=len(pairs),status='COMPUTED_SAME_SOURCE' if pairs else 'NO_MATCHING_CASES',path_end_reasons=dict(Counter(e for _,_,e in pairs))))
        for z in r['rows']:rows.append(dict(group=key[0],pattern=key[1],**z))
        for z in r['coverage']:coverage.append(dict(group=key[0],pattern=key[1],**z))
    return dict(schema='BLUE_ALL_PATTERN_LANDMARK_V1',asof=source['asof_day'],selection_asof=snapshot['asof'],split_day=split_day,inventory=inventory,watch_not_promoted=watch,rows=rows,coverage=coverage,unique_case_count=len(cache),limits=['RETROSPECTIVE_SNAPSHOT_SELECTION_NOT_HISTORICAL_RECOMMENDATION','SHARED_CASES_ACROSS_PATTERNS_NOT_INDEPENDENT','AUDITED_SESSION_CALENDAR_NOT_INDEPENDENT_EXCHANGE_PROOF','NO_CORPORATE_ACTION_PROOF','FROZEN_SUPPORT_RESISTANCE_UNKNOWN_NO_FABRICATION','LANDMARK_CANDLE_60P_BODY_DIFFERS_FROM_RANKING_70P_WITH_WICKS','NO_AUTOMATIC_RECOMMENDATION_OR_UI_CHANGE','AGGREGATES_ONLY_NO_RAW_STOCK_ARTIFACT'])

def main():
    p=argparse.ArgumentParser()
    for k in ('source','snapshot','out'):p.add_argument('--'+k,type=Path,required=True)
    p.add_argument('--private-charts',type=Path,help='Local/private bundle only; never add to public artifacts')
    a=p.parse_args();raw=a.source.read_bytes();snap=a.snapshot.read_bytes();hashes=dict(source=hashlib.sha256(raw).hexdigest(),snapshot=hashlib.sha256(snap).hexdigest())
    collector=None
    if a.private_charts:
        from pattern_performance_chart_evidence import EvidenceCollector
        collector=EvidenceCollector(hashes)
    r=study(json.loads(raw),json.loads(snap),case_sink=collector.capture if collector else None);r['input_sha256']=hashes
    if collector:collector.write(a.private_charts,r['asof'],r['selection_asof'])
    a.out.write_text(json.dumps(r,ensure_ascii=False,allow_nan=False,separators=(',',':'))+'\n');print(json.dumps({k:r[k] for k in ('asof','selection_asof','split_day','unique_case_count','inventory','watch_not_promoted')}))
if __name__=='__main__':main()

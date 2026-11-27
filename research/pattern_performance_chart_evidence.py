"""Bounded real-price evidence for the EXACT all-pattern cohorts.
Private output: do not upload bundles or HTML as public workflow artifacts.
"""
import hashlib,html,json,re
from datetime import date
from collections import defaultdict
from pathlib import Path
from env20_chart_review import candles,validate_path

def packed(x):return json.dumps(x,ensure_ascii=False,allow_nan=False,sort_keys=True,separators=(',',':'))
def digest(x):return hashlib.sha256(x.encode()).hexdigest()
def compact(b):return {k:b[k] for k in ('day','open','high','low','close','volume','amount') if k in b}

def observation(path,h=5):
    if len(path)<h:return dict(status='INCOMPLETE',available=len(path),required=h)
    a=path[:h];entry=a[0]['open'];high=max(b['high'] for b in a);low=min(b['low'] for b in a)
    first=next((i for i,b in enumerate(a) if 100*b['high']>=105*entry),None)
    return dict(status='HIT5' if first is not None else 'MISS5',entry_day=a[0]['day'],entry_open=entry,goal_price=entry*1.05,
      first_target_day=a[first]['day'] if first is not None else None,high=high,low=low,close=a[-1]['close'],
      high_pct=100*(high/entry-1),low_pct=100*(low/entry-1),close_pct=100*(a[-1]['close']/entry-1),
      adverse_before_target_low=min([entry]+[b['low'] for b in a[:first]]) if first is not None else None,
      intraday_order='UNKNOWN_WITH_DAILY_OHLC')

class EvidenceCollector:
    def __init__(self,hashes,per_status=2):
        if not isinstance(per_status,int) or not 1<=per_status<=3:raise ValueError('BAD_SAMPLE_LIMIT')
        if set(hashes)!= {'source','snapshot'} or any(not isinstance(h,str) or len(h)!=64 or any(c not in '0123456789abcdef' for c in h) for h in hashes.values()):raise ValueError('BAD_SOURCE_HASHES')
        self.hashes=hashes;self.per_status=per_status;self.cases={};self.cohorts=[]
    def capture(self,target,pairs):
        buckets=defaultdict(list)
        for c,o,end in pairs:
            path=o['landmark_bars'];pre=c['pre_bars']
            validate_path(pre,c['day'],before=True);validate_path(path,c['day'])
            result=observation(path);item=dict(id=c['id'],code=c['code'],signal_day=c['day'],pre_bars=[compact(b) for b in pre[-30:]],post_bars=[compact(b) for b in path],path_end_reason=end,outcome=result)
            # Hash-order sampling is fixed before looking at profit magnitude.
            buckets[result['status']].append(item)
        refs=[]
        for status in ('HIT5','MISS5','INCOMPLETE'):
            items=sorted(buckets[status],key=lambda x:digest('ALL_PATTERN_CHART_V1|'+x['id']))
            for item in items[:self.per_status]:
                raw=packed(item);h=digest(raw)
                prior=self.cases.get(item['id'])
                if prior and prior['sha256']!=h:raise ValueError('CASE_PATH_CONFLICT')
                self.cases[item['id']]=dict(sha256=h,payload=item,raw=raw)
                refs.append(dict(id=item['id'],status=status,sha256=h))
        self.cohorts.append(dict(group=target['group'],pattern=target['pattern'],roles=target['roles'],recommendation_horizons=target['recommendation_horizons'],status_counts={k:len(v) for k,v in sorted(buckets.items())},selected=refs))
    def bundle(self,asof,selection_asof):
        result=dict(schema='BLUE_PRIVATE_PATTERN_CHARTS_V1',asof=asof,selection_asof=selection_asof,input_sha256=self.hashes,sampling='FIXED_HASH_ORDER_PER_HIT_MISS_INCOMPLETE_NOT_LARGEST_WINNERS',per_status=self.per_status,cohorts=self.cohorts,cases=self.cases,limits=['AUDITED_OBSERVATIONS_NOT_PROVEN_CONSECUTIVE_TRADING_DAYS','INTRADAY_TARGET_LOW_ORDER_UNKNOWN','NOT_INDEPENDENT_MARKET_PRICE_VERIFICATION','NOT_REPRESENTATIVE_OR_INDEPENDENT_CASES','NO_RAW_SOURCE_REHASH_FROM_PAYLOAD_ONLY'])
        validate(result);return result
    def write(self,path,asof,selection_asof):
        bundle=self.bundle(asof,selection_asof);path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text(packed(bundle)+'\n');path.with_suffix('.html').write_text(render(bundle))

def validate(bundle):
    if bundle.get('schema')!='BLUE_PRIVATE_PATTERN_CHARTS_V1' or len(bundle['cohorts'])>200 or len(bundle['cases'])>1200:raise ValueError('BUNDLE_LIMIT')
    try:
        if any(date.fromisoformat(bundle[k]).isoformat()!=bundle[k] for k in ('asof','selection_asof')) or bundle['selection_asof']>bundle['asof']:raise ValueError('BUNDLE_DATES')
    except (TypeError,ValueError):raise ValueError('BUNDLE_DATES')
    if set(bundle.get('input_sha256',{}))!={'source','snapshot'} or any(not isinstance(h,str) or not re.fullmatch('[a-f0-9]{64}',h) for h in bundle['input_sha256'].values()):raise ValueError('BAD_SOURCE_HASHES')
    seen=set();used=set()
    for cohort in bundle['cohorts']:
        key=cohort['group'],cohort['pattern']
        if key in seen:raise ValueError('DUPLICATE_COHORT')
        seen.add(key)
        for r in cohort['selected']:
            v=bundle['cases'].get(r['id'])
            if not v or v['sha256']!=r['sha256'] or digest(packed(v['payload']))!=v['sha256'] or v.get('raw')!=packed(v['payload']):raise ValueError('CASE_HASH_MISMATCH')
            a=v['payload']
            if a['signal_day']>bundle['asof'] or any(z['day']>bundle['asof'] for z in a['pre_bars']+a['post_bars']):raise ValueError('CASE_AFTER_ASOF')
            validate_path(a['pre_bars'],a['signal_day'],before=True);validate_path(a['post_bars'],a['signal_day'])
            if a['id']!=r['id'] or a['id']!=a['signal_day']+'/'+a['code'] or observation(a['post_bars'])!=a['outcome'] or a['outcome']['status']!=r['status']:raise ValueError('CASE_OUTCOME_MISMATCH')
            used.add(r['id'])
    if used!=set(bundle['cases']):raise ValueError('UNREFERENCED_CASES')

def review_path(pre, post, case):
    outcome = case['outcome']
    chart = pre + post
    if outcome['status'] == 'INCOMPLETE':
        return candles(chart, case['signal_day']) + f"<p>관측 부족 · 이후 {len(post)}개 봉 확보 / 판정에 5개 필요</p>"
    entry, goal = outcome['entry_open'], outcome['goal_price']
    status = ('목표 도달 · ' + outcome['first_target_day']
              if outcome['status'] == 'HIT5' else '목표 미도달')
    caption = (f"<p><strong>{status}</strong> · 처음 5개 관측봉 고가 기준<br>"
               f"첫 관측봉 시가 {entry:,}원 · +5% 목표 {goal:,.2f}원<br>"
               f"관측 최고 {outcome['high_pct']:+.2f}% · 최저 {outcome['low_pct']:+.2f}% · "
               f"마지막 종가 {outcome['close_pct']:+.2f}%</p>")
    return caption + candles(chart, case['signal_day'], entry_day=outcome['entry_day'],
                             entry=entry, goal=goal)

def render(bundle):
    validate(bundle);e=html.escape
    out=['<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>전체 패턴 실제 차트 검토</title><style>body{font:16px system-ui;background:#f3f5f9;color:#18243a;max-width:1000px;margin:auto;padding:16px}section,article{background:white;padding:16px;margin:16px 0;border-radius:12px}svg{width:100%}summary{cursor:pointer;background:#e8eef8;padding:12px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:right}small{overflow-wrap:anywhere}</style><h1>전체 패턴 실제 종목 차트 검토</h1><p>성공·미도달·불완전별 고정 해시순 표본입니다. 큰 수익만 고르지 않았으며 전체 모집단의 대표 표본으로 해석하지 않습니다. 날짜는 실제 저장일자이며 연속 거래일 검증 전입니다. 신호 당시 차트를 먼저 보고 이후 경로를 펼쳐 함께 검토하세요.</p>']
    out.append('<small>원천 SHA256 '+e(bundle['input_sha256']['source'])+'<br>선택 SHA256 '+e(bundle['input_sha256']['snapshot'])+'</small>')
    for c in bundle['cohorts']:
        out.append('<section><h2>'+e(c['pattern'])+'</h2><p>'+e(c['group'])+' · '+e(packed(c['status_counts']))+'</p>')
        for ref in c['selected']:
            a=bundle['cases'][ref['id']]['payload'];pre=a['pre_bars'];post=a['post_bars']
            out.append('<article><h3>'+e(a['code']+' · '+a['signal_day'])+'</h3>'+candles(pre,a['signal_day']))
            out.append('<details><summary>이후 실제 경로와 결과 펼치기</summary>'+review_path(pre,post,a)+'<small>경로 종료: '+e(a['path_end_reason'])+'<br>사례 SHA256 '+e(ref['sha256'])+'</small><details><summary>실제 저장 OHLC 표</summary><table><tr><th>날짜</th><th>시가</th><th>고가</th><th>저가</th><th>종가</th></tr>')
            for b in post:out.append('<tr>'+''.join('<td>'+e(str(b[k]))+'</td>' for k in ('day','open','high','low','close'))+'</tr>')
            out.append('</table></details></details></article>')
        if not c['selected']:out.append('<p>조건 일치 사례 없음. 다른 패턴으로 대체하지 않습니다.</p>')
        out.append('</section>')
    return ''.join(out)+'</html>'

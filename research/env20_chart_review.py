"""Render real V6 price evidence and independently check stored horizon arithmetic.
No downloads or publishing. Future prices are hidden until the reader opens them.
"""
import argparse,hashlib,html,json,math,re
from datetime import date
from pathlib import Path

def validate_path(rows,signal,*,before=False):
    days=[z['day'] for z in rows]
    try:
        if any(date.fromisoformat(d).isoformat()!=d for d in days):raise ValueError('BAD_PATH_DATE')
    except (TypeError,ValueError):raise ValueError('BAD_PATH_DATE')
    if days!=sorted(set(days)) or any((d>signal if before else d<=signal) for d in days):raise ValueError('PATH_DATE_ORDER')
    if before and (not days or days[-1]!=signal):raise ValueError('SIGNAL_BAR_MISSING')
    for b in rows:
        if not all(type(b[k]) is int and b[k]>0 for k in ('open','high','low','close')) or not b['low']<=min(b['open'],b['close'])<=max(b['open'],b['close'])<=b['high']:raise ValueError('BAD_PATH_OHLC')

def validate_hash_links(rows,hashes):
    if set(hashes)!={b['day'] for b in rows} or any(not isinstance(h,str) or not re.fullmatch(r'[a-f0-9]{64}',h) for h in hashes.values()):raise ValueError('PATH_HASH_LINK_MISMATCH')

def verify(cases,outcomes):
    lookup={x['id']:x for x in outcomes}
    if len(lookup)!=len(outcomes) or len({c['id'] for c in cases})!=len(cases) or set(lookup)!={c['id'] for c in cases}:raise ValueError('CASE_ID_MISMATCH')
    checked=0;exact_count=0;linked=0
    for c in cases:
        o=lookup[c['id']];path=o['post_bars'];pre=c['pre_bars']
        validate_path(pre,c['day'],before=True);validate_path(path,c['day'])
        if 'source_hashes' in c:validate_hash_links(pre,c['source_hashes']);linked+=1
        if 'source_hashes' in o:validate_hash_links(path,o['source_hashes']);linked+=1
        if 'landmark_bars' in o:
            exact=o['landmark_bars'];validate_path(exact,c['day'])
            if o.get('landmark_path_version')!=1:raise ValueError('BAD_LANDMARK_PATH_VERSION')
            if exact[:len(path)]!=path:raise ValueError('CHART_OUTCOME_PATH_MISMATCH')
            validate_hash_links(exact,o.get('landmark_source_hashes',{}));linked+=1;exact_count+=1
            for b in path:
                if 'source_hashes' in o and o['source_hashes'][b['day']]!=o['landmark_source_hashes'][b['day']]:raise ValueError('CHART_OUTCOME_HASH_MISMATCH')
        for h,r in o['horizons'].items():
            if r['status']!='OBSERVED':continue
            a=path[:int(h)]
            if len(a)!=int(h):raise ValueError('SHORT_OBSERVED_PATH')
            entry=a[0]['open'];high=max(x['high'] for x in a);low=min(x['low'] for x in a)
            for field,value in [('peak_pct',100*(high/entry-1)),('trough_pct',100*(low/entry-1))]:
                if not math.isclose(r[field],value,abs_tol=1e-8):raise ValueError('OUTCOME_PRICE_MISMATCH')
            if r['hit5']!=(high*100>=entry*105):raise ValueError('TARGET_MISMATCH')
            checked+=1
    return dict(cases=len(cases),exact_paths_checked=exact_count,hash_links_checked=linked,hash_check='LINKAGE_ONLY_NOT_RAW_SOURCE_REHASH',observed_horizons_checked=checked,source='SAME_STORED_OHLC_ARITHMETIC_CHECK_NOT_INDEPENDENT_MARKET_SOURCE',recommendation=False)

def candles(bars,signal):
    if not bars:return '<p>후속 가격 자료 없음</p>'
    lo=min(b['low'] for b in bars);hi=max(b['high'] for b in bars);span=max(hi-lo,1)
    y=lambda v:25+180*(hi-v)/span
    step=760/len(bars);parts=['<svg viewBox="0 0 800 235" role="img" aria-label="실제 저장 일봉 차트">']
    for i,b in enumerate(bars):
        x=25+(i+.5)*step;color='#c43832' if b['close']>=b['open'] else '#2468c4'
        tip=html.escape(f"{b['day']} O {b['open']} H {b['high']} L {b['low']} C {b['close']}")
        parts.append(f'<g><title>{tip}</title><line x1="{x}" x2="{x}" y1="{y(b["high"])}" y2="{y(b["low"])}" stroke="{color}"/><rect x="{x-step*.28}" y="{min(y(b["open"]),y(b["close"]))}" width="{step*.56}" height="{max(1,abs(y(b["open"])-y(b["close"])))}" fill="{color}"/></g>')
        if b['day']==signal:parts.append(f'<text x="{x}" y="225" text-anchor="middle" font-size="11">신호일</text>')
    parts.append(f'<text x="5" y="15" font-size="11">{hi:,}</text><text x="5" y="212" font-size="11">{lo:,}</text>')
    return ''.join(parts)+'</svg><small>'+html.escape(bars[0]['day']+' ~ '+bars[-1]['day'])+'</small>'

def render(cases,outcomes):
    audit=verify(cases,outcomes);lookup={x['id']:x for x in outcomes};parts=['<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>ENV20 실제 종목 검토</title><style>body{font:16px system-ui;max-width:960px;margin:24px auto;padding:16px;background:#f4f6fa;color:#172337}article{background:white;margin:20px 0;padding:20px;border-radius:12px}svg{width:100%}summary{cursor:pointer;padding:12px;background:#e9eef8}small{color:#526176}</style><h1>ENV20 실제 저장 종목 차트 검토</h1><p>동일 원천 가격의 산술 재검산입니다. 외부 시세·수정주가 독립 대조는 미완료입니다. 전체 사례를 코드·날짜순으로 표시하며 성과에 따라 선별하지 않습니다. 캔들에 포인터를 올리면 날짜와 OHLC를 확인할 수 있습니다.</p>']
    for c in sorted(cases,key=lambda c:c['id']):
        o=lookup[c['id']];pre=c['pre_bars'][-30:];post=o.get('landmark_bars',o['post_bars'])
        parts.append('<article><h2>'+html.escape((c.get('name') or '종목명 미등록')+' '+c['code']+' · '+c['day'])+'</h2><small>신호 ID '+html.escape(c['id'])+'</small>'+candles(pre,c['day']))
        parts.append('<details><summary>이후 실제 가격 경로·결과 펼치기</summary>'+candles(pre+post,c['day'])+'<pre>'+html.escape(json.dumps(o['horizons'],ensure_ascii=False,indent=2))+'</pre><p>경로 종료 사유: '+html.escape(o.get('landmark_end_status','LEGACY_FIXED_HORIZONS'))+'</p></details></article>')
    return ''.join(parts),audit

def main():
    p=argparse.ArgumentParser()
    for k in ('cases','outcomes','out'):p.add_argument('--'+k,type=Path,required=True)
    a=p.parse_args();read=lambda p:json.loads(p.read_text());page,audit=render(read(a.cases),read(a.outcomes))
    audit['input_sha256']={k:hashlib.sha256(getattr(a,k).read_bytes()).hexdigest() for k in ('cases','outcomes')}
    a.out.write_text(page);a.out.with_suffix('.audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2));print(json.dumps(audit))
if __name__=='__main__':main()

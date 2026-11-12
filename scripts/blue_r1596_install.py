#!/usr/bin/env python3
"""BLUE R1.5.9.6: fail-closed fixes for fresh saved quote, 413 request, and in-price controls."""
import argparse
from pathlib import Path

FILES=[
'web/src/search-priority.ts','web/src/main.tsx','web/src/PriceCompareMini.tsx',
'web/src/r1595-group-price.css','worker/src/search-quote-priority.ts',
'worker/src/price-compare.ts','web/src/price-compare.ts',
'collector/src/search-quote-priority.mjs'
]

def change(s,old,new,label):
    if new in s:
        print('R1596_ALREADY',label);return s
    if s.count(old)!=1:
        raise ValueError(f'R1596_ANCHOR_NOT_UNIQUE {label}, count={s.count(old)}')
    print('R1596_PATCH',label)
    return s.replace(old,new,1)

def patch_client(s):
    s=change(s,
" const r=await fetch(API+'/api/prices/request',{method:'POST',credentials:'include',cache:'no-store',signal,\n   headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({items:unique})});\n if(!r.ok)throw new Error(r.status===404?'빠른 시세 수집 API 배포 전':`시세 수집 요청 실패 (${r.status})`);",
" // Use an empty authenticated POST: a tiny batch no longer traverses body-size / content filters.\n // Access and Origin checks, verified search proof and quotas still apply on the Worker.\n const url=new URL(API+'/api/prices/request');\n url.searchParams.set('items',unique.map(x=>x.code+':'+x.day).join(','));\n const r=await fetch(url.toString(),{method:'POST',credentials:'include',cache:'no-store',signal});\n if(!r.ok){\n  const contentType=r.headers.get('content-type')||'';\n  let providerError='';\n  if(contentType.includes('application/json')){try{const json=await r.json() as {error?:string};providerError=json.error||'';}catch{}}\n  throw new Error(r.status===401?'Cloudflare Access 로그인 필요':\n   r.status===403?'접근 권한 또는 허용된 출처 확인 필요':\n   r.status===404?'우선 시세 수집 API 배포 필요':\n   r.status===413?`시세 요청 413 (빈 POST) · Cloudflare 요청 제한 확인 필요${providerError?' · '+providerError:''}`:\n   `시세 수집 요청 실패 (${r.status}${providerError?' '+providerError:''})`);\n }",
'empty-post-query-413')
    return s

def patch_worker_queue(s):
    s=change(s,
" const raw=await req.text();if(raw.length>3500)return reply({error:'PAYLOAD_TOO_LARGE'},413);\n let body:unknown;try{body=JSON.parse(raw);}catch{return reply({error:'INVALID_JSON'},400);}\n const items=decodeRequested((body as {items?:unknown})?.items,today());",
" const url=new URL(req.url);\n const queryItems=url.searchParams.get('items');\n let payload:unknown;\n if(queryItems!==null){\n  if(queryItems.length>200)return reply({error:'QUERY_TOO_LONG'},400);\n  const pairs=queryItems.split(',');\n  payload=pairs.map(pair=>{const [code,day,...rest]=pair.split(':');\n   return rest.length?null:{code,day};});\n }else{\n  // Backward compatibility with previously deployed web bundles.\n  const raw=await req.text();if(raw.length>3500)return reply({error:'PAYLOAD_TOO_LARGE'},413);\n  let body:unknown;try{body=JSON.parse(raw);}catch{return reply({error:'INVALID_JSON'},400);}\n  payload=(body as {items?:unknown})?.items;\n }\n const items=decodeRequested(payload,today());",
'query-post-server-413')
    return s

def patch_collector(s):
    s=change(s,
"  if(!token)return {status:'WAITING_TOKEN',count:due.results.length};",
"  if(!token){\n   // Persist the blocked reason without deleting any previously validated price.\n   const next=dateISO(now.getTime()+5*60000);\n   for(const item of due.results){\n    await db.prepare(\"UPDATE blue_search_quote_priority_r1594 SET status='WAITING_TOKEN',checked_at_utc=?,last_error='KIS_TOKEN_CACHE_UNAVAILABLE',next_due_utc=? WHERE code=?\")\n      .bind(stamp,next,item.code).run();\n   }\n   return {status:'WAITING_TOKEN',count:due.results.length};\n  }",
'collector-token-diagnostics')
    return s

def patch_compare(s):
    s=change(s,
" high_coverage_to:string|null;high_complete:boolean;\n};",
" high_coverage_to:string|null;high_complete:boolean;\n quote_status?:string|null;quote_checked_at?:string|null;quote_error?:string|null;\n};",
'compare-server-types')
    s=change(s,
"  const candidates:Observation[]=[];const highs:HighObservation[]=[];",
"  const candidates:Observation[]=[];const highs:HighObservation[]=[];\n  let quoteStatus:string|null=null,quoteCheckedAt:string|null=null,quoteError:string|null=null;",
'compare-init-diagnostics')
    s=change(s,
"   const q=await db.prepare(`SELECT status,trade_date,price,high,quote_at_utc,market\n      FROM blue_search_quote_priority_r1594 WHERE code=? LIMIT 1`).bind(code)\n     .first<{status:string;trade_date:string|null;price:number|null;high:number|null;quote_at_utc:string|null;market:string|null}>();\n   if(q&&['READY','QUEUED','RETRY'].includes(q.status)&&q.trade_date&&iso(q.trade_date)&&q.trade_date>day&&money(q.price)){",
"   const q=await db.prepare(`SELECT status,trade_date,price,high,quote_at_utc,market,checked_at_utc,last_error\n      FROM blue_search_quote_priority_r1594 WHERE code=? LIMIT 1`).bind(code)\n     .first<{status:string;trade_date:string|null;price:number|null;high:number|null;quote_at_utc:string|null;market:string|null;checked_at_utc:string|null;last_error:string|null}>();\n   if(q){quoteStatus=q.status;quoteCheckedAt=q.checked_at_utc;quoteError=q.last_error;}\n   // A temporarily blocked request cannot erase the last genuine observed price.\n   if(q&&['READY','QUEUED','RETRY','WAITING_TOKEN'].includes(q.status)&&q.trade_date&&iso(q.trade_date)&&q.trade_date>day&&money(q.price)){",
'compare-provide-queue-health')
    s=change(s,
"   period_high_source:high.source,high_coverage_to:high.coverageTo,high_complete:high.complete});",
"   high_coverage_to:high.coverageTo,high_complete:high.complete,\n   quote_status:quoteStatus,quote_checked_at:quoteCheckedAt,quote_error:quoteError});",
'compare-include-queue-health')
    return s

def patch_web_compare_type(s):
    return change(s,
" high_coverage_to:string|null;high_complete:boolean;\n};",
" high_coverage_to:string|null;high_complete:boolean;\n quote_status?:string|null;quote_checked_at?:string|null;quote_error?:string|null;\n};",
'web-compare-queue-types')

def patch_mini(s):
    s=change(s,
"export default function PriceCompareMini({data,baseline,loading=false,compact=false}: {data?:PriceCompare;baseline?:number|null;loading?:boolean;compact?:boolean}){",
"export default function PriceCompareMini({data,baseline,loading=false,compact=false,onRequest,requesting=false,requestDisabled=false}: {data?:PriceCompare;baseline?:number|null;loading?:boolean;compact?:boolean;onRequest?:()=>void;requesting?:boolean;requestDisabled?:boolean}){",
'mini-request-props')
    s=change(s,
" const hasHigh=typeof data?.period_high==='number'&&data.period_high>0&&!!data.period_high_day;",
" const hasHigh=typeof data?.period_high==='number'&&data.period_high>0&&!!data.period_high_day;\n const kstParts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date());\n const kst=Object.fromEntries(kstParts.map(x=>[x.type,x.value]));\n const today=`${kst.year}-${kst.month}-${kst.day}`;\n // A saved quote from a prior date is not advertised as today's price.\n // Weekend or pre-open snapshots remain clearly dated without false stale alarms.\n const oldQuote=hasLatest&&['Mon','Tue','Wed','Thu','Fri'].includes(kst.weekday)&&Number(kst.hour)>=10&&String(data!.latest_day)<today;\n const showRequest=!!onRequest&&!loading&&(!hasLatest||oldQuote);\n const queueWarning=data?.quote_status==='WAITING_TOKEN'?'KIS 토큰/인증 확인 필요':\n  data?.quote_status==='RETRY'?'시세 수집 재시도 예정':null;",
'mini-freshness-check')
    s=change(s,
"  <div className=\"r1593-compare-line\"><span>최근 확인가</span><strong>{hasLatest?cash(data!.latest_price):'—'}</strong>\n   <small>{hasLatest?<>{data!.latest_day} · {sourceName(data!.latest_source)}{data!.latest_market?' · '+(data!.latest_market==='J'?'KRX':data!.latest_market==='NX'?'NXT':data!.latest_market):''}{received(data!.latest_at)}{difference(data!.latest_price,baseline)}</>:loading?'저장 시세 조회 중':'후속 시세 미수집'}</small></div>",
"  <div className=\"r1593-compare-line\"><span>최근 확인가</span><strong>{hasLatest?cash(data!.latest_price):'—'}</strong>\n   {showRequest&&<button type=\"button\" className=\"r1596-inline-request\" disabled={requestDisabled||requesting} onClick={e=>{e.stopPropagation();onRequest?.();}} onKeyDown={e=>e.stopPropagation()}>{requesting?'요청 중…':'↻ 시세 갱신'}</button>}\n   <small>{hasLatest?<>{data!.latest_day} 기준 · {sourceName(data!.latest_source)}{data!.latest_market?' · '+(data!.latest_market==='J'?'KRX':data!.latest_market==='NX'?'NXT':data!.latest_market):''}{received(data!.latest_at)}{difference(data!.latest_price,baseline)}{oldQuote&&<span className=\"r1596-stale\"> · {today} 최신 시세 미확인</span>}</>:loading?'저장 시세 조회 중':'후속 시세 미수집'}{queueWarning&&<span className=\"r1596-stale\"> · {queueWarning}</span>}</small></div>",
'mini-price-action-stale-label')
    return s

def patch_main(s):
    s=change(s,
"                <PriceCompareMini data={r1593Prices[comparisonKey(r)]} baseline={r.close_price} loading={r1593Busy}/>\n                {!r1593Busy&&!r1593Prices[comparisonKey(r)]?.latest_price&&<button type=\"button\" className=\"r1595-request-price\"\n                  disabled={!!r1595Requesting||r1595Timers.current.size>=3} onClick={e=>{e.stopPropagation();void requestMissingQuote(r);}}\n                  onKeyDown={e=>e.stopPropagation()}>\n                    {r1595Requesting===comparisonKey(r)?'요청 중…':'시세 수집 요청'}</button>}",
"                <PriceCompareMini data={r1593Prices[comparisonKey(r)]} baseline={r.close_price} loading={r1593Busy}\n                  onRequest={()=>{void requestMissingQuote(r);}} requesting={r1595Requesting===comparisonKey(r)}\n                  requestDisabled={!!r1595Requesting||r1595Timers.current.size>=3}/>",
'desktop-inline-request')
    s=change(s,
"              <button className=\"stock-card\" onClick={()=>openDetail(r)} aria-label={`${displayName(r)} 상세 분석 보기`}>",
"              <div className=\"stock-card\" role=\"button\" tabIndex={0} onClick={()=>openDetail(r)}\n                onKeyDown={e=>{if(e.target===e.currentTarget&&(e.key==='Enter'||e.key===' ')){e.preventDefault();openDetail(r);}}}\n                aria-label={`${displayName(r)} 상세 분석 보기`}>",
'mobile-card-nonnested-button')
    s=change(s,
"              <PriceCompareMini compact data={r1593Prices[comparisonKey(r)]} baseline={r.close_price} loading={r1593Busy}/>",
"              <PriceCompareMini compact data={r1593Prices[comparisonKey(r)]} baseline={r.close_price} loading={r1593Busy}\n                onRequest={()=>{void requestMissingQuote(r);}} requesting={r1595Requesting===comparisonKey(r)}\n                requestDisabled={!!r1595Requesting||r1595Timers.current.size>=3}/>",
'mobile-inline-request')
    s=change(s,
"            </button>\n              <button type=\"button\" className={'r151-mobile-add '+(inBasket(r)?'saved':'')}",
"            </div>\n              <button type=\"button\" className={'r151-mobile-add '+(inBasket(r)?'saved':'')}",
'mobile-card-close')
    s=change(s,
"              {!r1593Busy&&!r1593Prices[comparisonKey(r)]?.latest_price&&<button type=\"button\"\n                className=\"r1595-request-price r1595-request-mobile\"\n                disabled={!!r1595Requesting||r1595Timers.current.size>=3}\n                onClick={()=>{void requestMissingQuote(r);}}>\n                 {r1595Requesting===comparisonKey(r)?'수집 요청 중…':'이 종목 시세 수집 요청'}</button>}",
"              {/* Quote refresh is now visible directly beside the saved quote above. */}",
'remove-low-visibility-mobile-action')
    s=change(s,
"        <PriceCompareMini compact data={r1593Prices[comparisonKey(selected)]} baseline={selected.close_price} loading={r1593Busy}/>",
"        <PriceCompareMini compact data={r1593Prices[comparisonKey(selected)]} baseline={selected.close_price} loading={r1593Busy}\n          onRequest={()=>{void requestMissingQuote(selected);}} requesting={r1595Requesting===comparisonKey(selected)}\n          requestDisabled={!!r1595Requesting||r1595Timers.current.size>=3}/>",
'detail-inline-request')
    return s

def patch_css(s):
    return change(s,
".r1595-request-status{font-size:11px;color:#42678e;margin:6px 0;line-height:1.5}",
".r1595-request-status{font-size:11px;color:#42678e;margin:6px 0;line-height:1.5}\n/* R1596: refresh adjacent to the observed price, not below the entire stock card. */\n.r1596-inline-request{display:inline-flex;align-items:center;justify-content:center;border:1px solid #8bb0e2;background:#e8f1ff;color:#1d57a8;border-radius:7px;padding:4px 7px;font-size:10px;font-weight:800;line-height:1.3;min-height:27px;white-space:nowrap;cursor:pointer}\n.r1596-inline-request:disabled{opacity:.55;cursor:default}\n.r1596-stale{color:#ae5544;font-weight:800}\n.r1593-compare-line>.r1596-inline-request{margin-left:auto;flex-shrink:0}\n@media(max-width:520px){.r1596-inline-request{padding:5px 7px;font-size:10px}.r1593-compare-line>.r1596-inline-request{margin-left:5px}}",
'price-action-css')

def patch_file(path,s):
    return {
      'web/src/search-priority.ts':patch_client,
      'worker/src/search-quote-priority.ts':patch_worker_queue,
      'collector/src/search-quote-priority.mjs':patch_collector,
      'worker/src/price-compare.ts':patch_compare,
      'web/src/price-compare.ts':patch_web_compare_type,
      'web/src/PriceCompareMini.tsx':patch_mini,
      'web/src/main.tsx':patch_main,
      'web/src/r1595-group-price.css':patch_css,
    }[path](s)

def install(root,apply=False):
    changed=[]
    for filename in FILES:
        p=root/filename
        if not p.is_file():raise FileNotFoundError(f'R1596_REQUIRED_MISSING {filename}')
        old=p.read_text(encoding='utf8');new=patch_file(filename,old)
        if old!=new:
            changed.append(filename)
            if apply:p.write_text(new,encoding='utf8')
    print('R1596_SCOPE',sorted(changed),'APPLY' if apply else 'CHECK')
    return changed

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--apply',action='store_true');ap.add_argument('--check',action='store_true');args=ap.parse_args()
    install(Path('.'),args.apply)

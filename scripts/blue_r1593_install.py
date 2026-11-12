#!/usr/bin/env python3
"""BLUE R1.5.9.3 narrow, idempotent patch (authenticated D1-only price comparisons).
Run from the checked-out BLUE-Signal-Lab repository root.
"""
from pathlib import Path
import argparse

CHANGES={}

def replace_once(path,step,old,new):
    source=CHANGES.get(path,Path(path).read_text(encoding='utf-8'))
    if (new and new in source) or (not new and old not in source):
        print('R1593_ALREADY',path,step);CHANGES[path]=source;return
    count=source.count(old)
    if count!=1:raise RuntimeError(f'R1593_ANCHOR_MISMATCH file={path} step={step} count={count}')
    CHANGES[path]=source.replace(old,new,1)
    print('R1593_PATCH',path,step)

def install(apply=False):
    CHANGES.clear()
    p='worker/src/index.ts'
    replace_once(p,'worker-import',"import {basketWatch} from './performance';",
      "import {basketWatch} from './performance';\nimport {comparePrices} from './price-compare';")
    replace_once(p,'protected-route',
      "      if (p === '/api/live/quotes' && request.method === 'GET') {",
      "      // R1593_PRICE_COMPARE: Access-protected, read-only saved price/history.\n"
      "      if (p === '/api/prices/compare' && request.method === 'GET') {\n"
      "        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);\n"
      "        const upstream=await comparePrices(env.DB,u);\n"
      "        return new Response(upstream.body,{status:upstream.status,headers:{...cors,\n"
      "          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});\n"
      "      }\n"
      "      if (p === '/api/live/quotes' && request.method === 'GET') {")

    p='web/src/main.tsx'
    replace_once(p,'main-import',"import SmartBasket from './SmartBasket';",
      "import SmartBasket from './SmartBasket';\nimport PriceCompareMini from './PriceCompareMini';\n"
      "import {comparisonKey,fetchCompared,type PriceCompare} from './price-compare';")
    replace_once(p,'main-compare-hook',"  const searchVersion=useRef(0);",
      "  const searchVersion=useRef(0);\n"
      "  // R1593: browser reads only validated D1 snapshots; no KIS call on search.\n"
      "  const [r1593Prices,setR1593Prices]=useState<Record<string,PriceCompare>>({});\n"
      "  const [r1593Busy,setR1593Busy]=useState(false);\n"
      "  const [r1593Error,setR1593Error]=useState('');\n"
      "  useEffect(()=>{\n"
      "    if(activeView!=='research'||!rows.length)return;\n"
      "    const ctrl=new AbortController();setR1593Busy(true);setR1593Error('');setR1593Prices({});\n"
      "    void fetchCompared(rows,ctrl.signal).then(result=>{if(!ctrl.signal.aborted)setR1593Prices(result);})\n"
      "      .catch(e=>{if(!ctrl.signal.aborted)setR1593Error(e instanceof Error?e.message:'최근 시세 확인 실패');})\n"
      "      .finally(()=>{if(!ctrl.signal.aborted)setR1593Busy(false);});\n"
      "    return ()=>ctrl.abort();\n"
      "  },[rows,activeView]);")
    replace_once(p,'result-info',
      '          <p className="result-hint">종목을 누르면 RSI · Slow · MACD · 돌파선 · 상단 매물대 정보를 볼 수 있습니다.</p>',
      '          <p className="result-hint">검색일 확정 종가와 이후 D1 저장 시세·기간 고가를 구분해 표시합니다. 가격이 없으면 미수집으로 표시합니다.</p>\n'
      '          {r1593Error&&<p className="r1593-comparison-status" role="status">가격 비교: {r1593Error}</p>}')
    replace_once(p,'desktop-column-header',
      '<th>종가</th><th>RSI / GC</th>',
      '<th>검색일 종가 / 최근 확인가 / 기간 최고가</th><th>RSI / GC</th>')
    replace_once(p,'desktop-prices',
      '</td><td>{money(r.close_price)}</td>\n              <td>{fmt(r,\'rsi\')}',
      '</td><td className="r1593-price-cell"><strong>{money(r.close_price)}원</strong><small> · 검색일 종가</small>\n'
      '                <PriceCompareMini data={r1593Prices[comparisonKey(r)]} baseline={r.close_price} loading={r1593Busy}/>\n'
      '              </td>\n              <td>{fmt(r,\'rsi\')}')
    replace_once(p,'mobile-prices',
      '<ChevronRight size={19} className="stock-chevron"/></div>\n              <div className="stock-tags">',
      '<ChevronRight size={19} className="stock-chevron"/></div>\n'
      '              <PriceCompareMini compact data={r1593Prices[comparisonKey(r)]} baseline={r.close_price} loading={r1593Busy}/>\n'
      '              <div className="stock-tags">')
    replace_once(p,'detail-prices',
      '        <div className="study-tags">{selected.signals.map(s=><span key={s}>{showSignal(s)}</span>)}</div>',
      '        <PriceCompareMini compact data={r1593Prices[comparisonKey(selected)]} baseline={selected.close_price} loading={r1593Busy}/>\n'
      '        <div className="study-tags">{selected.signals.map(s=><span key={s}>{showSignal(s)}</span>)}</div>')

    p='web/src/SmartBasket.tsx'
    replace_once(p,'basket-import',"import './r158-long-watch.css';",
      "import './r158-long-watch.css';\nimport {comparisonKey,fetchCompared,sourceName,type PriceCompare} from './price-compare';")
    replace_once(p,'basket-hook',
      " const idsKey=items.map(x=>perfId(x)).join(',');",
      " const idsKey=items.map(x=>perfId(x)).join(',');\n"
      " // R1593: mirror shared, read-only D1 price records; preserve existing Watch queue.\n"
      " const [r1593Prices,setR1593Prices]=useState<Record<string,PriceCompare>>({});\n"
      " const [r1593Error,setR1593Error]=useState('');\n"
      " useEffect(()=>{\n"
      "  if(!active||!idsKey)return;const ctrl=new AbortController();let loading=false;\n"
      "  const load=async()=>{if(loading||document.visibilityState==='hidden')return;loading=true;\n"
      "   try{const result=await fetchCompared(items,ctrl.signal);if(!ctrl.signal.aborted){setR1593Prices(result);setR1593Error('');}}\n"
      "   catch(e){if(!ctrl.signal.aborted)setR1593Error(e instanceof Error?e.message:'최근 시세 확인 실패');}\n"
      "   finally{loading=false;}\n"
      "  };\n"
      "  void load();const timer=window.setInterval(()=>{void load();},30000);\n"
      "  const wake=()=>{if(document.visibilityState==='visible')void load();};\n"
      "  document.addEventListener('visibilitychange',wake);\n"
      "  return ()=>{ctrl.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',wake);};\n"
      " },[active,idsKey]);")
    replace_once(p,'basket-pct',
      "  const pr=performance[perfId(x)];const price=pr?.quote_day&&pr.quote_day>x.day&&pr.quote_day>=(pr.recent_day||'')",
      "  const verified=r1593Prices[comparisonKey(x)];\n"
      "  if(verified?.latest_day&&verified.latest_day>x.day&&verified.latest_price)\n"
      "    return pctChange(verified.latest_price,x.baseline);\n"
      "  const pr=performance[perfId(x)];const price=pr?.quote_day&&pr.quote_day>x.day&&pr.quote_day>=(pr.recent_day||'')")
    replace_once(p,'basket-error',
      '   {performanceError&&<p className="basket-alert" role="status">시세 수집 연결: {performanceError}</p>}',
      '   {performanceError&&<p className="basket-alert" role="status">시세 수집 연결: {performanceError}</p>}\n'
      '   {r1593Error&&<p className="r1593-comparison-status" role="status">D1 저장 시세 비교: {r1593Error}</p>}')
    replace_once(p,'basket-observation-merge',
      "     const maxHigh=intradayHigh&&(!dailyHigh||intradayHigh>dailyHigh)?intradayHigh:dailyHigh;\n"
      "     const maxHighDay=maxHigh===intradayHigh?pr?.quote_day:pr?.highest_day;\n"
      "     const pending=!pr||['QUEUED','NOT_REGISTERED','HISTORY_PARTIAL'].includes(pr.status);",
      "     const comp=r1593Prices[comparisonKey(it)];\n"
      "     const compareRecent=comp?.latest_day&&comp.latest_day>it.day&&comp.latest_price?comp.latest_price:null;\n"
      "     const shownRecent=compareRecent??recent??(q&&q.trade_date_kst>it.day?q.price:null);\n"
      "     const shownRecentDay=compareRecent?comp?.latest_day:recent?recentDay:q&&q.trade_date_kst>it.day?q.trade_date_kst:null;\n"
      "     const shownSource=compareRecent?sourceName(comp?.latest_source):recent?'기존 KIS 수집기':'KIS 저장 시세';\n"
      "     const highs=[\n"
      "       ...(intradayHigh?[{price:intradayHigh,day:pr?.quote_day||'',source:'장중 관측'}]:[]),\n"
      "       ...(dailyHigh?[{price:dailyHigh,day:pr?.highest_day||'',source:'KIS 일봉'}]:[]),\n"
      "       ...(comp?.period_high?[{price:comp.period_high,day:comp.period_high_day||'',source:comp.high_complete?'수집 기간':'부분 관측'}]:[])\n"
      "     ];\n"
      "     const highest=highs.sort((a,b)=>b.price-a.price)[0];\n"
      "     const maxHigh=highest?.price??null,maxHighDay=highest?.day||null;\n"
      "     const pending=!pr||['QUEUED','NOT_REGISTERED','HISTORY_PARTIAL'].includes(pr.status);")
    replace_once(p,'basket-render-high',
      "         <small>{maxHigh?`${pctText(pctChange(maxHigh,it.baseline))} · ${maxHighDay||''}${maxHigh===intradayHigh?' (장중 관측)':''}`:pending?'수집 중':'이후 거래 없음 / 미확인'}</small></div>",
      "         <small>{maxHigh?`${pctText(pctChange(maxHigh,it.baseline))} · ${maxHighDay||''} · ${highest?.source||'저장 시세'}${comp?.high_coverage_to?' · '+comp.high_coverage_to+'까지 확인':''}`:pending?'수집 중':'기간 고가 미확인'}</small></div>")
    replace_once(p,'basket-render-recent',
      "       <div><span>최근 확인가</span><b>{recent?`${cash(recent)}원`:q&&q.trade_date_kst>it.day?`${cash(q.price)}원`:baselineOnly?`${cash(it.baseline)}원`:'—'}</b>\n"
      "         <small>{recentDay||((q&&q.trade_date_kst>it.day)?q.trade_date_kst:baselineOnly?it.day:'확인 대기')}{quoteIsLater?' · 장중 관측':recent?' · 확정 종가':q&&q.trade_date_kst>it.day?' · 기존 KIS 저장 시세':baselineOnly?' · 검색일 기준가':''}</small></div>",
      "       <div><span>최근 확인가</span><b>{shownRecent?`${cash(shownRecent)}원`:'—'}</b>\n"
      "         <small>{shownRecentDay?`${shownRecentDay} · ${shownSource}`:'후속 시세 미수집'} · 실시간 체결가 아님</small></div>")
    replace_once(p,'basket-unused-vars',
      "     const baselineOnly=pr?.status==='WAITING_NEXT_SESSION'&&!recent&&!(q&&q.trade_date_kst>it.day);\n",
      "")

    if apply:
        for path,content in CHANGES.items():
            Path(path).write_text(content,encoding='utf-8')
        print('R1593_APPLIED',sorted(CHANGES))
    else:print('R1593_ANCHORS_OK',sorted(CHANGES))

if __name__=='__main__':
    parser=argparse.ArgumentParser();mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check',action='store_true');mode.add_argument('--apply',action='store_true')
    args=parser.parse_args();install(args.apply)

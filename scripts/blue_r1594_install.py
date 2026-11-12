#!/usr/bin/env python3
"""BLUE R1.5.9.4 narrowly scoped, idempotent source patch. Fail closed on drift."""
from pathlib import Path
import argparse

class PatchError(RuntimeError): pass

def change(s, old, new, label):
    if new in s:
        print('R1594_ALREADY',label)
        return s
    n=s.count(old)
    if n != 1:
        raise PatchError(f'R1594_ANCHOR_NOT_UNIQUE {label}: count={n}')
    print('R1594_PATCH',label)
    return s.replace(old,new,1)


def patch_main(s):
    s=change(s,
        "import PriceCompareMini from './PriceCompareMini';",
        "import PriceCompareMini from './PriceCompareMini';\nimport {requestSearchPriority} from './search-priority';",
        'main-search-priority-import')
    s=change(s,"import './r1591-evidence-basket.css';",
        "import './r1591-evidence-basket.css';\nimport './r1594-refresh.css';",'main-refresh-css')
    s=change(s,
        "  const searchVersion=useRef(0);\n  // R1593:",
        "  const searchVersion=useRef(0);\n  const [r1594Refresh,setR1594Refresh]=useState(0);\n  const [r1594TrackingRefresh,setR1594TrackingRefresh]=useState(0);\n  const [r1594BasketRefresh,setR1594BasketRefresh]=useState(0);\n  const [r1594AiRefresh,setR1594AiRefresh]=useState(0);\n  const [r1594QueueStatus,setR1594QueueStatus]=useState('');\n  // R1593:",
        'main-refresh-states')
    # Original statement contains the replacement as a prefix; do not use `change` here.
    old_reset="setR1593Busy(true);setR1593Error('');setR1593Prices({});"
    new_reset="setR1593Busy(true);setR1593Error('');"
    if old_reset in s:
        if s.count(old_reset)!=1:raise PatchError('R1594_ANCHOR_NOT_UNIQUE main-keep-previous-saved-prices')
        s=s.replace(old_reset,new_reset,1)
        print('R1594_PATCH main-keep-previous-saved-prices')
    elif new_reset in s:print('R1594_ALREADY main-keep-previous-saved-prices')
    else:raise PatchError('R1594_ANCHOR_MISSING main-keep-previous-saved-prices')
    s=change(s,
        "  },[rows,activeView]);\n\n  useEffect(()=>{",
        "  },[rows,activeView,r1594Refresh]);\n\n  // R1594: submit at most eight verified visible search symbols to the server queue.\n  // This does NOT block the D1 search and NEVER calls KIS from the browser.\n  useEffect(()=>{\n    if(activeView!=='research'||!rows.length)return;\n    const ctrl=new AbortController();let count=0;let timer=0;\n    const priority=rows.filter(x=>/^\\d{6}$/.test(x.code)&&x.close_price!==null&&x.close_price>0)\n      .filter((x,i,a)=>a.findIndex(y=>y.code===x.code)===i).slice(0,8);\n    setR1594QueueStatus('저장 시세는 즉시 조회 · 신규 시세 수집 요청 중');\n    void requestSearchPriority(priority,ctrl.signal).then(result=>{\n      if(ctrl.signal.aborted)return;\n      const n=result.queued;\n      setR1594QueueStatus(n?`KIS 서버 우선 수집 대기 ${n}종목 · 저장 시세를 자동 재확인합니다`:\n        result.throttled?'최근 요청된 종목 · 저장 시세 확인 중':'저장 시세 확인 중');\n      if(n||result.throttled){timer=window.setInterval(()=>{\n        if(ctrl.signal.aborted||document.visibilityState==='hidden'||++count>12){window.clearInterval(timer);return;}\n        void fetchCompared(priority,ctrl.signal).then(prices=>{\n          if(!ctrl.signal.aborted)setR1593Prices(previous=>({...previous,...prices}));\n        }).catch(()=>{});\n      },12000);}\n    }).catch(e=>{if(!ctrl.signal.aborted)setR1594QueueStatus(e instanceof Error?e.message:'우선 수집 요청 실패');});\n    return ()=>{ctrl.abort();window.clearInterval(timer);};\n  },[rows,activeView,r1594Refresh]);\n\n  useEffect(()=>{",
        'main-priority-effect')
    s=change(s,
        "  const openDetail=(r:Signal)=>setSelected(r);",
        "  const refreshCurrentView=()=>{\n    if(activeView==='research'){\n      setR1594Refresh(v=>v+1);\n      void loadDates().catch(e=>setR1593Error(String(e)));\n      if(total!==null)void search(page,false);\n    }else if(activeView==='tracking')setR1594TrackingRefresh(v=>v+1);\n    else if(activeView==='basket')setR1594BasketRefresh(v=>v+1);\n    else setR1594AiRefresh(v=>v+1);\n  };\n  const openDetail=(r:Signal)=>setSelected(r);",
        'main-refresh-handler')
    s=change(s,
        '    {(watchDate||completedDate||scanInfo)&&<div className="r1581-scan-monitor" role="status">',
        '''    <div className="r1594-view-toolbar" role="group" aria-label="현재 화면 데이터 새로고침">
      <span>{({research:'종목 검색',tracking:'종목 추적',ai:'AI 시황',basket:'장바구니'} as const)[activeView]}</span>
      <button type="button" disabled={activeView==='research'&&(busy||requestBusy)}
        onClick={refreshCurrentView}><RefreshCw size={16}/> 새로고침</button>
    </div>
    {(watchDate||completedDate||scanInfo)&&<div className="r1581-scan-monitor" role="status">''',
        'main-header-refresh-control')
    s=change(s,
        '<SmartBasket quickAddRequest={basketRequest} onItemsChange={setBasketIds} active={activeView===\'basket\'}/>',
        '<SmartBasket quickAddRequest={basketRequest} onItemsChange={setBasketIds} active={activeView===\'basket\'} refreshKey={r1594BasketRefresh}/>',
        'main-basket-refresh-prop')
    s=change(s,
        '<LiveMarket active={activeView===\'tracking\'}/>',
        '<LiveMarket active={activeView===\'tracking\'} refreshKey={r1594TrackingRefresh}/>',
        'main-tracking-refresh-prop')
    s=change(s,
        "<AiWidget key={'market-'+(mode==='single'?date:latest||end)} kind=\"market\"",
        "<AiWidget key={'market-'+(mode==='single'?date:latest||end)+'-'+r1594AiRefresh} kind=\"market\"",
        'main-ai-refresh-key')
    s=change(s,
        '          {r1593Error&&<p className="r1593-comparison-status" role="status">가격 비교: {r1593Error}</p>}',
        '''          {r1593Error&&<p className="r1593-comparison-status" role="status">가격 비교: {r1593Error}</p>}
          {rows.length>0&&<p className="r1594-quote-note" role="status">{r1594QueueStatus} · 수집 가능한 시장 시간에만 KIS 가격이 갱신됩니다.</p>}''',
        'main-priority-status')
    return s


def patch_basket(s):
    s=change(s,
        'export default function SmartBasket({quickAddRequest,onItemsChange,active=true}: {',
        'export default function SmartBasket({quickAddRequest,onItemsChange,active=true,refreshKey=0}: {',
        'basket-refresh-prop-value')
    s=change(s,
        ' onItemsChange?:(ids:string[])=>void;\n active?:boolean;\n}){',
        ' onItemsChange?:(ids:string[])=>void;\n active?:boolean;\n refreshKey?:number;\n}){',
        'basket-refresh-prop-type')
    s=change(s,
        ' },[active,idsKey]);\n // Register immediately after any new item',
        ' },[active,idsKey,refreshKey]);\n // Register immediately after any new item',
        'basket-refresh-price-comparison')
    s=change(s,
        ' },[active,idsKey]);\n // R1591: gently recover evidence',
        ' },[active,idsKey,refreshKey]);\n // R1591: gently recover evidence',
        'basket-refresh-watch-status')
    s=change(s,
        '  return()=>{mounted=false;window.clearInterval(id);};\n },[]);',
        '  return()=>{mounted=false;window.clearInterval(id);};\n },[refreshKey]);',
        'basket-refresh-live-snapshots')
    return s


def patch_tracking(s):
    s=change(s,
        'export default function LiveMarket({active=true}: {active?:boolean}){',
        'export default function LiveMarket({active=true,refreshKey=0}: {active?:boolean;refreshKey?:number}){',
        'tracking-refresh-prop')
    s=change(s,
        ' },[active]);\n const items=useMemo(',
        ' },[active,refreshKey]);\n const items=useMemo(',
        'tracking-restart-poll')
    return s


def patch_index(s):
    s=change(s,
        "import {comparePrices} from './price-compare';",
        "import {comparePrices} from './price-compare';\nimport {requestSearchQuotes} from './search-quote-priority';",
        'api-queue-import')
    s=change(s,
        "      if (p === '/api/live/quotes' && request.method === 'GET') {",
        '''      // R1.5.9.4: authenticated batch request, no direct browser KIS access.
      if (p === '/api/prices/request' && request.method === 'POST') {
        if (!access) return respond({error:'ACCESS_REQUIRED'},401);
        if (request.headers.get('Origin')!==origin) return respond({error:'ORIGIN_DENIED'},403);
        const upstream=await requestSearchQuotes(request,env.DB);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      if (p === '/api/live/quotes' && request.method === 'GET') {''',
        'api-queue-protected-route')
    return s


def patch_compare(s):
    s=change(s,
        "'blue_kis_live_quotes_r14','chart_snapshots')",
        "'blue_kis_live_quotes_r14','chart_snapshots','blue_search_quote_priority_r1594')",
        'api-compare-table-detection')
    s=change(s,
        "  for(const table of ['blue_kis_live_quotes_r141','blue_kis_live_quotes_r14']){",
        '''  // Search-triggered KIS REST snapshots: latest observed only, not full-period coverage.
  if(tables.has('blue_search_quote_priority_r1594')){
   const q=await db.prepare(`SELECT status,trade_date,price,high,quote_at_utc,market
      FROM blue_search_quote_priority_r1594 WHERE code=? LIMIT 1`).bind(code)
     .first<{status:string;trade_date:string|null;price:number|null;high:number|null;quote_at_utc:string|null;market:string|null}>();
   if(q&&['READY','QUEUED','RETRY'].includes(q.status)&&q.trade_date&&iso(q.trade_date)&&q.trade_date>day&&money(q.price)){
    candidates.push({price:q.price!,day:q.trade_date,source:'KIS_SEARCH_PRIORITY_R1594',
      at:q.quote_at_utc,market:q.market,priority:85});
    if(money(q.high)&&q.high! >= q.price!)highs.push({price:q.high!,day:q.trade_date,
      source:'KIS_SEARCH_PRIORITY_DAY_HIGH_R1594',coverageTo:q.trade_date,full:false});
   }
  }
  for(const table of ['blue_kis_live_quotes_r141','blue_kis_live_quotes_r14']){''',
        'api-compare-fast-quote-candidate')
    return s


def patch_priceclient(s):
    return change(s,
        "  case 'KIS_STORED_SNAPSHOT':return 'KIS 저장 시세';",
        "  case 'KIS_STORED_SNAPSHOT':return 'KIS 저장 시세';\n  case 'KIS_SEARCH_PRIORITY_R1594':return 'KIS 우선 수집 시세';\n  case 'KIS_SEARCH_PRIORITY_DAY_HIGH_R1594':return 'KIS 우선 수집 장중 고가';",
        'web-source-labels')


def patch_collector(s):
    s=change(s,
        "import {collectBasket} from './basket.mjs';",
        "import {collectBasket} from './basket.mjs';\nimport {collectSearchPriority} from './search-quote-priority.mjs';",
        'collector-fast-import')
    s=change(s,
        "      await collectBasket(env); // prioritize newly added watch symbols",
        "      await collectSearchPriority(env).catch(()=>{console.warn('BLUE_R1594_PRIORITY_UNAVAILABLE');});\n      await collectBasket(env); // prioritize newly added watch symbols",
        'collector-fast-before-watch')
    return s

ACTIONS={
 'web/src/main.tsx':patch_main,
 'web/src/SmartBasket.tsx':patch_basket,
 'web/src/LiveMarket.tsx':patch_tracking,
 'web/src/price-compare.ts':patch_priceclient,
 'worker/src/index.ts':patch_index,
 'worker/src/price-compare.ts':patch_compare,
 'collector/src/index.mjs':patch_collector,
}

def install(root:Path,mode:str):
    output={}
    for name,fn in ACTIONS.items():
        p=root/name
        if not p.is_file():raise PatchError('R1594_MISSING_'+name)
        initial=p.read_text(encoding='utf-8')
        final=fn(initial)
        output[name]=final
    if mode=='apply':
        for name,content in output.items():(root/name).write_text(content,encoding='utf-8')
    print('R1594_ANCHORS_OK',sorted(output))
    return output

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    mode=parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check',action='store_true')
    mode.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    install(Path('.'),'apply' if args.apply else 'check')

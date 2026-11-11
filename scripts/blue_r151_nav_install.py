#!/usr/bin/env python3
"""BLUE R1.5.1 UI-only upgrade: independent basket tab and one-tap basket add.
Safe to run in GitHub Actions on an ephemeral checkout. No API, D1 or trading code touched.
"""
from __future__ import annotations
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / 'web/src/main.tsx'
BASKET = ROOT / 'web/src/SmartBasket.tsx'
CSS = ROOT / 'web/src/r151-navigation.css'


def once(src: str, old: str, new: str, label: str) -> str:
    count=src.count(old)
    if count != 1:
        raise RuntimeError(f'R151_SHAPE_DRIFT: {label}: expected one anchor, found {count}')
    return src.replace(old,new,1)


def patch_main(src: str) -> str:
    assert 'import SmartBasket from' in src, 'R1.5 module required'
    if 'R151_BASKET_TAB' in src:
        return src
    src=once(src,
        'import {Search, CalendarDays, BarChart3, AlertCircle, RefreshCw, SlidersHorizontal, ListFilter, X, ChevronRight, Download, ArrowLeft, Activity, Clock3, Database, CheckCircle2} from \'lucide-react\';',
        'import {Search, CalendarDays, BarChart3, AlertCircle, RefreshCw, SlidersHorizontal, ListFilter, X, ChevronRight, Download, ArrowLeft, Activity, Clock3, Database, CheckCircle2, ShoppingBasket} from \'lucide-react\';',
        'icon imports')
    src=once(src,"import './ai.css';", "import './ai.css';\nimport './r151-navigation.css';",'css import')
    src=once(src,'  const [marketAiOpen,setMarketAiOpen]=useState(false);',
        '''  // R151_BASKET_TAB: keep both workspaces mounted, toggle only visibility.
  const [activeView,setActiveView]=useState<'research'|'basket'>('research');
  const [basketIds,setBasketIds]=useState<string[]>(()=>{
    try{const x=JSON.parse(localStorage.getItem('blue_r15_basket_v1')||'[]');
      return Array.isArray(x)?x.filter((i:unknown)=>Boolean(i&&typeof i==='object'&&'id' in i)).map((i:any)=>String(i.id)):[];
    }catch{return [];}
  });
  const basketSequence=useRef(0);
  const [basketRequest,setBasketRequest]=useState<{serial:number;item:Signal}|null>(null);
  const [marketAiOpen,setMarketAiOpen]=useState(false);''','view state')
    src=once(src,
        "  const flip=(t:string)=>setSignals(a=>a.includes(t)?a.filter(s=>s!==t):[...a,t]);",
        '''  const flip=(t:string)=>setSignals(a=>a.includes(t)?a.filter(s=>s!==t):[...a,t]);
  const inBasket=(r:Signal)=>basketIds.includes(`MANUAL:${r.code}:${r.day}`);
  const canBasket=(r:Signal)=>/^\\d{6}$/.test(r.code)&&typeof r.close_price==='number'&&r.close_price>0;
  const quickBasket=(r:Signal)=>{
    if(!canBasket(r)||inBasket(r)||basketIds.length>=100)return;
    setBasketRequest({serial:++basketSequence.current,item:{...r,name:displayName(r)}});
  };''','quick add')
    src=once(src,
        "  const nav=(target:'search'|'results'|'summary'|'ai')=>{\n    if(target==='search'){setFilterOpen(true);setTimeout(()=>formRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),20);}",
        "  const nav=(target:'search'|'results'|'summary'|'ai'|'basket')=>{\n    if(target==='basket'){setActiveView('basket');window.setTimeout(()=>window.scrollTo({top:0,behavior:'smooth'}),15);return;}\n    setActiveView('research');\n    if(target==='search'){setFilterOpen(true);setTimeout(()=>formRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),20);}",
        'nav route')
    src=once(src,
        "    </header>\n    {installGuide",
        """    </header>
    <nav className="r151-main-tabs" role="tablist" aria-label="BLUE 기능 화면">
      <button type="button" role="tab" aria-selected={activeView==='research'}
        className={activeView==='research'?'active':''} onClick={()=>{setActiveView('research');window.scrollTo({top:0,behavior:'smooth'});}}>
        <BarChart3 size={18}/> 종목 검색 · AI 시황
      </button>
      <button type="button" role="tab" aria-selected={activeView==='basket'}
        className={activeView==='basket'?'active':''} onClick={()=>nav('basket')}>
        <ShoppingBasket size={18}/> AI 스마트 장바구니 <span className="r151-basket-count">{basketIds.length}</span>
      </button>
    </nav>
    {installGuide""",'top tabs')
    src=once(src,'    <main className="app-main">',
        '    <main className={"app-main "+(activeView===\'basket\'?\'r151-basket-mode\':\'\')}>',
        'main mode')
    src=once(src,
        '      <section className="content">\n        <LiveMarket />\n        <SmartBasket searchRows={rows} />',
        '''      <section className="content">
        <div className={'r151-basket-content '+(activeView==='basket'?'':'r151-hidden')}>
          <SmartBasket searchRows={rows} quickAddRequest={basketRequest} onItemsChange={setBasketIds}/>
        </div>
        <div className={'r151-research-content '+(activeView==='research'?'':'r151-hidden')}>
        <LiveMarket />''',
        'basket separate view')
    src=once(src,
        '        <p className="disclaimer"><AlertCircle size={14}/> RSI·MACD·유효선 후보·상단 매물대 강도는 연구용 계산값이며 현재가·실제 호가 매물대가 아닙니다. R0.8 이전 분석 기록은 재분석해야 신규 정보가 표시됩니다.</p>\n      </section>',
        '        <p className="disclaimer"><AlertCircle size={14}/> RSI·MACD·유효선 후보·상단 매물대 강도는 연구용 계산값이며 현재가·실제 호가 매물대가 아닙니다. R0.8 이전 분석 기록은 재분석해야 신규 정보가 표시됩니다.</p>\n        </div>\n      </section>',
        'close research view')
    src=once(src,
        '<td>{r.day}</td><td><b>{displayName(r)}</b><div className="small">{r.code}</div></td>',
        '''<td>{r.day}</td><td><div className="r151-desktop-stock">
                 <div><b>{displayName(r)}</b><div className="small">{r.code}</div></div>
                 <button type="button" className={'r151-quick-add '+(inBasket(r)?'saved':'')}
                   title={inBasket(r)?'이미 담긴 종목':'장바구니에 담기'}
                   aria-label={`${displayName(r)} ${inBasket(r)?'장바구니에 담김':'장바구니에 담기'}`}
                   disabled={inBasket(r)||!canBasket(r)||basketIds.length>=100}
                   onClick={e=>{e.stopPropagation();quickBasket(r);}}
                   onKeyDown={e=>e.stopPropagation()}>
                   {inBasket(r)?<CheckCircle2 size={16}/>:<ShoppingBasket size={16}/>}
                 </button>
               </div></td>''','desktop add icon')
    src=once(src,
        '{visibleRows.length?visibleRows.map((r,i)=><button key={`${r.code}-${r.day}-${i}`} className="stock-card" onClick={()=>openDetail(r)} aria-label={`${displayName(r)} 상세 분석 보기`}>',
        '''{visibleRows.length?visibleRows.map((r,i)=><div className="r151-mobile-row" key={`${r.code}-${r.day}-${i}`}>
              <button className="stock-card" onClick={()=>openDetail(r)} aria-label={`${displayName(r)} 상세 분석 보기`}>''',
        'mobile card wrapper')
    src=once(src,
        '</button>):<div className="mobile-empty"><Search size={30}/>',
        '''</button>
              <button type="button" className={'r151-mobile-add '+(inBasket(r)?'saved':'')}
                title={inBasket(r)?'장바구니에 담김':'장바구니에 담기'}
                aria-label={`${displayName(r)} ${inBasket(r)?'장바구니에 담김':'장바구니에 담기'}`}
                disabled={inBasket(r)||!canBasket(r)||basketIds.length>=100}
                onClick={()=>quickBasket(r)}>
                {inBasket(r)?<CheckCircle2 size={19}/>:<ShoppingBasket size={19}/>}
                <span>{inBasket(r)?'담김':'담기'}</span>
              </button></div>):<div className="mobile-empty"><Search size={30}/>''',
        'mobile add icon')
    src=once(src,
        '''      <button className="dock-primary" onClick={()=>nav('ai')}><Activity size={20}/><span>AI 시황</span></button>
      <button onClick={()=>nav('summary')}><Activity size={20}/><span>요약</span></button>''',
        '''      <button className={activeView==='research'?'dock-primary':''} onClick={()=>nav('ai')}><Activity size={20}/><span>AI 시황</span></button>
      <button className={activeView==='basket'?'dock-primary':''} onClick={()=>nav('basket')}><ShoppingBasket size={20}/><span>장바구니</span></button>''',
        'mobile dock')
    # Ensure all expected UI changes are present and there is only one basket instance.
    assert src.count('<SmartBasket searchRows={rows} quickAddRequest={basketRequest} onItemsChange={setBasketIds}/>')==1
    assert src.count('r151-mobile-add')==1
    return src


def patch_basket(src:str)->str:
    if 'R151_QUICK_ADD' in src:return src
    src=once(src,
        "export default function SmartBasket({searchRows}: {searchRows:SearchRow[]}){",
        '''// R151_QUICK_ADD: controlled one-tap requests from the search results list.
export default function SmartBasket({searchRows,quickAddRequest,onItemsChange}: {
 searchRows:SearchRow[];
 quickAddRequest?:{serial:number;item:SearchRow}|null;
 onItemsChange?:(ids:string[])=>void;
}){''',
        'basket prop signature')
    src=once(src,
        " const [quotes,setQuotes]=useState<Quotes|null>(null);",
        """ const [quotes,setQuotes]=useState<Quotes|null>(null);
 useEffect(()=>{onItemsChange?.(items.map(x=>x.id));},[items,onItemsChange]);
 useEffect(()=>{
  if(quickAddRequest)add(quickAddRequest.item,'MANUAL');
  // Only react to new requests, not unrelated changes to basket items.
 },[quickAddRequest]);""",
        'basket bridge')
    return src


def run()->None:
    if not MAIN.exists() or not BASKET.exists() or not CSS.exists():
        raise SystemExit('R151_NEEDS_SOURCE_AND_CSS: run from repo root with payload restored')
    main0=MAIN.read_text(encoding='utf8'); basket0=BASKET.read_text(encoding='utf8')
    main1=patch_main(main0);basket1=patch_basket(basket0)
    # Compute all changes before changing any file. Never edit existing web or API server unexpectedly.
    if main1!=main0:MAIN.write_text(main1,encoding='utf8')
    if basket1!=basket0:BASKET.write_text(basket1,encoding='utf8')
    print('R151_BASKET_TABS_READY',{'main_changed':main1!=main0,'basket_changed':basket1!=basket0})

if __name__=='__main__':run()

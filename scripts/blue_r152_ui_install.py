#!/usr/bin/env python3
"""Install BLUE R1.5.2 four independent workspaces + compact basket, UI only.
Target repository state: R1.5.1 applied. Strict markers; fail rather than overwrite mismatched source.
"""
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[1]
MAIN=ROOT/'web/src/main.tsx'
BASKET=ROOT/'web/src/SmartBasket.tsx'
LIVE=ROOT/'web/src/LiveMarket.tsx'
CSS=ROOT/'web/src/r152-four-tabs.css'


def once(source, before, after, name):
    n=source.count(before)
    if n!=1:
        raise RuntimeError(f'R152_ANCHOR_MISMATCH {name}: occurrences={n}')
    return source.replace(before,after,1)

def rex_once(source, pattern, replacement, name):
    updated,n=re.subn(pattern,replacement,source,count=1,flags=re.S)
    if n!=1: raise RuntimeError(f'R152_REGEX_MISMATCH {name}: matches={n}')
    return updated

def update_main(text):
    if 'R152_FOUR_TABS' in text:
        return text
    if 'R151_BASKET_TAB' not in text: raise RuntimeError('R1.5.1 must be installed first')
    text=once(text,'CheckCircle2, ShoppingBasket} from \'lucide-react\';',
        'CheckCircle2, ShoppingBasket, Radar} from \'lucide-react\';','icon')
    text=once(text,"import './r151-navigation.css';", "import './r151-navigation.css';\nimport './r152-four-tabs.css';",'css')
    text=once(text,"  const [activeView,setActiveView]=useState<'research'|'basket'>('research');",
        "  // R152_FOUR_TABS: separate search, live tracking, AI briefing and basket.\n  const [activeView,setActiveView]=useState<'research'|'tracking'|'ai'|'basket'>('research');",'activeView')
    text=once(text,"  const [marketAiOpen,setMarketAiOpen]=useState(false);\n",'', 'obsolete accordion state')
    old_nav="""  const nav=(target:'search'|'results'|'summary'|'ai'|'basket')=>{
    if(target==='basket'){setActiveView('basket');window.setTimeout(()=>window.scrollTo({top:0,behavior:'smooth'}),15);return;}
    setActiveView('research');
    if(target==='search'){setFilterOpen(true);setTimeout(()=>formRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),20);}
    if(target==='results')resultRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
    if(target==='summary')summaryRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
    if(target==='ai'){setMarketAiOpen(true);window.setTimeout(()=>aiRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),30);}
  };"""
    new_nav="""  const nav=(target:'search'|'results'|'summary'|'ai'|'basket'|'tracking')=>{
    if(target==='basket'||target==='tracking'||target==='ai'){
      setActiveView(target);
      window.setTimeout(()=>window.scrollTo({top:0,behavior:'smooth'}),20);
      return;
    }
    setActiveView('research');
    if(target==='search'){
      setFilterOpen(true);
      window.setTimeout(()=>formRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),35);
    }else if(target==='results'){
      window.setTimeout(()=>resultRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),35);
    }else if(target==='summary'){
      window.setTimeout(()=>summaryRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),35);
    }
  };"""
    text=once(text,old_nav,new_nav,'navigation')
    top_start='    <nav className="r151-main-tabs" role="tablist" aria-label="BLUE 기능 화면">'
    i=text.find(top_start)
    if i<0: raise RuntimeError('R152 top tabs start missing')
    j=text.find('    </nav>',i)
    if j<0: raise RuntimeError('R152 top tabs end missing')
    tabs="""    <nav className="r152-main-tabs" role="tablist" aria-label="BLUE 주요 기능">
      <button type="button" role="tab" aria-selected={activeView==='research'}
        className={activeView==='research'?'active':''} onClick={()=>nav('search')}>
        <BarChart3 size={18}/><span>종목 검색</span>
      </button>
      <button type="button" role="tab" aria-selected={activeView==='tracking'}
        className={activeView==='tracking'?'active':''} onClick={()=>nav('tracking')}>
        <Radar size={18}/><span>종목 추적</span>
      </button>
      <button type="button" role="tab" aria-selected={activeView==='ai'}
        className={activeView==='ai'?'active':''} onClick={()=>nav('ai')}>
        <Activity size={18}/><span>AI 시황</span>
      </button>
      <button type="button" role="tab" aria-selected={activeView==='basket'}
        className={activeView==='basket'?'active':''} onClick={()=>nav('basket')}>
        <ShoppingBasket size={18}/><span>장바구니</span><span className="r151-basket-count">{basketIds.length}</span>
      </button>
    </nav>"""
    text=text[:i]+tabs+text[j+len('    </nav>'):]
    text=once(text,'<main className={"app-main "+(activeView===\'basket\'?\'r151-basket-mode\':\'\')}>',
        '<main className={"app-main "+(activeView!==\'research\'?\'r152-full-mode\':\'\')}>','main display class')
    text=once(text,'<SmartBasket searchRows={rows} quickAddRequest={basketRequest} onItemsChange={setBasketIds}/>',
        '<SmartBasket quickAddRequest={basketRequest} onItemsChange={setBasketIds}/>','basket searchRows prop')
    research='''        <div className={'r151-research-content '+(activeView==='research'?'':'r151-hidden')}>
        <LiveMarket />'''
    replacement='''        <div className={'r152-tracking-content '+(activeView==='tracking'?'':'r151-hidden')}>
          <LiveMarket active={activeView==='tracking'}/>
        </div>
        <div className={'r152-ai-content '+(activeView==='ai'?'':'r151-hidden')}>
          <section ref={aiRef} id="ai-panel" className="r152-ai-section">
            <AiWidget key={'market-'+(mode==='single'?date:latest||end)} kind="market"
              date={mode==='single'?date:latest||end}
              observed={mode==='single'?days.find(d=>d.day===date)?.observed_stocks:null}
              matched={mode==='single'?days.find(d=>d.day===date)?.matched_stocks:null}
              events={mode==='single'?days.find(d=>d.day===date)?.signal_events:null}
              searchMatched={rows}/>
          </section>
        </div>
        <div className={'r151-research-content '+(activeView==='research'?'':'r151-hidden')}>'''
    text=once(text,research,replacement,'tracking and AI views')
    text=rex_once(text,r'\n        <section ref=\{aiRef\} id="ai-panel" className="ai-accordion" style=\{\{scrollMarginTop:12\}\}>.*?\n        </section>\n', '\n','remove old accordion')
    old_bottom="""    <nav className="mobile-dock" aria-label="모바일 메뉴">
      <button onClick={()=>nav('search')}><SlidersHorizontal size={20}/><span>검색</span></button>
      <button onClick={()=>nav('results')}><BarChart3 size={20}/><span>종목 결과</span></button>
      <button className={activeView==='research'?'dock-primary':''} onClick={()=>nav('ai')}><Activity size={20}/><span>AI 시황</span></button>
      <button className={activeView==='basket'?'dock-primary':''} onClick={()=>nav('basket')}><ShoppingBasket size={20}/><span>장바구니</span></button>
    </nav>"""
    new_bottom="""    <nav className="mobile-dock" aria-label="모바일 메뉴">
      <button className={activeView==='research'?'dock-primary':''} onClick={()=>nav('search')}><BarChart3 size={20}/><span>검색</span></button>
      <button className={activeView==='tracking'?'dock-primary':''} onClick={()=>nav('tracking')}><Radar size={20}/><span>추적</span></button>
      <button className={activeView==='ai'?'dock-primary':''} onClick={()=>nav('ai')}><Activity size={20}/><span>AI 시황</span></button>
      <button className={activeView==='basket'?'dock-primary':''} onClick={()=>nav('basket')}><ShoppingBasket size={20}/><span>장바구니</span></button>
    </nav>"""
    text=once(text,old_bottom,new_bottom,'mobile dock')
    # Search runs, details, chart, AI and basket state all remain mounted on view switches.
    if text.count("<LiveMarket active={activeView==='tracking'}/>")!=1 or text.count('className="r152-main-tabs"')!=1:
        raise RuntimeError('R152 tab invariants failed')
    return text

def update_basket(text):
    if 'R152_COMPACT_BASKET' in text:return text
    if 'R151_QUICK_ADD' not in text:raise RuntimeError('R1.5.1 SmartBasket missing')
    text=once(text,"import {useEffect,useMemo,useState} from 'react';","import {useEffect,useState} from 'react';",'memo removal')
    text=once(text,"import {Bot,BookmarkPlus,Download,Upload,Trash2,RefreshCw,AlertCircle,ShoppingBasket,Plus,CheckCircle2} from 'lucide-react';",
        "import {Bot,Download,Upload,Trash2,RefreshCw,AlertCircle,ShoppingBasket} from 'lucide-react';",'basket imports')
    text=once(text,'export default function SmartBasket({searchRows,quickAddRequest,onItemsChange}: {\n searchRows:SearchRow[];\n',
        'export default function SmartBasket({quickAddRequest,onItemsChange}: {\n','remove searchRows prop')
    text=once(text," const [lookup,setLookup]=useState('');\n",'', 'lookup state')
    text=once(text," const [aiBusy,setAiBusy]=useState(false);\n",
        "  const [aiBusy,setAiBusy]=useState(false);\n  // R152_COMPACT_BASKET: AI results stay collapsed until requested.\n  const [showAi,setShowAi]=useState(false);\n",'compact marker')
    text=once(text,"   setAi(d);if(d.status==='PENDING')", "   setAi(d);if(d.status==='READY')setShowAi(true);if(d.status==='PENDING')",'expand after generation')
    text=rex_once(text,r'\n const choices=useMemo\(\(\)=>searchRows.filter\(.*?\[searchRows,lookup\]\);','', 'choices removal')
    start=text.find(' return <section className="panel blue-basket"')
    if start<0:raise RuntimeError('basket return missing')
    marker='  {error&&<p className="basket-alert"'
    end=text.find(marker,start)
    if end<0:raise RuntimeError('basket error marker missing')
    compact='''  return <section className="panel blue-basket r152-basket-compact" id="blue-basket" aria-labelledby="blue-basket-h">
   <header className="r152-basket-head">
     <div><h2 id="blue-basket-h"><ShoppingBasket size={18}/> AI 스마트 장바구니 <small>R1.5.2</small></h2>
       <p>검색 결과의 장바구니 아이콘으로 직접 담고, 이곳에서 AI 후보와 비교합니다.</p></div>
     <button type="button" className="r152-ai-generate" disabled={aiBusy} onClick={()=>void generateAi()}>
       {aiBusy?<RefreshCw size={17}/>:<Bot size={17}/>}{aiBusy?'AI 분석 중…':'AI 후보 만들기'}
     </button>
   </header>
   <div className="r152-basket-kpis" aria-label="장바구니 현황">
     <div><span>내 선택</span><strong>{items.filter(x=>x.source==='MANUAL').length}</strong></div>
     <div><span>AI 선택</span><strong>{items.filter(x=>x.source==='AI').length}</strong></div>
     <div><span>성과 차이</span><strong>{comparable?((machine.avg??0)-(manual.avg??0)>0?'+':'')+((machine.avg??0)-(manual.avg??0)).toFixed(2)+'%p':'—'}</strong></div>
   </div>
   {ai?.status==='READY'&&<details className="r152-ai-candidates" open={showAi} onToggle={e=>setShowAi(e.currentTarget.open)}>
     <summary><span>AI 관찰 후보 <strong>{(ai.items||[]).length}종목</strong></span><small>{ai.asof} · {ai.cached?'저장된 분석':'새 분석'}</small></summary>
     <div className="basket-ai-results"><small>Gemini 검토 결과 · {ai.model}</small>
       {!(ai.items||[]).length&&<p className="basket-muted">AI가 이번 거래일의 후보를 보류했습니다.</p>}
       {(ai.items||[]).map(p=><article key={p.code}><div><b>{p.name} ({p.code})</b>
         <span>기준 종가 {cash(p.close_price)}원</span></div><p>{p.reason||'관찰 근거 추가 확인 필요'}</p>
         <small>반대 시나리오: {p.risk||'미기재'}</small><small>다음 확인: {p.watch||'미기재'}</small>
         <button type="button" disabled={items.some(x=>x.id===`AI:${p.code}:${p.day}`)} onClick={()=>add(p,'AI')}>
           {items.some(x=>x.id===`AI:${p.code}:${p.day}`)?'AI 관찰함에 담김':'AI 관찰함에 담기'}</button>
       </article>)}
     </div>
   </details>}
   {ai&&ai.status!=='READY'&&ai.status!=='NOT_CACHED'&&ai.status!=='PENDING'&&<p className="basket-muted">{ai.message||'최근 확정 일봉 데이터가 없습니다.'}</p>}
'''
    text=text[:start]+compact+text[end:]
    text=once(text,'아직 담긴 종목이 없습니다. 위에서 검색 결과를 선택하거나 AI 후보를 생성하세요.',
        '아직 담긴 종목이 없습니다. 검색 결과에서 담기 아이콘을 누르거나 AI 후보를 생성하세요.','empty state')
    more_before='''     {it.source==='AI'&&<p className="basket-insight">AI 관찰 근거: {it.reason||'미기재'} · 위험: {it.risk||'미기재'}</p>}
     <label className="basket-memo">관찰 메모<input value={it.memo} maxLength={240} placeholder="추세선·거래량·다음 확인 항목" onChange={e=>setItems(old=>old.map(x=>x.id===it.id?{...x,memo:e.target.value}:x))}/></label>'''
    more_after='''     <details className="r152-record-more"><summary>메모 · 관찰 근거</summary>
       {it.source==='AI'&&<p className="basket-insight">AI 관찰 근거: {it.reason||'미기재'} · 위험: {it.risk||'미기재'}</p>}
       <label className="basket-memo">관찰 메모<input value={it.memo} maxLength={240} placeholder="추세선·거래량·다음 확인 항목" onChange={e=>setItems(old=>old.map(x=>x.id===it.id?{...x,memo:e.target.value}:x))}/></label>
     </details>'''
    text=once(text,more_before,more_after,'record compact details')
    end='''  <p className="basket-foot">연구 전용 · 등록 기준은 실제 체결가가 아닌 과거 확정 종가입니다. 성과는 후속 KRX 수집 스냅샷이 있을 때만 참고 비교하며, 최신 체결 확인·수수료·세금·배당·수정주가를 반영하지 않습니다. AI 후보는 검증된 투자 우위가 아닙니다. 장바구니는 현재 브라우저에만 저장됩니다.</p>'''
    replace=end+'''
   <details className="r152-data-management"><summary>데이터 관리 · 기기 변경 시 백업</summary>
     <div className="basket-actions"><button type="button" onClick={saveBackup}><Download size={15}/> 백업 저장</button>
       <label className="basket-import"><Upload size={15}/> 백업 가져오기<input type="file" accept=".json,application/json" onChange={e=>{void importBackup(e.target.files?.[0]);e.target.value='';}}/></label>
     </div>
   </details>'''
    text=once(text,end,replace,'backup preservation in collapsed management')
    if 'choices.map' in text or 'searchRows.filter' in text or 'basket-picker basket-ai' in text: raise RuntimeError('unused manual picker remains')
    return text

def update_live(text):
    if 'R152_TRACKING_ACTIVE' in text:return text
    text=once(text,'export default function LiveMarket(){',
        '''// R152_TRACKING_ACTIVE: suspended polling while the tracking tab is inactive.
export default function LiveMarket({active=true}: {active?:boolean}){''', 'live prop')
    text=once(text,"if(inFlight||document.visibilityState==='hidden')return;",
        "if(!active||inFlight||document.visibilityState==='hidden')return;",'poll guard')
    text=once(text,' },[]);\n const items=useMemo', ' },[active]);\n const items=useMemo','effect dependency')
    return text

def main():
    for path in (MAIN,BASKET,LIVE,CSS):
        if not path.exists():raise RuntimeError(f'Missing {path}; ensure files are in BLUE repo')
    before={MAIN:MAIN.read_text(encoding='utf-8'),BASKET:BASKET.read_text(encoding='utf-8'),LIVE:LIVE.read_text(encoding='utf-8')}
    updated={MAIN:update_main(before[MAIN]),BASKET:update_basket(before[BASKET]),LIVE:update_live(before[LIVE])}
    # Compute all updates first: no partial writes if a strict anchor fails.
    if '--check' in sys.argv:
        print('R152_ANCHORS_AND_TRANSFORM_OK')
        return
    for path,content in updated.items():
        if content!=before[path]:path.write_text(content,encoding='utf-8')
    print('R152_UI_APPLIED',*[f'{x.name}={updated[x]!=before[x]}' for x in updated])

if __name__=='__main__':
    main()

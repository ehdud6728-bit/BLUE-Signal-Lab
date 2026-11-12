#!/usr/bin/env python3
"""BLUE Signal Lab R1.5.7 reviewed UI patch. No mutations of research selection rules."""
import argparse
from pathlib import Path

class AnchorError(RuntimeError): pass

def replace_once(text, old, new, path):
    n=text.count(old)
    if n != 1:
        raise AnchorError(f'R157_ANCHOR_MISMATCH {path}: matches={n} :: {old[:110]!r}')
    return text.replace(old,new,1)

def patch_basket(s):
    path='web/src/SmartBasket.tsx'
    s=replace_once(s,
        ".filter(s=>/^[A-Za-z0-9_\\-]{2,48}$/.test(s)).map(s=>s.replace(/^BB/i,'BLUE')))];",
        ".filter(s=>/^[A-Za-z0-9_\\-]{2,48}$/.test(s)).map(s=>s.replace(/^(?:BLUE|BB)(?=\\d)/i,'B')))];",path)
    s=replace_once(s,
        " const [filter,setFilter]=useState<'ALL'|'MANUAL'|'AI'>('ALL');",
        " const [filter,setFilter]=useState<'ALL'|'MANUAL'|'AI'>('ALL');\n // R157_BASKET_FILTERS: local display filters; persisted basket order/data never changed.\n const [rank,setRank]=useState<'RECENT'|'GAIN_TOP'|'LOSS_TOP'>('RECENT');\n const [dayFilter,setDayFilter]=useState('ALL');\n const [query,setQuery]=useState('');",path)
    start="   setAi(d);if(d.status==='READY')setShowAi(true);if(d.status==='PENDING')setMessage('다른 요청에서 분석 중입니다. 잠시 뒤 화면을 다시 열어 주세요.');"
    end="""    setAi(d);
    if(d.status==='READY'){
     // R157_AI_AUTO_ADD: only server-verified picks, never invent a basket item.
     const picked=(Array.isArray(d.items)?d.items:[]).filter(p=>validCode(p.code)&&validDay(p.day)&&
       Number.isFinite(p.close_price)&&p.close_price>0).slice(0,6);
     const already=new Set(items.map(x=>x.id));
     const unique=picked.filter(p=>!already.has(`AI:${p.code}:${p.day}`));
     setItems(old=>{
      const existing=new Set(old.map(x=>x.id));
      const room=Math.max(0,100-old.length);
      const additions=unique.filter(p=>!existing.has(`AI:${p.code}:${p.day}`)).slice(0,room).map(p=>({
       id:`AI:${p.code}:${p.day}`,source:'AI' as const,code:p.code,name:p.name||p.code,
       day:p.day,baseline:p.close_price,added_at:new Date().toISOString(),signals:p.signals||[],
       memo:'',reason:p.reason,risk:p.risk,watch:p.watch
      }));
      return additions.length?[...additions,...old]:old;
     });
     setShowAi(false);setFilter('AI');setDayFilter('ALL');setRank('RECENT');setQuery('');
     setMessage(picked.length?`AI 후보 ${picked.length}종목 확인 · 신규 ${Math.min(unique.length,Math.max(0,100-items.length))}종목 자동 등록 · 기존 후보는 중복 제외`:
       'AI가 이번 기준일의 관찰 후보를 보류했습니다.');
    }
    if(d.status==='PENDING')setMessage('다른 요청에서 분석 중입니다. 잠시 뒤 화면을 다시 열어 주세요.');"""
    s=replace_once(s,start,end,path)
    s=replace_once(s,
        """         <button type="button" disabled={items.some(x=>x.id===`AI:${p.code}:${p.day}`)} onClick={()=>add(p,'AI')}>
           {items.some(x=>x.id===`AI:${p.code}:${p.day}`)?'AI 관찰함에 담김':'AI 관찰함에 담기'}</button>""",
        """          <small className="r157-auto-picked">{items.some(x=>x.id===`AI:${p.code}:${p.day}`)?'자동 등록됨':'AI 후보 생성 버튼으로 자동 등록'}</small>""",path)
    s=replace_once(s,
        " const visible=items.filter(x=>filter==='ALL'||x.source===filter);",
        """ // R157_FILTER_SOURCE: keep source/date/name filtering independent of saved records.
 const availableDays=[...new Set(items.map(x=>x.day))].sort((a,b)=>b.localeCompare(a));
 const normalizedQuery=query.trim().toLocaleLowerCase('ko-KR');
 const scoped=items.filter(x=>(filter==='ALL'||x.source===filter)&&
   (dayFilter==='ALL'||x.day===dayFilter)&&
   (!normalizedQuery||x.code.includes(normalizedQuery)||x.name.toLocaleLowerCase('ko-KR').includes(normalizedQuery)));""",path)
    s=replace_once(s,
        " const summary=(kind:'MANUAL'|'AI')=>{",
        """  const visible=rank==='RECENT'?scoped:
    scoped.filter(x=>{const v=pct(x);return v!==null&&(rank==='GAIN_TOP'?v>0:v<0);})
     .sort((a,b)=>{
      const left=pct(a)??0,right=pct(b)??0;
      return (rank==='GAIN_TOP'?right-left:left-right)||a.day.localeCompare(b.day)||a.code.localeCompare(b.code);
     }).slice(0,10);
  const summary=(kind:'MANUAL'|'AI')=>{""",path)
    s=replace_once(s,
        """  {!visible.length?<div className="basket-empty">아직 담긴 종목이 없습니다. 검색 결과에서 담기 아이콘을 누르거나 AI 후보를 생성하세요.</div>:""",
        """   <div className="r157-basket-filters" aria-label="장바구니 정렬과 검색">
     <div className="r157-rank-pills" role="group" aria-label="수익률 필터">
      {([['RECENT','최신 등록'],['GAIN_TOP','상승 TOP 10'],['LOSS_TOP','하락 TOP 10']] as const).map(([key,label])=><button
       key={key} type="button" className={rank===key?'active':''} aria-pressed={rank===key} onClick={()=>setRank(key)}>{label}</button>)}
     </div>
     <div className="r157-filter-controls">
      <label>발견일 <select aria-label="발견 날짜" value={dayFilter} onChange={e=>setDayFilter(e.target.value)}>
       <option value="ALL">전체 날짜</option>{availableDays.map(day=><option key={day} value={day}>{day}</option>)}
      </select></label>
      <input type="search" aria-label="종목명 또는 종목코드 검색" value={query} onChange={e=>setQuery(e.target.value)} placeholder="종목명 · 코드 검색"/>
     </div>
     <p className="r157-filter-count">{visible.length}종목 표시{rank!=='RECENT'?' · 확인된 검색일 이후 수익률만 순위에 포함':''} · 전체 저장 {items.length}종목</p>
   </div>
   {!visible.length?<div className="basket-empty">{items.length?'선택한 조건에 해당하는 종목이 없습니다. 필터를 바꿔 주세요.':'아직 담긴 종목이 없습니다. 검색 결과에서 담거나 AI 후보 만들기를 눌러 주세요.'}</div>:""",path)
    s=replace_once(s,
        'AI 스마트 장바구니 <small>R1.5.4</small>',
        'AI 스마트 장바구니 <small>R1.5.7</small>',path)
    return s

def patch_live(s):
    path='web/src/LiveMarket.tsx'
    s=replace_once(s,
        ' change_from_eod_pct:number|null;day_range_position_pct:number|null;',
        ' change_from_eod_pct:number|null;change_from_prev_close_pct?:number|null;day_range_position_pct:number|null;',path)
    s=replace_once(s,
        ".map(s=>s.replace(/^BB/i,'BLUE')))];",
        ".map(s=>s.replace(/^(?:BLUE|BB)(?=\\d)/i,'B')))];",path)
    s=replace_once(s,
        "const phaseName:Record<string,string>=",
        """// R157_MOBILE_PRICE: label the source of each change; old snapshots only have signal-day change.
const performance=(q:Quote)=>typeof q.change_from_prev_close_pct==='number'&&Number.isFinite(q.change_from_prev_close_pct)
 ?{value:q.change_from_prev_close_pct,label:'전일 종가 대비'}
 :{value:q.change_from_eod_pct,label:'신호일 종가 대비'};
const percent=(n:number|null)=>n===null?'—':`${n>0?'+':''}${n.toFixed(2)}%`;
const trend=(n:number|null)=>n===null?'':n>0?'blue-live-up':n<0?'blue-live-down':'';
const phaseName:Record<string,string>=""",path)
    s=replace_once(s,'KIS KRX·NXT 종목 추적 <small>R1.5.4 UI</small>',
       'KIS KRX·NXT 종목 추적 <small>R1.5.7 UI</small>',path)
    s=replace_once(s,'<th>전일 종가 대비</th>','<th>가격 변화</th>',path)
    s=replace_once(s,
      """    <td className={'blue-live-number '+(q.change_from_eod_pct==null?'':q.change_from_eod_pct>0?'blue-live-up':q.change_from_eod_pct<0?'blue-live-down':'')}>
      {q.change_from_eod_pct==null?'—':`${q.change_from_eod_pct>0?'+':''}${q.change_from_eod_pct.toFixed(2)}%`}</td>""",
      """    <td className={'blue-live-number '+trend(performance(q).value)}>
      {percent(performance(q).value)}<small>{performance(q).label}</small></td>""",path)
    anchor='  <p className="blue-live-disclaimer"><AlertTriangle size={14}/>'
    card="""  {!!items.length&&<div className="r157-live-cards" aria-label="종목 추적 모바일 카드">
   {items.map(q=><article className="r157-track-card" key={q.market+'-'+q.code}>
    <div className="r157-track-main">
     <div className="r157-track-identity"><strong>{q.name||q.code}</strong>
      <small>{q.code} · {q.market_label} {phaseName[q.phase]||q.phase}</small></div>
     <div className="r157-track-price"><strong>{money(q.price)}원</strong>
      <b className={trend(performance(q).value)}>{percent(performance(q).value)}</b>
      <small>{performance(q).label}</small></div>
    </div>
    <div className="r157-track-meta">신호일 {q.eod_asof||'미확인'} · 추적 최초 확인 {firstDate(q.tracking_started_at_utc)}
      {q.tracking_start_source==='RETAINED_HISTORY'?' (보관 기록 기준)':''}</div>
    <details className="r157-track-details"><summary>신호·추적 관점 보기</summary>
     <p>관찰 근거: {signalLabels(q.eod_signals).length?signalLabels(q.eod_signals).slice(0,6).join(' · '):'원본 신호 확인 불가'}</p>
     <p>관찰 관점: 신호 이후 가격·변동 및 추세 유지 확인</p>
     <p>거래일 {q.reported_trade_day_matches_today===true?'일치':q.reported_trade_day_matches_today===false?'불일치':'미확인'} · 누적 거래량 {money(q.accumulated_volume)} · 수집 {timeKST(q.received_at_utc)}</p>
    </details>
   </article>)}
  </div>}
"""
    s=replace_once(s,anchor,card+anchor,path)
    return s

def patch_main(s):
    path='web/src/main.tsx'
    s=replace_once(s,"import './r155-ai-repair.css';", "import './r155-ai-repair.css';\n// R157_UI_FILTERS\nimport './r157-ui.css';",path)
    s=replace_once(s,"const showSignal=(t:string)=>t.replace(/^BB/,'BLUE');",
      "const showSignal=(t:string)=>t.replace(/^(?:BLUE|BB)(?=\\d)/i,'B');",path)
    return s

def patch_collector(s):
    path='collector/src/core.mjs'
    target="""  const hhmmss=String(o.stck_cntg_hour||'');
  return {code:candidate.code,name:candidate.name,market,market_label:market==='J'?'KRX':'NXT',phase,"""
    replace="""  const hhmmss=String(o.stck_cntg_hour||'');
   // R157_PREV_CLOSE: KIS provider-supplied percentage, NOT the scanner signal-day return.
   // Absence or invalid values remain null for older snapshots; never fabricate a prior close.
   const prevRaw=String(o.prdy_ctrt??'').trim();
   const prevPct=prevRaw!==''?Number(prevRaw):NaN;
   const changeFromPrev=Number.isFinite(prevPct)&&prevPct>=-100&&prevPct<=1000
     ?Math.round(prevPct*100)/100:null;
  return {code:candidate.code,name:candidate.name,market,market_label:market==='J'?'KRX':'NXT',phase,"""
    s=replace_once(s,target,replace,path)
    s=replace_once(s,
       '    change_from_eod_pct:Math.round((price/candidate.eod_close-1)*1e6)/1e4,',
       '    change_from_eod_pct:Math.round((price/candidate.eod_close-1)*1e6)/1e4,\n    change_from_prev_close_pct:changeFromPrev,',path)
    return s

def patch_worker_live(s):
    path='worker/src/live.ts'
    s=replace_once(s,
      '  change_from_eod_pct:number|null;day_range_position_pct:number|null;',
      '   change_from_eod_pct:number|null;change_from_prev_close_pct?:number|null;day_range_position_pct:number|null;',path)
    return s

def patch_test(s):
    path='collector/test/core.test.mjs'
    anchor="test('D1 100 parameter SQL limit is preserved at 40 valid market quotes',()=>{"
    insert="""test('R1.5.7 prior-day return is provider-derived, absent values are null',()=>{
  const candidate=normalizeCandidate(seed(),'R141_VERIFIED_EOD_ARTIFACT');
  const withPct={...quote,output:{...quote.output,prdy_ctrt:'-1.23'}};
  const q=parseQuote(candidate,'J','KRX_REGULAR',withPct,at(9,5),'2026-11-11');
  assert.equal(q.change_from_prev_close_pct,-1.23);
  assert.equal(parseQuote(candidate,'J','KRX_REGULAR',quote,at(9,5),'2026-11-11').change_from_prev_close_pct,null);
  const invalid={...quote,output:{...quote.output,prdy_ctrt:'not-a-number'}};
  assert.equal(parseQuote(candidate,'J','KRX_REGULAR',invalid,at(9,5),'2026-11-11').change_from_prev_close_pct,null);
});

"""
    s=replace_once(s,anchor,insert+anchor,path)
    return s

PATCHES={
 'web/src/SmartBasket.tsx':patch_basket,
 'web/src/LiveMarket.tsx':patch_live,
 'web/src/main.tsx':patch_main,
 'collector/src/core.mjs':patch_collector,
 'worker/src/live.ts':patch_worker_live,
 'collector/test/core.test.mjs':patch_test,
}

def main():
    a=argparse.ArgumentParser();mode=a.add_mutually_exclusive_group(required=True)
    mode.add_argument('--check',action='store_true');mode.add_argument('--apply',action='store_true')
    args=a.parse_args();out={}
    for path,patch in PATCHES.items():
        p=Path(path)
        if not p.is_file():raise SystemExit('R157_FILE_MISSING '+path)
        original=p.read_text(encoding='utf-8')
        # Safe reruns after successful commit.
        if ('R157_BASKET_FILTERS' in original if path.endswith('SmartBasket.tsx') else
            'R157_MOBILE_PRICE' in original if path.endswith('LiveMarket.tsx') else
            'R157_UI_FILTERS' in original if path.endswith('main.tsx') else
            'R157_PREV_CLOSE' in original if path.endswith('core.mjs') else
            'change_from_prev_close_pct?:number|null' in original if path.endswith('live.ts') else
            "R1.5.7 prior-day return" in original):
            print('R157_ALREADY_PATCHED',path);continue
        out[path]=patch(original)
        print('R157_VALIDATED',path,'updated=True')
    if args.apply:
        for path,updated in out.items():Path(path).write_text(updated,encoding='utf-8')
    print('R157_CHECK_OK' if args.check else 'R157_APPLY_OK')

if __name__=='__main__':main()

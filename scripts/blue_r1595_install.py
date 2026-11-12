#!/usr/bin/env python3
"""R1.5.9.5 additive safe source edits; no DB schema, credential, trade or scanner changes."""
from pathlib import Path
import argparse

class PatchError(RuntimeError): pass

def change(s,old,new,name):
    if new in s:
        print('R1595_ALREADY',name)
        return s
    hits=s.count(old)
    if hits!=1:
        raise PatchError(f'R1595_ANCHOR_NOT_UNIQUE {name} count={hits}')
    print('R1595_PATCH',name)
    return s.replace(old,new,1)


def patch_basket(s):
    s=change(s,
      "import {Bot,Download,Upload,Trash2,RefreshCw,AlertCircle,ShoppingBasket,Bookmark,BookmarkCheck} from 'lucide-react';",
      "import {Bot,Download,Upload,Trash2,RefreshCw,AlertCircle,ShoppingBasket,Bookmark,BookmarkCheck,ChevronDown} from 'lucide-react';\nimport {groupBasketRecords} from './basket-grouping';\nimport './r1595-group-price.css';",
      'basket-group-imports')
    s=change(s,
      " const [rank,setRank]=useState<'RECENT'|'GAIN_TOP'|'LOSS_TOP'>('RECENT');",
      " const [rank,setRank]=useState<'RECENT'|'GAIN_TOP'|'LOSS_TOP'>('RECENT');\n const [groupSimilar,setGroupSimilar]=useState(true);\n const [expandedCodes,setExpandedCodes]=useState<string[]>([]);",
      'basket-toggle-states')
    s=change(s,
      'const result=await fetchCompared(items,ctrl.signal);if(!ctrl.signal.aborted){setR1593Prices(result);setR1593Error(\'\');}',
      'const result=await fetchCompared(items,ctrl.signal,partial=>{if(!ctrl.signal.aborted)setR1593Prices(prev=>({...prev,...partial}));});if(!ctrl.signal.aborted){setR1593Prices(prev=>({...prev,...result}));setR1593Error(\'\');}',
      'basket-stream-batches')
    s=change(s,
      " const manual=summary('MANUAL'),machine=summary('AI');",
      " const displayGroups=groupBasketRecords(visible,groupSimilar);\n const manual=summary('MANUAL'),machine=summary('AI');",
      'basket-display-groups')
    s=change(s,
      "     <p className=\"r157-filter-count\">{visible.length}종목 표시{rank!=='RECENT'?' · 확인된 검색일 이후 수익률만 순위에 포함':''} · 일반 {normalCount} · 장기 {lockedCount}건</p>",
      """     <p className="r157-filter-count">{visible.length}개 발견 기록 · {new Set(visible.map(x=>x.code)).size}종목{rank!=='RECENT'?' · 확인된 후속 수익률 기준':''} · 일반 {normalCount} · 장기 {lockedCount}건</p>
     <div className="r1595-display-controls"><span>같은 종목의 날짜별 발견가·수익률은 별도 보존</span>
       <div className="r1595-view-modes" role="group" aria-label="장바구니 동일 종목 묶음 방식">
         <button type="button" aria-pressed={groupSimilar} onClick={()=>setGroupSimilar(true)}>종목별 묶기</button>
         <button type="button" aria-pressed={!groupSimilar} onClick={()=>setGroupSimilar(false)}>개별 기록</button>
       </div>
     </div>""",
      'basket-group-controls')
    s=change(s,
      '   <div className="basket-list">{visible.map(it=>{const q=latestQuote.get(it.code),growth=pct(it);',
      '''   <div className="basket-list">{displayGroups.map(group=><section key={group.key}
     className={'r1595-symbol-group'+(group.records.length>1&&groupSimilar?' is-multiple':'')}>
     {groupSimilar&&group.records.length>1&&<button type="button"
       className={'r1595-group-header'+(group.records.some(hotPattern)?' hot':'')}
       aria-expanded={expandedCodes.includes(group.code)}
       onClick={()=>setExpandedCodes(prev=>prev.includes(group.code)?prev.filter(c=>c!==group.code):[...prev,group.code])}>
       <span><strong>{group.name} ({group.code}) · {group.records.length}개 발견 기록</strong>
         <small>{group.records.map(it=>it.day).join(' · ')} · 펼쳐서 개별 수익률 확인</small></span>
       <ChevronDown size={17}/></button>}
     {(!groupSimilar||group.records.length===1||expandedCodes.includes(group.code))&&
       <div className="r1595-group-records">{group.records.map(it=>{const q=latestQuote.get(it.code),growth=pct(it);''',
      'basket-group-open')
    s=change(s,
      '    </article>})}</div>}',
      '    </article>})}</div>}</section>)}</div>}',
      'basket-group-close')
    return s


def patch_main(s):
    s=change(s,
      "import {comparisonKey,fetchCompared,type PriceCompare} from './price-compare';",
      "import {comparisonKey,fetchCompared,type PriceCompare} from './price-compare';\nimport './r1595-group-price.css';",
      'main-request-style')
    s=change(s,
      "  const [r1594QueueStatus,setR1594QueueStatus]=useState('');",
      """  const [r1594QueueStatus,setR1594QueueStatus]=useState('');
  const [r1595Requesting,setR1595Requesting]=useState('');
  const [r1595RequestNote,setR1595RequestNote]=useState('');
  const r1595Timers=useRef<Map<string,number>>(new Map());
  useEffect(()=>()=>{for(const timer of r1595Timers.current.values())window.clearInterval(timer);r1595Timers.current.clear();},[]);""",
      'main-single-retry-states')
    s=change(s,
      "void fetchCompared(rows,ctrl.signal).then(result=>{if(!ctrl.signal.aborted)setR1593Prices(result);})",
      "void fetchCompared(rows,ctrl.signal,partial=>{if(!ctrl.signal.aborted)setR1593Prices(prev=>({...prev,...partial}));}).then(result=>{if(!ctrl.signal.aborted)setR1593Prices(prev=>({...prev,...result}));})",
      'main-stream-batches')
    s=change(s,
      "  const openDetail=(r:Signal)=>setSelected(r);",
      """  // R1595: manually request a missing verified symbol, then poll only that pair.
  // The protected API validates real discovery evidence; no KIS call from this browser.
  async function requestMissingQuote(r:Signal){
    const key=comparisonKey(r);
    if(r1595Requesting||r1595Timers.current.size>=3)return;
    if(!/^\\d{6}$/.test(r.code)||!r.close_price||r.close_price<=0)return;
    setR1595Requesting(key);setR1595RequestNote('');
    try{
      const result=await requestSearchPriority([{code:r.code,day:r.day}]);
      if(result.not_verified){setR1595RequestNote(`${r.name||r.code}: 검증된 발견 기록이 없어 요청할 수 없습니다.`);return;}
      setR1595RequestNote(`${r.name||r.code}: ${result.queued?'수집 요청 완료':result.throttled?'최근 요청이 있어 대기 중':'수집 접수 확인 필요'} · 장중 거래시간에 수집됩니다.`);
      if(r1595Timers.current.has(key))return;
      let attempts=0,inFlight=false;
      const timer=window.setInterval(()=>{
        if(inFlight||document.visibilityState==='hidden')return;
        if(++attempts>12){window.clearInterval(timer);r1595Timers.current.delete(key);return;}
        inFlight=true;
        void fetchCompared([{code:r.code,day:r.day}]).then(data=>{
          setR1593Prices(prev=>({...prev,...data}));
          if(data[key]?.latest_price){window.clearInterval(timer);r1595Timers.current.delete(key);}
        }).catch(()=>{}).finally(()=>{inFlight=false;});
      },12000);
      r1595Timers.current.set(key,timer);
    }catch(e){setR1595RequestNote(e instanceof Error?e.message:'시세 수집 요청 오류');}
    finally{setR1595Requesting('');}
  }
  const openDetail=(r:Signal)=>setSelected(r);""",
      'main-manual-quote-request')
    s=change(s,
      '          {r1593Error&&<p className="r1593-comparison-status" role="status">가격 비교: {r1593Error}</p>}',
      '          {r1593Error&&<p className="r1593-comparison-status" role="status">가격 비교: {r1593Error}</p>}\n          {r1595RequestNote&&<p className="r1595-request-status" role="status">{r1595RequestNote}</p>}',
      'main-manual-result-note')
    s=change(s,
      '                <PriceCompareMini data={r1593Prices[comparisonKey(r)]} baseline={r.close_price} loading={r1593Busy}/>\n              </td>',
      '''                <PriceCompareMini data={r1593Prices[comparisonKey(r)]} baseline={r.close_price} loading={r1593Busy}/>
                {!r1593Busy&&!r1593Prices[comparisonKey(r)]?.latest_price&&<button type="button" className="r1595-request-price"
                  disabled={!!r1595Requesting||r1595Timers.current.size>=3} onClick={e=>{e.stopPropagation();void requestMissingQuote(r);}}
                  onKeyDown={e=>e.stopPropagation()}>
                    {r1595Requesting===comparisonKey(r)?'요청 중…':'시세 수집 요청'}</button>}
              </td>''',
      'main-desktop-quote-button')
    s=change(s,
      "                <span>{inBasket(r)?'담김':'담기'}</span>\n              </button></div>):<div className=\"mobile-empty\">",
      """                <span>{inBasket(r)?'담김':'담기'}</span>
              </button>
              {!r1593Busy&&!r1593Prices[comparisonKey(r)]?.latest_price&&<button type="button"
                className="r1595-request-price r1595-request-mobile"
                disabled={!!r1595Requesting||r1595Timers.current.size>=3}
                onClick={()=>{void requestMissingQuote(r);}}>
                 {r1595Requesting===comparisonKey(r)?'수집 요청 중…':'이 종목 시세 수집 요청'}</button>}
              </div>):<div className="mobile-empty">""",
      'main-mobile-quote-button')
    return s


def patch_client(s):
    start='export async function fetchCompared(items:{code:string;day:string}[],signal?:AbortSignal):Promise<Record<string,PriceCompare>>{'
    old='''export async function fetchCompared(items:{code:string;day:string}[],signal?:AbortSignal):Promise<Record<string,PriceCompare>>{
 const unique=[...new Map(items.filter(x=>/^\\d{6}$/.test(x.code)&&/^20\\d{2}-\\d{2}-\\d{2}$/.test(x.day))
  .map(x=>[comparisonKey(x),x] as const)).values()];
 const all:Record<string,PriceCompare>={};
 for(let i=0;i<unique.length;i+=20){
  if(signal?.aborted)throw new Error('CANCELLED');
  const u=new URL(API+'/api/prices/compare');
  u.searchParams.set('items',unique.slice(i,i+20).map(comparisonKey).join(','));
  const r=await fetch(u.toString(),{credentials:'include',cache:'no-store',signal});
  if(!r.ok)throw new Error(r.status===401?'Cloudflare Access 로그인이 필요합니다.':
   r.status===404?'시세 비교 API 배포가 필요합니다.':`시세 비교 API ${r.status}`);
  const data=await r.json() as {items?:PriceCompare[]};
  for(const item of data.items||[])if(item&&/^\\d{6}$/.test(item.code))all[comparisonKey(item)]=item;
 }
 return all;
}'''
    new='''export async function fetchCompared(items:{code:string;day:string}[],signal?:AbortSignal,
 onBatch?:(partial:Record<string,PriceCompare>)=>void):Promise<Record<string,PriceCompare>>{
 const unique=[...new Map(items.filter(x=>/^\\d{6}$/.test(x.code)&&/^20\\d{2}-\\d{2}-\\d{2}$/.test(x.day))
  .map(x=>[comparisonKey(x),x] as const)).values()];
 const all:Record<string,PriceCompare>={};
 let failed=0,firstError='';
 // Eight date-pairs per request avoid large D1 work per Worker invocation.
 // Each successfully completed chunk is rendered before the remaining requests finish.
 for(let i=0;i<unique.length;i+=8){
  if(signal?.aborted)throw new Error('CANCELLED');
  const u=new URL(API+'/api/prices/compare');
  u.searchParams.set('items',unique.slice(i,i+8).map(comparisonKey).join(','));
  try{
   const r=await fetch(u.toString(),{credentials:'include',cache:'no-store',signal});
   if(!r.ok){
    const err=r.status===401?'Cloudflare Access 로그인이 필요합니다.':
     r.status===404?'시세 비교 API 배포가 필요합니다.':`시세 비교 API ${r.status}`;
    if(r.status===401||r.status===404)throw new Error(err);
    throw new Error(err);
   }
   const data=await r.json() as {items?:PriceCompare[]};
   const partial:Record<string,PriceCompare>={};
   for(const item of data.items||[]){if(item&&/^\\d{6}$/.test(item.code)){
    const key=comparisonKey(item);partial[key]=item;all[key]=item;
   }}
   if(Object.keys(partial).length)onBatch?.(partial);
  }catch(e){
   if(signal?.aborted)throw e;
   failed++;if(!firstError)firstError=e instanceof Error?e.message:String(e);
   if(firstError.includes('Access 로그인')||firstError.includes('API 배포'))throw e;
  }
 }
 if(failed)throw new Error(`시세 ${failed}묶음 조회 실패 · 확인된 자료는 유지 (${firstError})`);
 return all;
}'''
    if start not in s and new not in s:
        raise PatchError('R1595_CLIENT_ORIGINAL_MISSING')
    return change(s,old,new,'price-compare-stream-8')


def patch_collector(s):
    s=change(s,
      '  const since=dateISO(now.getTime()-2*3600000);',
      '  // Keep a bounded overnight/weekend backlog until the next eligible KIS session.\n  const since=dateISO(now.getTime()-7*86400000);',
      'collector-overnight-queue')
    s=change(s,
      '    ORDER BY next_due_utc ASC,requested_at_utc DESC LIMIT 4',
      "    ORDER BY CASE status WHEN 'QUEUED' THEN 0 WHEN 'RETRY' THEN 1 ELSE 2 END,requested_at_utc DESC,next_due_utc ASC LIMIT 4",
      'collector-recent-request-first')
    return s

ACTIONS={
 'web/src/SmartBasket.tsx':patch_basket,
 'web/src/main.tsx':patch_main,
 'web/src/price-compare.ts':patch_client,
 'collector/src/search-quote-priority.mjs':patch_collector,
}

def install(root:Path,mode:str):
    changes={}
    for filename,fn in ACTIONS.items():
        file=root/filename
        if not file.is_file():raise PatchError(f'R1595_FILE_MISSING {filename}')
        old=file.read_text(encoding='utf-8')
        changes[filename]=fn(old)
    if mode=='apply':
        for name,source in changes.items():
            target=root/name
            if target.read_text(encoding='utf-8')!=source:target.write_text(source,encoding='utf-8')
    print('R1595_'+('APPLIED' if mode=='apply' else 'ANCHORS_OK'),list(changes))

if __name__=='__main__':
    p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True)
    g.add_argument('--check',action='store_true');g.add_argument('--apply',action='store_true')
    a=p.parse_args();install(Path('.'),'apply' if a.apply else 'check')

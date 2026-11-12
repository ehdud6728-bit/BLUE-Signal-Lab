#!/usr/bin/env python3
"""R1.5.8 long-term protected basket, backward-compatible local storage and safe cleanup.
Run from BLUE-Signal-Lab repository root. Strict 1:1 source anchors, no network.
"""
from pathlib import Path
import argparse

p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');p.add_argument('--apply',action='store_true'); args=p.parse_args()
if args.check == args.apply: raise SystemExit('Choose exactly one of --check/--apply')

base=Path('web/src/SmartBasket.tsx')
src=base.read_text(encoding='utf-8')
if 'R158_LONGTERM' in src:
  if args.apply: print('R158_ALREADY_INSTALLED')
  else: print('R158_ALREADY_INSTALLED_CHECK')
  raise SystemExit(0)
if 'R157_BASKET_FILTERS' not in src or 'R157_AI_AUTO_ADD' not in src:
  raise SystemExit('R158_REQUIRES_R157_APPLIED')

def rep(old,new):
 global src
 n=src.count(old)
 if n!=1:raise SystemExit(f'R158_ANCHOR_MISMATCH: {old[:75]!r} count={n}')
 src=src.replace(old,new,1)

rep("import {Bot,Download,Upload,Trash2,RefreshCw,AlertCircle,ShoppingBasket} from 'lucide-react';",
    "import {Bot,Download,Upload,Trash2,RefreshCw,AlertCircle,ShoppingBasket,Bookmark,BookmarkCheck} from 'lucide-react';")
rep("import './smart-basket.css';", "import './smart-basket.css';\nimport './r158-long-watch.css';")
rep("const STORE='blue_r15_basket_v1';",
    "// R158_LONGTERM: separate storage quotas; this is cleanup protection, not cloud backup.\nconst STORE='blue_r15_basket_v1';\nconst MAX_REGULAR=100, MAX_PROTECTED=20;")
rep("  added_at:string;signals:string[];memo:string;reason?:string;risk?:string;watch?:string};",
    "  added_at:string;signals:string[];memo:string;reason?:string;risk?:string;watch?:string;\n  protected?:boolean;protected_at?:string};")
rep("function readItems():BasketItem[]{\n try {const json=localStorage.getItem(STORE);if(!json)return [];const arr=JSON.parse(json);\n  return Array.isArray(arr)?arr.filter(validItem).slice(0,100):[];\n } catch{return [];}\n}",
    """function keepQuotas(list:BasketItem[]):BasketItem[]{
 const seen=new Set<string>();let regular=0,locked=0;
 return list.filter(x=>{
  if(seen.has(x.id))return false;
  if(x.protected===true){if(locked>=MAX_PROTECTED)return false;locked++;}
  else {if(regular>=MAX_REGULAR)return false;regular++;}
  seen.add(x.id);return true;
 });
}
function readItems():BasketItem[]{
 try {const json=localStorage.getItem(STORE);if(!json)return [];const arr=JSON.parse(json);
  return Array.isArray(arr)?keepQuotas(arr.filter(validItem)):[];
 } catch{return [];}
}""")
rep("  typeof x.id==='string'&&x.id===`${x.source}:${x.code}:${x.day}`;",
    "  typeof x.id==='string'&&x.id===`${x.source}:${x.code}:${x.day}`&&\n  (x.protected===undefined||typeof x.protected==='boolean')&&\n  (x.protected_at===undefined||typeof x.protected_at==='string');")
rep(" const [filter,setFilter]=useState<'ALL'|'MANUAL'|'AI'>('ALL');",
    " const [filter,setFilter]=useState<'ALL'|'MANUAL'|'AI'|'PROTECTED'>('ALL');\n const [cleanupDays,setCleanupDays]=useState(60);\n const [lastRemoved,setLastRemoved]=useState<BasketItem[]>([]);")
rep("  if(items.length>=100){setError('관찰함은 최대 100건까지 저장합니다.');return;}",
    "  if(items.filter(x=>!x.protected).length>=MAX_REGULAR){setError('일반 관찰함은 100건까지 가능합니다. 오래 보려는 종목은 장기 관찰로 보호하세요.');return;}")
rep("      const room=Math.max(0,100-old.length);",
    "      const room=Math.max(0,MAX_REGULAR-old.filter(x=>!x.protected).length);")
rep("     setMessage(picked.length?`AI 후보 ${picked.length}종목 확인 · 신규 ${Math.min(unique.length,Math.max(0,100-items.length))}종목 자동 등록 · 기존 후보는 중복 제외`:",
    "     setMessage(picked.length?`AI 후보 ${picked.length}종목 확인 · 신규 ${Math.min(unique.length,Math.max(0,MAX_REGULAR-items.filter(x=>!x.protected).length))}종목 자동 등록 · 기존 후보는 중복 제외`:")
rep("   if(obj.items.length>100||obj.items.some((x:unknown)=>!validItem(x)))throw Error('관찰함 데이터 형식이 맞지 않습니다.');\n   setItems(current=>{const all=new Map(current.map(x=>[x.id,x]));for(const x of obj.items as BasketItem[])all.set(x.id,x);\n    return [...all.values()].slice(0,100);});setError('');setMessage('백업을 가져왔습니다. 동일 종목·날짜는 백업 내용으로 갱신했습니다.');",
    """   if(obj.items.length>MAX_REGULAR+MAX_PROTECTED||obj.items.some((x:unknown)=>!validItem(x)))throw Error('관찰함 데이터 형식이 맞지 않습니다.');
   const all=new Map(items.map(x=>[x.id,x]));
   for(const x of obj.items as BasketItem[]){
     const original=all.get(x.id);
     // Never clear an existing long-term protection through an older backup.
     all.set(x.id,original?.protected&&!x.protected?{...x,protected:true,protected_at:original.protected_at}:x);
   }
   const merged=[...all.values()];
   if(merged.filter(x=>x.protected).length>MAX_PROTECTED||merged.filter(x=>!x.protected).length>MAX_REGULAR)
     throw Error('백업 병합 후 한도를 초과합니다. 일반 100건·장기 관찰 20건 이내로 정리한 뒤 다시 시도하세요.');
   setItems(merged);setLastRemoved([]);setError('');setMessage('백업을 가져왔습니다. 기존 장기 관찰 보호 설정은 유지했습니다.');""")
rep(" const latestQuote=new Map<string,Quote>();",
    """ const normalCount=items.filter(x=>!x.protected).length;
 const lockedCount=items.length-normalCount;
 // Expiration is based on the verified discovery day, never the last quote timestamp.
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const ageDays=(day:string)=>Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(day+'T00:00:00Z'))/86400000);
 const expired=items.filter(x=>!x.protected&&ageDays(x.day)>=cleanupDays);
 function toggleProtection(id:string){
  const target=items.find(x=>x.id===id);if(!target)return;
  if(!target.protected&&lockedCount>=MAX_PROTECTED){setError('장기 관찰은 최대 20건입니다. 다른 종목의 보호를 먼저 해제하세요.');return;}
  if(target.protected&&normalCount>=MAX_REGULAR){setError('일반 관찰함 100건이 가득 찼습니다. 보호 해제 전에 일반 종목을 정리하세요.');return;}
  setItems(old=>old.map(x=>x.id===id?{...x,protected:!target.protected,
    protected_at:target.protected?undefined:new Date().toISOString()}:x));
  setError('');setMessage(target.protected?`${target.name} 장기 관찰 보호 해제`:`${target.name} 장기 관찰 보호 · 오래된 종목 정리에서 제외`);
 }
 function cleanupOld(){
  if(!expired.length)return;
  if(!window.confirm(`발견일 기준 ${cleanupDays}일 이상 지난 일반 종목 ${expired.length}건을 삭제합니다.\\n장기 관찰 ${lockedCount}건은 삭제되지 않습니다.\\n삭제 전 JSON 백업을 내려받고, 이 화면에서 되돌리기도 가능합니다. 계속할까요?`))return;
  saveBackup();
  const ids=new Set(expired.map(x=>x.id));
  setLastRemoved(expired);setItems(old=>old.filter(x=>x.protected||!ids.has(x.id)));
  setMessage(`일반 관찰 ${expired.length}건 정리 완료 · 장기 관찰 ${lockedCount}건 유지 · 백업 파일 저장`);setError('');
 }
 function undoCleanup(){
  const existing=new Set(items.map(x=>x.id));
  const restore=lastRemoved.filter(x=>!existing.has(x.id));
  if(normalCount+restore.length>MAX_REGULAR){setError('일반 관찰 100건 한도 때문에 되돌릴 수 없습니다.');return;}
  setItems(old=>[...restore,...old]);setLastRemoved([]);setError('');setMessage(`${restore.length}건 되돌렸습니다.`);
 }
 const latestQuote=new Map<string,Quote>();""")
rep("const scoped=items.filter(x=>(filter==='ALL'||x.source===filter)&&",
    "const scoped=items.filter(x=>(filter==='ALL'||(filter==='PROTECTED'?x.protected===true:x.source===filter))&&")
rep("AI 스마트 장바구니 <small>R1.5.7</small>","AI 스마트 장바구니 <small>R1.5.8</small>")
rep("   {ai?.status==='READY'&&<details className=\"r152-ai-candidates\"",
    "   <div className=\"r158-capacity\" role=\"status\"><span>일반 <strong>{normalCount}/{MAX_REGULAR}</strong></span><span>장기 관찰 <strong>{lockedCount}/{MAX_PROTECTED}</strong></span><small>장기 관찰은 일반 한도와 별도 · 자동 정리 제외</small></div>\n   {ai?.status==='READY'&&<details className=\"r152-ai-candidates\"")
rep("{([['ALL','전체'],['MANUAL','내 선택'],['AI','AI 선택']] as const).map",
    "{([['ALL','전체'],['MANUAL','내 선택'],['AI','AI 선택'],['PROTECTED','장기 관찰']] as const).map")
rep("     <p className=\"r157-filter-count\">{visible.length}종목 표시{rank!=='RECENT'?' · 확인된 검색일 이후 수익률만 순위에 포함':''} · 전체 저장 {items.length}종목</p>\n   </div>",
    """     <p className="r157-filter-count">{visible.length}종목 표시{rank!=='RECENT'?' · 확인된 검색일 이후 수익률만 순위에 포함':''} · 일반 {normalCount} · 장기 {lockedCount}건</p>
     <details className="r158-cleanup">
      <summary>오래된 일반 종목 정리 <span>{expired.length}건 대상</span></summary>
      <div className="r158-cleanup-controls"><label>발견일 기준
        <select aria-label="오래된 종목 기준일" value={cleanupDays} onChange={e=>setCleanupDays(Number(e.target.value))}>
         {[30,60,90,180].map(n=><option key={n} value={n}>{n}일 이상</option>)}
        </select></label>
       <button type="button" disabled={!expired.length} onClick={cleanupOld}>{expired.length}건 정리하기</button>
       {!!lastRemoved.length&&<button type="button" className="r158-undo" onClick={undoCleanup}>{lastRemoved.length}건 되돌리기</button>}
      </div>
      <small>장기 관찰은 제외됩니다. 삭제 전 JSON 백업을 저장하고 확인 후 정리합니다. 이 브라우저에서만 보호됩니다. 서버 가격 수집 기록은 정리 즉시 삭제되지 않으며, 마지막 등록 이후 최대 7일간 활성으로 남을 수 있습니다.</small>
     </details>
   </div>""")
rep("     <div className=\"basket-record-head\"><div><span className={`basket-src ${it.source==='AI'?'ai':''}`}>{it.source==='AI'?'AI 선택':'직접 선택'}</span>\n       <strong>{it.name}</strong> <small>{it.code}</small></div>\n       <button type=\"button\" className=\"basket-delete\" title=\"장바구니에서 제거\" aria-label={`${it.name} 제거`}\n       onClick={()=>setItems(old=>old.filter(x=>x.id!==it.id))}><Trash2 size={16}/></button></div>",
    """     <div className="basket-record-head"><div><span className={`basket-src ${it.source==='AI'?'ai':''}`}>{it.source==='AI'?'AI 선택':'직접 선택'}</span>
       <strong>{it.name}</strong> <small>{it.code}</small>{it.protected&&<span className="r158-locked">장기 관찰</span>}</div>
       <div className="r158-record-actions">
        <button type="button" className={'r158-protect '+(it.protected?'active':'')} aria-pressed={it.protected===true}
          title={it.protected?'장기 관찰 보호 해제':'장기 관찰로 보호'} aria-label={`${it.name} ${it.protected?'보호 해제':'장기 관찰 등록'}`}
          onClick={()=>toggleProtection(it.id)}>{it.protected?<BookmarkCheck size={17}/>:<Bookmark size={17}/>}</button>
        <button type="button" className="basket-delete" title={it.protected?'장기 관찰 보호 해제 후 삭제 가능':'장바구니에서 제거'}
          disabled={it.protected===true} aria-label={`${it.name} 제거`}
          onClick={()=>setItems(old=>old.filter(x=>x.protected||x.id!==it.id))}><Trash2 size={16}/></button>
       </div></div>""")
rep("  <p className=\"basket-foot\">R1.5.3 검색일 다음 거래일부터의 KIS 원주가 일봉 고가를 사용합니다.",
    "  <p className=\"basket-foot\">장기 관찰 보호는 이 브라우저에서의 목록 정리·삭제 방지 기능입니다. 캐시 삭제·기기 변경까지 보장하지 않으므로 JSON 백업을 보관하세요. R1.5.3 검색일 다음 거래일부터의 KIS 원주가 일봉 고가를 사용합니다.")

api_path=Path('worker/src/performance.ts')
api=api_path.read_text(encoding='utf-8')
old="if((active?.n||0)+result.filter(x=>x.status==='QUEUED').length>=80)"
if api.count(old)!=1:raise SystemExit('R158_API_CAP_ANCHOR_MISMATCH')
api=api.replace(old,"if((active?.n||0)+result.filter(x=>x.status==='QUEUED').length>=120)",1)

if args.check:
 print('R158_CHECK_OK SmartBasket + API quota 120')
else:
 base.write_text(src,encoding='utf-8')
 api_path.write_text(api,encoding='utf-8')
 print('R158_APPLIED SmartBasket + API watch active capacity 120')

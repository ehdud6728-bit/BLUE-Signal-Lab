#!/usr/bin/env python3
"""BLUE R1.5.9.1 - only search/basket presentation and verified pattern snapshot.
Run in BLUE-Signal-Lab repo root. Pure local source patch; no network, no D1 mutations.
"""
from __future__ import annotations
import argparse
from pathlib import Path

FILES = {
    'web/src/main.tsx': [],
    'web/src/SmartBasket.tsx': [],
}

def patch_unique(text: str, old: str, new: str, file: str, desc: str) -> str:
    if new in text:
        print('R1591_ALREADY', file, desc)
        return text
    n = text.count(old)
    if n != 1:
        raise RuntimeError(f'R1591_ANCHOR_MISMATCH file={file} step={desc} occurrences={n}')
    return text.replace(old, new, 1)


def change_main(s: str) -> str:
    f='web/src/main.tsx'
    s=patch_unique(s,
        "  const techFlag=(r:Signal,k:string)=>extra(r,k)===undefined?'미계산':flag(r,k)?'발생':'해당 없음';",
        "  // R1591_SEARCH_BADGES: verified EOD indicators only, never inferred from absent data.\n"
        "  const techBadges=(r:Signal):string[]=>{\n"
        "    const out:string[]=[];const a=num(r,'ma20'),b=num(r,'ma40'),c=num(r,'ma60');\n"
        "    if(a!==null&&b!==null&&c!==null&&a<b&&b<c)out.push('역배열');\n"
        "    if(flag(r,'ma_to_up'))out.push('정배열 전환');\n"
        "    if(flag(r,'ma112_cross'))out.push('112선 돌파');\n"
        "    if(flag(r,'ma224_cross'))out.push('224선 돌파');\n"
        "    return out;\n"
        "  };\n"
        "  const techFlag=(r:Signal,k:string)=>extra(r,k)===undefined?'미계산':flag(r,k)?'발생':'해당 없음';",
        f,'tech-badges-helper')
    s=patch_unique(s,
        '<td>{r.signals.map(s=><span className="tag" key={s}>{showSignal(s)}</span>)}</td><td>{money(r.close_price)}</td>',
        '<td>{r.signals.map(s=><span className="tag" key={s}>{showSignal(s)}</span>)}'
        '{techBadges(r).map(t=><span className="r1591-search-tech" key={t}>{t}</span>)}</td><td>{money(r.close_price)}</td>',
        f,'desktop-tech-badges')
    s=patch_unique(s,
        '<div className="stock-quick"><div><small>RSI</small>',
        '{techBadges(r).length>0&&<div className="r1591-mobile-tech">{techBadges(r).map(t=><span className="r1591-search-tech" key={t}>{t}</span>)}</div>}\n'
        '               <div className="stock-quick"><div><small>RSI</small>',
        f,'mobile-tech-badges')
    s=patch_unique(s,
        "import './r159-ma-evidence.css';",
        "import './r159-ma-evidence.css';\nimport './r1591-evidence-basket.css';",
        f,'css-import')
    return s


def change_basket(s: str) -> str:
    f='web/src/SmartBasket.tsx'
    s=patch_unique(s,
        "import {useEffect,useState} from 'react';",
        "import {useEffect,useRef,useState} from 'react';",
        f,'use-ref')
    s=patch_unique(s,
        "  protected?:boolean;protected_at?:string};",
        "  protected?:boolean;protected_at?:string;\n"
        "  patternUp10d?:number;patternN10d?:number;patternLabel10d?:string};",
        f,'optional-snapshot-fields')
    s=patch_unique(s,
        "function baselineReturn(item:BasketItem,quote:Quote|undefined):number|null{",
        "// R1591: freeze only provenance-backed research evidence from an actual search/D1 row.\n"
        "function patternEvidence(data:SearchRow|AiPick):Pick<BasketItem,'patternUp10d'|'patternN10d'|'patternLabel10d'>|Record<string,never>{\n"
        " const x='extras' in data?data.extras:undefined;\n"
        " const n=Number(x?.r159_pattern_n_10d),p=Number(x?.r159_pattern_up_10d);\n"
        " if(!Number.isInteger(n)||n<1||n>100000||!Number.isFinite(p)||p<0||p>100)return {};\n"
        " const rawLabel=x?.r159_pattern_label_10d;const label=typeof rawLabel==='string'?rawLabel.slice(0,150):'';\n"
        " return {patternUp10d:p,patternN10d:n,patternLabel10d:label};\n"
        "}\n"
        "const hotPattern=(x:BasketItem)=>typeof x.patternUp10d==='number'&&x.patternUp10d>=70&&\n"
        " typeof x.patternN10d==='number'&&x.patternN10d>=8;\n"
        "function baselineReturn(item:BasketItem,quote:Quote|undefined):number|null{",
        f,'evidence-helper')
    s=patch_unique(s,
        "  (x.protected_at===undefined||typeof x.protected_at==='string');",
        "  (x.protected_at===undefined||typeof x.protected_at==='string')&&\n"
        "   (x.patternUp10d===undefined||(typeof x.patternUp10d==='number'&&Number.isFinite(x.patternUp10d)&&x.patternUp10d>=0&&x.patternUp10d<=100))&&\n"
        "   (x.patternN10d===undefined||(Number.isInteger(x.patternN10d)&&x.patternN10d>=1&&x.patternN10d<=100000))&&\n"
        "   (x.patternLabel10d===undefined||(typeof x.patternLabel10d==='string'&&x.patternLabel10d.length<=150));",
        f,'safe-import')
    s=patch_unique(s,
        " const [items,setItems]=useState<BasketItem[]>(readItems);",
        " const [items,setItems]=useState<BasketItem[]>(readItems);\n"
        " const evidenceAttempted=useRef<Set<string>>(new Set());",
        f,'evidence-attempted-ref')
    s=patch_unique(s,
        " useEffect(()=>{onItemsChange?.(items.map(x=>x.id));},[items,onItemsChange]);",
        " // R1591: gently recover evidence for pre-existing baskets and AI picks.\n"
        " // Existing API read endpoint; no new Worker or schema and no mass full-market fetch.\n"
        " useEffect(()=>{\n"
        "  if(!active)return;let disposed=false;let cursor=0;\n"
        "  const pending=[...new Map(items.filter(x=>x.patternN10d===undefined)\n"
        "   .map((x):[string,BasketItem]=>[perfId(x),x])).values()].filter(x=>!evidenceAttempted.current.has(perfId(x)));\n"
        "  if(!pending.length)return;\n"
        "  const worker=async()=>{while(!disposed){\n"
        "   const it=pending[cursor++];if(!it)return;const key=perfId(it);evidenceAttempted.current.add(key);\n"
        "   try{const u=new URL(API+'/api/search');u.searchParams.set('mode','single');\n"
        "    u.searchParams.set('date',it.day);u.searchParams.set('code',it.code);u.searchParams.set('limit','1');\n"
        "    const r=await fetch(u.toString(),{credentials:'include',cache:'no-store'});if(!r.ok)continue;\n"
        "    const d=await r.json() as {items?:SearchRow[]};\n"
        "    const found=d.items?.find(x=>x.code===it.code&&x.day===it.day);if(!found||disposed)continue;\n"
        "    const snapshot=patternEvidence(found);if(!('patternN10d' in snapshot))continue;\n"
        "    setItems(old=>old.map(x=>perfId(x)===key&&x.patternN10d===undefined?{...x,...snapshot}:x));\n"
        "   }catch{/* Historical evidence is optional. Never invent it on network errors. */}\n"
        "  }};\n"
        "  void Promise.all([worker(),worker(),worker()]);\n"
        "  return()=>{disposed=true};\n"
        " },[active,idsKey]);\n"
        " useEffect(()=>{onItemsChange?.(items.map(x=>x.id));},[items,onItemsChange]);",
        f,'legacy-evidence-hydration')
    s=patch_unique(s,
        "    reason:p?.reason,risk:p?.risk,watch:p?.watch},...prev]);",
        "    reason:p?.reason,risk:p?.risk,watch:p?.watch,...patternEvidence(data)},...prev]);",
        f,'snapshot-on-manual-add')
    s=patch_unique(s,
        "<ShoppingBasket size={18}/> AI 스마트 장바구니 <small>R1.5.8</small>",
        "<ShoppingBasket size={18}/> AI 스마트 장바구니 <small>R1.5.9.1</small>",
        f,'version')
    s=patch_unique(s,
        '<article className="basket-record" key={it.id}>',
        '<article className={"basket-record"+(hotPattern(it)?" r1591-basket-tomato":"")} key={it.id}>',
        f,'tomato-border')
    s=patch_unique(s,
        '     <div className="r154-origin-strip">',
        "      {hotPattern(it)&&<div className=\"r1591-basket-evidence\" title={it.patternLabel10d||'실제 과거 일봉 패턴 검증'}>\n"
        "       과거 10일 상승 {it.patternUp10d!.toFixed(1)}% · 표본 {it.patternN10d}건 · 탐색적 결과\n"
        "      </div>}\n"
        '     <div className="r154-origin-strip">',
        f,'tomato-score')
    return s

CHANGERS={'web/src/main.tsx':change_main,'web/src/SmartBasket.tsx':change_basket}

def main() -> int:
    p=argparse.ArgumentParser()
    p.add_argument('--check',action='store_true')
    p.add_argument('--apply',action='store_true')
    p.add_argument('--root',default='.')
    a=p.parse_args()
    if a.check==a.apply:raise SystemExit('Choose exactly one of --check or --apply')
    root=Path(a.root)
    changes={}
    for name,fn in CHANGERS.items():
        path=root/name
        original=path.read_text(encoding='utf-8')
        new=fn(original)
        changes[path]=new
        print('R1591_'+('CHECK' if a.check else 'PATCHED'),name)
    if a.apply:
        for path,new in changes.items():path.write_text(new,encoding='utf-8')
    print('R1591_'+('ANCHORS_OK' if a.check else 'APPLIED'))
    return 0

if __name__=='__main__':raise SystemExit(main())

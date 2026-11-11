#!/usr/bin/env python3
"""R1.5.3 fail-closed patches against reviewed BLUE R1.5.2 source anchors.
Use --check before --apply. This installer intentionally does not deploy anything.
"""
from pathlib import Path
import argparse

R=Path(__file__).resolve().parents[1]

def once(s, old, new, name):
    n=s.count(old)
    if n!=1: raise SystemExit(f'R153_ANCHOR_MISMATCH {name} expected 1 found {n}')
    return s.replace(old,new,1)

def adjust_main(s):
    if 'R153_BOTTOM_NAV_ONLY' in s:return s
    s=once(s,"import './r152-four-tabs.css';","import './r152-four-tabs.css';\nimport './r153-performance.css';",'main-css')
    start=s.index('    <nav className="r152-main-tabs" role="tablist" aria-label="BLUE 주요 기능">')
    end=s.index('    {installGuide&&',start)
    assert s[start:end].count('role="tab"')==4
    s=s[:start]+"    {/* R153_BOTTOM_NAV_ONLY: navigation is in the bottom dock on every viewport. */}\n"+s[end:]
    s=once(s,'<SmartBasket quickAddRequest={basketRequest} onItemsChange={setBasketIds}/>',
         "<SmartBasket quickAddRequest={basketRequest} onItemsChange={setBasketIds} active={activeView==='basket'}/>",'main-basket-prop')
    return s

def adjust_api(s):
    if "import {basketWatch}" in s:return s
    s=once(s,"import { handleBasketAi } from './basket';",
       "import { handleBasketAi } from './basket';\nimport {basketWatch} from './performance';",'api-import')
    anchor="      // R1.4: D1-only intraday snapshots; same Cloudflare Access guard as BLUE AI."
    handler="""      // R1.5.3: never accept arbitrary price data or arbitrary KIS requests.
      // Only Access-authenticated requests on verified scan symbols may enroll.
      if (p === '/api/basket/watch' && (request.method === 'GET'||request.method === 'POST')) {
        if (!access) return respond({error:'ACCESS_REQUIRED'},401);
        if (request.method==='POST' && request.headers.get('Origin')!==origin)
          return respond({error:'ORIGIN_DENIED'},403);
        const upstream=await basketWatch(request,env);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
"""
    return once(s,anchor,handler+anchor,'api-route')

def adjust_collector_index(s):
    if 'collectBasket' in s:return s
    s=once(s,"import {collect} from './core.mjs';",
       "import {collect} from './core.mjs';\nimport {collectBasket} from './basket.mjs';",'collector-import')
    s=once(s,"    ctx.waitUntil(collect(env));",
       """    // R1.5.3: watch queue every minute; original research collection every 5 minutes.
    ctx.waitUntil((async()=>{
      const minute=new Date().getUTCMinutes();
      await collectBasket(env); // prioritize newly added watch symbols
      if(minute%5===0)await collect(env); // preserve original five-minute cadence
    })());""",'collector-cron')
    return s

def adjust_collector_core(s):
    if 'export async function getKisQuote' in s:return s
    return once(s,'async function getKisQuote(env, token, market, code){',
      'export async function getKisQuote(env, token, market, code){','quote-export')

def adjust_collector_config(s):
    if '"* * * * *"' in s:return s
    return once(s,'"*/5 * * * *"','"* * * * *"','cron-every-minute')

def adjust_basket(s):
    if 'R153_PERFORMANCE_MONITOR' in s:return s
    s=once(s,"const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\\/+$/,'');",
'''// R153_PERFORMANCE_MONITOR: KIS results are server-verified; never fabricate missing candles.
type Performance={code:string;day:string;status:string;baseline?:number;
 registered_at?:string;checked_at?:string;last_covered_day?:string;
 highest_price?:number|null;highest_day?:string|null;
 recent_close?:number|null;recent_day?:string|null;
 quote_price?:number|null;quote_high?:number|null;quote_day?:string|null;
 quote_at?:string|null;quote_market?:string|null;last_error?:string|null};
const perfId=(x:{code:string;day:string})=>`${x.code}:${x.day}`;
const pctChange=(n:number|null|undefined,base:number)=>typeof n==='number'&&Number.isFinite(n)&&n>0&&base>0?(n/base-1)*100:null;
const pctText=(p:number|null)=>p===null?'—':`${p>0?'+':''}${p.toFixed(2)}%`;
const statusText=(s:string)=>({QUEUED:'등록 완료 · 수집 대기',NOT_REGISTERED:'수집 요청 전',
  HISTORY_PARTIAL:'과거 가격 확인 중',WAITING_TOKEN:'KIS 토큰 확인 필요',
  PROVIDER_RETRY:'시세 조회 재시도 예정',WAITING_NEXT_SESSION:'다음 거래일 대기',
  READY:'가격 확인 완료',UNVERIFIED_EOD:'검증된 종가 정보 없음',
  CAPACITY_LIMIT:'수집 대기열 한도 도달'} as Record<string,string>)[s]||'수집 상태 확인 중';
const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\\/+$/,'');''','basket-extra-type')
    s=once(s,"export default function SmartBasket({quickAddRequest,onItemsChange}: {",
       "export default function SmartBasket({quickAddRequest,onItemsChange,active=true}: {",'basket-props1')
    s=once(s," onItemsChange?:(ids:string[])=>void;\n}){",
       " onItemsChange?:(ids:string[])=>void;\n active?:boolean;\n}){",'basket-props2')
    s=once(s," const [quotes,setQuotes]=useState<Quotes|null>(null);",
''' const [quotes,setQuotes]=useState<Quotes|null>(null);
 const [performance,setPerformance]=useState<Record<string,Performance>>({});
 const [performanceError,setPerformanceError]=useState('');
 const [performanceChecked,setPerformanceChecked]=useState('');
 const idsKey=items.map(x=>perfId(x)).join(',');
 // Register immediately after any new item (including quick-add from hidden search tab).
 useEffect(()=>{
   if(!idsKey)return;
   let disposed=false;
   const register=async()=>{
    const entries=idsKey.split(',').map(x=>{const pos=x.indexOf(':');return {code:x.slice(0,pos),day:x.slice(pos+1)};});
    for(let i=0;i<entries.length;i+=20){
     if(disposed)break;
     try{const r=await fetch(API+'/api/basket/watch',{method:'POST',credentials:'include',
       headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({items:entries.slice(i,i+20)}),cache:'no-store'});
       if(!r.ok)throw Error(r.status===404?'수집 API 배포 전':`등록 API 오류 ${r.status}`);
       if(!disposed)setPerformanceError('');
     }catch(e){if(!disposed)setPerformanceError(e instanceof Error?e.message:'수집 등록 실패');break;}
    }
   };
   void register();return()=>{disposed=true;};
 },[idsKey]);
 // The UI checks frequently; server collection itself occurs via separate Cron.
 useEffect(()=>{
   if(!active||!idsKey)return;
   let disposed=false,inFlight=false;
   const load=async()=>{
    if(inFlight||document.visibilityState==='hidden')return;
    inFlight=true;
    try{
     const url=new URL(API+'/api/basket/watch');url.searchParams.set('items',idsKey);
     const r=await fetch(url.toString(),{credentials:'include',cache:'no-store'});
     if(!r.ok)throw Error(r.status===404?'수집 API 배포 전':`조회 API 오류 ${r.status}`);
     const data=await r.json() as {items:Performance[]};
     if(!disposed){setPerformance(Object.fromEntries((data.items||[]).map(x=>[perfId(x),x])));
       setPerformanceChecked(new Date().toISOString());setPerformanceError('');}
    }catch(e){if(!disposed)setPerformanceError(e instanceof Error?e.message:'가격 확인 실패');}
    finally{inFlight=false;}
   };
   void load();const timer=window.setInterval(()=>{void load();},30000);
   const wake=()=>{if(document.visibilityState==='visible')void load();};
   document.addEventListener('visibilitychange',wake);
   return()=>{disposed=true;window.clearInterval(timer);document.removeEventListener('visibilitychange',wake);};
 },[active,idsKey]);''','basket-state-effects')
    # Display existing price comparison when available, but prefer trusted returned performance.
    s=once(s," const pct=(x:BasketItem)=>baselineReturn(x,latestQuote.get(x.code));",
''' const pct=(x:BasketItem)=>{
  const pr=performance[perfId(x)];const price=pr?.quote_day&&pr.quote_day>x.day&&pr.quote_day>=(pr.recent_day||'')
   ?pr.quote_price:pr?.recent_day&&pr.recent_day>x.day?pr.recent_close:null;
  return pctChange(price,x.baseline)??baselineReturn(x,latestQuote.get(x.code));
 };''','basket-percentage')
    s=once(s,'  {message&&<p className="basket-feedback" role="status">{message}</p>}',
'''  {message&&<p className="basket-feedback" role="status">{message}</p>}
   {performanceError&&<p className="basket-alert" role="status">시세 수집 연결: {performanceError}</p>}
   {items.length>0&&<p className="r153-performance-status" role="status">
    <RefreshCw size={12}/> 장바구니 등록 직후 수집 요청 · 서버 분당 최대 3종목 처리 · 화면 확인 30초
    {performanceChecked&&<span> · 마지막 화면 확인 {new Date(performanceChecked).toLocaleTimeString('ko-KR')}</span>}
   </p>}''','basket-status')
    s=once(s,"   <div className=\"basket-list\">{visible.map(it=>{const q=latestQuote.get(it.code),growth=pct(it);",
'''   <div className="basket-list">{visible.map(it=>{const q=latestQuote.get(it.code),growth=pct(it);
     const pr=performance[perfId(it)];
     const quoteIsLater=!!(pr?.quote_day&&pr.quote_day>it.day&&pr.quote_day>=(pr.recent_day||''));
     const recent=quoteIsLater?pr?.quote_price:pr?.recent_day&&pr.recent_day>it.day?pr?.recent_close:null;
     const recentDay=quoteIsLater?pr?.quote_day:pr?.recent_day;
     const baselineOnly=pr?.status==='WAITING_NEXT_SESSION'&&!recent&&!(q&&q.trade_date_kst>it.day);
     const intradayHigh=pr?.quote_day&&pr.quote_day>it.day?pr.quote_high:null;
     const dailyHigh=pr?.highest_price||null;
     const maxHigh=intradayHigh&&(!dailyHigh||intradayHigh>dailyHigh)?intradayHigh:dailyHigh;
     const maxHighDay=maxHigh===intradayHigh?pr?.quote_day:pr?.highest_day;
     const pending=!pr||['QUEUED','NOT_REGISTERED','HISTORY_PARTIAL'].includes(pr.status);
     const state=pr?statusText(pr.status):'등록 확인 중';''','basket-visible')
    s=once(s,'       <strong>{it.name}</strong> <small>{it.code}</small></div>',
'''       <strong>{it.name}</strong> <small>{it.code} · 발견가 {cash(it.baseline)}원 ({it.day})</small></div>''','basket-headline')
    start=s.index('     <div className="basket-record-stats"><div><span>기준일·확정종가</span>')
    end=s.index('     <details className="r152-record-more">',start)
    s=s[:start]+'''     <div className="basket-record-stats r153-price-grid">
       <div><span>검색 이후 최고가</span><b>{maxHigh?`${cash(maxHigh)}원`:'—'}</b>
         <small>{maxHigh?`${pctText(pctChange(maxHigh,it.baseline))} · ${maxHighDay||''}${maxHigh===intradayHigh?' (장중 관측)':''}`:pending?'수집 중':'이후 거래 없음 / 미확인'}</small></div>
       <div><span>최근 확인가</span><b>{recent?`${cash(recent)}원`:q&&q.trade_date_kst>it.day?`${cash(q.price)}원`:baselineOnly?`${cash(it.baseline)}원`:'—'}</b>
         <small>{recentDay||((q&&q.trade_date_kst>it.day)?q.trade_date_kst:baselineOnly?it.day:'확인 대기')}{quoteIsLater?' · 장중 관측':recent?' · 확정 종가':q&&q.trade_date_kst>it.day?' · 기존 KIS 저장 시세':baselineOnly?' · 검색일 기준가':''}</small></div>
       <div><span>기준가 대비</span><b className={growth==null?'':growth>=0?'basket-rise':'basket-fall'}>{pctText(growth)}</b>
         <small>{maxHigh&&recent?`최고가 대비 ${pctText(pctChange(recent,maxHigh))}`:state}</small></div>
     </div>
     <div className="r153-row-state" title={pr?.checked_at||''}>{state}{pr?.checked_at&&` · 최종 확인 ${new Date(pr.checked_at).toLocaleString('ko-KR')}`}</div>
''' +s[end:]
    s=once(s,'  <p className="basket-foot">연구 전용',
       '  <p className="basket-foot">R1.5.3 검색일 다음 거래일부터의 KIS 원주가 일봉 고가를 사용합니다. 액면분할·합병에 따른 가격 보정은 하지 않아 수익률 왜곡 가능성이 있습니다. 수집 토큰 상태·장외시간에 따라 2분 안에 값이 표시되지 않을 수 있습니다. 장중 확인가는 확정 종가와 다릅니다. 연구 전용', 'basket-foot')
    return s

def main():
    p=argparse.ArgumentParser();p.add_argument('--check',action='store_true');p.add_argument('--apply',action='store_true');a=p.parse_args()
    actions={
      'web/src/main.tsx':adjust_main,
      'web/src/SmartBasket.tsx':adjust_basket,
      'worker/src/index.ts':adjust_api,
      'collector/src/index.mjs':adjust_collector_index,
      'collector/src/core.mjs':adjust_collector_core,
      'collector/wrangler.jsonc':adjust_collector_config,
    }
    changes={}
    for file,fn in actions.items():
      path=Path(file);original=path.read_text(encoding='utf-8');next_=fn(original)
      changes[file]=next_;print(('R153_CHECK' if a.check else 'R153_PATCH'),file,'changed=',original!=next_)
    if a.check:return
    if a.apply:
      for file,source in changes.items():Path(file).write_text(source,encoding='utf-8')
      print('R153_PATCHED')
    else: print('Use --apply to modify working tree')
if __name__=='__main__':main()

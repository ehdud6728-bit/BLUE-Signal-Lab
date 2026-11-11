#!/usr/bin/env python3
"""Non-destructive, idempotent BLUE R1.5 UI/API integration. Run on repo root.
No Stock-Hunter, scanner, collector, token vault or existing DB schema edits.
"""
from pathlib import Path
import argparse,sys
ROOT=Path(__file__).resolve().parents[1]

def one_change(text,needle,repl,label):
    if repl in text:return text,False
    if text.count(needle)!=1:raise RuntimeError(f'{label}: expected exactly one integration point, found {text.count(needle)}')
    return text.replace(needle,repl,1),True

def patch():
    for needed in ('web/src/SmartBasket.tsx','web/src/smart-basket.css','worker/src/basket.ts'):
        if not (ROOT/needed).is_file():raise RuntimeError('Missing R1.5 module: '+needed)
    w=ROOT/'web/src/main.tsx'; api=ROOT/'worker/src/index.ts'
    ws=w.read_text(encoding='utf8'); ap=api.read_text(encoding='utf8')
    ws,a=one_change(ws,"import LiveMarket from './LiveMarket';",
         "import LiveMarket from './LiveMarket';\nimport SmartBasket from './SmartBasket';",'Web import')
    ws,b=one_change(ws,'        <LiveMarket />','        <LiveMarket />\n        <SmartBasket searchRows={rows} />','Web component')
    ap,c=one_change(ap,"import { liveQuotes } from './live';",
       "import { liveQuotes } from './live';\nimport { handleBasketAi } from './basket';",'API import')
    insert="""      // BLUE R1.5: AI picks from server-verified historical EOD; no order entry.
      if (p === '/api/basket/ai' && (request.method === 'GET' || request.method === 'POST')) {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        if (request.method === 'POST' && request.headers.get('Origin') !== origin)
          return respond({error:'ORIGIN_DENIED'},403);
        const upstream = await handleBasketAi(request,env);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
"""
    ap,d=one_change(ap,"      // R1.4: D1-only intraday snapshots;",insert+"      // R1.4: D1-only intraday snapshots;",'API route')
    return [(w,ws,a or b),(api,ap,c or d)]

def main():
    p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');ns=p.parse_args()
    try:changes=patch()
    except Exception as e:print('R15_INSTALL_FAILED:',e,file=sys.stderr);return 1
    for path,content,changed in changes:
        print(('PATCH ' if changed else 'ALREADY ') +str(path.relative_to(ROOT)))
        if ns.apply and changed:path.write_text(content,encoding='utf8')
    print('R15_INSTALL_READY apply='+str(ns.apply).lower());return 0

if __name__=='__main__':sys.exit(main())

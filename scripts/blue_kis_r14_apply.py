#!/usr/bin/env python3
"""Safely adds the isolated R1.4 live UI/API hooks to the existing source tree.

Idempotent, checks anchors before changes, does not rewrite search/EOD logic.
Run only from repository root after new files have been added.
"""
from __future__ import annotations

import argparse
from pathlib import Path

WEB_IMPORT="import LiveMarket from './LiveMarket';\n"
WEB_ANCHOR="import StockChart from './StockChart';\n"
WEB_CONTENT_ANCHOR='<section className="content">'
WEB_INSERT=WEB_CONTENT_ANCHOR+'\n        <LiveMarket />'
WORKER_IMPORT="import { liveQuotes } from './live';\n"
WORKER_IMPORT_ANCHOR="import { handleAi, getCachedAi } from './ai';\n"
WORKER_ROUTE_ANCHOR="      if (p === '/api/health' && request.method === 'GET') {"
WORKER_ROUTE="""      // R1.4: D1-only intraday snapshots; same Cloudflare Access guard as BLUE AI.
      // Never forward KIS credentials or the encrypted token vault to browsers.
      if (p === '/api/live/quotes' && request.method === 'GET') {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        return respond(await liveQuotes(env.DB));
      }
"""


def change_web(src: str) -> str:
    result=src
    if WEB_IMPORT not in result:
        if result.count(WEB_ANCHOR)!=1:
            raise ValueError('WEB_IMPORT_ANCHOR_MISSING_OR_DUPLICATED')
        result=result.replace(WEB_ANCHOR, WEB_ANCHOR+WEB_IMPORT,1)
    if '<LiveMarket />' not in result:
        if result.count(WEB_CONTENT_ANCHOR)!=1:
            raise ValueError('WEB_CONTENT_ANCHOR_MISSING_OR_DUPLICATED')
        result=result.replace(WEB_CONTENT_ANCHOR,WEB_INSERT,1)
    if result.count('<LiveMarket />')!=1:
        raise ValueError('DUPLICATE_LIVE_MARKET_COMPONENT')
    return result


def change_worker(src: str) -> str:
    result=src
    if WORKER_IMPORT not in result:
        if result.count(WORKER_IMPORT_ANCHOR)!=1:
            raise ValueError('WORKER_IMPORT_ANCHOR_MISSING_OR_DUPLICATED')
        result=result.replace(WORKER_IMPORT_ANCHOR,WORKER_IMPORT_ANCHOR+WORKER_IMPORT,1)
    if "p === '/api/live/quotes'" not in result:
        if result.count(WORKER_ROUTE_ANCHOR)!=1:
            raise ValueError('WORKER_ROUTE_ANCHOR_MISSING_OR_DUPLICATED')
        result=result.replace(WORKER_ROUTE_ANCHOR,WORKER_ROUTE+WORKER_ROUTE_ANCHOR,1)
    if result.count("p === '/api/live/quotes'")!=1:
        raise ValueError('DUPLICATE_LIVE_QUOTES_ROUTE')
    return result


def apply(root:Path, write:bool=False) -> dict:
    paths={
        root/'web/src/main.tsx':change_web,
        root/'worker/src/index.ts':change_worker,
    }
    required=[root/'web/src/LiveMarket.tsx',root/'web/src/live-market.css',
              root/'worker/src/live.ts',root/'scripts/blue_kis_web_live_r14.py']
    missing=[str(p.relative_to(root)) for p in required if not p.exists()]
    if missing:
        raise ValueError('R14_NEW_FILES_MISSING: '+', '.join(missing))
    proposed={}
    for path,fn in paths.items():
        original=path.read_text(encoding='utf-8')
        next_text=fn(original)
        proposed[path]=(original,next_text)
    if write:
        for path,(old,new) in proposed.items():
            if old!=new:
                path.write_text(new,encoding='utf-8')
    return {str(p.relative_to(root)): ('modified' if a!=b else 'unchanged')
            for p,(a,b) in proposed.items()}


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--root',default='.')
    p.add_argument('--write',action='store_true')
    args=p.parse_args()
    for name,state in apply(Path(args.root).resolve(),args.write).items():
        print(name+': '+state)
    if not args.write:
        print('DRY_RUN_ONLY: files not modified')

if __name__=='__main__':
    main()

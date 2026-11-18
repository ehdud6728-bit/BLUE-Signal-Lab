import {collect,getKisQuote} from './core.mjs';
import {collectBasket} from './basket.mjs';
import {collectSearchPriority} from './search-quote-priority.mjs';
import {collectSymbolLivePriority} from './symbol-live.mjs';
import {createSharedQuoteFetcher} from './quote-cache.mjs';
import {mirrorQuotesToTurso,tursoMirrorEnabled} from './turso-mirror.mjs';
import {collectTursoDirect,tursoDirectMode} from './turso-direct.mjs';

// The public HTTP surface stays health-only. An on-demand KIS quote is exposed
// through a named, non-HTTP WorkerEntrypoint in index.mjs, not here.
export default {
  async scheduled(_event,env,ctx){
    // A separate waitUntil chain: D1 quota failures in the legacy collector
    // cannot block the independently authenticated Turso-only KIS path.
    const directNow=new Date();
    if(tursoDirectMode(env,directNow)!=='OFF'){
      ctx.waitUntil(collectTursoDirect(env,directNow)
        .then(result=>console.log('BLUE_TURSO_DIRECT status='+result.status+
          ' saved='+(result.saved||0)+' rejected='+(result.rejected||0)))
        .catch(()=>console.warn('BLUE_TURSO_DIRECT_FAILED')));
    }
    ctx.waitUntil((async()=>{
      const now=new Date(),minute=now.getUTCMinutes();
      const shared=createSharedQuoteFetcher(getKisQuote);
      const deps={quote:shared.quote,preserveBasketPacing:true};
      // One bounded Turso transaction per five-minute market tick, combining
      // basket and scan quotes by key. PILOT keeps its two-symbol total cap.
      // Verified quotes are queued BEFORE D1 persistence, with no new KIS calls.
      const toTurso=new Map();
      const mirrorOnTick=minute%5===0&&tursoMirrorEnabled(env,now);
      if(mirrorOnTick)deps.afterValidatedQuotes=(quotes)=>{
        for(const q of quotes){
          const key=`${q.trade_date_kst}:${q.market}:${q.code}`;
          const prev=toTurso.get(key);
          if(!prev||q.received_at_utc>prev.received_at_utc)toTurso.set(key,q);
        }
      };
      try{
        await collectSymbolLivePriority(env,now,deps).catch(()=>{console.warn('BLUE_SYMBOL_LIVE_UNAVAILABLE');});
        await collectSearchPriority(env,now,deps).catch(()=>{console.warn('BLUE_R1594_PRIORITY_UNAVAILABLE');});
        await collectBasket(env,now,deps).catch(()=>{console.warn('BLUE_R153_BASKET_UNAVAILABLE');});
        if(minute%5===0)await collect(env,now,deps);
      }finally{
        if(mirrorOnTick&&toTurso.size){
          ctx.waitUntil(mirrorQuotesToTurso(env,[...toTurso.values()],{now:new Date()})
            .then(result=>console.log(`BLUE_TURSO_MIRROR status=${result.status} mode=${result.mode||'OFF'} saved=${result.saved}`))
            .catch(()=>console.warn('BLUE_TURSO_MIRROR_WRITE_FAILED')));
        }
        console.log(`BLUE_QUOTE_SHARED provider_calls=${shared.stats.provider_calls} reused_calls=${shared.stats.reused_calls}`);
      }
    })());
  },
  async fetch(request,env){
    const u=new URL(request.url);
    if(request.method==='GET'&&u.pathname==='/health'){
      return Response.json({status:'ok',version:'R1.4.2',enabled:env.COLLECTOR_ENABLED==='true',
        schedule:'every minute; full market scan every five minutes; market gate Asia/Seoul',
        basket_batch_limit:Number(env.BASKET_BATCH_LIMIT||18),
        note:'No public manual-run endpoint.'},{headers:{'Cache-Control':'no-store'}});
    }
    return new Response('Not found',{status:404});
  }
};

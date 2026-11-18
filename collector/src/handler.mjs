import {collect,getKisQuote} from './core.mjs';
import {collectBasket} from './basket.mjs';
import {collectSearchPriority} from './search-quote-priority.mjs';
import {collectSymbolLivePriority} from './symbol-live.mjs';
import {createSharedQuoteFetcher} from './quote-cache.mjs';

// The public HTTP surface stays health-only. An on-demand KIS quote is exposed
// through a named, non-HTTP WorkerEntrypoint in index.mjs, not here.
export default {
  async scheduled(_event,env,ctx){
    ctx.waitUntil((async()=>{
      const now=new Date(),minute=now.getUTCMinutes();
      const shared=createSharedQuoteFetcher(getKisQuote);
      const deps={quote:shared.quote,preserveBasketPacing:true};
      try{
        await collectSymbolLivePriority(env,now,deps).catch(()=>{console.warn('BLUE_SYMBOL_LIVE_UNAVAILABLE');});
        await collectSearchPriority(env,now,deps).catch(()=>{console.warn('BLUE_R1594_PRIORITY_UNAVAILABLE');});
        await collectBasket(env,now,deps);
        if(minute%5===0)await collect(env,now,deps);
      }finally{
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

import {collect} from './core.mjs';
import {collectBasket} from './basket.mjs';

export default {
  async scheduled(_event,env,ctx){
    // R1.5.3: watch queue every minute; original research collection every 5 minutes.
    ctx.waitUntil((async()=>{
      const minute=new Date().getUTCMinutes();
      await collectBasket(env); // prioritize newly added watch symbols
      if(minute%5===0)await collect(env); // preserve original five-minute cadence
    })());
  },
  async fetch(request,env){
    const u=new URL(request.url);
    // Never expose a remote collect trigger. Only Cron can invoke collect().
    if(request.method==='GET'&&u.pathname==='/health'){
      return Response.json({status:'ok',version:'R1.4.2',enabled:env.COLLECTOR_ENABLED==='true',
        schedule:'*/5 UTC; market gate Asia/Seoul',note:'No public manual-run endpoint.'},{headers:{'Cache-Control':'no-store'}});
    }
    return new Response('Not found',{status:404});
  }
};

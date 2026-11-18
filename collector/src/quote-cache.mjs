/** One KIS snapshot per venue/symbol within a single scheduled collector tick.
 * Sharing responses avoids duplicating calls across symbol, search, basket and
 * baseline collectors. The single paced lane preserves provider protection.
 */
export function createSharedQuoteFetcher(fetchQuote, options={}){
  const spacingMs=options.spacingMs??450;
  const clock=options.clock??(()=>Date.now());
  const sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  if(!Number.isFinite(spacingMs)||spacingMs<0)throw Error('INVALID_QUOTE_SPACING');

  const snapshots=new Map();
  let serial=Promise.resolve(),nextAllowedAt=0;
  const stats={provider_calls:0,reused_calls:0};

  async function quote(env,token,market,code){
    const key=`${market}:${code}`;
    const cached=snapshots.get(key);
    if(cached){stats.reused_calls++;return cached;}

    // Queue the real provider calls serially. A cache hit may reuse an
    // in-flight promise or the finished quote without another REST request.
    const task=serial.then(async()=>{
      const remaining=Math.max(0,nextAllowedAt-clock());
      if(remaining>0)await sleep(remaining);
      nextAllowedAt=clock()+spacingMs;
      stats.provider_calls++;
      return fetchQuote(env,token,market,code);
    });
    serial=task.then(()=>undefined,()=>undefined);
    snapshots.set(key,task);
    try{
      const data=await task;
      // Invalid or error responses should never be treated as a valid cache.
      if(data?.rt_cd!=='0'||!data?.output)snapshots.delete(key);
      return data;
    }catch(err){
      snapshots.delete(key);
      throw err;
    }
  }
  return {quote,stats};
}

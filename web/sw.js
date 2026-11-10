/* BLUE Signal Lab R0.8.1 PWA — cache only immutable same-origin Vite assets.
   Never cache API calls, Cloudflare Access responses, or market research results. */
const CACHE='blue-static-r081';
self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting());});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{
  const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('blue-static-')&&k!==CACHE).map(k=>caches.delete(k)));
  await self.clients.claim();
})());});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||req.mode==='navigate')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(!url.pathname.startsWith('/assets/'))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);const cached=await cache.match(req);
    if(cached)return cached;
    const res=await fetch(req);
    if(res.ok&&res.type==='basic'&&!res.headers.get('content-type')?.includes('text/html'))await cache.put(req,res.clone());
    return res;
  })());
});

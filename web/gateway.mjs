const WEB_ORIGIN='https://blue-signal-lab.ehdud6728.workers.dev';
const error=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
 if(url.origin!==WEB_ORIGIN||!['GET','POST'].includes(request.method)||
  (request.method==='POST'&&request.headers.get('Origin')!==WEB_ORIGIN))return error('GATEWAY_REQUEST_DENIED',403);
 const assertion=request.headers.get('Cf-Access-Jwt-Assertion');
 if(!assertion||assertion.length>16384)return error('ACCESS_REQUIRED',401);
 const headers=new Headers({'Cf-Access-Jwt-Assertion':assertion});
 for(const name of ['Origin','Content-Type','Accept']){const v=request.headers.get(name);if(v!==null)headers.set(name,v);}
 try{
  const upstream=await env.BLUE_API.fetch(new Request(request,{headers,redirect:'manual'}));
  if(upstream.status>=300&&upstream.status<400)return error('GATEWAY_UPSTREAM_REDIRECT',502);
  const type=upstream.headers.get('Content-Type')||'';
  if(!type.toLowerCase().includes('application/json'))return error('GATEWAY_UNEXPECTED_RESPONSE',502);
  return new Response(upstream.body,{status:upstream.status,headers:{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch{return error('GATEWAY_API_UNAVAILABLE',503);}
}};

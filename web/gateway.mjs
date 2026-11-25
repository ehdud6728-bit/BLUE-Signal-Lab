const WEB_ORIGIN='https://blue-signal-lab.ehdud6728.workers.dev';
const error=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
// Prefer the Access-injected assertion; fall back only to a single same-host
// Access application cookie. The backend verifies its signature and audience.
function accessToken(request){
 const assertion=request.headers.get('Cf-Access-Jwt-Assertion');
 if(assertion!==null)return assertion;
 const cookies=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('CF_Authorization='));
 return cookies.length===1?cookies[0].slice('CF_Authorization='.length):null;
}
export default {async fetch(request,env){
 const url=new URL(request.url);
 if(!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
 if(url.origin!==WEB_ORIGIN||!['GET','POST'].includes(request.method)||
  (request.method==='POST'&&request.headers.get('Origin')!==WEB_ORIGIN))return error('GATEWAY_REQUEST_DENIED',403);
 const assertion=accessToken(request);
 if(!assertion||assertion.length>16384)return error('ACCESS_REQUIRED_WEB_TOKEN_MISSING',401);
 // Do not rely on reserved Cloudflare header propagation across the binding.
 // This is always set from the token above, never from a client X-Blue header.
 const headers=new Headers({'X-Blue-Gateway-Token':assertion});
 for(const name of ['Origin','Content-Type','Accept']){const v=request.headers.get(name);if(v!==null)headers.set(name,v);}
 try{
  const upstream=await env.BLUE_API.fetch(new Request(request,{headers,redirect:'manual'}));
  if(upstream.status>=300&&upstream.status<400)return error('GATEWAY_UPSTREAM_REDIRECT',502);
  const type=upstream.headers.get('Content-Type')||'';
  if(!type.toLowerCase().includes('application/json'))return error('GATEWAY_UNEXPECTED_RESPONSE',502);
  return new Response(upstream.body,{status:upstream.status,headers:{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 }catch{return error('GATEWAY_API_UNAVAILABLE',503);}
}};

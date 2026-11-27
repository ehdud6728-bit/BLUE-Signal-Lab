import {validAccessConfig,verifyWebAccessDetailed} from './web-access-jwt.mjs';
export const WEB_ORIGIN='https://blue-signal-lab.ehdud6728.workers.dev';
// Deny by default, including new admin routes.
const READ=new Set(['research/dates','research/provisional-detail','research/provisional-patterns','research/provisional','research/market-ai','research/forward-view','research/rotation-leaders','research/market-trends','research/market-rotation','research/private-combined-cases','research/coverage','research/pulse','research/exit-study','research/search','research/chart','research/request/status','eod/dates','eod/search','eod/prices/compare','analysis/live','analysis/symbols','analysis/symbol','ai/status','ai/report','chart','basket/ai','basket/watch','basket/tracking','prices/compare','live/quotes','health','runs','dates','search','symbol','scan/status']);
const WRITE=new Set(['research/market-ai','research/request','eod/quotes/refresh','analysis/live/request','analysis/live/refresh','analysis/request','ai/market','ai/stock','basket/ai','basket/watch','basket/tracking','prices/request','scan']);
export function allowedGatewayRequest(req){
 const url=new URL(req.url);
 if(url.origin!==WEB_ORIGIN||!url.pathname.startsWith('/api/'))return false;
 const route=url.pathname.slice(5);
 return req.method==='GET'?READ.has(route):req.method==='POST'&&WRITE.has(route)&&req.headers.get('Origin')===WEB_ORIGIN;
}
export const errorResponse=(error,status)=>Response.json({error},{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function handleVerifiedGateway(req,env,invoke,options={}){
 if(!allowedGatewayRequest(req))return errorResponse('GATEWAY_REQUEST_DENIED',403);
 if(!validAccessConfig(env.BLUE_WEB_ACCESS_TEAM,env.BLUE_WEB_ACCESS_AUD))return errorResponse('GATEWAY_ACCESS_NOT_CONFIGURED',503);
 const token=req.headers.get('X-Blue-Gateway-Token')??req.headers.get('Cf-Access-Jwt-Assertion');
 const result=await verifyWebAccessDetailed(token,env.BLUE_WEB_ACCESS_TEAM,env.BLUE_WEB_ACCESS_AUD,options);
 if(result!=='OK')return errorResponse('ACCESS_REQUIRED_API_'+result,result.startsWith('KEYS_')?503:401);
 const headers=new Headers();
 for(const name of ['Origin','Content-Type','Accept']){const v=req.headers.get(name);if(v!==null)headers.set(name,v);}
 // Only this private service binding callback carries the verified subject.
 // Derive a pseudonymous account key only for the new tracking route.
 let owner;
 if(new URL(req.url).pathname==='/api/basket/tracking'){
  try{
   const payload=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
   const claims=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload.padEnd(Math.ceil(payload.length/4)*4,'=')),c=>c.charCodeAt(0))));
   if(typeof claims.sub!=='string'||!claims.sub||claims.sub.length>256)return errorResponse('TRACKING_IDENTITY_REQUIRED',401);
   const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('BLUE_TRACKING_V1|'+JSON.stringify([claims.iss,claims.sub])));
   owner=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
  }catch{return errorResponse('TRACKING_IDENTITY_REQUIRED',401);}
 }
 return await invoke(new Request(req,{headers,redirect:'manual'}),owner);
}

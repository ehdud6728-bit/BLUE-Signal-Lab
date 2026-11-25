import {validAccessConfig,verifyWebAccess} from './web-access-jwt.mjs';
export const WEB_ORIGIN='https://blue-signal-lab.ehdud6728.workers.dev';
// Deny by default, including new admin routes.
const READ=new Set(['research/dates','research/provisional-detail','research/provisional-patterns','research/provisional','research/market-ai','research/rotation-leaders','research/market-trends','research/market-rotation','research/private-combined-cases','research/coverage','research/pulse','research/exit-study','research/search','research/chart','research/request/status','eod/dates','eod/search','eod/prices/compare','analysis/live','analysis/symbols','analysis/symbol','ai/status','ai/report','chart','basket/ai','basket/watch','prices/compare','live/quotes','health','runs','dates','search','symbol','scan/status']);
const WRITE=new Set(['research/market-ai','research/request','eod/quotes/refresh','analysis/live/request','analysis/live/refresh','analysis/request','ai/market','ai/stock','basket/ai','basket/watch','prices/request','scan']);
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
 if(!await verifyWebAccess(req.headers.get('Cf-Access-Jwt-Assertion'),env.BLUE_WEB_ACCESS_TEAM,env.BLUE_WEB_ACCESS_AUD,options))return errorResponse('ACCESS_REQUIRED',401);
 const headers=new Headers();
 for(const name of ['Origin','Content-Type','Accept']){const v=req.headers.get(name);if(v!==null)headers.set(name,v);}
 return await invoke(new Request(req,{headers,redirect:'manual'}));
}

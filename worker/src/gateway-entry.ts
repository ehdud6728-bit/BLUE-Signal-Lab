import {WorkerEntrypoint} from 'cloudflare:workers';
import api from './index';
import {handleVerifiedGateway} from './gateway-policy.mjs';
type GatewayEnv=Parameters<typeof api.fetch>[1]&{BLUE_WEB_ACCESS_TEAM?:string;BLUE_WEB_ACCESS_AUD?:string};
export default api;
// This named service binding entrypoint is not a public HTTP route.
export class BlueWebGateway extends WorkerEntrypoint<GatewayEnv>{
 async fetch(request:Request):Promise<Response>{
  return handleVerifiedGateway(request,this.env,(verified:Request,owner?:string)=>api.fetch(verified,this.env,this.ctx,true,owner));
 }
}

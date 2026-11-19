/** Read-only Cloudflare Worker bindings audit. Never prints raw API responses.
 * This is metadata only: presence of a Secret is not evidence of its value.
 */
const WORKER='blue-market-collector';
const ACCOUNT_ID=/^[a-f0-9]{32}$/i;
export const FLAG_NAMES=Object.freeze([
  'COLLECTOR_ENABLED',
  'TURSO_MIRROR_ENABLED',
  'TURSO_MIRROR_PAUSED',
  'TURSO_DIRECT_QUOTES_ENABLED',
  'TURSO_PROVISIONAL_QUOTES_ENABLED',
  'TURSO_PROVISIONAL_PAUSED',
  'TURSO_INSTANT_QUOTES_ENABLED',
]);
export const PILOT_NAMES=Object.freeze([
  'TURSO_MIRROR_PILOT_UNTIL_UTC',
  'TURSO_DIRECT_PILOT_UNTIL_UTC',
  'TURSO_PROVISIONAL_PILOT_UNTIL_UTC',
]);

function singleBinding(bindings,name){
  const matches=bindings.filter(x=>x&&x.name===name);
  if(matches.length>1)return {state:'DUPLICATE_BINDING'};
  return matches[0]||null;
}
function inspectFlag(binding){
  if(!binding)return 'ABSENT';
  if(binding.state==='DUPLICATE_BINDING')return 'UNKNOWN_DUPLICATE';
  if(binding.type==='secret_text')return 'SECRET_PRESENT_VALUE_UNKNOWN';
  if(binding.type!=='plain_text')return 'UNKNOWN_TYPE';
  // Only these two literal booleans may be shown. Never echo raw values.
  const value=String(binding.text||'').trim().toLowerCase();
  return value==='true'?'TRUE':value==='false'?'FALSE':'UNKNOWN_VALUE';
}
function inspectPilot(binding){
  if(!binding)return 'ABSENT';
  if(binding.state==='DUPLICATE_BINDING')return 'UNKNOWN_DUPLICATE';
  if(binding.type==='secret_text')return 'SECRET_PRESENT_EXPIRY_UNKNOWN';
  if(binding.type!=='plain_text')return 'UNKNOWN_TYPE';
  // Even a plaintext expiry is not printed as part of this limited audit.
  return 'PLAINTEXT_PRESENT_EXPIRY_NOT_CHECKED';
}

export function summarizeWorkerSettings(payload){
  if(payload?.success!==true||!Array.isArray(payload?.result?.bindings))
    throw Error('UNVERIFIABLE_BINDINGS');
  const bindings=payload.result.bindings;
  if(bindings.length>3000)throw Error('UNVERIFIABLE_BINDINGS');
  const flags=Object.fromEntries(FLAG_NAMES.map(name=>[
    name,inspectFlag(singleBinding(bindings,name))
  ]));
  const pilot=Object.fromEntries(PILOT_NAMES.map(name=>[
    name,inspectPilot(singleBinding(bindings,name))
  ]));
  const mirror=flags.TURSO_MIRROR_ENABLED;
  const mirrorOffRisk=mirror==='TRUE'?'POTENTIAL_EXISTING_MIRROR_INTERRUPTION':
    mirror==='FALSE'?'MIRROR_ALREADY_CONFIGURED_OFF':'MIRROR_RUNTIME_UNVERIFIED';
  return {worker:WORKER,method:'GET_ONLY',database_queries:0,
    flags,pilot,mirror_off_deploy_risk:mirrorOffRisk,
    advisory:'SETTINGS_METADATA_ONLY_NO_DEPLOY_AUTHORIZATION'};
}

export async function auditWorkerSettings({accountId,apiToken,fetchFn=fetch}={}){
  if(!ACCOUNT_ID.test(String(accountId||''))||!apiToken)
    throw Error('CLOUDFLARE_AUDIT_CONFIG_MISSING');
  const url=`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER}/settings`;
  let response;
  try{
    response=await fetchFn(url,{method:'GET',headers:{
      authorization:`Bearer ${apiToken}`,accept:'application/json'
    },signal:AbortSignal.timeout(12000)});
  }catch{throw Error('CLOUDFLARE_AUDIT_UNREACHABLE');}
  if(!response?.ok){
    if(response?.status===401)throw Error('CLOUDFLARE_AUDIT_AUTH_REJECTED');
    if(response?.status===403)throw Error('CLOUDFLARE_AUDIT_PERMISSION_DENIED');
    if(response?.status===404)throw Error('CLOUDFLARE_WORKER_NOT_FOUND');
    throw Error('CLOUDFLARE_AUDIT_HTTP_FAILED');
  }
  let payload;
  try{payload=await response.json();}catch{throw Error('CLOUDFLARE_AUDIT_INVALID_RESPONSE');}
  return summarizeWorkerSettings(payload);
}

async function main(){
  try{
    const result=await auditWorkerSettings({
      accountId:process.env.CLOUDFLARE_ACCOUNT_ID,
      apiToken:process.env.CLOUDFLARE_API_TOKEN,
    });
    console.log('BLUE_COLLECTOR_SETTINGS_AUDIT '+JSON.stringify(result));
  }catch(error){
    const allowed=new Set(['CLOUDFLARE_AUDIT_CONFIG_MISSING',
      'CLOUDFLARE_AUDIT_UNREACHABLE','CLOUDFLARE_AUDIT_AUTH_REJECTED',
      'CLOUDFLARE_AUDIT_PERMISSION_DENIED','CLOUDFLARE_WORKER_NOT_FOUND',
      'CLOUDFLARE_AUDIT_HTTP_FAILED','CLOUDFLARE_AUDIT_INVALID_RESPONSE',
      'UNVERIFIABLE_BINDINGS']);
    console.error('BLUE_COLLECTOR_SETTINGS_AUDIT_FAILED',
      allowed.has(error?.message)?error.message:'SANITIZED_AUDIT_FAILURE');
    process.exitCode=1;
  }
}
if(process.argv[1]&&import.meta.url===new URL(`file://${process.argv[1]}`).href)main();

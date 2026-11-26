// Verify only the configured Access issuer and application audience.
// Result codes contain no JWT, email, audience, signing key or raw claims.
const TEAM=/^[a-z0-9-]+\.cloudflareaccess\.com$/;
const AUD=/^[a-f0-9]{64}$/;
const bytes=s=>{
 if(typeof s!=='string'||!s.length||!/^[A-Za-z0-9_-]+$/.test(s))throw Error('BAD_JWT');
 return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
};
const decode=s=>JSON.parse(new TextDecoder().decode(bytes(s)));
export const validAccessConfig=(team,aud)=>typeof team==='string'&&TEAM.test(team)&&typeof aud==='string'&&AUD.test(aud);
// Cache only successful public key sets, scoped to the configured issuer.
// Never accept stale keys on fetch failure. No token or user data is cached.
const keyCache=new Map();
const KEY_TTL_MS=120000;
const MAX_ISSUERS=4;
const DEFAULT_TIMEOUT=4000;
async function loadKeys(team,fetcher,timeout){
 const url='https://'+team+'/cdn-cgi/access/certs';
 let result='KEYS_NETWORK';
 for(let attempt=0;attempt<2;attempt++){
  let resp;
  try{
   resp=await fetcher(url,{method:'GET',redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(timeout)});
  }catch(e){
   result=e?.name==='TimeoutError'||e?.name==='AbortError'?'KEYS_TIMEOUT':'KEYS_NETWORK';
   continue;
  }
  if(!resp.ok){
   const status=resp.status;
   result=Number.isInteger(status)&&status>=300&&status<=599?'KEYS_HTTP_'+status:'KEYS_HTTP_OTHER';
   if(status===429||status>=500)continue;
   return {error:result};
  }
  let body;
  try{body=await resp.json();}catch{return {error:'KEYS_INVALID_JSON'};}
  if(!body||!Array.isArray(body.keys)||body.keys.length===0||body.keys.length>20)return {error:'KEYS_INVALID_SET'};
  return {keys:body.keys};
 }
 return {error:result};
}
function matchingKeys(keys,kid){
 return keys.filter(k=>k&&k.kid===kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
}
async function getKeys(team,kid,fetcher,cache,clock,timeout){
 const old=cache?.get(team);
 if(old&&old.expires>clock()&&matchingKeys(old.keys,kid).length>0)return {keys:old.keys};
 if(old&&old.expires<=clock())cache.delete(team);
 const loaded=await loadKeys(team,fetcher,timeout);
 if(loaded.error)return loaded;
 // Only remember a response containing the expected unique candidate.
 // Unknown kids still require refresh; no unverified token is accepted.
 if(cache&&matchingKeys(loaded.keys,kid).length===1){
  if(!cache.has(team)&&cache.size>=MAX_ISSUERS)cache.delete(cache.keys().next().value);
  cache.set(team,{keys:loaded.keys,expires:clock()+KEY_TTL_MS});
 }
 return loaded;
}
export async function verifyWebAccessDetailed(token,team,aud,{now=Date.now(),fetcher=fetch,cache=fetcher===fetch?keyCache:null,clock=Date.now,timeout=DEFAULT_TIMEOUT}={}){
 if(!validAccessConfig(team,aud))return 'NOT_CONFIGURED';
 if(typeof token!=='string'||!token||token.length>16384)return 'TOKEN_MISSING';
 let h,p,s,header,claims;
 try{
  const parts=token.split('.');if(parts.length!==3)return 'TOKEN_FORMAT';
  [h,p,s]=parts;header=decode(h);claims=decode(p);
 }catch{return 'TOKEN_FORMAT';}
 const seconds=Math.floor(now/1000);
 if(!header||!claims||header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>256)return 'TOKEN_FORMAT';
 if(claims.iss!=='https://'+team)return 'ISSUER_MISMATCH';
 if(!Array.isArray(claims.aud)||!claims.aud.includes(aud))return 'AUDIENCE_MISMATCH';
 if(claims.type!=='app'||typeof claims.sub!=='string'||!claims.sub)return 'IDENTITY_REQUIRED';
 if(!Number.isInteger(claims.exp)||claims.exp<=seconds||
    !Number.isInteger(claims.iat)||claims.iat>seconds+30||
    (claims.nbf!==undefined&&(!Number.isInteger(claims.nbf)||claims.nbf>seconds)))return 'TOKEN_TIME';
 const loaded=await getKeys(team,header.kid,fetcher,cache,clock,timeout);
 if(loaded.error)return loaded.error;
 const keys=matchingKeys(loaded.keys,header.kid);
 if(keys.length!==1)return 'KEY_NOT_FOUND';
 try{
  const key=await crypto.subtle.importKey('jwk',keys[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(s),new TextEncoder().encode(h+'.'+p))?'OK':'SIGNATURE_INVALID';
 }catch{return 'SIGNATURE_INVALID';}
}
export async function verifyWebAccess(...args){return await verifyWebAccessDetailed(...args)==='OK';}

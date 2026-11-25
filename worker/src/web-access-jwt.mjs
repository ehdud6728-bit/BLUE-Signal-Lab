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
export async function verifyWebAccessDetailed(token,team,aud,{now=Date.now(),fetcher=fetch}={}){
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
 let body;
 try{
  const resp=await fetcher('https://'+team+'/cdn-cgi/access/certs',{redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!resp.ok)return 'KEYS_UNAVAILABLE';
  body=await resp.json();
 }catch{return 'KEYS_UNAVAILABLE';}
 if(!body||!Array.isArray(body.keys)||body.keys.length>20)return 'KEYS_UNAVAILABLE';
 const keys=body.keys.filter(k=>k&&k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
 if(keys.length!==1)return 'KEY_NOT_FOUND';
 try{
  const key=await crypto.subtle.importKey('jwk',keys[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(s),new TextEncoder().encode(h+'.'+p))?'OK':'SIGNATURE_INVALID';
 }catch{return 'SIGNATURE_INVALID';}
}
export async function verifyWebAccess(...args){return await verifyWebAccessDetailed(...args)==='OK';}

// Validate an identity-based Access application token; never trust an incoming issuer URL.
const TEAM=/^[a-z0-9-]+\.cloudflareaccess\.com$/;
const AUD=/^[a-f0-9]{64}$/;
const bytes=s=>{
 if(typeof s!=='string'||!s.length||!/^[A-Za-z0-9_-]+$/.test(s))throw Error('BAD_JWT');
 return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));
};
const decode=s=>JSON.parse(new TextDecoder().decode(bytes(s)));
export const validAccessConfig=(team,aud)=>typeof team==='string'&&TEAM.test(team)&&typeof aud==='string'&&AUD.test(aud);
export async function verifyWebAccess(token,team,aud,{now=Date.now(),fetcher=fetch}={}){
 if(!validAccessConfig(team,aud)||typeof token!=='string'||token.length>16384)return false;
 try{
  const parts=token.split('.');if(parts.length!==3)return false;
  const [h,p,s]=parts,header=decode(h),claims=decode(p),seconds=Math.floor(now/1000);
  if(header.alg!=='RS256'||typeof header.kid!=='string'||!header.kid||header.kid.length>256||
    claims.iss!=='https://'+team||!Array.isArray(claims.aud)||!claims.aud.includes(aud)||
    claims.type!=='app'||typeof claims.sub!=='string'||!claims.sub||
    !Number.isInteger(claims.exp)||claims.exp<=seconds||
    !Number.isInteger(claims.iat)||claims.iat>seconds+30||
    (claims.nbf!==undefined&&(!Number.isInteger(claims.nbf)||claims.nbf>seconds)))return false;
  const resp=await fetcher('https://'+team+'/cdn-cgi/access/certs',{redirect:'error',signal:AbortSignal.timeout(5000),cf:{cacheEverything:true,cacheTtl:300}});
  if(!resp.ok)return false;
  const body=await resp.json();
  if(!Array.isArray(body.keys)||body.keys.length>20)return false;
  const keys=body.keys.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256')&&(!k.use||k.use==='sig'));
  if(keys.length!==1)return false;
  const key=await crypto.subtle.importKey('jwk',keys[0],{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  return await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(s),new TextEncoder().encode(h+'.'+p));
 }catch{return false;}
}

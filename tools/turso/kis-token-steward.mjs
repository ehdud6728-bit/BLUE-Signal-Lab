/** Encrypted KIS token steward for Turso, wholly separate from D1.
 * NEVER enable with the old D1 token issuer active; first pause it, then wait
 * 24 hours after the recorded pause. The Worker only READS this vault.
 */
import {createClient} from '@libsql/client';
import {createHash,createCipheriv,hkdfSync,randomBytes} from 'node:crypto';

const KIS_TOKEN_URL='https://openapi.koreainvestment.com:9443/oauth2/tokenP';
const DAY_MS=86_400_000;
const GRACE_MS=5*60_000;
const hash=s=>createHash('sha256').update(s).digest('hex');
export const scopeFor=key=>'KIS_PROD_READONLY_V1_'+hash(key).slice(0,20);
const utc=now=>now.toISOString();
const kstDay=now=>new Date(now.getTime()+9*3600_000).toISOString().slice(0,10);

function parseKisExpiry(expiry){
  if(typeof expiry!=='string')throw Error('KIS_EXPIRY_BAD');
  const s=expiry.trim();
  const stamp=/^20\d{2}-\d\d-\d\d[ T]\d\d:\d\d:\d\d$/.test(s)
    ?s.replace(' ','T')+'+09:00':s;
  if(!/^20\d{2}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(stamp))throw Error('KIS_EXPIRY_BAD');
  const time=Date.parse(stamp);
  if(!Number.isFinite(time))throw Error('KIS_EXPIRY_BAD');
  return time;
}
export function cutoverReady(env,now=new Date()){
  if(String(env.BLUE_KIS_TOKEN_AUTO_PAUSED)!=='true'||String(env.BLUE_KIS_TURSO_CUTOVER_APPROVED)!=='true')
    return 'LEGACY_ISSUER_NOT_PAUSED_OR_CUTOVER_NOT_APPROVED';
  const raw=String(env.BLUE_KIS_D1_DISABLED_AT_UTC||'');
  if(!/^20\d{2}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(raw))
    return 'LEGACY_ISSUER_PAUSE_TIMESTAMP_MISSING';
  const stopped=Date.parse(raw);
  if(!Number.isFinite(stopped)||stopped>now.getTime()||now.getTime()-stopped<DAY_MS)
    return 'WAIT_24H_SINCE_LEGACY_ISSUER_PAUSED';
  return 'READY';
}
export function encryptKisToken(token,key,secret){
  if(!token||token.length>4096||!key||!secret)throw Error('KIS_TOKEN_INVALID');
  // The exact same HKDF+AES-GCM format as the existing (D1) Worker decryptor:
  // ciphertext resides in Turso, with NO D1 query or stored plaintext.
  const salt=Buffer.from(hash('BLUE_KIS_R131_VAULT_'+key),'hex');
  const derived=Buffer.from(hkdfSync('sha256',Buffer.from(secret,'utf8'),salt,
    Buffer.from('BLUE-Signal-Lab encrypted KIS access-token D1 v1','utf8'),32));
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',derived,nonce);
  cipher.setAAD(Buffer.from(scopeFor(key),'utf8'));
  const encrypted=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
  return Buffer.concat([nonce,encrypted,cipher.getAuthTag()]).toString('base64url');
}
export async function issueOnce(key,secret,{fetchFn=fetch}={}){
  const result=await fetchFn(KIS_TOKEN_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify({grant_type:'client_credentials',appkey:key,appsecret:secret}),
    signal:AbortSignal.timeout(15000)
  });
  if(!result.ok)throw Error('KIS_ISSUE_HTTP_UNAVAILABLE');
  const data=await result.json();
  if(typeof data?.access_token!=='string'||!data.access_token||
    typeof data?.access_token_token_expired!=='string')throw Error('KIS_ISSUE_BAD_RESPONSE');
  return {token:data.access_token,expires:parseKisExpiry(data.access_token_token_expired)};
}
export async function steward(client,env,now=new Date(),{mode='check',issuer=issueOnce}={}){
  if(!['check','issue'].includes(mode))throw Error('INVALID_MODE');
  const key=String(env.KIS_APP_KEY||''),secret=String(env.KIS_APP_SECRET||'');
  if(!key||!secret)throw Error('KIS_CONFIG_MISSING');
  await client.execute('CREATE TABLE IF NOT EXISTS blue_turso_kis_vault_v1 (scope TEXT PRIMARY KEY,ciphertext TEXT NOT NULL,expires_at_utc TEXT NOT NULL,saved_at_utc TEXT NOT NULL)');
  await client.execute('CREATE TABLE IF NOT EXISTS blue_turso_kis_issuance_v1 (scope TEXT PRIMARY KEY,last_attempt_at_utc TEXT NOT NULL,last_attempt_day_kst TEXT NOT NULL,status TEXT NOT NULL,last_success_at_utc TEXT)');
  const scope=scopeFor(key);
  const result=await client.execute({sql:'SELECT expires_at_utc,saved_at_utc FROM blue_turso_kis_vault_v1 WHERE scope=? LIMIT 1',args:[scope]});
  const existing=result.rows?.[0];
  const expires=existing?Date.parse(String(existing.expires_at_utc)):NaN;
  const saved=existing?Date.parse(String(existing.saved_at_utc)):NaN;
  if(existing&&(!Number.isFinite(expires)||!Number.isFinite(saved)||saved>now.getTime()+GRACE_MS||
    expires<=saved))return {status:'INVALID_TOKEN_METADATA'};
  const tokenValid=existing&&expires>now.getTime()+GRACE_MS;
  if(mode==='check')return {status:tokenValid?'TOKEN_VALID':'TOKEN_MISSING_OR_EXPIRED',
    expires_at_utc:existing?String(existing.expires_at_utc):null};
  const gate=cutoverReady(env,now);
  if(gate!=='READY')return {status:gate};
  if(tokenValid)return {status:'TOKEN_VALID',expires_at_utc:String(existing.expires_at_utc)};
  // Never request a new token within 24h of the last SAVED token.
  if(existing&&now.getTime()-saved<DAY_MS)return {status:'WAIT_24H_FROM_LAST_SAVED'};
  const stamp=utc(now);
  const claimed=await client.execute({sql:`INSERT INTO blue_turso_kis_issuance_v1
    (scope,last_attempt_at_utc,last_attempt_day_kst,status,last_success_at_utc)
    VALUES(?,?,?,'CLAIMED',NULL)
    ON CONFLICT(scope) DO UPDATE SET
      last_attempt_at_utc=excluded.last_attempt_at_utc,
      last_attempt_day_kst=excluded.last_attempt_day_kst,status='CLAIMED'
    WHERE last_attempt_day_kst<excluded.last_attempt_day_kst
      AND (julianday(excluded.last_attempt_at_utc)-julianday(last_attempt_at_utc))>=1.0
    RETURNING last_attempt_at_utc`,args:[scope,stamp,kstDay(now)]});
  if(!claimed.rows?.length)return {status:'ALREADY_ATTEMPTED_KST_DAY_OR_24H'};
  let issued;
  try{issued=await issuer(key,secret);}catch{
    await client.execute({sql:"UPDATE blue_turso_kis_issuance_v1 SET status='ISSUE_FAILED' WHERE scope=? AND last_attempt_at_utc=?",args:[scope,stamp]});
    return {status:'ISSUE_FAILED_NO_RETRY'};
  }
  try{
    if(!Number.isFinite(issued.expires)||issued.expires<=now.getTime()+GRACE_MS||
      issued.expires>now.getTime()+48*3600_000)throw Error('KIS_EXPIRY_BAD');
    const encrypted=encryptKisToken(issued.token,key,secret);
    await client.execute({sql:`INSERT INTO blue_turso_kis_vault_v1
      (scope,ciphertext,expires_at_utc,saved_at_utc) VALUES(?,?,?,?)
      ON CONFLICT(scope) DO UPDATE SET ciphertext=excluded.ciphertext,
        expires_at_utc=excluded.expires_at_utc,saved_at_utc=excluded.saved_at_utc`,
      args:[scope,encrypted,utc(new Date(issued.expires)),stamp]});
    await client.execute({sql:"UPDATE blue_turso_kis_issuance_v1 SET status='SAVED',last_success_at_utc=? WHERE scope=? AND last_attempt_at_utc=?",args:[stamp,scope,stamp]});
    return {status:'TOKEN_SAVED',expires_at_utc:utc(new Date(issued.expires))};
  }catch{
    await client.execute({sql:"UPDATE blue_turso_kis_issuance_v1 SET status='SAVE_FAILED' WHERE scope=? AND last_attempt_at_utc=?",args:[scope,stamp]});
    return {status:'SAVE_FAILED_NO_RETRY'};
  }
}
async function main(){
  const env=process.env,mode=process.argv.includes('--issue')?'issue':'check';
  const url=String(env.TURSO_DATABASE_URL||'').trim(),authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(libsql|https):\/\//.test(url)||!authToken)throw Error('TURSO_CONNECTION_MISSING');
  const client=createClient({url,authToken});
  try{
    const result=await steward(client,env,new Date(),{mode});
    console.log('BLUE_TURSO_KIS_TOKEN_STEWARD '+JSON.stringify(result));
    if(['ISSUE_FAILED_NO_RETRY','SAVE_FAILED_NO_RETRY','INVALID_TOKEN_METADATA'].includes(result.status))
      process.exitCode=1;
  }finally{client.close();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(()=>{console.error('BLUE_TURSO_KIS_TOKEN_STEWARD_FAILED');process.exitCode=1;});
}

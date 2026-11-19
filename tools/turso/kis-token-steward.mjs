/** Single KIS issuer with a Turso primary and optional encrypted D1 standby.
 * NEVER enable with the old D1 token issuer active; first pause it, then wait
 * 24 hours after the recorded pause. Workers only READ the token vaults.
 */
import {createClient} from '@libsql/client';
import {createHash,createCipheriv,createDecipheriv,hkdfSync,randomBytes} from 'node:crypto';

const KIS_TOKEN_URL='https://openapi.koreainvestment.com:9443/oauth2/tokenP';
const DAY_MS=86_400_000;
const GRACE_MS=5*60_000;
const RENEW_BEFORE_MS=60*60_000;
const RETRY_DELAY_MS=30*60_000;
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
  if(!Number.isFinite(stopped)||stopped>now.getTime())
    return 'WAIT_24H_SINCE_LEGACY_ISSUER_PAUSED';
  if(now.getTime()-stopped<DAY_MS)
    return String(env.BLUE_KIS_EARLY_CUTOVER_APPROVED)==='true'
      ?'EARLY_D1_AUDIT_REQUIRED':'WAIT_24H_SINCE_LEGACY_ISSUER_PAUSED';
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
export function decryptKisToken(encoded,key,secret){
  try{
    if(typeof encoded!=='string'||!key||!secret)throw Error('BAD_TOKEN');
    const blob=Buffer.from(encoded,'base64url');
    if(blob.length<29||blob.length>8192)throw Error('BAD_TOKEN');
    const salt=Buffer.from(hash('BLUE_KIS_R131_VAULT_'+key),'hex');
    const derived=Buffer.from(hkdfSync('sha256',Buffer.from(secret,'utf8'),salt,
      Buffer.from('BLUE-Signal-Lab encrypted KIS access-token D1 v1','utf8'),32));
    const cipher=createDecipheriv('aes-256-gcm',derived,blob.subarray(0,12));
    cipher.setAAD(Buffer.from(scopeFor(key),'utf8'));
    cipher.setAuthTag(blob.subarray(blob.length-16));
    const token=Buffer.concat([cipher.update(blob.subarray(12,blob.length-16)),cipher.final()]).toString('utf8');
    if(!token||token.length>4096)throw Error('BAD_TOKEN');
    return token;
  }catch{throw Error('KIS_TOKEN_DECRYPT_FAILED');}
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
async function syncBackup(client,key,secret,scope,backup,now){
  let result;
  try{
    result=await client.execute({sql:`SELECT ciphertext,expires_at_utc,saved_at_utc
      FROM blue_turso_kis_vault_v1 WHERE scope=? LIMIT 1`,args:[scope]});
    const row=result.rows?.[0];
    if(!row)return {status:'D1_BACKUP_NO_PRIMARY_TOKEN'};
    const expires=Date.parse(String(row.expires_at_utc)),saved=Date.parse(String(row.saved_at_utc));
    if(!Number.isFinite(expires)||!Number.isFinite(saved)||saved>now.getTime()+GRACE_MS||
       expires<=saved)return {status:'INVALID_TOKEN_METADATA'};
    if(expires<=now.getTime()+GRACE_MS)return {status:'D1_BACKUP_PRIMARY_EXPIRED'};
    const token=decryptKisToken(String(row.ciphertext),key,secret);
    await backup.mirror({token,expiresAt:String(row.expires_at_utc),
      savedAt:String(row.saved_at_utc),key,secret});
    await client.execute({sql:`UPDATE blue_turso_kis_issuance_v1 SET status='SAVED_DUAL'
      WHERE scope=? AND status IN ('SAVED','D1_SYNC_PENDING','SAVED_DUAL')`,args:[scope]});
    return {status:'D1_BACKUP_VERIFIED',expires_at_utc:String(row.expires_at_utc)};
  }catch{return {status:'D1_BACKUP_SYNC_FAILED'};}
}
export async function steward(client,env,now=new Date(),{mode='check',issuer=issueOnce,backup=null}={}){
  if(!['check','issue','sync'].includes(mode))throw Error('INVALID_MODE');
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
  const tokenValid=Boolean(existing&&expires>now.getTime()+GRACE_MS);
  const renewalDue=!tokenValid||expires<=now.getTime()+RENEW_BEFORE_MS;
  if(mode==='check')return {status:!existing?'TOKEN_MISSING':
      !tokenValid?'TOKEN_EXPIRED':renewalDue?'TOKEN_EXPIRES_SOON':'TOKEN_VALID',
    expires_at_utc:existing?String(existing.expires_at_utc):null};
  const gate=cutoverReady(env,now);
  if(gate!=='READY'&&gate!=='EARLY_D1_AUDIT_REQUIRED')return {status:gate};
  const dual=String(env.BLUE_KIS_DUAL_VAULT_ENABLED)==='true';
  // Never issue a new KIS token with half-configured primary/backup storage.
  if(!dual||!backup||typeof backup.mirror!=='function'||typeof backup.inspect!=='function')
    return {status:'D1_BACKUP_NOT_CONFIGURED'};
  if(gate==='EARLY_D1_AUDIT_REQUIRED'){
    // Do not replace the 24-hour pause rule with a bare repository flag.
    // Recheck the actual D1 issuance ledger immediately before tokenP/sync.
    if(typeof backup.auditIssuer!=='function')return {status:'EARLY_D1_AUDIT_UNAVAILABLE'};
    let audit;
    try{audit=await backup.auditIssuer({key,
      pauseAt:String(env.BLUE_KIS_D1_DISABLED_AT_UTC),now});}
    catch{return {status:'EARLY_D1_AUDIT_UNAVAILABLE'};}
    if(audit.status!=='EARLY_D1_ISSUER_VERIFIED')
      return {status:'EARLY_D1_AUDIT_BLOCKED'};
  }
  if(mode==='sync')return syncBackup(client,key,secret,scope,backup,now);
  if(!existing){
    // An empty Turso vault is not proof that no valid KIS token was issued.
    // An active D1 standby must be reused instead of requesting tokenP again.
    let standby;
    try{standby=await backup.inspect({key,secret,now});}
    catch{return {status:'D1_BACKUP_INSPECTION_FAILED_NO_ISSUE'};}
    if(standby.status==='VALID'){
      await client.execute({sql:`INSERT INTO blue_turso_kis_vault_v1
        (scope,ciphertext,expires_at_utc,saved_at_utc) VALUES(?,?,?,?)
        ON CONFLICT(scope) DO NOTHING`,args:[scope,
          encryptKisToken(standby.token,key,secret),standby.expiresAt,standby.savedAt]});
      return {status:'TOKEN_RESTORED_FROM_D1',expires_at_utc:standby.expiresAt};
    }
    if(standby.status==='EXPIRED'&&now.getTime()-Date.parse(standby.savedAt)<DAY_MS)
      return {status:'WAIT_24H_FROM_BACKUP_SAVED',expires_at_utc:standby.expiresAt};
    if(!['MISSING','EXPIRED'].includes(standby.status))
      return {status:'D1_BACKUP_INSPECTION_FAILED_NO_ISSUE'};
  }
  if(!renewalDue){
    const prior=await client.execute({sql:`SELECT status FROM blue_turso_kis_issuance_v1
      WHERE scope=? LIMIT 1`,args:[scope]});
    if(prior.rows?.[0]?.status==='D1_SYNC_PENDING')
      return syncBackup(client,key,secret,scope,backup,now);
    return {status:'TOKEN_VALID',expires_at_utc:String(existing.expires_at_utc)};
  }
  // The previous saved token may remain usable during the renewal window.
  // No new tokenP call is allowed until 24 hours after that saved token.
  if(existing&&now.getTime()-saved<DAY_MS)return {
    status:tokenValid?'TOKEN_VALID_RENEWAL_WAIT_24H':'WAIT_24H_FROM_LAST_SAVED',
    expires_at_utc:String(existing.expires_at_utc)};
  const stamp=utc(now);
  // Persist the reservation before tokenP. The only exception to the usual
  // 24-hour/KST-day attempt guard is ONE retry after a failed provider call,
  // at least 30 minutes later on that same KST day.
  const claimed=await client.execute({sql:`INSERT INTO blue_turso_kis_issuance_v1
    (scope,last_attempt_at_utc,last_attempt_day_kst,status,last_success_at_utc)
    VALUES(?,?,?,'CLAIMED',NULL)
    ON CONFLICT(scope) DO UPDATE SET
      status=CASE WHEN last_attempt_day_kst=excluded.last_attempt_day_kst
                       AND status='ISSUE_FAILED'
                  THEN 'CLAIMED_RETRY' ELSE 'CLAIMED' END,
      last_attempt_at_utc=excluded.last_attempt_at_utc,
      last_attempt_day_kst=excluded.last_attempt_day_kst
    WHERE (last_attempt_day_kst<excluded.last_attempt_day_kst
      AND (julianday(excluded.last_attempt_at_utc)-julianday(last_attempt_at_utc))>=1.0)
      OR (last_attempt_day_kst=excluded.last_attempt_day_kst AND status='ISSUE_FAILED'
      AND (julianday(excluded.last_attempt_at_utc)-julianday(last_attempt_at_utc))>=(${RETRY_DELAY_MS}/86400000.0))
    RETURNING last_attempt_at_utc,status`,args:[scope,stamp,kstDay(now)]});
  if(!claimed.rows?.length)return {status:'ALREADY_ATTEMPTED_KST_DAY_OR_24H'};
  const retry=claimed.rows[0].status==='CLAIMED_RETRY';
  let issued;
  try{issued=await issuer(key,secret);}catch{
    await client.execute({sql:"UPDATE blue_turso_kis_issuance_v1 SET status=? WHERE scope=? AND last_attempt_at_utc=?",args:[retry?'ISSUE_RETRY_FAILED':'ISSUE_FAILED',scope,stamp]});
    return {status:retry?'ISSUE_FAILED_FINAL':'ISSUE_FAILED_RETRY_AFTER_30M'};
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
    // A successful tokenP call is never repeated because a standby DB write failed.
    // The existing primary token is re-used for later backup synchronization.
  }catch{
    await client.execute({sql:"UPDATE blue_turso_kis_issuance_v1 SET status='SAVE_FAILED' WHERE scope=? AND last_attempt_at_utc=?",args:[scope,stamp]});
    return {status:'SAVE_FAILED_NO_RETRY'};
  }
  const backupResult=await syncBackup(client,key,secret,scope,backup,now);
  if(backupResult.status==='D1_BACKUP_VERIFIED')return {status:'TOKEN_SAVED_DUAL',expires_at_utc:utc(new Date(issued.expires))};
  await client.execute({sql:`UPDATE blue_turso_kis_issuance_v1 SET status='D1_SYNC_PENDING'
    WHERE scope=? AND last_attempt_at_utc=?`,args:[scope,stamp]});
  return {status:'TOKEN_SAVED_BACKUP_PENDING',expires_at_utc:utc(new Date(issued.expires))};
}
async function main(){
  const env=process.env,mode=process.argv.includes('--sync')?'sync':process.argv.includes('--issue')?'issue':'check';
  const url=String(env.TURSO_DATABASE_URL||'').trim(),authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(libsql|https):\/\//.test(url)||!authToken)throw Error('TURSO_CONNECTION_MISSING');
  const client=createClient({url,authToken});
  try{
    const backup=mode!=='check'&&env.BLUE_KIS_DUAL_VAULT_ENABLED==='true'
      ?(await import('./d1-token-backup.mjs')).createD1Backup(env):null;
    const result=await steward(client,env,new Date(),{mode,backup});
    console.log('BLUE_TURSO_KIS_TOKEN_STEWARD '+JSON.stringify(result));
    if(['ISSUE_FAILED_RETRY_AFTER_30M','ISSUE_FAILED_FINAL','SAVE_FAILED_NO_RETRY',
      'INVALID_TOKEN_METADATA','TOKEN_SAVED_BACKUP_PENDING','D1_BACKUP_SYNC_FAILED',
      'D1_BACKUP_NO_PRIMARY_TOKEN','D1_BACKUP_PRIMARY_EXPIRED',
      'D1_BACKUP_NOT_CONFIGURED','D1_BACKUP_INSPECTION_FAILED_NO_ISSUE',
      'EARLY_D1_AUDIT_UNAVAILABLE','EARLY_D1_AUDIT_BLOCKED'].includes(result.status))
      process.exitCode=1;
  }finally{client.close();}
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
  main().catch(()=>{console.error('BLUE_TURSO_KIS_TOKEN_STEWARD_FAILED');process.exitCode=1;});
}

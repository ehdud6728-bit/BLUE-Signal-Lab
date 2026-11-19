/** Mirror one already-issued KIS token into the existing encrypted D1 vault.
 * This module NEVER calls the KIS provider, and never logs ciphertext.
 */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {encryptKisToken,decryptKisToken,scopeFor} from './kis-token-steward.mjs';

function databaseId(){
  const config=new URL('../../worker/wrangler.jsonc',import.meta.url);
  const data=JSON.parse(readFileSync(fileURLToPath(config),'utf8'));
  const matches=data.d1_databases?.filter(d=>d.database_name==='blue-signal-lab-db')||[];
  if(matches.length!==1||!/^[0-9a-f-]{36}$/i.test(String(matches[0].database_id)))
    throw Error('D1_BACKUP_CONFIGURATION_INVALID');
  return matches[0].database_id;
}

export function createD1Backup(env,{fetchFn=fetch,dbId=databaseId()}={}){
  const account=String(env.CLOUDFLARE_ACCOUNT_ID||'').trim();
  const credential=String(env.CLOUDFLARE_API_TOKEN||'').trim();
  if(!/^[0-9a-f]{32}$/i.test(account)||!credential)throw Error('D1_BACKUP_CONFIG_MISSING');
  const url=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`;
  async function query(sql,params=[]){
    let response,body;
    try{
      response=await fetchFn(url,{method:'POST',
        headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},
        body:JSON.stringify({sql,params}),signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Error('D1_BACKUP_UNAVAILABLE');
      body=await response.json();
    }catch{throw Error('D1_BACKUP_UNAVAILABLE');}
    const result=body?.result?.[0];
    if(body?.success!==true||result?.success!==true||!Array.isArray(result.results))
      throw Error('D1_BACKUP_UNAVAILABLE');
    return result.results;
  }
  return {
    /** D1 is a standby copy, never an independently-issued token source. */
    async inspect({key,secret,now}){
      const rows=await query(`SELECT ciphertext,expires_at_utc,saved_at_utc
        FROM blue_kis_token_vault_v1 WHERE scope=? LIMIT 1`,[scopeFor(key)]);
      const row=rows[0];
      if(!row)return {status:'MISSING'};
      const expires=Date.parse(String(row.expires_at_utc));
      const saved=Date.parse(String(row.saved_at_utc));
      if(!Number.isFinite(expires)||!Number.isFinite(saved)||saved>now.getTime()+5*60_000||
         expires<=saved)throw Error('D1_BACKUP_METADATA_INVALID');
      // Decryption also guards against a stale or different app-secret scope.
      const token=decryptKisToken(String(row.ciphertext),key,secret);
      return {status:expires>now.getTime()+5*60_000?'VALID':'EXPIRED',
        token,expiresAt:String(row.expires_at_utc),savedAt:String(row.saved_at_utc)};
    },
    async mirror({token,expiresAt,savedAt,key,secret}){
      if(!token||!Number.isFinite(Date.parse(expiresAt))||
          !Number.isFinite(Date.parse(savedAt)))throw Error('D1_BACKUP_METADATA_INVALID');
      const scope=scopeFor(key);
      await query(`CREATE TABLE IF NOT EXISTS blue_kis_token_vault_v1 (
        scope TEXT PRIMARY KEY,ciphertext TEXT NOT NULL,
        expires_at_utc TEXT NOT NULL,saved_at_utc TEXT NOT NULL)`);
      const ciphertext=encryptKisToken(token,key,secret);
      // Never allow an older Turso copy to replace a newer D1 standby token.
      await query(`INSERT INTO blue_kis_token_vault_v1
        (scope,ciphertext,expires_at_utc,saved_at_utc) VALUES(?,?,?,?)
        ON CONFLICT(scope) DO UPDATE SET ciphertext=excluded.ciphertext,
          expires_at_utc=excluded.expires_at_utc,saved_at_utc=excluded.saved_at_utc
        WHERE blue_kis_token_vault_v1.saved_at_utc<=excluded.saved_at_utc
          AND blue_kis_token_vault_v1.expires_at_utc<=excluded.expires_at_utc`,
        [scope,ciphertext,expiresAt,savedAt]);
      const rows=await query(`SELECT ciphertext,expires_at_utc,saved_at_utc
        FROM blue_kis_token_vault_v1 WHERE scope=? LIMIT 1`,[scope]);
      const row=rows[0];
      if(!row||row.expires_at_utc!==expiresAt||row.saved_at_utc!==savedAt)
        throw Error('D1_BACKUP_CONFLICT');
      // A metadata-only readback is not proof that the expected token survived.
      if(decryptKisToken(String(row.ciphertext),key,secret)!==token)
        throw Error('D1_BACKUP_CONFLICT');
      return {status:'D1_BACKUP_VERIFIED'};
    }
  };
}

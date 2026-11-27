/** Read an existing immutable private snapshot; publish ciphertext only.
 * Private recipient keys never enter GitHub or the workflow. No DB writes. */
import {createHash,createPublicKey,createPrivateKey,publicEncrypt,privateDecrypt,randomBytes,createCipheriv,createDecipheriv,constants} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {read,validate} from './private-pattern-charts.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const need=(ok,message)=>{if(!ok)throw Error(message)};
const SCHEMA='BLUE_PRIVATE_CHART_ENVELOPE_V1';
function recipient(pem){const key=createPublicKey(pem);need(key.asymmetricKeyType==='rsa'&&key.asymmetricKeyDetails.modulusLength>=2048,'INVALID_EXPORT_RECIPIENT');return {key,id:sha(key.export({type:'spki',format:'der'}))};}
const aad=b=>Buffer.from(`${SCHEMA}|${b.snapshot_id}|${b.recipient_sha256}`);
export function seal(raw,pem,snapshot){
 const {key,id}=recipient(pem);need(/^[a-f0-9]{64}$/.test(snapshot)&&sha(raw)===snapshot,'EXPORT_SNAPSHOT_MISMATCH');validate(raw);
 const secret=randomBytes(32),iv=randomBytes(12),b={schema:SCHEMA,snapshot_id:snapshot,recipient_sha256:id};
 try{const cipher=createCipheriv('aes-256-gcm',secret,iv);cipher.setAAD(aad(b));const encrypted=Buffer.concat([cipher.update(raw,'utf8'),cipher.final()]);
 return {...b,wrapped_key:publicEncrypt({key,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},secret).toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')};
 }finally{secret.fill(0)}
}
export function unseal(bundle,pem){
 need(bundle?.schema===SCHEMA&&/^[a-f0-9]{64}$/.test(bundle.snapshot_id)&&/^[a-f0-9]{64}$/.test(bundle.recipient_sha256),'INVALID_EXPORT_ENVELOPE');
 const key=createPrivateKey(pem),pub=createPublicKey(key);need(sha(pub.export({type:'spki',format:'der'}))===bundle.recipient_sha256,'WRONG_EXPORT_RECIPIENT');
 const bytes=(name,max)=>{const s=bundle[name];need(typeof s==='string'&&s.length<=max&&/^[A-Za-z0-9+/]+={0,2}$/.test(s),'INVALID_EXPORT_ENCODING');return Buffer.from(s,'base64')};
 const iv=bytes('iv',32),tag=bytes('tag',32),wrapped=bytes('wrapped_key',2048),ciphertext=bytes('ciphertext',24*1024*1024);need(iv.length===12&&tag.length===16,'INVALID_EXPORT_NONCE');
 const secret=privateDecrypt({key,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},wrapped);
 try{need(secret.length===32,'INVALID_EXPORT_KEY');const decipher=createDecipheriv('aes-256-gcm',secret,iv);decipher.setAAD(aad(bundle));decipher.setAuthTag(tag);const raw=Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');need(sha(raw)===bundle.snapshot_id,'EXPORT_PLAINTEXT_HASH');validate(raw);return raw;
 }finally{secret.fill(0)}
}
export async function exportStored(db,snapshot,pem){recipient(pem);return seal(await read(db,snapshot),pem,snapshot);}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 let db;try{
  const snapshot=process.env.CHART_SNAPSHOT_ID,out=process.env.CHART_ENCRYPTED_OUT;
  need(/^[a-f0-9]{64}$/.test(snapshot||'')&&typeof out==='string'&&out.endsWith('.sealed.json'),'EXPORT_CONFIG_REQUIRED');
  const pem=await readFile('research/chart-export-recipient-public.pem','utf8');recipient(pem);
  const {createClient}=await import('@libsql/client');db=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN,intMode:'string'});
  const encrypted=await exportStored(db,snapshot,pem);await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(encrypted)+'\n');
  console.log('BLUE_PRIVATE_CHART_ENCRYPTED_EXPORT',JSON.stringify({status:'ENCRYPTED_SNAPSHOT_READY',snapshot_id:snapshot,recipient_sha256:encrypted.recipient_sha256,db_writes:0,raw_artifact_files:0}));
 }catch{console.error('BLUE_PRIVATE_CHART_ENCRYPTED_EXPORT_FAILED');process.exitCode=1}finally{db?.close()}
}

import {createHash,createPublicKey,createPrivateKey,publicEncrypt,privateDecrypt,randomBytes,createCipheriv,createDecipheriv,constants,generateKeyPairSync} from 'node:crypto';
const SCHEMA='BLUE_HIGH15_CASE_ENVELOPE_V1';
const sha=x=>createHash('sha256').update(x).digest('hex');
const need=(ok,code)=>{if(!ok)throw Error(code)};
const publicPem="-----BEGIN PUBLIC KEY-----\nMIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAkUZ8ezJKOilTydOifSyi\n5IyIH2UA+QPkdZ43i+6aOct0kxUNe7Njo0/9bgbZ6WMIAxECkosCcWdArnGtOiM0\nKguB7tdB7o8MlU3b3CkTYYlmk0/NpAum1nZf5MbyL4g43+VysmjnECmVQSNSpC8Y\nBHJ0wbIwMu16IRbYNutdG58MK6nuYDkJVe7HryUo4Xyw2x4jB8cRX1gA68aDH55c\nN6mCXwD8B0y3p/6gSWJXXv++eCH8VDAMhRMmIQzjq7yrnxbbxOjZdMFSf9ELIjCX\nwW/FHnuKb+2047qQONqVCylnStTSH9PoJeFuw7Da1/KlPmgQ5f6333A8ZTsJzrQi\nGckHI+mtJ0z3DQCBfN9oI/GY9XqRjw09FIzatn3UM33zFid26OcsVoBcwoRE+SKD\nikjuAIsgSzvmYgJJCsPATCsDI/UxmpWc4Ni4yb0FP2aBvZYPcygOcfOXNjEM+TaZ\nUprLVk8BVWZHDSGwHysbAQo+l9gDhKHd3FOrjsxJJxIlAgMBAAE=\n-----END PUBLIC KEY-----\n";
const fingerprint='f61699bfc2d8fd9513ae441494230a30f320663e2c1f1a420a7de91253a778db';
const aad=b=>Buffer.from(SCHEMA+'|'+b.payload_sha256+'|'+b.recipient_sha256);
function seal(raw,pem=publicPem){
 const key=createPublicKey(pem),id=sha(key.export({type:'spki',format:'der'}));
 need(key.asymmetricKeyType==='rsa'&&key.asymmetricKeyDetails.modulusLength>=2048,'INVALID_HIGH15_RECIPIENT');
 if(pem===publicPem)need(id===fingerprint,'WRONG_HIGH15_PUBLIC_KEY');
 need(typeof raw==='string'&&Buffer.byteLength(raw)<=64*1024*1024,'HIGH15_PAYLOAD_LIMIT');
 const b={schema:SCHEMA,payload_sha256:sha(raw),recipient_sha256:id},secret=randomBytes(32),iv=randomBytes(12);
 try{const c=createCipheriv('aes-256-gcm',secret,iv);c.setAAD(aad(b));
 const enc=Buffer.concat([c.update(raw,'utf8'),c.final()]);
 return {...b,wrapped_key:publicEncrypt({key,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},secret).toString('base64'),iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),ciphertext:enc.toString('base64')};
 }finally{secret.fill(0)}
}
function unseal(b,pem){
 need(b?.schema===SCHEMA&&/^[a-f0-9]{64}$/.test(b.payload_sha256)&&/^[a-f0-9]{64}$/.test(b.recipient_sha256),'HIGH15_BAD_ENVELOPE');
 const key=createPrivateKey(pem);need(sha(createPublicKey(key).export({type:'spki',format:'der'}))===b.recipient_sha256,'HIGH15_WRONG_KEY');
 const iv=Buffer.from(b.iv,'base64'),tag=Buffer.from(b.tag,'base64');
 need(iv.length===12&&tag.length===16&&typeof b.ciphertext==='string'&&b.ciphertext.length<90*1024*1024,'HIGH15_BAD_CIPHER');
 const secret=privateDecrypt({key,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(b.wrapped_key,'base64'));
 try{need(secret.length===32,'HIGH15_BAD_SECRET');const c=createDecipheriv('aes-256-gcm',secret,iv);c.setAAD(aad(b));c.setAuthTag(tag);const raw=Buffer.concat([c.update(Buffer.from(b.ciphertext,'base64')),c.final()]).toString('utf8');need(sha(raw)===b.payload_sha256,'HIGH15_HASH_FAIL');return raw}finally{secret.fill(0)}
}
function sealTest(){
 let n=0;const t=x=>{need(x,'HIGH15_CRYPTO_TEST');n++};
 const k=generateKeyPairSync('rsa',{modulusLength:2048}),pub=k.publicKey.export({type:'spki',format:'pem'}),priv=k.privateKey.export({type:'pkcs8',format:'pem'});
 const raw=JSON.stringify({schema:'BLUE_HIGH15_PRIVATE_CASES_V1',cases:[{name:'PRIVATE_FIXTURE_NAME',code:'000001'}]});
 const a=seal(raw,pub);t(unseal(a,priv)===raw);t(!JSON.stringify(a).includes('PRIVATE_FIXTURE_NAME')&&!JSON.stringify(a).includes('"code"'));t(a.ciphertext!==seal(raw,pub).ciphertext);
 let rejected=false;try{unseal({...a,tag:Buffer.alloc(16).toString('base64')},priv)}catch{rejected=true}t(rejected);
 t(seal(raw).recipient_sha256===fingerprint);
 return n;
}
export {seal,unseal,sealTest};

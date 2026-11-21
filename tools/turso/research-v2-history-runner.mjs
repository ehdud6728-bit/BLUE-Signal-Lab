/** One-time, read-only 36-ticker historical KRX->KIS fallback.
 * Uses an ALREADY-ISSUED Turso encrypted KIS token; never tokenP, D1, SQL
 * writes, deployment, or target-day EOD replacement. Token is never logged.
 */
import {createClient} from '@libsql/client/web';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {scopeFor,decryptKisToken} from './kis-token-steward.mjs';

export async function cachedHistoryToken(client,env,now=new Date()) {
  if(!env.KIS_APP_KEY||!env.KIS_APP_SECRET)return {status:'KIS_CONFIG_MISSING',token:null};
  let rows;
  try{
    rows=(await client.execute({sql:'SELECT ciphertext,expires_at_utc FROM blue_turso_kis_vault_v1 WHERE scope=? LIMIT 1',
      args:[scopeFor(env.KIS_APP_KEY)]})).rows;
  }catch{return {status:'TURSO_TOKEN_VAULT_UNAVAILABLE',token:null};}
  const row=rows?.[0];
  if(!row)return {status:'TURSO_TOKEN_MISSING',token:null};
  if(!Number.isFinite(Date.parse(String(row.expires_at_utc)))||
    Date.parse(String(row.expires_at_utc))<=now.getTime()+300_000)
    return {status:'TURSO_TOKEN_EXPIRED',token:null};
  try{return {status:'READY',token:decryptKisToken(row.ciphertext,env.KIS_APP_KEY,env.KIS_APP_SECRET)};}
  catch{return {status:'TURSO_TOKEN_DECRYPT_FAILED',token:null};}
}

export async function runTargetedHistory(env, args, deps={}) {
  if(args.length!==3 || !args[0].startsWith('--plan=') ||
     !args[1].startsWith('--anchor-eod-dir=') || !args[2].startsWith('--out='))
    throw Error('TARGETED_HISTORY_ARGUMENTS_INVALID');
  const url=String(env.TURSO_DATABASE_URL||'').trim();
  const authToken=String(env.TURSO_AUTH_TOKEN||'').trim();
  if(!/^(libsql|https):\/\//.test(url)||!authToken)
    throw Error('TURSO_HISTORY_READ_ONLY_CONFIG_MISSING');
  const connect=deps.createClient||createClient;
  const client=connect({url,authToken,intMode:'string'});
  let token='';
  try{
    // Decryption performs a single SELECT. If absent, historical KRX is
    // still attempted, but fallback cannot be called or auto-issue a token.
    const found=await (deps.cachedToken||cachedHistoryToken)(client,env,new Date());
    token=found.token||'';
  }finally{
    client.close();
  }
  if(!token)console.log('BLUE_V2_HISTORY_KIS_SECONDARY_UNAVAILABLE: cached token missing; KRX only');
  const run=deps.runPython||((childEnv)=>new Promise((ok,fail)=>{
    const proc=spawn('python3',['scripts/research_v2_targeted_history.py','--mode=collect',...args],{
      stdio:'inherit',env:childEnv});
    proc.on('error',fail);
    proc.on('exit',(code)=>code===0?ok():fail(Error('TARGETED_HISTORY_COLLECTION_FAILED')));
  }));
  await run({...env,BLUE_RESEARCH_KIS_TOKEN:token});
  return {status:'HISTORY_COLLECTION_PROCESS_COMPLETE',token_logged:false,db_writes:0};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runTargetedHistory(process.env,process.argv.slice(2)).catch(e=>{
    const safe=new Set(['TARGETED_HISTORY_ARGUMENTS_INVALID',
      'TURSO_HISTORY_READ_ONLY_CONFIG_MISSING','TARGETED_HISTORY_COLLECTION_FAILED']);
    console.error(safe.has(e?.message)?e.message:'TARGETED_HISTORY_RUNNER_FAILED');
    process.exitCode=1;
  });
}

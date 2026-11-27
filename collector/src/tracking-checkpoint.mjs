/** Durable work ledger for bounded tracking execution. No automatic schedule,
 * provider request or business-price write is enabled by importing this module.
 * Delivery is at least once: storage callbacks must upsert by task.id and fence
 * stale lease tokens. A crash after provider I/O can cause another request. */
import {createHash,randomUUID} from 'node:crypto';
export const TABLE='blue_tracking_jobs_v1';
const need=(ok,code)=>{if(!ok)throw Error(code)};
const digest=s=>createHash('sha256').update(s).digest('hex');
export function task(code,kind,window_end){
 need(/^\d{6}$/.test(code)&&['QUOTE','BASIC','PRECISE'].includes(kind)&&Number.isFinite(Date.parse(window_end)),'INVALID_TRACKING_TASK');
 const end=new Date(window_end).toISOString();return {id:digest(`${code}|${kind}|${end}`),code,kind,window_end:end};
}
export async function prepare(db){
 await db.execute(`CREATE TABLE IF NOT EXISTS ${TABLE} (id TEXT PRIMARY KEY,code TEXT NOT NULL,kind TEXT NOT NULL,window_end TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('PENDING','RUNNING','RETRY','COMPLETE','FAILED')),attempts INTEGER NOT NULL DEFAULT 0,next_retry INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until INTEGER NOT NULL DEFAULT 0,receipt_sha256 TEXT,updated_at INTEGER NOT NULL)`);
}
export async function enqueue(db,tasks,now){
 const unique=new Map();for(const t of tasks){const checked=task(t.code,t.kind,t.window_end);need(t.id===checked.id,'INVALID_TRACKING_TASK_ID');unique.set(t.id,checked)}
 need(unique.size<=100&&Number.isSafeInteger(now),'TRACKING_ENQUEUE_LIMIT');
 let added=0;for(const t of unique.values()){
  const q=await db.execute({sql:`INSERT OR IGNORE INTO ${TABLE} (id,code,kind,window_end,state,updated_at) VALUES (?,?,?,?,'PENDING',?)`,args:[t.id,t.code,t.kind,t.window_end,now]});added+=q.rowsAffected;
 }return {added};
}
export async function claim(db,id,now,{leaseMs=120000,token=randomUUID()}={}){
 need(/^[a-f0-9]{64}$/.test(id)&&Number.isSafeInteger(now)&&Number.isSafeInteger(leaseMs)&&leaseMs>=1000&&leaseMs<=300000&&typeof token==='string'&&token.length>=8&&token.length<=128,'INVALID_TRACKING_CLAIM');
 await db.execute({sql:`UPDATE ${TABLE} SET state='FAILED',lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND state='RUNNING' AND attempts>=3 AND lease_until<=?`,args:[now,id,now]});
 const q=await db.execute({sql:`UPDATE ${TABLE} SET state='RUNNING',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=? AND attempts<3 AND ((state IN ('PENDING','RETRY') AND next_retry<=?) OR (state='RUNNING' AND lease_until<=?)) RETURNING id,code,kind,window_end,attempts`,args:[token,now+leaseMs,now,id,now,now]});
 return q.rows.length?{...q.rows[0],attempts:Number(q.rows[0].attempts),lease_token:token,lease_until:now+leaseMs}:null;
}
export async function finish(db,job,now,receipt){
 need(Number.isSafeInteger(now)&&/^[a-f0-9]{64}$/.test(receipt||''),'INVALID_TRACKING_RECEIPT');
 const q=await db.execute({sql:`UPDATE ${TABLE} SET state='COMPLETE',receipt_sha256=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND state='RUNNING' AND lease_token=? AND lease_until>?`,args:[receipt,now,job.id,job.lease_token,now]});
 return q.rowsAffected===1;
}
export async function retry(db,job,now){
 need(Number.isSafeInteger(now),'INVALID_TRACKING_CLOCK');
 const failed=job.attempts>=3;
 const q=await db.execute({sql:`UPDATE ${TABLE} SET state=?,next_retry=?,lease_token=NULL,lease_until=0,updated_at=? WHERE id=? AND state='RUNNING' AND lease_token=? AND lease_until>?`,args:[failed?'FAILED':'RETRY',now+30000*2**(job.attempts-1),now,job.id,job.lease_token,now]});
 return q.rowsAffected===1;
}
export async function executeOne(db,t,handler,{clock=()=>Date.now(),leaseMs=120000}={}){
 const job=await claim(db,t.id,clock(),{leaseMs});if(!job)return {status:'SKIPPED'};
 try{
  // The handler must persist and read-back its own output before returning a
  // SHA-256 receipt. We never equate successful provider I/O with a saved result.
  const result=await handler(job);
  need(result?.persisted_verified===true&&/^[a-f0-9]{64}$/.test(result.receipt_sha256||''),'UNVERIFIED_TRACKING_SAVE');
  return {status:await finish(db,job,clock(),result.receipt_sha256)?'COMPLETE':'LEASE_LOST'};
 }catch{
  const changed=await retry(db,job,clock());return {status:changed?(job.attempts>=3?'FAILED':'RETRY'):'LEASE_LOST'};
 }
}
/** Recover pending/retry/expired work from the ledger rather than relying on
 * another exact-minute scheduler offer. Bounded; no provider is called here. */
export async function due(db,now,{limit=10}={}){
 need(Number.isSafeInteger(now)&&Number.isSafeInteger(limit)&&limit>=1&&limit<=10,'INVALID_TRACKING_DUE_LIMIT');
 const q=await db.execute({sql:`SELECT id,code,kind,window_end FROM ${TABLE} WHERE ((state IN ('PENDING','RETRY') AND next_retry<=?) OR (state='RUNNING' AND lease_until<=?)) ORDER BY updated_at,id LIMIT ?`,args:[now,now,limit]});return q.rows;
}

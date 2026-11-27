import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {task,prepare,enqueue,claim,finish,retry,executeOne,due,TABLE} from './tracking-checkpoint.mjs';
import {plan} from '../../tools/turso/tracking-plan.mjs';
const receipt='a'.repeat(64),start=Date.parse('2026-11-27T00:32:00Z');
function store(file=':memory:'){const sql=new DatabaseSync(file);return {sql,execute:async input=>{const {sql:q,args=[]}=typeof input==='string'?{sql:input}:input;const s=sql.prepare(q);if(/^SELECT|RETURNING/.test(q)||q.includes(' RETURNING '))return {rows:s.all(...args),rowsAffected:0};const r=s.run(...args);return {rows:[],rowsAffected:Number(r.changes)}}};}
const row=items=>({owner:'a'.repeat(64),revision:1,roster_json:JSON.stringify(items)});
test('late invocation retains precise and basic slots, stable across roster edits',()=>{
 const rows=[row([{code:'005930',precise:true},{code:'000024',precise:false}])];
 const exact=plan(rows,new Date(start)).checkpoint_tasks,late=plan(rows,new Date(start+4*60000)).checkpoint_tasks;
 assert.equal(exact.find(x=>x.kind==='PRECISE').id,late.find(x=>x.kind==='PRECISE').id);
 assert.equal(late.find(x=>x.kind==='PRECISE').window_end,'2026-11-27T00:30:00.000Z');
 assert.equal(exact.find(x=>x.kind==='BASIC').id,late.find(x=>x.kind==='BASIC').id);
 const changed=plan([row([{code:'000001',precise:false},{code:'000024',precise:false},{code:'005930',precise:true}])],new Date(start+4*60000)).checkpoint_tasks;
 assert.equal(changed.find(x=>x.kind==='BASIC'&&x.code==='000024').id,late.find(x=>x.kind==='BASIC').id);
 assert.equal(plan(rows,new Date('2026-11-28T00:36:00Z')).checkpoint_tasks.length,0);
});
test('actual SQLite enqueue deduplicates, claims exclude overlap and completed work never reopens',async()=>{
 const db=store();await prepare(db);const t=task('005930','PRECISE','2026-11-27T00:30:00Z');
 assert.equal((await enqueue(db,[t,t],start)).added,1);assert.equal((await enqueue(db,[t],start)).added,0);
 const [a,b]=await Promise.all([claim(db,t.id,start,{token:'worker-111'}),claim(db,t.id,start,{token:'worker-222'})]);
 assert.equal([a,b].filter(Boolean).length,1);assert.equal(await finish(db,a||b,start+1,receipt),true);
 assert.equal(await claim(db,t.id,start+200000),null);db.sql.close();
});
test('expired lease is reclaimed and stale worker cannot complete or retry the new owner',async()=>{
 const db=store();await prepare(db);const t=task('005930','QUOTE','2026-11-27T00:30:00Z');await enqueue(db,[t],start);
 const a=await claim(db,t.id,start,{leaseMs:1000,token:'worker-old'}),b=await claim(db,t.id,start+1001,{leaseMs:1000,token:'worker-new'});
 assert.equal(b.attempts,2);assert.equal(await finish(db,a,start+1002,receipt),false);assert.equal(await retry(db,a,start+1002),false);assert.equal(await finish(db,b,start+1002,receipt),true);db.sql.close();
});
test('failed save retries with backoff and fails after third attempt, no false checkpoint',async()=>{
 const db=store();await prepare(db);const t=task('005930','BASIC','2026-11-27T00:00:00Z');await enqueue(db,[t],start);let now=start,calls=0;
 const handler=async()=>{calls++;return {persisted_verified:false,receipt_sha256:receipt}};
 assert.equal((await executeOne(db,t,handler,{clock:()=>now})).status,'RETRY');
 assert.equal((await executeOne(db,t,handler,{clock:()=>now})).status,'SKIPPED');assert.equal(calls,1);
 now+=30000;assert.equal((await executeOne(db,t,handler,{clock:()=>now})).status,'RETRY');
 now+=60000;assert.equal((await executeOne(db,t,handler,{clock:()=>now})).status,'FAILED');
 assert.equal(db.sql.prepare(`SELECT state,receipt_sha256 FROM ${TABLE}`).get().receipt_sha256,null);assert.equal(await claim(db,t.id,now+100000),null);db.sql.close();
});
test('verified save completes, invalid receipt retries, third expired attempt becomes terminal',async()=>{
 const db=store();await prepare(db);const t=task('005930','QUOTE','2026-11-27T00:30:00Z');await enqueue(db,[t],start);
 assert.equal((await executeOne(db,t,async()=>({persisted_verified:true,receipt_sha256:receipt}),{clock:()=>start})).status,'COMPLETE');
 const x=task('000660','QUOTE','2026-11-27T00:30:00Z');await enqueue(db,[x],start);
 assert.equal((await executeOne(db,x,async()=>({persisted_verified:true,receipt_sha256:'invalid'}),{clock:()=>start})).status,'RETRY');
 await claim(db,x.id,start+30000,{leaseMs:1000});await claim(db,x.id,start+31001,{leaseMs:1000});assert.equal(await claim(db,x.id,start+32002),null);
 assert.equal(db.sql.prepare(`SELECT state FROM ${TABLE} WHERE id=?`).get(x.id).state,'FAILED');db.sql.close();
});

test('file-backed checkpoint survives process-style reopen and independent workers share one lease',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'blue-tracking-')),file=join(dir,'ledger.sqlite');let a,b;
 try{
  a=store(file);await prepare(a);const t=task('005930','PRECISE','2026-11-27T00:30:00Z');await enqueue(a,[t],start);a.sql.close();
  a=store(file);b=store(file);const first=await claim(a,t.id,start,{token:'worker-one'});assert.ok(first);assert.equal(await claim(b,t.id,start,{token:'worker-two'}),null);
  assert.equal(await finish(a,first,start+1,receipt),true);a.sql.close();a=null;b.sql.close();b=null;
  a=store(file);assert.equal(await claim(a,t.id,start+300000),null);assert.equal(a.sql.prepare(`SELECT receipt_sha256 FROM ${TABLE}`).get().receipt_sha256,receipt);
 }finally{a?.sql.close();b?.sql.close();rmSync(dir,{recursive:true,force:true})}
});

test('retry work is recovered from durable ledger without another scheduler offer',async()=>{
 const db=store();await prepare(db);const t=task('005930','BASIC','2026-11-27T00:00:00Z');await enqueue(db,[t],start);
 await executeOne(db,t,async()=>{throw Error('storage failed')},{clock:()=>start});
 assert.equal((await due(db,start+29999)).length,0);const [recovered]=await due(db,start+30000);assert.equal(recovered.id,t.id);
 assert.equal((await executeOne(db,recovered,async()=>({persisted_verified:true,receipt_sha256:receipt}),{clock:()=>start+30000})).status,'COMPLETE');
 assert.equal((await due(db,start+60000)).length,0);await assert.rejects(()=>due(db,start,{limit:11}),/INVALID_TRACKING_DUE_LIMIT/);db.sql.close();
});

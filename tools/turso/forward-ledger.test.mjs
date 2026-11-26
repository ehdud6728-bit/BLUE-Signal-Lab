import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runLedger,pack,unpack} from './forward-ledger.mjs';
const now=new Date('2026-11-26T06:00:00Z');
const candidate={schema:'BLUE_FORWARD_CANDIDATE_V1',rule_version:'FORWARD_V1',rule_commit:'a'.repeat(40),source_day:'2026-11-25',cutoff:'2026-11-25',rows:Array.from({length:1700},(_,i)=>({code:String(i).padStart(6,'0'),features:{UP_DAY:true}}))};
function fake(){
 const d=new DatabaseSync(':memory:');const sqls=[];
 return {sqls,close:()=>d.close(),async execute(q){const sql=typeof q==='string'?q:q.sql,args=q.args||[];sqls.push(sql);const p=d.prepare(sql);return {rows:/^SELECT/.test(sql)?p.all(...args):(p.run(...args),[])};}};
}
test('inspect and wrong confirm never write; first capture is immutable',async()=>{
 const db=fake();try{
 assert.equal((await runLedger(db,candidate,{now})).status,'INSPECT_ONLY');
 assert.ok(db.sqls.every(x=>x.startsWith('SELECT')));
 await assert.rejects(runLedger(db,candidate,{now,mode:'apply'}),/CONFIRM_REQUIRED/);
 const first=await runLedger(db,candidate,{now,mode:'apply',confirm:'blue-forward-capture-v1'});
 assert.equal(first.status,'CAPTURED_READBACK_MATCH');
 const changed={...candidate,rule_commit:'b'.repeat(40)};
 const second=await runLedger(db,changed,{now,mode:'apply',confirm:'blue-forward-capture-v1'});
 assert.equal(second.status,'ALREADY_CAPTURED');assert.equal(second.ledger[0].rule_commit,'a'.repeat(40));
 assert.equal(db.sqls.filter(x=>x.startsWith('INSERT')).length,1);
 }finally{db.close();}
});
test('digest detects corruption; stale cutoff rejected',async()=>{
 const {payload,digest}=pack(candidate);
 assert.throws(()=>unpack({payload,payload_sha256:'b'.repeat(64)}),/HASH_MISMATCH/);
 const db=fake();try{await assert.rejects(runLedger(db,candidate,{now:new Date('2026-11-27T06:00:00Z')}),/BAD_CANDIDATE/);assert.equal(db.sqls.length,0);}finally{db.close();}
});

test('scheduled capture rejects stale source without touching database',async()=>{const db=fake();try{const stale={...candidate,source_day:'2026-11-24'};const r=await runLedger(db,stale,{now,scheduled:true,mode:'apply',confirm:'blue-forward-capture-v1'});assert.equal(r.status,'SCHEDULE_NO_EXACT_PRIOR_DAY');assert.equal(db.sqls.length,0);await assert.rejects(runLedger(db,candidate,{now,scheduled:true}),/SCHEDULE_NOT_AUTHORIZED/);assert.equal(db.sqls.length,0);}finally{db.close();}});

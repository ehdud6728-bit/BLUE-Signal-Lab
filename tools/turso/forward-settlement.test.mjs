import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runSettlement,pack,unpack} from './forward-settlement.mjs';
const d='2026-11-25',entry='2026-11-27',h='a'.repeat(64);
const s={source_day:d,rule_version:'FORWARD_V1',captured_at:'2026-11-26T06:00:00Z',rule_commit:'b'.repeat(40),benchmark_state_sha256:h,source_hashes:{[d]:h},rows:[{code:'000001'}]};
const r={schema:'BLUE_FORWARD_SETTLEMENT_V1',source_day:d,rule_version:s.rule_version,outcome_version:'FORWARD_HIGH_V2',captured_at:s.captured_at,rule_commit:s.rule_commit,benchmark_state_sha256:h,source_hashes:s.source_hashes,snapshot_rows:1,horizon:1,entry_day:entry,maturity_day:entry,observation_days:[entry],outcome_hashes:{[entry]:h},coverage:'COMPLETE_SYMBOL_PATHS',pooled:{events:1,sample_count:1,missing_path:0,pending:0},groups:[]};
const batch={schema:'BLUE_FORWARD_SETTLEMENT_BATCH_V1',asof:entry,records:[r],diagnostics:{}};
const apply={mode:'apply',confirm:'blue-forward-settlement-v1'};
function fake(){const db=new DatabaseSync(':memory:'),sqls=[];return {sqls,close:()=>db.close(),async execute(q){const sql=typeof q==='string'?q:q.sql,args=q.args||[];sqls.push(sql);const p=db.prepare(sql);return {rows:/^SELECT/.test(sql)?p.all(...args):(p.run(...args),[])}}}}
test('inspect no write; explicit apply immutable readback; archive survives empty batch',async()=>{const db=fake();try{
 const a=await runSettlement(db,batch,[s]);assert.equal(a.missing,1);assert.ok(db.sqls.every(x=>x.startsWith('SELECT')));
 await assert.rejects(runSettlement(db,batch,[s],{mode:'apply'}),/CONFIRM_REQUIRED/);
 const b=await runSettlement(db,batch,[s],apply);assert.equal(b.written,1);assert.equal(b.total,1);assert.deepEqual(b.recent_rows[0],r);
 const c=await runSettlement(db,batch,[s],apply);assert.equal(c.unchanged,1);assert.equal(c.written,0);
 const e=await runSettlement(db,{...batch,records:[]},[]);assert.equal(e.total,1);assert.deepEqual(e.recent_rows[0],r);
 assert.equal(db.sqls.filter(x=>x.startsWith('INSERT')).length,1);
}finally{db.close()}});
test('changed result cannot replace seal; inspect shows conflict; missing capture and wrong proof rejected',async()=>{const db=fake();try{
 await runSettlement(db,batch,[s],apply);
 const changed={...batch,records:[{...r,groups:[{feature:'CANDLE'}]}]};
 assert.equal((await runSettlement(db,changed,[s])).conflicts.length,1);
 await assert.rejects(runSettlement(db,changed,[s],apply),/EXISTING_CONFLICT/);
 await assert.rejects(runSettlement(db,batch,[]),/SOURCE_MISMATCH/);
 await assert.rejects(runSettlement(db,{...batch,records:[{...r,outcome_hashes:{}}]},[s]),/BAD_PROOF/);
 assert.equal(db.sqls.filter(x=>x.startsWith('INSERT')).length,1);
}finally{db.close()}});
test('empty batch does not create table; corrupt payload blocked',async()=>{const db=fake();try{
 const a=await runSettlement(db,{...batch,records:[]},[],apply);assert.equal(a.total,0);assert.ok(db.sqls.every(x=>x.startsWith('SELECT')));
 const {payload}=pack(r);assert.throws(()=>unpack({payload,payload_sha256:'c'.repeat(64)}),/HASH_MISMATCH/);
}finally{db.close()}});

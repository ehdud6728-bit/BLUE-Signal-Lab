import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {trackingRegistry,validateRoster} from '../worker/src/turso-tracking-registry.ts';
const owner='a'.repeat(64),other='b'.repeat(64),env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'test'};
const row=i=>({code:String(i).padStart(6,'0'),precise:i<10});
const req=(data)=>new Request('https://test.invalid/api/basket/tracking',data===undefined?{}:{method:'POST',body:JSON.stringify(data)});
function setup(){
 const sql=new DatabaseSync(':memory:');const calls=[];
 const factory=()=>({execute:async(q)=>{const a=typeof q==='string'?{sql:q,args:[]}:q;calls.push(a.sql);const stmt=sql.prepare(a.sql);return /^SELECT/i.test(a.sql)?{rows:stmt.all(...a.args)}:{rowsAffected:Number(stmt.run(...a.args).changes)};},close(){}});
 return {calls,call:(data,who=owner)=>trackingRegistry(req(data),env,who,{factory}),sql};
}
test('unique 50 and precise 10 server cap',()=>{assert.equal(validateRoster(Array.from({length:50},(_,i)=>row(i))).length,50);assert.throws(()=>validateRoster(Array.from({length:51},(_,i)=>row(i))));assert.throws(()=>validateRoster([row(0),row(0)]));assert.throws(()=>validateRoster(Array.from({length:11},(_,i)=>({...row(i),precise:true}))))});
test('read-only initial GET, isolated owners, revision conflict, history retained',async()=>{const db=setup();assert.equal((await db.call()).body.revision,0);assert.ok(db.calls.every(s=>s.startsWith('SELECT')));assert.equal((await db.call({revision:0,items:[row(1)]})).body.revision,1);assert.equal((await db.call(undefined,other)).body.revision,0);assert.equal((await db.call({revision:0,items:[]})).status,409);assert.equal((await db.call({revision:1,items:[row(1)]})).body.status,'UNCHANGED');assert.equal((await db.call({revision:1,items:[]})).body.revision,2);assert.equal(db.sql.prepare('select count(*) n from blue_tracking_roster_v1').get().n,2);assert.equal((await db.call({revision:0,items:[row(2)]},other)).body.revision,1);assert.equal((await db.call()).body.items.length,0);db.sql.close()});
test('atomic revision race has one winner, bad body no storage',async()=>{const db=setup();assert.equal((await db.call({revision:0,items:[row(1),row(1)]})).status,400);assert.equal(db.calls.length,0);await db.call({revision:0,items:[row(1)]});const a=await Promise.all([db.call({revision:1,items:[row(2)]}),db.call({revision:1,items:[row(3)]})]);assert.deepEqual(a.map(x=>x.status).sort(),[200,409]);db.sql.close()});

test('GET returns dated provisional prices only for current owner and latest collection date',async()=>{
 const db=setup();
 try{
   await db.call({revision:0,items:[row(1),row(2)]});
   await db.call({revision:0,items:[row(3)]},other);
   assert.equal((await db.call()).body.quotes_available,false);
   db.sql.exec("CREATE TABLE blue_kis_provisional_daily_v1(trade_day TEXT,code TEXT,market TEXT,close INTEGER,observed_at_utc TEXT,PRIMARY KEY(trade_day,code))");
   const insert=db.sql.prepare("INSERT INTO blue_kis_provisional_daily_v1 VALUES(?,?,'J',1000,?)");
   for(const [code,day] of [['000001','2025-01-03'],['000002','2025-01-02'],['000003','2025-01-03']])insert.run(day,code,day+'T01:00:00Z');
   const r=await db.call();assert.equal(r.body.quotes_available,true);
   assert.deepEqual(r.body.quotes.map(q=>[q.code,q.day,q.price]),[['000001','2025-01-03',1000]]);
 }finally{db.sql.close();}
});

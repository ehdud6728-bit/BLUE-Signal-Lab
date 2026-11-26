import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runProvisionalWatchdog as run} from './src/provisional-watchdog.mjs';
const now=new Date('2026-11-26T07:40:00Z');
const env={BLUE_PROVISIONAL_WATCHDOG_ENABLED:'true',COLLECTOR_ENABLED:'true',BLUE_PROVISIONAL_WATCHDOG_GITHUB_TOKEN:'synthetic',TURSO_DATABASE_URL:'https://invalid.example',TURSO_AUTH_TOKEN:'synthetic'};
function fixture({head=null,active=false,gateReady=true,http=204}={}){
 const db=new DatabaseSync(':memory:');const calls=[],sqls=[];
 if(head){db.exec('CREATE TABLE blue_provisional_pattern_head_v1(trade_day TEXT,reference_day TEXT,scan_asof_utc TEXT,latest_observed_utc TEXT)');db.prepare('INSERT INTO blue_provisional_pattern_head_v1 VALUES(?,?,?,?)').run('2026-11-26','2026-11-25',head[0],head[1]);}
 const client={close(){},async execute(q){const sql=typeof q==='string'?q:q.sql,args=typeof q==='string'?[]:q.args;sqls.push(sql);const stmt=db.prepare(sql);return /^SELECT/.test(sql)?{rows:stmt.all(...args)}:{rowsAffected:Number(stmt.run(...args).changes)};}};
 const deps={clientFactory:()=>client,nowFn:()=>now,gate:async()=>gateReady?{ready:true,day:'2026-11-26',reference:'2026-11-25',latest_observed_utc:'2026-11-26T07:39:00Z'}:{ready:false,reason:'NO_CURRENT_QUOTES'},fetchFn:async(url,o)=>{calls.push([url,o]);if(o.method==='POST')return {status:http};return {ok:true,json:async()=>({total_count:active?1:0,workflow_runs:active?[{}]:[]})};}};
 return {db,calls,sqls,deps};
}
test('disabled, off tick and unavailable quotes never dispatch or write',async()=>{
 const f=fixture({gateReady:false});try{assert.equal((await run({},now,f.deps)).status,'DISABLED');assert.equal((await run(env,new Date('2026-11-26T07:41:00Z'),f.deps)).status,'NOT_TICK');assert.equal((await run(env,now,f.deps)).status,'NO_CURRENT_QUOTES');assert.equal(f.calls.length,0);assert.equal(f.sqls.length,0);}finally{f.db.close();}
});
test('no head dispatches existing workflow once; cooldown survives repeated ticks',async()=>{
 const f=fixture();try{assert.equal((await run(env,now,f.deps)).status,'DISPATCH_ACCEPTED');assert.equal(f.calls.length,6);const [url,opts]=f.calls.at(-1);assert.ok(url.endsWith('/blue_provisional_pattern_publish.yml/dispatches'));assert.deepEqual(JSON.parse(opts.body),{ref:'main',inputs:{mode:'recovery'}});assert.equal((await run(env,now,f.deps)).status,'COOLDOWN_OR_DAILY_CAP');assert.equal(f.calls.length,6);}finally{f.db.close();}
});
test('fresh head and active run block dispatch',async()=>{
 const fresh=fixture({head:['2026-11-26T07:36:00Z','2026-11-26T07:34:00Z']});try{assert.equal((await run(env,now,fresh.deps)).status,'RECENT_PUBLICATION');assert.equal(fresh.calls.length,0);}finally{fresh.db.close();}
 const active=fixture({active:true});try{assert.equal((await run(env,now,active.deps)).status,'PUBLISH_ALREADY_ACTIVE');assert.equal(active.calls.length,1);}finally{active.db.close();}
});
test('post-close transition can recover despite fresh intraday head; denied dispatch is not success',async()=>{
 const f=fixture({head:['2026-11-26T07:30:00Z','2026-11-26T06:20:00Z'],http:403});try{assert.equal((await run(env,now,f.deps)).status,'DISPATCH_REJECTED');assert.equal(f.calls.length,6);}finally{f.db.close();}
});
test('gate changes before dispatch, or GitHub is unreachable: fail closed',async()=>{
 const f=fixture();try{let checks=0;const initial=f.deps.gate;f.deps.gate=async()=>++checks===1?initial():{ready:false,reason:'EOD_ALREADY_AVAILABLE'};assert.equal((await run(env,now,f.deps)).status,'NO_LONGER_ELIGIBLE');assert.equal(f.calls.length,5);}finally{f.db.close();}
});

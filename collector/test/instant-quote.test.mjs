import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSymbolLiveInstant} from '../src/instant-quote.mjs';

const now=new Date('2026-11-17T05:50:00Z'); // KST 14:50
const quote={rt_cd:'0',output:{stck_prpr:'3320',stck_oprc:'3205',stck_hgpr:'3360',
 stck_lwpr:'3125',acml_vol:'123400',stck_bsop_date:'20261117'}};
function mockDb(change=1){
 const calls=[];
 return {calls,prepare(sql){return {bind(...args){this.args=args;return this;},
  async run(){calls.push({sql,args:this.args||[]});return {meta:{changes:typeof change==='function'?change(sql):change}};}};}};
}
const active=db=>({DB:db,COLLECTOR_ENABLED:'true'});
const deps={token:async()=> 'TEST_TOKEN_NOT_REAL',
 phases:()=>[['J','KRX_REGULAR']],quote:async()=>quote,receivedAt:now};

test('immediate KIS quote is stored separately without modifying EOD records',async()=>{
 const db=mockDb();
 const res=await collectSymbolLiveInstant(active(db),'225190',now,deps);
 assert.deepEqual(res,{status:'SAVED',code:'225190',trade_date:'2026-11-17',market:'J'});
 const writes=db.calls.filter(x=>/\b(INSERT|UPDATE|DELETE)\b/i.test(x.sql));
 assert.ok(writes.some(x=>x.sql.includes('INSERT INTO blue_symbol_live_quotes_v1')));
 assert.ok(writes.every(x=>!/(INSERT|UPDATE|DELETE)\s+(INTO\s+)?(runs|signals|daily_counts)\b/i.test(x.sql)));
 assert.equal(db.calls.some(x=>JSON.stringify(x).includes('TEST_TOKEN_NOT_REAL')),false);
});
test('invalid ticker, disabled collector and closed session do not contact DB',async()=>{
 const noDb={prepare(){throw Error('UNEXPECTED_DB_ACCESS');}};
 assert.equal((await collectSymbolLiveInstant(active(noDb),'22/190',now,deps)).status,'INVALID_CODE');
 assert.equal((await collectSymbolLiveInstant({DB:noDb,COLLECTOR_ENABLED:'false'},'225190',now,deps)).status,'DISABLED');
 assert.equal((await collectSymbolLiveInstant(active(noDb),'225190',new Date('2026-11-17T12:00:00Z'))).status,'MARKET_CLOSED');
});
test('per-code cooldown cannot call KIS',async()=>{
 let attempts=0;
 const limited={...deps,quote:async()=>{attempts++;return quote;}};
 const db=mockDb(0);
 const res=await collectSymbolLiveInstant(active(db),'225190',now,limited);
 assert.equal(res.status,'COOLDOWN');assert.equal(attempts,0);
});
test('global minute quota rejects excess requests before calling KIS',async()=>{
 let attempts=0;
 const db=mockDb(sql=>sql.includes('INSERT INTO blue_symbol_live_direct_budget_v1')?0:1);
 const res=await collectSymbolLiveInstant(active(db),'225190',now,
  {...deps,quote:async()=>{attempts++;return quote;}});
 assert.equal(res.status,'RATE_LIMITED');assert.equal(attempts,0);
});
test('missing cached token does not call KIS or write limiter',async()=>{
 const db=mockDb();let called=false;
 const res=await collectSymbolLiveInstant(active(db),'225190',now,{...deps,token:async()=>null,
  quote:async()=>{called=true;return quote;}});
 assert.equal(res.status,'WAITING_TOKEN');assert.equal(called,false);assert.equal(db.calls.length,0);
});

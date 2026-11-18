import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InvalidEodQuery,tursoEodCompare} from '../worker/src/turso-eod.ts';

const env={TURSO_DATABASE_URL:'libsql://test.invalid',TURSO_AUTH_TOKEN:'test-only'};

function mock(rows,failed=false){
 const calls=[];let closed=0;
 return {calls,get closed(){return closed;},factory:()=>({
  async execute(query){
   calls.push(query);
   assert.equal(typeof query.sql,'string');
   assert.match(query.sql,/^SELECT\b/);
   assert.match(query.sql,/JOIN blue_eod_ingest_audit_v1/);
   if(failed)throw Error('TURSO_PROVIDER_DOWN');
   const codes=new Set(query.args.slice(0,-2));
   return {rows:rows.filter(row=>codes.has(row.code)&&
     row.trade_day>query.args.at(-2)&&row.trade_day<=query.args.at(-1))};
  },close(){closed++;}
 })};
}

const prices=[
 {trade_day:'2026-11-17',code:'225190',close:'4480',high:'4550'},
 {trade_day:'2026-11-18',code:'225190',close:'4500',high:'4700'},
 {trade_day:'2026-11-18',code:'005930',close:'194700',high:'199950'}
];

test('LK Samyang Nov 17 discovery uses only Nov 18 verified EOD',async()=>{
 const db=mock(prices);
 const data=await tursoEodCompare(env,new URLSearchParams({items:'225190:2026-11-17'}),'2026-11-19',db.factory);
 assert.equal(data.storage,'TURSO');
 const r=data.items[0];
 assert.equal(r.latest_price,4500);
 assert.equal(r.latest_day,'2026-11-18');
 assert.equal(r.period_high,4700);
 assert.equal(r.period_high_day,'2026-11-18');
 assert.equal(r.latest_source,'KRX_VERIFIED_EOD_CLOSE');
 assert.equal(r.high_complete,false);
 assert.equal(r.high_coverage_from,'2026-11-18');
 assert.equal(db.calls.length,1);
 assert.deepEqual(db.calls[0].args,['225190','2026-11-17','2026-11-19']);
 assert.equal(db.closed,1);
});

test('same code discovered on different days has independent subsequent highs',async()=>{
 const db=mock(prices);
 const data=await tursoEodCompare(env,new URLSearchParams({items:
  '225190:2026-11-16,225190:2026-11-17,225190:2026-11-18,005930:2026-11-17'}),
 '2026-11-19',db.factory);
 assert.equal(data.items[0].high_coverage_from,'2026-11-17');
 assert.equal(data.items[0].latest_price,4500);
 assert.equal(data.items[1].high_coverage_from,'2026-11-18');
 assert.equal(data.items[1].period_high,4700);
 assert.equal(data.items[2].status,'NO_LATER_PRICE');
 assert.equal(data.items[2].latest_price,null);
 assert.equal(data.items[2].period_high,null);
 assert.equal(data.items[3].latest_price,194700);
 assert.deepEqual(db.calls[0].args,['225190','005930','2026-11-16','2026-11-19']);
});

test('no valid later row stays unverified rather than copying discovery price',async()=>{
 const db=mock([]);
 const data=await tursoEodCompare(env,new URLSearchParams({items:'225190:2026-11-17'}),
 '2026-11-19',db.factory);
 assert.equal(data.items[0].status,'NO_LATER_PRICE');
 assert.equal(data.items[0].latest_price,null);
 assert.equal(data.items[0].high_complete,false);
});

test('invalid requests cannot query Turso; malformed verified prices fail closed',async()=>{
 const db=mock(prices);
 for(const pairs of ['', 'BAD:2026-11-17','225190:2026-11-20',
   Array.from({length:25},(_,i)=>`${String(i).padStart(6,'0')}:2026-11-17`).join(',')]){
  await assert.rejects(()=>tursoEodCompare(env,new URLSearchParams({items:pairs}),
   '2026-11-19',db.factory),InvalidEodQuery);
 }
 assert.equal(db.calls.length,0);
 const bad=mock([{trade_day:'2026-11-18',code:'225190',close:'5000',high:'4000'}]);
 await assert.rejects(()=>tursoEodCompare(env,new URLSearchParams({items:'225190:2026-11-17'}),
   '2026-11-19',bad.factory),/INVALID_PRICE/);
 assert.equal(bad.closed,1);
});

test('provider failure closes Turso connection, no fallback write',async()=>{
 const db=mock(prices,true);
 await assert.rejects(()=>tursoEodCompare(env,new URLSearchParams({items:'225190:2026-11-17'}),
 '2026-11-19',db.factory),/PROVIDER_DOWN/);
 assert.equal(db.closed,1);
 assert.equal(db.calls.every(x=>/^SELECT\b/.test(x.sql)),true);
});

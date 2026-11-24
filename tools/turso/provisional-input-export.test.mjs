import test from 'node:test';
import assert from 'node:assert/strict';
import {exportInputs} from './provisional-input-export.mjs';
const day='2026-11-24',reference='2026-11-23',now=new Date('2026-11-24T10:20:00Z');
const source='KIS_REST_INQUIRE_DAILY_PRICE_PROVISIONAL';
const make=(code,amount,absent=false)=>{
 const observed_at_utc='2026-11-24T10:19:00Z';
 const p={code,trade_date_kst:day,received_at_utc:observed_at_utc,price:100,accumulated_volume:20};
 if(!absent)p.accumulated_amount_krw=amount;
 return {code,source,observed_at_utc,close:100,open:100,high:100,low:100,volume:20,listing_market:'KOSPI',payload_json:JSON.stringify(p)};
};
const client=(n=1700)=>({execute:async({sql})=>({rows:sql.includes('GROUP BY source')?[{source,n:'3',oldest:'2026-11-24T10:19:00Z',newest:'2026-11-24T10:19:00Z'}]:sql.includes('COUNT(*)')?[{n}]:sql.includes('JOIN')?[make('000001',null,true),make('000002',null),make('000003',2000)]:[{trade_day:reference,row_count:1700}]})});
test('distinguishes old payload from new null amount',async()=>{
 const r=await exportInputs(client(),day,now,260,{quotesOnly:true});
 assert.equal(r.coverage.missingAmount,2);
 assert.equal(r.coverage.bySource[source].absent,1);
 assert.equal(r.coverage.bySource[source].nullAmount,1);
 assert.equal(r.coverage.bySource[source].valid,1);
 assert.equal(r.coverage.eligible,3);
 assert.equal(r.coverage.turnoverAvailable,1);
 assert.deepEqual(r.quotes.map(q=>q.amount),[null,null,2000]);
});
test('rejects incomplete reference even in quotes-only mode',async()=>{
 await assert.rejects(exportInputs(client(1699),day,now,260,{quotesOnly:true}),/EOD_COUNT_MISMATCH/);
});

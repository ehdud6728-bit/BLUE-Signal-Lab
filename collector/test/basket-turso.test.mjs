import test from 'node:test';
import assert from 'node:assert/strict';
import {collectBasket} from '../src/basket.mjs';

test('basket quote enters Turso queue immediately after KIS verification, before D1 write',async()=>{
  const now=new Date('2026-11-19T01:05:00.000Z');
  const sqlCalls=[];
  const db={prepare(sql){
    return {bind(){return this;},async run(){
      sqlCalls.push(sql);
      if(sql.includes('UPDATE blue_basket_watch_r153 SET quote_price='))throw Error('D1_WRITE_UNAVAILABLE');
      return {meta:{changes:1}};
    },async all(){
      sqlCalls.push(sql);
      return {results:sql.startsWith('SELECT * FROM blue_basket_watch_r153')?[{
        code:'005930',base_day:'2026-11-18',baseline_close:180000,
        progress_to_day:'2026-11-18',last_seen_at_utc:now.toISOString()
      }]:[]};
    }};
  }};
  const valid={rt_cd:'0',output:{stck_prpr:'194700',stck_oprc:'190000',
    stck_hgpr:'199950',stck_lwpr:'188800',acml_vol:'10000',stck_bsop_date:'20261119'}};
  let queued=[];
  const result=await collectBasket({COLLECTOR_ENABLED:'true',DB:db},now,{
    phases:()=>[['J','KRX_REGULAR']],token:async()=> 'TEST_TOKEN',quote:async()=>valid,
    afterValidatedQuotes:quotes=>{
      queued=quotes;
      assert.equal(sqlCalls.some(sql=>sql.includes('UPDATE blue_basket_watch_r153 SET quote_price=')),false);
    }
  });
  assert.equal(result.status,'RETRY');
  assert.equal(queued.length,1);
  assert.equal(queued[0].price,194700);
  assert.equal(queued[0].candidate_source,'BASKET_WATCH');
});

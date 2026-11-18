import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedQuoteFetcher} from '../src/quote-cache.mjs';

const ok=code=>({rt_cd:'0',output:{code}});

test('one venue/symbol is fetched once across collector lanes in the same tick',async()=>{
  const requests=[];
  const shared=createSharedQuoteFetcher(async(_env,_token,market,code)=>{
    requests.push(`${market}:${code}`);return ok(code);
  },{spacingMs:0});
  const q=shared.quote;
  const [a,b]=await Promise.all([q({},'TOKEN','J','225190'),q({},'TOKEN','J','225190')]);
  const c=await q({},'TOKEN','J','225190');
  const d=await q({},'TOKEN','NX','225190');
  assert.deepEqual([a,b,c].map(x=>x.output.code),['225190','225190','225190']);
  assert.equal(d.output.code,'225190');
  assert.deepEqual(requests,['J:225190','NX:225190']);
  assert.deepEqual(shared.stats,{provider_calls:2,reused_calls:2});
});

test('provider calls remain serialized and respect a minimum spacing interval',async()=>{
  let now=1000;const calls=[];const waits=[];
  const shared=createSharedQuoteFetcher(async(_env,_token,_market,code)=>{
    calls.push({code,at:now});return ok(code);
  },{spacingMs:450,clock:()=>now,sleep:async ms=>{waits.push(ms);now+=ms;}});
  await Promise.all(['000001','000002','000003'].map(code=>shared.quote({},'TOKEN','J',code)));
  assert.deepEqual(calls.map(x=>x.at),[1000,1450,1900]);
  assert.deepEqual(waits,[450,450]);
});

test('failed and provider-rejected quotes are not cached',async()=>{
  let attempts=0;
  const shared=createSharedQuoteFetcher(async()=>{
    attempts++;
    if(attempts===1)throw Error('PROVIDER_DOWN');
    if(attempts===2)return {rt_cd:'1',msg_cd:'EGW00201'};
    return ok('225190');
  },{spacingMs:0});
  await assert.rejects(shared.quote({},'TOKEN','J','225190'),/PROVIDER_DOWN/);
  assert.equal((await shared.quote({},'TOKEN','J','225190')).rt_cd,'1');
  assert.equal((await shared.quote({},'TOKEN','J','225190')).rt_cd,'0');
  assert.equal((await shared.quote({},'TOKEN','J','225190')).rt_cd,'0');
  assert.equal(attempts,3);
});

test('a synthetic 100-stock watchlist adds no duplicate calls across 4 consumers',async()=>{
  let calls=0;
  const shared=createSharedQuoteFetcher(async(_env,_token,_market,code)=>{
    calls++;return ok(code);
  },{spacingMs:0});
  const codes=Array.from({length:100},(_,i)=>String(i).padStart(6,'0'));
  // 100 unique tickers but several overlapping views: basket (100),
  // pinned analysis (20), search priority (40), generic watch (12).
  for(const group of [codes,codes.slice(0,20),codes.slice(0,40),codes.slice(0,12)]){
    for(const code of group)await shared.quote({},'TOKEN','J',code);
  }
  assert.equal(calls,100);
  assert.equal(shared.stats.reused_calls,72);
});

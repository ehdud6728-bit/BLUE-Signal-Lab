import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {appendBasketRecord,pendingBasketQuickAdds} from '../web/src/basket-quick-queue.ts';

test('rapid taps are queued in order and none is replaced by the last tap',()=>{
 const taps=[
  {serial:1,code:'005930'},
  {serial:2,code:'000660'},
  {serial:3,code:'225190'}
 ];
 assert.deepEqual(pendingBasketQuickAdds(taps,0).map(x=>x.code),['005930','000660','225190']);
 assert.deepEqual(pendingBasketQuickAdds([...taps,{serial:4,code:'035720'}],3).map(x=>x.code),['035720']);
 assert.deepEqual(pendingBasketQuickAdds(taps,3),[]);
});

test('duplicate or stale serials are not replayed on rerender',()=>{
 assert.deepEqual(pendingBasketQuickAdds([
  {serial:6,code:'A'},{serial:4,code:'OLD'},
  {serial:5,code:'B'},{serial:5,code:'DUPLICATE'}
 ],4).map(x=>x.code),['B','A']);
});

test('all three queued stocks remain saved and duplicate quick taps are idempotent',()=>{
 let basket=[];
 const requests=pendingBasketQuickAdds([
  {serial:1,id:'MANUAL:005930:2026-11-20'},
  {serial:2,id:'MANUAL:000660:2026-11-20'},
  {serial:3,id:'MANUAL:225190:2026-11-20'},
  {serial:4,id:'MANUAL:005930:2026-11-20'}
 ],0);
 for(const item of requests)basket=appendBasketRecord(basket,{id:item.id});
 assert.deepEqual(basket.map(x=>x.id),[
  'MANUAL:225190:2026-11-20','MANUAL:000660:2026-11-20','MANUAL:005930:2026-11-20'
 ]);
});

test('regular quota ignores protected records and rejects the 101st regular item',()=>{
 let basket=[{id:'protected',protected:true}];
 for(let i=0;i<100;i++)basket=appendBasketRecord(basket,{id:`regular-${i}`});
 assert.equal(basket.length,101);
 const rejected=appendBasketRecord(basket,{id:'regular-100'});
 assert.equal(rejected,basket);
});

test('Turso mounts the basket while the search tab is visible, without idle watch/AI/quotes calls',()=>{
 const main=readFileSync(new URL('../web/src/main.tsx',import.meta.url),'utf8');
 const basket=readFileSync(new URL('../web/src/SmartBasket.tsx',import.meta.url),'utf8');
 assert.match(main,/\(storageMode==='d1'\|\|storageMode==='turso'\)\&\&<SmartBasket/);
 assert.doesNotMatch(main,/storageMode==='turso'&&activeView==='basket'\)\)\&\&<SmartBasket/);
 assert.match(main,/setBasketRequests\(prev=>\[\.\.\.prev,request\]\)/);
 assert.match(main,/onItemsChange=\{onBasketItemsChange\}/);
 assert.match(main,/basketAtLimit\(r\.code\)/);
 assert.match(main,/onQuickAddsHandled=\{serial=>setBasketRequests\(prev=>prev\.filter\(x=>x\.serial>serial\)\)\}/);
 assert.match(basket,/pendingBasketQuickAdds\(quickAddRequests\|\|\[\],handledQuickAdd\.current\)/);
 assert.match(basket,/appendTracked\(prev,\{id,source,code:data\.code/);
 assert.match(basket,/if\(!active\|\|!idsKey\)return;/);
 assert.match(basket,/if\(!active\)return;\s*let mounted=true;/);
 assert.match(basket,/onItemsChange\?\.\(items\.map\(x=>x\.id\),items\.filter\(x=>!x\.protected\)\.length\)/);
});

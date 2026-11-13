import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateStopCandidates,preferredStopMethod} from '../web/src/stop-loss.ts';
const bars=Array.from({length:45},(_,i)=>{
 const d=new Date(Date.UTC(2026,7,1+i));const t=d.toISOString().slice(0,10);
 const c=1000+i;return {t,o:c-1,h:c+10,l:c-10,c};
});
const asof=bars.at(-1).t;
const row=(m,r)=>r.find(x=>x.method===m);
test('supports genuine 10 prior sessions, ATR14 and MA20',()=>{
 const x=calculateStopCandidates(bars,asof,1044);
 assert.equal(x.length,4);
 assert.ok(row('SUPPORT',x).price<1044);
 assert.ok(row('ATR',x).price<1044);
 assert.ok(row('MA20',x).price<1044);
 assert.equal(row('TRAILING',x).price,null);
});
test('future prices are never used for discovery as-of',()=>{
 const a=calculateStopCandidates(bars.slice(0,30),bars[29].t,1029);
 const b=calculateStopCandidates([...bars,{t:'2027-01-05',o:99999,h:100010,l:99990,c:100000}],bars[29].t,1029);
 assert.deepEqual(a,b);
});
test('trailing needs a later observed high, not an arbitrary number',()=>{
 assert.equal(row('TRAILING',calculateStopCandidates(bars,asof,1044,1300,asof)).price,null);
 const t=row('TRAILING',calculateStopCandidates(bars,asof,1044,1300,'2026-11-12'));
 assert.ok(t.price>1044);assert.ok(t.baselinePct>0);
});
test('missing verified candles never makes up stop prices',()=>{
 const x=calculateStopCandidates(null,'2026-11-12',1000);
 assert.ok(x.every(y=>y.price===null));
});
test('invalid or insufficient candle data is rejected',()=>{
 const x=calculateStopCandidates([{t:'2026-11-11',o:1,h:1,l:10,c:2}],asof,1044);
 assert.ok(x.every(y=>y.price===null));
});
test('prefers structural stop for B40/ENV but ATR for momentum-only',()=>{
 assert.equal(preferredStopMethod(['B40']),'SUPPORT');
 assert.equal(preferredStopMethod(['BB40']),'SUPPORT');
 assert.equal(preferredStopMethod(['ENV20']),'SUPPORT');
 assert.equal(preferredStopMethod(['MACD_GC']),'ATR');
});

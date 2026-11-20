import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {basketReturn,highestObservedPrice,lowestObservedPrice,rankBasketRecords}
 from '../web/src/basket-rank.ts';

const items=[
 {code:'005930',day:'2026-11-10',baseline:100,current:120,high:130,low:90},
 {code:'000660',day:'2026-11-11',baseline:100,current:105,high:160,low:110},
 {code:'225190',day:'2026-11-12',baseline:100,current:140,high:150,low:null},
 {code:'035720',day:'2026-11-13',baseline:100,current:80,high:110,low:75}
];
const score=(item,basis)=>basketReturn(basis==='CURRENT'?item.current:
 basis==='HIGH'?item.high:item.low,item.baseline);

test('rising top 10 switches between current, observed high, observed low without rewriting basket',()=>{
 const before=structuredClone(items);
 assert.deepEqual(rankBasketRecords(items,'GAIN_TOP','CURRENT',score).map(x=>x.code),
  ['225190','005930','000660']);
 assert.deepEqual(rankBasketRecords(items,'GAIN_TOP','HIGH',score).map(x=>x.code),
  ['000660','225190','005930','035720']);
 assert.deepEqual(rankBasketRecords(items,'GAIN_TOP','LOW',score).map(x=>x.code),
  ['000660']);
 assert.deepEqual(items,before);
});

test('falling top 10 keeps current return even after choosing high or low',()=>{
 assert.deepEqual(rankBasketRecords(items,'LOSS_TOP','HIGH',score).map(x=>x.code),['035720']);
 assert.deepEqual(rankBasketRecords(items,'LOSS_TOP','LOW',score).map(x=>x.code),['035720']);
 assert.equal(rankBasketRecords(items,'RECENT','LOW',score),items);
});

test('rank cap, ties and distinct discovery dates are deterministic',()=>{
 const stocks=Array.from({length:13},(_,i)=>({code:String(i).padStart(6,'0'),
  day:i%2?'2026-11-11':'2026-11-10',baseline:100,current:110,high:140,low:101}));
 const ranked=rankBasketRecords(stocks,'GAIN_TOP','HIGH',score);
 assert.equal(ranked.length,10);
 assert.deepEqual(ranked.slice(0,2).map(x=>x.code),['000000','000002']);
});

test('post-discovery extrema are never fabricated from the discovery day or unknown low',()=>{
 const high=highestObservedPrice({discoveryDay:'2026-11-18',
  performance:{quote_day:'2026-11-19',quote_high:110,highest_day:'2026-11-18',highest_price:190},
  compared:{period_high:125,period_high_day:'2026-11-20',high_complete:false},
  recent:{price:115,day:'2026-11-20'}});
 assert.equal(high?.price,125);
 assert.equal(high?.day,'2026-11-20');
 assert.equal(lowestObservedPrice('2026-11-18',
  {period_low:90,period_low_day:'2026-11-18'}),null);
 assert.equal(lowestObservedPrice('2026-11-18',
  {period_low:92,period_low_day:'2026-11-19'})?.price,92);
 assert.equal(lowestObservedPrice('2026-11-18',{})?.price,undefined);
});

test('basket selector matches the shared ranking and uses clear mobile buttons',async()=>{
 const basket=await readFile(new URL('../web/src/SmartBasket.tsx',import.meta.url),'utf8');
 const css=await readFile(new URL('../web/src/r157-ui.css',import.meta.url),'utf8');
 assert.match(basket,/rankBasketRecords\(scoped,rank,gainBasis/);
 assert.match(basket,/aria-label="상승 TOP 10 가격 기준"/);
 assert.match(basket,/\['CURRENT','현재수익률'\],\['HIGH','관측 최고가'\],\['LOW','관측 최저가'\]/);
 assert.match(css,/r157-gain-basis/);
});

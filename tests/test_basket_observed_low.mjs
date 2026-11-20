import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('basket shows saved post-discovery low, discovery-relative return, source and partial caveat',async()=>{
 const src=await readFile(new URL('../web/src/SmartBasket.tsx',import.meta.url),'utf8');
 assert.match(src,/const minLow=comp\?\.period_low/);
 assert.match(src,/검색 이후 관측 최저가/);
 assert.match(src,/pctChange\(minLow,it\.baseline\)/);
 assert.match(src,/sourceName\(comp\?\.period_low_source\)/);
 assert.match(src,/부분 관측/);
 // A close is not the daily low. The card must use the low-specific evidence.
 assert.doesNotMatch(src,/const minLow=shownRecent/);
});

test('basket price cards use a balanced four-column / two-column mobile grid',async()=>{
 const css=await readFile(new URL('../web/src/r15116-basket-priority.css',import.meta.url),'utf8');
 assert.match(css,/grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:700px\)[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.match(css,/basket-price-low/);
});

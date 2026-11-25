import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stockObservationContext} from '../web/src/stock-observation-context.ts';

test('observed reverse arrangement, low turnover and absent crosses remain descriptive',()=>{
 const r=stockObservationContext({ma20:5800,ma40:6000,ma60:6200,traded_amount_krw:1520000000,amount_ratio20:.23,rsi:32.1,rsi_gc:false,slow_14_3_3_gc:'false',macd_gc:0,supply_strength_method:'DAILY_HL_UNIFORM_120_V2',supply_strength_grade:'약',supply_reference_price:5668.2},5640);
 assert.equal(r.trend,'역배열');assert.equal(r.turnover,'0.23배 · 평균 미만');
 assert.equal(r.rsi,32.1);assert.equal(r.momentum,'당일 GC 없음');
 assert.equal(r.supply.price,5668.2);assert.ok(Math.abs(r.supply.distancePct-.5)<1e-8);
 assert.ok(r.checks.includes('거래대금 회복 여부'));
 assert.ok(r.checks.includes('하락 배열 완화 여부'));
});
test('missing data and invalid fields are not false negatives or zero observations',()=>{
 const r=stockObservationContext({ma20:false,ma40:10,ma60:20,amount_ratio20:0,rsi:101,rsi_gc:'nonsense',supply_reference_price:100,supply_strength_grade:'약'},null);
 assert.equal(r.trend,'미계산');assert.equal(r.turnover,'미확인');assert.equal(r.rsi,null);
 assert.match(r.momentum,/확인된 GC 없음.*미계산/);assert.equal(r.supply,null);
});
test('actual known cross and unknown siblings are distinct; supply provenance required',()=>{
 const r=stockObservationContext({ma20:'30',ma40:'20',ma60:'10',traded_amount_krw:200,amount_ratio20:2,macd_gc:'True',slow_14_3_3_gc:false,supply_strength_method:'legacy',supply_strength_grade:'강',supply_reference_price:100},90);
 assert.equal(r.trend,'정배열');assert.equal(r.turnover,'2.00배 · 평균 초과');
 assert.equal(r.momentum,'MACD GC 발생 · RSI 미계산');assert.equal(r.supply,null);
});
test('both search layouts pass same discovery reference price; summary precedes details',async()=>{
 const main=await readFile(new URL('../web/src/main.tsx',import.meta.url),'utf8');
 const ui=await readFile(new URL('../web/src/StockResearchReference.tsx',import.meta.url),'utf8');
 assert.equal((main.match(/referencePrice=\{r\.close_price\}/g)||[]).length,2);
 assert.ok(ui.indexOf('className="sr-context"')<ui.indexOf('className="sr-reference"'));
 assert.match(ui,/현재가 예측이나 매수 추천 아님/);
});

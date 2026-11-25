import test from 'node:test';
import assert from 'node:assert/strict';
import {synthesizeStockResearch} from '../web/src/stock-research-synthesis.ts';
const loss={pattern:'ENV20|LONG_BULL',mean_pct:-2.11,median_pct:-3,profit_factor:.52,payoff_ratio:1.19,worst_5pct_mean_pct:-20.61,min_pct:-31.05,n:522};
const win={...loss,mean_pct:3,median_pct:1,profit_factor:1.8};
const tomato={label:'RSI 골든크로스 + 역배열',up:100,n:8};
test('observed positive tomato and negative market research remain separate',()=>{
 const r=synthesizeStockResearch([loss],[],tomato,null,null);
 assert.equal(r.label,'긍정·부정 근거 혼재');
 assert.ok(r.risk.some(x=>x.includes('-31.05')));
 assert.ok(r.limits.some(x=>x.includes('8건')));
 assert.ok(r.positive.some(x=>x.includes('100.0%')));
 assert.equal(Object.hasOwn(r,'score'),false);
});
test('payoff alone does not turn negative profitability positive',()=>{
 assert.equal(synthesizeStockResearch([loss],[],null,null,null).label,'수익성 주의');
});
test('unverified high return feature never becomes favorable evidence',()=>{
 const r=synthesizeStockResearch([], [{pattern:'A',feature:'CANDLE',value:'BULL',status:'INSUFFICIENT_HOLDOUT'}],null,null,null);
 assert.equal(r.label,'판단 자료 부족');
 assert.equal(r.positive.length,0);
});
test('different market conditions with opposite returns are mixed',()=>{
 assert.equal(synthesizeStockResearch([win,loss],[],null,null,null).opposing,true);
 assert.equal(synthesizeStockResearch([win],[],null,null,null).label,'긍정적 관측 근거 있음');
});

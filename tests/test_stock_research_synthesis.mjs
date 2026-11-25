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

test('negative median is not hidden by positive average or profit factor',()=>{
 const r=synthesizeStockResearch([{...win,median_pct:-1}],[],null,null,null);
 assert.equal(r.label,'수익성 주의');
 assert.equal(r.positive.length,0);
});
test('short-term evidence needs both positive direction and positive median',()=>{
 const recent={pattern:'ENV20',horizon_trading_days:3,positive_return_probability_pct:45,median_return_pct:-1,sample_count:40};
 const r=synthesizeStockResearch([],[],tomato,recent,null);
 assert.equal(r.opposing,true);
 assert.equal(r.label,'긍정·부정 근거 혼재');
 assert.ok(r.risk.some(t=>t.includes('45.0%')));
 const mixed=synthesizeStockResearch([],[],null,{...recent,positive_return_probability_pct:60},null);
 assert.equal(mixed.positive.length,0);
 assert.equal(mixed.label,'판단 자료 부족');
});
test('compound downside updates label and opposing together; small sample is not direction',()=>{
 const x={label:'ENV20',status:'DESCRIPTIVE_ONLY',n:40,mean:2,median:-1,profitFactor:1.2};
 const r=synthesizeStockResearch([win],[],null,null,null,[x]);
 assert.equal(r.opposing,true);
 assert.equal(r.label,'긍정·부정 근거 혼재');
 assert.equal(synthesizeStockResearch([],[],null,null,null,[x]).label,'수익성 주의');
 const small=synthesizeStockResearch([],[],null,null,null,[{...x,status:'SMALL_SAMPLE',n:3}]);
 assert.equal(small.risk.length,0);
 assert.equal(small.label,'판단 자료 부족');
});

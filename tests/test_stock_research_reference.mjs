import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedCandleFeatures,exactConditionMatch,selectStockResearch} from '../web/src/stock-research-reference.ts';
const asof='2026-11-24',base='ENV20_LOWER_TOUCH',signals=[base],features=['BULL','BODY_30_50','CLOSE_MID'];
const row=(pattern,n=40)=>({pattern,group:'detail_rankings',horizon:3,n,dates:6,stocks:20});
const profile=(pattern,feature,value,status='INSUFFICIENT_HOLDOUT')=>({pattern,window:28,horizon:3,outcome:'CLOSE',target_pct:10,feature,value,status,train:{n:40},holdout:{n:0}});
const args={day:'2026-11-25',asof,signals,features,profit:{asof,rows:[row(base,200),row(base+'|BULL|BODY_30_50',40),row(base+'|BULL|CLOSE_MID',70),row(base+'|BULL|AMOUNT_5|2_3',90)]},profiles:{asof,rows:[profile(base+'|BULL|BODY_30_50','CLOSE_POSITION','CLOSE_MID'),profile(base,'AMOUNT_5','2_3'),profile(base,'CLOSE_POSITION','CLOSE_HIGH')]}};
test('exact base and candle compound, never unsupported extra conditions',()=>{
 const f=verifiedCandleFeatures(features);
 assert.equal(exactConditionMatch(base+'|BULL|CLOSE_MID',signals,f),true);
 assert.equal(exactConditionMatch(base+'|BULL|CLOSE_HIGH',signals,f),false);
 assert.equal(exactConditionMatch(base+'|BULL|MARKET_BROAD_WEAK',signals,f),false);
 assert.equal(exactConditionMatch(base+'|AMOUNT_5|2_3',signals,f),false);
 assert.equal(exactConditionMatch(base+'|BULL',[],f),false);
});
test('choose representative by specificity then sample count, not returns',()=>{
 const r=selectStockResearch(args);
 assert.equal(r.profits.length,1);
 assert.equal(r.profits[0].pattern,base+'|BULL|CLOSE_MID');
 assert.equal(r.high.length,1);
 assert.equal(r.high[0].status,'INSUFFICIENT_HOLDOUT');
});
test('missing or contradictory features never infer matches',()=>{
 for(const features of [null,[],['BULL','BEAR','CLOSE_MID']]){
  const r=selectStockResearch({...args,features});
  assert.equal(r.profits[0].pattern,base);
  assert.equal(r.high.length,0);
 }
 const r=selectStockResearch({...args,features:['BULL','CLOSE_LOW','CLOSE_HIGH']});
 assert.equal(r.high.length,0);
});
test('stale study and retrospective separation',()=>{
 assert.equal(selectStockResearch({...args,day:asof}).profits.length,0);
 assert.equal(selectStockResearch({...args,day:asof,allowRetrospective:true}).retrospective,true);
 assert.equal(selectStockResearch({...args,day:'2026-11-31'}).profits.length,0);
 assert.equal(selectStockResearch({...args,profit:{...args.profit,asof:'2026-11-23'}}).profits.length,0);
});

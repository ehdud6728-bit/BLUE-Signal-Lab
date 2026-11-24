import test from 'node:test';
import assert from 'node:assert/strict';
import {flowWindow,marketBriefing} from '../web/src/market-briefing.ts';
const f=[{day:'2026-11-23',foreign:'BUY',institution:null},{day:'2026-11-20',foreign:'BUY',institution:'SELL'},{day:'2026-11-19',foreign:'SELL',institution:'BUY'}];
test('count only known direction and distinguish stale or conflicting evidence',()=>{
 assert.equal(flowWindow(f,'foreign',3).buy,2);
 assert.equal(flowWindow(f,'institution',3).complete,false);
 const m=['KOSPI','KOSDAQ'].map(market=>({market,change_pct:1,breadth_pct:60,flows:f}));
 const g=['.NDX','.SPX','.VIX'].map(symbol=>({symbol,summary:{day:'2026-11-23',close:20,change_pct:symbol==='.VIX'?-1:1,change5_pct:null}}));
 assert.equal(marketBriefing(m,g,false).scenario,'REBOUND_OBSERVATION');
 assert.equal(marketBriefing(m,g,true).scenario,'HOLD');
 g[0].summary.day='2026-11-20';
 assert.equal(marketBriefing(m,g,false).scenario,'HOLD');
});

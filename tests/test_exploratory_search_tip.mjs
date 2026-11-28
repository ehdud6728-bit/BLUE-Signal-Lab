import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {exploratorySearchTip,SEARCH_TIP_EVIDENCE} from '../web/src/exploratory-search-tip.ts';
const day='2026-11-30';
const extras={slow_12_5_5_gc:true,slow_12_5_5_last_gc:day,diagnostic_status:'R08_RESEARCH_EOD'};
test('only exact-day EOD scanner signal displays a research tip',()=>{
 assert.equal(exploratorySearchTip(day,extras,false)?.title,'연구 중 · Stoch 12·5·5 GC');
 for(const flag of [true,1,'1','true','True'])assert.ok(exploratorySearchTip(day,{...extras,slow_12_5_5_gc:flag},false));
 for(const flag of [false,0,'0','false',null,undefined,'yes',2])assert.equal(exploratorySearchTip(day,{...extras,slow_12_5_5_gc:flag},false),null);
});
test('missing, wrong-day, provisional and unsupported source do not display',()=>{
 assert.equal(exploratorySearchTip(day,undefined,false),null);
 assert.equal(exploratorySearchTip(day,{...extras,slow_12_5_5_last_gc:'2026-11-27'},false),null);
 assert.equal(exploratorySearchTip(day,extras,true),null);
 assert.equal(exploratorySearchTip(day,{...extras,diagnostic_status:'NO_PRICE_HISTORY'},false),null);
 assert.equal(exploratorySearchTip(day,{...extras,diagnostic_status:undefined},false),null);
});
test('historical results are retrospective and 10 sessions are not mature',()=>{
 assert.equal(exploratorySearchTip(day,extras,false)?.retrospective,false);
 assert.equal(exploratorySearchTip('2026-11-27',{...extras,slow_12_5_5_last_gc:'2026-11-27'},false)?.retrospective,true);
 const e=SEARCH_TIP_EVIDENCE;
 assert.equal(e.yes+e.no+e.unknown,e.observed);
 assert.equal(e.mature10,0);
 assert.equal(e.yesHit15,9);assert.equal(e.noHit15,71);
 assert.equal(e.yesDown10,11);assert.equal(e.noDown10,270);
});
test('only search card display wiring, no promotion or provisional match',()=>{
 const main=readFileSync(new URL('../web/src/main.tsx',import.meta.url),'utf8');
 assert.equal(main.match(/<ExploratorySearchTip day=\{r\.day\} extras=\{r\.extras\} provisional=\{r\.provisional\}\/>/g)?.length,2);
 const component=readFileSync(new URL('../web/src/ExploratorySearchTip.tsx',import.meta.url),'utf8');
 assert.match(component,/10일\/독립기간 검증 전/);
 assert.match(component,/5일 최고수익 평균/);
});

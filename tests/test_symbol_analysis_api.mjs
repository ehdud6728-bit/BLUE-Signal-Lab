import test from 'node:test';
import assert from 'node:assert/strict';
import {lookupSymbolAnalysis,validAnalysisCode,validAnalysisDate} from '../worker/src/symbol-analysis.ts';

function mockDb(row=null,exists=true){
 const sqls=[];
 return {sqls,prepare(sql){
  const stmt={bind(...args){this.args=args;return this;},async first(){sqls.push({sql,args:this.args||[]});
   return sql.includes('sqlite_master')?(exists?{name:'blue_symbol_analysis_v1'}:null):row;}};
  return stmt;
 }};
}
function saved({future=false}={}){
 const day='2026-11-06';
 return {run_id:'blue_symbol_123',source:'TEST',quality_status:'CORPORATE_ACTION_REVIEW_REQUIRED',
  created_at_utc:'2026-11-17T00:00:00Z',
  diagnosis_json:JSON.stringify({code:'225190',asof:day,matched:false,reason:'NO_ENABLED_SIGNAL_ON_TARGET_DAY'}),
  chart_json:JSON.stringify({asof:day,bars:[{t:future?'2026-11-09':day,o:10,h:12,l:9,c:11}]}),
  stats_json:'null'};
}
test('exact ticker/date validation blocks arbitrary paths',()=>{
 assert.equal(validAnalysisCode('225190'),true);
 assert.equal(validAnalysisCode('22519/'),false);
 assert.equal(validAnalysisDate('2026-02-29'),false);
 assert.equal(validAnalysisDate('2026-11-06'),true);
});
test('missing symbol is explicitly not stored, never inferred from matched signals',async()=>{
 const db=mockDb(null,false);
 assert.equal((await lookupSymbolAnalysis(db,'225190','2026-11-06')).status,'NOT_STORED');
 assert.ok(db.sqls.every(x=>!/(INSERT|DELETE|UPDATE)/i.test(x.sql)));
});
test('unmatched symbol can return isolated chart while preserving review warning',async()=>{
 const db=mockDb(saved());const out=await lookupSymbolAnalysis(db,'225190','2026-11-06');
 assert.equal(out.status,'READY');assert.equal(out.diagnosis.matched,false);
 assert.equal(out.quality_status,'CORPORATE_ACTION_REVIEW_REQUIRED');
 assert.equal(out.stats,null);
 assert.ok(db.sqls.some(x=>x.sql.includes('WHERE code=? AND day=?')));
});
test('future-dated bar is never served to historical analysis',async()=>{
 const out=await lookupSymbolAnalysis(mockDb(saved({future:true})),'225190','2026-11-06');
 assert.equal(out.status,'CORRUPT_STORED_ANALYSIS');
});

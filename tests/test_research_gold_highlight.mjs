import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {validatedResearchSignal,researchCardClasses} from '../web/src/research-gold-highlight.ts';

const row={day:'2026-11-20',signals:['BB20_LOWER','ENV20'],research_recommendation:{
  source:'BLUE_TURSO_AUDITED_PATTERN_RESEARCH_V2',
  status:'VALIDATED_OUT_OF_SAMPLE',
  asof_day:'2026-11-19',
  research_audit_sha256:'a'.repeat(64),
  matched_signals:['BB20_LOWER'],
  mature_sample_count:42,
  holdout_verified:true,
  downside_risk_checked:true,
}};

test('gold requires audited, holdout-verified Turso pattern evidence',()=>{
  assert.equal(validatedResearchSignal(row,true),'BB20_LOWER');
  assert.equal(validatedResearchSignal(row,false),null,'D1 or non-pattern search cannot grant gold');
});

test('frequency growth and exploratory tomato observation cannot grant gold',()=>{
  assert.equal(validatedResearchSignal({...row,research_recommendation:undefined,relative_change_pct:900},true),null);
  assert.equal(validatedResearchSignal({...row,research_recommendation:undefined,extras:{r159_pattern_up_10d:90,r159_pattern_n_10d:25}},true),null);
  assert.equal(validatedResearchSignal({...row,research_recommendation:{relative_change_pct:1000}},true),null);
});

test('incomplete, unaudited, wrong-date and unmatched evidence fail closed',()=>{
  const variants=[
    {source:'OTHER'}, {status:'EXPLORATORY'}, {holdout_verified:false},
    {downside_risk_checked:false}, {research_audit_sha256:'not-a-hash'},
    {mature_sample_count:0}, {mature_sample_count:'50'},
    {asof_day:'2026-11-21'}, {asof_day:'2026-02-30'},
    {matched_signals:['BB40']}, {matched_signals:[]}, {matched_signals:['']},
  ];
  for(const change of variants){
    const proof={...row.research_recommendation,...change};
    assert.equal(validatedResearchSignal({...row,research_recommendation:proof},true),null,JSON.stringify(change));
  }
  assert.equal(validatedResearchSignal({...row,day:'2026-02-30'},true),null);
});

test('gold/tomato classes are independent and can coexist',()=>{
  assert.equal(researchCardClasses(false,false),'');
  assert.equal(researchCardClasses(false,true),' r159-tomato-stock');
  assert.equal(researchCardClasses(true,false),' r-research-gold');
  assert.equal(researchCardClasses(true,true),' r-research-gold r159-tomato-stock');
});

test('search cards and mobile/desktop gradients preserve diagonal gold + tomato',()=>{
  const main=readFileSync(new URL('../web/src/main.tsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('../web/src/r-research-gold-outline.css',import.meta.url),'utf8');
  assert.match(main,/className=\{'clickable'\+stockHighlight\(r\)\}/);
  assert.match(main,/className=\{'r151-mobile-row'\+stockHighlight\(r\)\}/);
  assert.match(main,/\{goldEvidenceBlock\(r\)\}/);
  assert.match(css,/\.r151-mobile-row\.r-research-gold\.r159-tomato-stock>\.stock-card/);
  assert.match(css,/\.desktop-results tr\.r-research-gold\.r159-tomato-stock>td/);
  assert.match(css,/linear-gradient\(135deg,#c49b32/);
});

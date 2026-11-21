/**
 * Fail-closed UI contract for future independently validated pattern research.
 * Search frequency, exploratory 10-day observation and legacy D1 data are NOT
 * recommendations. The existing search API does not yet emit this payload.
 */
export type ResearchHighlightRow = {
  day:string;
  signals:string[];
  research_recommendation?:unknown;
};

const validDay=(value:unknown):value is string=>{
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false;
  const parsed=new Date(value+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
};

/** Return the exact active signal that earned a researched recommendation. */
export function validatedResearchSignal(row:ResearchHighlightRow,verifiedTursoSearch:boolean):string|null{
  if(!verifiedTursoSearch||!validDay(row.day)||!Array.isArray(row.signals))return null;
  const proof=row.research_recommendation;
  if(!proof||typeof proof!=='object'||Array.isArray(proof))return null;
  const p=proof as Record<string,unknown>;
  if(p.source!=='BLUE_TURSO_AUDITED_PATTERN_RESEARCH_V2'||
     p.status!=='VALIDATED_OUT_OF_SAMPLE'||
     p.holdout_verified!==true||p.downside_risk_checked!==true||
     !validDay(p.asof_day)||p.asof_day>row.day||
     typeof p.research_audit_sha256!=='string'||!/^[0-9a-f]{64}$/.test(p.research_audit_sha256)||
     typeof p.mature_sample_count!=='number'||!Number.isSafeInteger(p.mature_sample_count)||p.mature_sample_count<1||
     !Array.isArray(p.matched_signals))return null;
  const names=p.matched_signals;
  if(names.length===0||names.length>50||names.some(s=>typeof s!=='string'||!s.trim()||s.length>64))return null;
  return names.find((s:string)=>row.signals.includes(s))??null;
}

export function researchCardClasses(isGold:boolean,isTomato:boolean):string{
  return `${isGold?' r-research-gold':''}${isTomato?' r159-tomato-stock':''}`;
}

import {RECENT_ASOF,RECENT_RECOMMENDATIONS} from './recent-pattern-data';
export function matchedRecent(day:string,signals:string[],features:unknown){
 if(day<=RECENT_ASOF||!Array.isArray(features))return [];
 return RECENT_RECOMMENDATIONS.filter(r=>{
 if(r.tier!=='SHORT_RECOMMENDATION')return false;
 const [base,shape,detail,...rest]=r.pattern.split('|');
 if(!signals.includes(base)||!features.includes(shape)||rest.length)return false;
 return r.group==='candle_rankings'&&!detail||r.group==='detail_rankings'&&shape==='BULL'&&/^(BODY_(10_30|30_50|50_70)|CLOSE_(LOW|MID|HIGH))$/.test(detail??'')&&features.includes(detail);
 }).sort((a,b)=>b.positive_return_probability_pct-a.positive_return_probability_pct);
}

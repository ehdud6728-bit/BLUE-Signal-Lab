/** Search-day technical evidence, separate from the scanner's signal codes.
 * Never recalculate these badges from a later quote or a different trade day.
 */
export const DISCOVERY_TECH_BADGES=['역배열','정배열 전환','112선 돌파','224선 돌파'] as const;
export type DiscoveryTechBadge=typeof DISCOVERY_TECH_BADGES[number];

const positive=(value:unknown):number|null=>{
 if(value===null||value===undefined||value===''||typeof value==='boolean')return null;
 const n=Number(value);
 return Number.isFinite(n)&&n>0?n:null;
};
const trueFlag=(value:unknown)=>value===true||value===1||
 (typeof value==='string'&&['true','1'].includes(value.toLowerCase()));

export function discoveryTechnicalBadges(extras:Record<string,unknown>|undefined):DiscoveryTechBadge[]{
 if(!extras)return [];
 const result:DiscoveryTechBadge[]=[];
 const a=positive(extras.ma20),b=positive(extras.ma40),c=positive(extras.ma60);
 if(a!==null&&b!==null&&c!==null&&a<b&&b<c)result.push('역배열');
 if(trueFlag(extras.ma_to_up))result.push('정배열 전환');
 if(trueFlag(extras.ma112_cross))result.push('112선 돌파');
 if(trueFlag(extras.ma224_cross))result.push('224선 돌파');
 return result;
}

// The isolated stock-analysis view exposes explicit, dated predicates instead
// of the historical search row's MA extras.
export function analysisTechnicalBadges(predicates:Record<string,boolean|null>):DiscoveryTechBadge[]{
 const result:DiscoveryTechBadge[]=[];
 if(predicates.MA_INVERSE===true)result.push('역배열');
 if(predicates.MA_TO_UP===true)result.push('정배열 전환');
 if(predicates.MA112_CROSS===true)result.push('112선 돌파');
 if(predicates.MA224_CROSS===true)result.push('224선 돌파');
 return result;
}

export function validDiscoveryTechnicalBadges(value:unknown):value is DiscoveryTechBadge[]{
 return Array.isArray(value)&&value.length<=DISCOVERY_TECH_BADGES.length&&
  new Set(value).size===value.length&&
  value.every(x=>DISCOVERY_TECH_BADGES.includes(x as DiscoveryTechBadge));
}

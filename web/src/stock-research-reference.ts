/** Exact supported close-known conditions. Unknown is never a mismatch.
 * No inferred turnover, prior returns, market breadth or prior high features.
 * This is a display-only reference, not a recommendation or sort criterion.
 */
const SHAPES=['FLAT','DOJI','LOWER_WICK','UPPER_WICK','LONG_BULL','LONG_BEAR','BULL','BEAR'] as const;
const BODIES=['BODY_10_30','BODY_30_50','BODY_50_70'] as const;
const POSITIONS=['CLOSE_LOW','CLOSE_MID','CLOSE_HIGH'] as const;
type FeatureMap=Record<string,string|undefined>;
export function verifiedCandleFeatures(input:unknown):FeatureMap{
 if(!Array.isArray(input)||input.some(x=>typeof x!=='string'))return {};
 const one=(values:readonly string[])=>{const present=values.filter(v=>input.includes(v));return present.length===1?present[0]:undefined;};
 const shape=one(SHAPES);
 if(!shape)return {};
 if(shape!=='BULL')return {CANDLE:shape};
 return {CANDLE:shape,BODY:one(BODIES),CLOSE_POSITION:one(POSITIONS)};
}
export function exactConditionMatch(pattern:string,signals:readonly string[],f:FeatureMap):boolean{
 const [base,shape,detail,...extra]=pattern.split('|');
 if(!base||!signals.includes(base)||extra.length)return false;
 if(!shape)return detail===undefined;
 if(shape!==f.CANDLE)return false;
 if(!detail)return true;
 return shape==='BULL'&&(detail===f.BODY||detail===f.CLOSE_POSITION);
}
type Profit={pattern:string;group:string;horizon:number;n:number;dates:number;stocks:number};
type Profile={pattern:string;window:number;horizon:number;outcome:string;target_pct:number;feature:string;value:string;status:string;train:{n:number};holdout:{n:number}};
type Data<T>={asof:string;rows:T[]};
const valid=(day:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
export function selectStockResearch<P extends Profit,H extends Profile>(input:{day:string;asof:string;signals:readonly string[];features:unknown;profit:Data<P>|null;profiles:Data<H>|null;allowRetrospective?:boolean}){
 const {day,asof,signals,features,profit,profiles,allowRetrospective}=input;
 const empty={retrospective:false,profits:[] as P[],high:[] as H[]};
 if(!valid(day)||!valid(asof)||!Array.isArray(signals)||day<=asof&&!allowRetrospective)return empty;
 const f=verifiedCandleFeatures(features);
 const specificity=(p:string)=>p.split('|').length;
 const baseSort=(a:P,b:P)=>specificity(b.pattern)-specificity(a.pattern)||b.n-a.n||a.pattern.localeCompare(b.pattern)||a.group.localeCompare(b.group);
 // One representative per base signal, selected by specificity and sample,
 // NEVER by the best observed return. Full ranking remains in research center.
 const seen=new Set<string>();
 const profits=(profit?.asof===asof?profit.rows:[]).filter(r=>r.horizon===3&&r.n>=30&&r.dates>=5&&r.stocks>=10&&exactConditionMatch(r.pattern,signals,f)).sort(baseSort).filter(r=>{const k=r.pattern.split('|')[0];if(seen.has(k))return false;seen.add(k);return true;}).slice(0,3);
 const states:Record<string,number>={HOLDOUT_AGREES_EXPLORATORY:0,INSUFFICIENT_HOLDOUT:1,HOLDOUT_DISAGREES:2};
 const used=new Set<string>();
 const high=(profiles?.asof===asof?profiles.rows:[]).filter(r=>r.window===28&&r.horizon===3&&r.outcome==='CLOSE'&&r.target_pct===10&&Object.hasOwn(states,r.status)&&['CANDLE','BODY','CLOSE_POSITION'].includes(r.feature)&&f[r.feature]!==undefined&&f[r.feature]===r.value&&exactConditionMatch(r.pattern,signals,f)).sort((a,b)=>states[a.status]-states[b.status]||specificity(b.pattern)-specificity(a.pattern)||b.train.n-a.train.n||a.pattern.localeCompare(b.pattern)||a.feature.localeCompare(b.feature)).filter(r=>{const k=r.pattern.split('|')[0]+'|'+r.feature+'|'+r.value;if(used.has(k))return false;used.add(k);return true;}).slice(0,3);
 return {retrospective:day<=asof,profits,high};
}

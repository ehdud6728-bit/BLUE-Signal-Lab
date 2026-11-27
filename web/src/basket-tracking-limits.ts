/** Local-first guard. Unique symbols, not discovery rows. Server enrollment is
 * a separate future authority; this helper does not schedule or call KIS. */
export const MAX_BASKET_CODES=50;
export const INITIAL_PRECISE_CODES=10;
export const DESIGN_PRECISE_MAX=20;
type RecordBase={id:string;code:string;protected?:boolean;precise?:boolean};
export const uniqueCodes=(rows:readonly RecordBase[])=>new Set(rows.map(r=>r.code));
export const preciseCodes=(rows:readonly RecordBase[])=>new Set(rows.filter(r=>r.precise===true).map(r=>r.code));
export function canAddCode(rows:readonly RecordBase[],code:string){
 const codes=uniqueCodes(rows);return codes.has(code)||codes.size<MAX_BASKET_CODES;
}
export function dedupeRecords<T extends RecordBase>(rows:readonly T[]):T[]{
 const seen=new Set<string>(),pins=preciseCodes(rows);
 // Do not silently drop historical rows for a new quota. Normalize same-code
 // pin state; an imported/legacy overage stays visible and can be reduced.
 return rows.filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true})
  .map(r=>({...r,precise:pins.has(r.code)||undefined}));
}
export function appendTracked<T extends RecordBase>(rows:readonly T[],item:T,maxRegular=100):T[]{
 if(rows.some(r=>r.id===item.id)||!canAddCode(rows,item.code)||(!item.protected&&rows.filter(r=>!r.protected).length>=maxRegular))return rows as T[];
 const pinned=preciseCodes(rows).has(item.code);
 return [{...item,precise:pinned||undefined},...rows];
}
export function togglePrecise<T extends RecordBase>(rows:readonly T[],code:string):T[]{
 if(!rows.some(r=>r.code===code))return rows as T[];
 const pins=preciseCodes(rows),was=pins.has(code);
 if(!was&&(pins.size>=INITIAL_PRECISE_CODES||uniqueCodes(rows).size>MAX_BASKET_CODES))return rows as T[];
 return rows.map(r=>r.code===code?{...r,precise:!was||undefined}:r);
}
// A restore/import may preserve existing overages but not increase them.
export function withinTrackingLimits(before:readonly RecordBase[],after:readonly RecordBase[]){
 return uniqueCodes(after).size<=Math.max(MAX_BASKET_CODES,uniqueCodes(before).size)
 &&preciseCodes(after).size<=Math.max(INITIAL_PRECISE_CODES,preciseCodes(before).size);
}

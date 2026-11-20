/** Pure, bounded-by-user-taps handoff: no stock or basket records are dropped
 * merely because the basket tab is not visible. */
export function pendingBasketQuickAdds<T extends {serial:number}>(
 requests:readonly T[],handledThrough:number):T[]{
 const seen=new Set<number>();
 return requests.filter(request=>{
  if(!Number.isSafeInteger(request.serial)||request.serial<=handledThrough||seen.has(request.serial))return false;
  seen.add(request.serial);return true;
 }).sort((a,b)=>a.serial-b.serial);
}

/** Apply each successful add against the latest state, not a stale closure
 * from the first tap. Protected long-term items do not consume regular slots. */
export function appendBasketRecord<T extends {id:string;protected?:boolean}>(
 current:readonly T[],incoming:T,maxRegular=100):T[]{
 if(current.some(x=>x.id===incoming.id)||current.filter(x=>!x.protected).length>=maxRegular)
  return current as T[];
 return [incoming,...current];
}

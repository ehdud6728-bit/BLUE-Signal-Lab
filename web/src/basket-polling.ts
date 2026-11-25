/** Browser read cadence only. Never changes collector/KIS schedule or
 * claims an exchange holiday/calendar is verified. Manual refresh starts
 * a fresh effect, and a visible tab checks at the next due time.
 */
export type BasketReadKind='COMPARE'|'LEGACY_WATCH'|'LEGACY_LIVE';
export function basketReadInterval(kind:BasketReadKind,now=new Date()):number{
 const kst=new Date(now.getTime()+9*3600000);
 const minute=kst.getUTCHours()*60+kst.getUTCMinutes();
 // Include premarket, extended trading and the nightly 22:20 EOD update.
 const active=kst.getUTCDay()>=1&&kst.getUTCDay()<=5&&minute>=8*60&&minute<22*60+45;
 return (kind==='COMPARE'?(active?30:180):(active?120:300))*1000;
}
export function basketReadDue(kind:BasketReadKind,lastStarted:number|null,now=new Date()):boolean{
 return lastStarted===null||now.getTime()-lastStarted>=basketReadInterval(kind,now);
}

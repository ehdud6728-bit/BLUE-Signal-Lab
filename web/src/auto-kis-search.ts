/** Search-time KIS requests are limited to visible, missing/stale prices.
 * This never changes historical turnover or a signal-day closing price. */
export function missingKisSearchQuotes(items:{code:string;day:string}[],
 compares:Record<string,{latest_price?:number|null;latest_day?:string|null;latest_at?:string|null}>,today:string,limit=100,now=new Date()){
 // A same-day snapshot can be hours old. Only timestamped observations
 // can be judged by age; date-only observations preserve legacy behavior.
 const freshTimestamp=(at:string|null|undefined)=>{
  if(!at)return true;
  const stamp=Date.parse(at);
  return Number.isFinite(stamp)&&stamp<=now.getTime()+60_000&&now.getTime()-stamp<=15*60_000;
 };
 const seen=new Set<string>();
 return items.filter(item=>{
  if(!/^[0-9A-Z]{6}$/.test(item.code)||!/^20\d{2}-\d{2}-\d{2}$/.test(item.day)||
    item.day>today||seen.has(item.code))return false;
  const row=compares[`${item.code}:${item.day}`];
  if(row&&typeof row.latest_price==='number'&&row.latest_price>0&&row.latest_day&&row.latest_day>=today&&freshTimestamp(row.latest_at))
    return false;
  seen.add(item.code);return true;
 }).slice(0,Math.max(0,Math.min(100,limit)));
}

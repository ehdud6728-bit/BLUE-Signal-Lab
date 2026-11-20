/** Search-time KIS requests are limited to visible, missing/stale prices.
 * This never changes historical turnover or a signal-day closing price. */
export function missingKisSearchQuotes(items:{code:string;day:string}[],
 compares:Record<string,{latest_price?:number|null;latest_day?:string|null}>,today:string,limit=100){
 const seen=new Set<string>();
 return items.filter(item=>{
  if(!/^[0-9A-Z]{6}$/.test(item.code)||!/^20\d{2}-\d{2}-\d{2}$/.test(item.day)||
    item.day>today||seen.has(item.code))return false;
  const row=compares[`${item.code}:${item.day}`];
  if(row&&typeof row.latest_price==='number'&&row.latest_price>0&&row.latest_day&&row.latest_day>=today)
    return false;
  seen.add(item.code);return true;
 }).slice(0,Math.max(0,Math.min(100,limit)));
}

/** Candidate minute-to-bar calculation, no market calls or writes.
 * KRX regular session, open-labelled minute convention only (provider
 * timestamp semantics still need independent verification). A 15:30 auction
 * is not silently merged into continuous-session intervals. */
const need=(ok,code)=>{if(!ok)throw Error(code)};
const minute=h=>{need(typeof h==='string'&&/^\d{6}$/.test(h)&&h.slice(4)==='00','BAD_MINUTE_LABEL');const hh=Number(h.slice(0,2)),mm=Number(h.slice(2,4));need(hh<24&&mm<60,'BAD_MINUTE_LABEL');return hh*60+mm};
const label=m=>String(Math.floor(m/60)).padStart(2,'0')+String(m%60).padStart(2,'0')+'00';
const valid=r=>{const m=minute(r.h);need(m>=540&&m<=930,'OUT_OF_SESSION');need(['o','hi','lo','c','v'].every(k=>Number.isSafeInteger(r[k]))&&r.lo>0&&r.lo<=r.o&&r.o<=r.hi&&r.lo<=r.c&&r.c<=r.hi&&r.v>=0,'INVALID_MINUTE');return m};
const same=(a,b)=>['h','o','hi','lo','c','v'].every(k=>a[k]===b[k]);
/** Pages already identity/date checked by parser. Drop first row of EACH
 * page, even historical query: documented volume uncertainty. */
export function reconcilePages(pages){
 const map=new Map(),conflicts=new Set();
 for(const page of pages){
  for(const r of page.slice(1)){
   const m=valid(r),prior=map.get(m);
   if(prior&&!same(prior,r)){conflicts.add(m);map.delete(m)}
   else if(!conflicts.has(m))map.set(m,r);
  }
 }
 return {map,conflicts};
}
/** Compare repeated independent retrievals. Stability is not proof of
 * exchange finality. Missing/no-trade rows are never invented. */
export function repeatedMinutes(first,second){
 const a=reconcilePages(first),b=reconcilePages(second),map=new Map(),conflicts=new Set([...a.conflicts,...b.conflicts]);
 for(const [m,r] of a.map){
  if(b.map.has(m)&&!same(r,b.map.get(m)))conflicts.add(m);
  if(b.map.has(m)&&!conflicts.has(m))map.set(m,r);
 }
 return {map,conflicts};
}
export function aggregateWindow(evidence,start,end,period,cutoff){
 const a=minute(start),b=minute(end),closed=minute(cutoff);
 need([5,30,60].includes(period)&&b-a===period&&a>=540&&b<=930&&(a-540)%period===0,'BAD_WINDOW');
 if(b>closed)return {status:'NOT_CLOSED',start,end,period};
 const rows=[],missing=[],conflicts=[];
 for(let m=a;m<b;m++){if(evidence.conflicts.has(m))conflicts.push(label(m));else if(!evidence.map.has(m))missing.push(label(m));else rows.push(evidence.map.get(m))}
 if(missing.length||conflicts.length)return {status:'INCOMPLETE',start,end,period,missing,conflicts};
 const volume=rows.reduce((sum,r)=>sum+r.v,0);need(Number.isSafeInteger(volume),'VOLUME_OVERFLOW');
 return {status:'REPEAT_STABLE_CANDIDATE',start,end,period,minute_count:rows.length,open:rows[0].o,high:Math.max(...rows.map(r=>r.hi)),low:Math.min(...rows.map(r=>r.lo)),close:rows.at(-1).c,volume};
}
export function candle(bar){
 if(bar.status!=='REPEAT_STABLE_CANDIDATE')return null;
 const width=bar.high-bar.low,body=Math.abs(bar.close-bar.open);
 const shape=!width?'FLAT_RANGE':body*10<=width?'DOJI':bar.close>bar.open?(body*10>=width*6?'LONG_BULL':'BULL'):(body*10>=width*6?'LONG_BEAR':'BEAR');
 return {shape,lower_wick_long:width>0&&2*(Math.min(bar.open,bar.close)-bar.low)>=width,upper_wick_long:width>0&&2*(bar.high-Math.max(bar.open,bar.close))>=width};
}

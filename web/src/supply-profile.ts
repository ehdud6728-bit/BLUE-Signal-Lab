/** Research-only as-of volume allocation; not a trade-by-price profile or order book. */
export type DailyOHLCV={t:string;h:number;l:number;c:number;v:number};
export type SupplyBin={low:number;high:number;price:number;volume_shares:number;share_pct:number;relative_pct:number;grade:'강'|'중'|'약'|'낮음'};
export type SupplyProfile={status:'READY'|'INSUFFICIENT_HISTORY'|'NO_UPPER_CONCENTRATION';reference:SupplyBin|null;pocPrice:number;totalShares:number;bins:SupplyBin[]};
const rounded=(n:number,d=2)=>Math.round((n+Number.EPSILON)*10**d)/10**d;

export function dailySupplyProfile(bars:DailyOHLCV[]):SupplyProfile|null{
  if(bars.length<101)return null;
  const close=Number(bars[bars.length-1].c);
  if(!(Number.isFinite(close)&&close>0))return null;
  const recent=bars.slice(-121,-1).filter(b=>Number.isFinite(b.l)&&Number.isFinite(b.h)&&Number.isFinite(b.v)&&b.l>0&&b.h>=b.l&&b.v>=0);
  if(recent.length<100)return null;
  const total=recent.reduce((sum,b)=>sum+b.v,0);
  if(total<=0)return null;
  const width=Math.max(close*.01,(Math.max(...recent.map(b=>b.h))-Math.min(...recent.map(b=>b.l)))/400,.01);
  const bins=new Map<number,number>();
  for(const b of recent){
    if(!b.v)continue;
    if(b.h===b.l){const k=Math.floor(b.l/width);bins.set(k,(bins.get(k)||0)+b.v);continue;}
    const start=Math.floor(b.l/width),end=Math.ceil(b.h/width)-1;
    for(let k=start;k<=end;k++){
      const overlap=Math.min(b.h,(k+1)*width)-Math.max(b.l,k*width);
      if(overlap>0)bins.set(k,(bins.get(k)||0)+b.v*overlap/(b.h-b.l));
    }
  }
  if(!bins.size)return null;
  const entries=[...bins.entries()];
  const peak=Math.max(...entries.map(e=>e[1]));
  const pocKey=entries.find(e=>e[1]===peak)![0];
  const center=(k:number)=>(k+.5)*width;
  const toBin=(key:number):SupplyBin=>{
    const v=bins.get(key)!;const rel=100*v/peak;
    return {low:rounded(key*width),high:rounded((key+1)*width),price:rounded(center(key)),
      volume_shares:Math.round(v),share_pct:rounded(100*v/total,3),relative_pct:rounded(rel),
      grade:rel>=75?'강':rel>=50?'중':rel>=25?'약':'낮음'};
  };
  const above=(threshold:number)=>entries.filter(([key,v])=>center(key)>close&&v>=threshold*peak).map(([key])=>key).sort((a,b)=>a-b);
  const referenceKey=above(.25)[0];
  const nearby=above(.05).slice(0,8);
  if(referenceKey!==undefined&&!nearby.includes(referenceKey))nearby.push(referenceKey);
  nearby.sort((a,b)=>a-b);
  return {status:referenceKey===undefined?'NO_UPPER_CONCENTRATION':'READY',
    reference:referenceKey===undefined?null:toBin(referenceKey),pocPrice:rounded(center(pocKey)),
    totalShares:Math.round(total),bins:nearby.map(toBin)};
}

/** R1.5.10.7 – indicative observation levels from verified archived EOD candles.
 * Never infer intraday/live indicators from a discovery-day snapshot.
 */
export type StopMethod='SUPPORT'|'ATR'|'MA20'|'TRAILING';
export type StopBar={t:string;o:number;h:number;l:number;c:number};
export type StopCandidate={method:StopMethod;label:string;basis:string;price:number|null;baselinePct:number|null};

function finitePositive(v:unknown):v is number{return typeof v==='number'&&Number.isFinite(v)&&v>0;}
function validBar(v:unknown):v is StopBar{
 if(!v||typeof v!=='object')return false;
 const b=v as Partial<StopBar>;
 return typeof b.t==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(b.t)&&
  finitePositive(b.o)&&finitePositive(b.h)&&finitePositive(b.l)&&finitePositive(b.c)&&
  b.h>=b.l&&b.h>=b.c&&b.l<=b.c;
}
const safeStop=(raw:number|null,baseline:number,canExceed=false):number|null=>{
 if(raw===null||!Number.isFinite(raw)||raw<=0)return null;
 const price=Math.floor(raw);
 return price>0&&(canExceed||price<baseline)?price:null;
};

/** Original unadjusted daily OHLC until the discovery date. No future candles. */
export function calculateStopCandidates(rawBars:unknown,discoveryDay:string,baseline:number,
 observedHigh:number|null=null,observedHighDay:string|null=null):StopCandidate[]{
 const bars=Array.isArray(rawBars)?rawBars.filter(validBar).filter(b=>b.t<=discoveryDay)
  .sort((a,b)=>a.t.localeCompare(b.t)).slice(-180):[];
 const validBase=finitePositive(baseline);
 const candidate=(method:StopMethod,label:string,basis:string,raw:number|null,allowAbove=false):StopCandidate=>{
  const price=validBase?safeStop(raw,baseline,allowAbove):null;
  return {method,label,basis,price,baselinePct:price!==null?100*(price/baseline-1):null};
 };
 // The last 10 *completed previous* sessions are used; don't use the entry signal day's low.
 const prior=bars.filter(b=>b.t<discoveryDay).slice(-10);
 const support=prior.length===10?Math.min(...prior.map(b=>b.l))*0.995:null;
 // 14-session ATR (simple moving average of true ranges) requires 15 daily bars.
 const last15=bars.slice(-15);
 let atr:number|null=null;
 if(last15.length===15){
  let sum=0;
  for(let i=1;i<last15.length;i++){
   const b=last15[i],prev=last15[i-1];
   sum+=Math.max(b.h-b.l,Math.abs(b.h-prev.c),Math.abs(b.l-prev.c));
  }
  atr=sum/14;
 }
 const ma20=bars.length>=20?bars.slice(-20).reduce((sum,b)=>sum+b.c,0)/20:null;
 const trailValid=finitePositive(observedHigh)&&typeof observedHighDay==='string'&&
  observedHighDay>discoveryDay&&observedHigh>baseline;
 return [
  candidate('SUPPORT','최근 저점','발견일 이전 10거래일 저점 −0.5%',support),
  candidate('ATR','ATR 변동성','발견가 − 발견일 ATR(14) × 2.5',atr===null?null:baseline-atr*2.5),
  candidate('MA20','20일선','발견일 20일 이동평균선 −0.5%',ma20===null?null:ma20*0.995),
  candidate('TRAILING','추적 손절선','발견일 ATR(14) × 2.5 · 이후 관측된 최고가 기준(추정)',
   trailValid&&atr!==null?observedHigh-atr*2.5:null,true)
 ];
}

export function preferredStopMethod(signals:readonly string[]):StopMethod{
 return signals.some(s=>/^(?:B(?:B|LUE)?(?:20|30|40)(?:_|$)|ENV(?:20|40)(?:_|$))/i.test(s))?'SUPPORT':'ATR';
}

/** Basket-only display rankings. No price fetching, trading rules or data writes. */
export type BasketRank='RECENT'|'GAIN_TOP'|'LOSS_TOP';
export type GainBasis='CURRENT'|'HIGH'|'LOW';
export type ObservedPrice={price:number;day:string;source:string};
export type RecentCandidate={price:number|null|undefined;day:string|null|undefined;source:string;at?:string|null;priority:number;confirmed?:boolean};
/** Compare trade dates first, then confirmed regular-session EOD, then actual
 * receipt time (not exchange execution time). Unknown time never outranks
 * known time on the same date. A discovery-day observation needs its own
 * timestamp to prove it was not received before the provisional discovery.
 */
export function chooseBasketObservation(discoveryDay:string,discoveryAt:string|undefined,candidates:RecentCandidate[],now=new Date()){
 const validDay=(v:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
 const kstDay=(ms:number)=>new Date(ms+9*3600000).toISOString().slice(0,10);
 const today=kstDay(now.getTime());
 const discoveryMs=discoveryAt?Date.parse(discoveryAt):NaN;
 const eligible=candidates.flatMap(c=>{
  const {price,day,at}=c;
  if(typeof price!=='number'||!Number.isFinite(price)||price<=0||!day||!validDay(day)||day<discoveryDay||day>today)return [];
  const received=at?Date.parse(at):NaN;
  // Later receipts of historical daily fallback may be legitimate; reject
  // receipt before the trading day and timestamps in the future.
  if(at&&(!Number.isFinite(received)||received>now.getTime()||kstDay(received)<day))return [];
  if(day===discoveryDay&&(!Number.isFinite(discoveryMs)||!Number.isFinite(received)||received<discoveryMs))return [];
  return [{price,day,source:c.source,at:at||null,priority:c.priority,confirmed:c.confirmed===true,received:Number.isFinite(received)?received:-Infinity}];
 });
 eligible.sort((a,b)=>b.day.localeCompare(a.day)||Number(b.confirmed)-Number(a.confirmed)||
   (a.received===b.received?0:b.received>a.received?1:-1)||b.priority-a.priority);
 const chosen=eligible[0];
 return chosen?{price:chosen.price,day:chosen.day,source:chosen.source,at:chosen.at}:null;
}

type HighInputs={
 discoveryDay:string;
 performance?:{quote_day?:string|null;quote_high?:number|null;
  highest_day?:string|null;highest_price?:number|null}|null;
 compared?:{period_high?:number|null;period_high_day?:string|null;period_high_source?:string|null;high_complete?:boolean}|null;
 recent?:{price:number;day:string}|null;
};

function validLaterExtreme(price:number|null|undefined,day:string|null|undefined,discoveryDay:string){
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 return typeof price==='number'&&Number.isFinite(price)&&price>0&&typeof day==='string'&&
  /^20\d{2}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&
  new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day&&day>discoveryDay&&day<=today;
}
export function confirmedTrailingHigh(high:ObservedPrice|null):ObservedPrice|null{
 return high?.source==='KRX_VERIFIED_EOD_HIGH'?high:null;
}

/** A saved price without a later observation date is not a post-discovery high. */
export function highestObservedPrice({discoveryDay,performance,compared,recent}:HighInputs):ObservedPrice|null{
 const candidates:ObservedPrice[]=[];
 const add=(price:number|null|undefined,day:string|null|undefined,source:string)=>{
  if(validLaterExtreme(price,day,discoveryDay))
   candidates.push({price:price!,day:day!,source});
 };
 // The Turso comparison already resolves KRX-versus-KIS conflicts per day.
 // Do not reintroduce an incompatible legacy maximum from another source.
 if(['KRX_VERIFIED_EOD_HIGH','KIS_TURSO_DAY_HIGH'].includes(compared?.period_high_source||'')&&
    validLaterExtreme(compared?.period_high,compared?.period_high_day,discoveryDay))
  return {price:compared!.period_high!,day:compared!.period_high_day!,source:compared!.period_high_source!};
 add(performance?.quote_high,performance?.quote_day,'장중 관측');
 add(performance?.highest_price,performance?.highest_day,'KIS 일봉');
 add(compared?.period_high,compared?.period_high_day,compared?.period_high_source||(compared?.high_complete?'수집 기간':'부분 관측'));
 add(recent?.price,recent?.day,'최근 관측 가격');
 return candidates.sort((a,b)=>b.price-a.price||a.day.localeCompare(b.day))[0]||null;
}

export function lowestObservedPrice(discoveryDay:string,compared?:{
 period_low?:number|null;period_low_day?:string|null;period_low_source?:string|null
}|null):ObservedPrice|null{
 const price=compared?.period_low,day=compared?.period_low_day;
 return validLaterExtreme(price,day,discoveryDay)?
  {price:price!,day:day!,source:compared?.period_low_source||'저가 출처 미상'}:null;
}

export function basketReturn(price:number|null|undefined,baseline:number):number|null{
 return typeof price==='number'&&Number.isFinite(price)&&price>0&&
  Number.isFinite(baseline)&&baseline>0?(price/baseline-1)*100:null;
}

/** TOP 10 means positive or negative returns only, with missing observations omitted. */
export function rankBasketRecords<T extends {day:string;code:string}>(
 records:T[],rank:BasketRank,basis:GainBasis,returnFor:(item:T,basis:GainBasis)=>number|null
):T[]{
 if(rank==='RECENT')return records;
 const metric:GainBasis=rank==='LOSS_TOP'?'CURRENT':basis;
 const scored=records.flatMap(item=>{
  const value=returnFor(item,metric);
  return value!==null&&Number.isFinite(value)&&
   (rank==='GAIN_TOP'?value>0:value<0)?[{item,value}]:[];
 });
 scored.sort((a,b)=>(rank==='GAIN_TOP'?b.value-a.value:a.value-b.value)||
  a.item.day.localeCompare(b.item.day)||a.item.code.localeCompare(b.item.code));
 return scored.slice(0,10).map(x=>x.item);
}

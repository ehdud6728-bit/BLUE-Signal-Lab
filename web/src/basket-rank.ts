/** Basket-only display rankings. No price fetching, trading rules or data writes. */
export type BasketRank='RECENT'|'GAIN_TOP'|'LOSS_TOP';
export type GainBasis='CURRENT'|'HIGH'|'LOW';
export type ObservedPrice={price:number;day:string;source:string};
type HighInputs={
 discoveryDay:string;
 performance?:{quote_day?:string|null;quote_high?:number|null;
  highest_day?:string|null;highest_price?:number|null}|null;
 compared?:{period_high?:number|null;period_high_day?:string|null;high_complete?:boolean}|null;
 recent?:{price:number;day:string}|null;
};

/** A saved price without a later observation date is not a post-discovery high. */
export function highestObservedPrice({discoveryDay,performance,compared,recent}:HighInputs):ObservedPrice|null{
 const candidates:ObservedPrice[]=[];
 const add=(price:number|null|undefined,day:string|null|undefined,source:string)=>{
  if(typeof price==='number'&&Number.isFinite(price)&&price>0&&day&&day>discoveryDay)
   candidates.push({price,day,source});
 };
 add(performance?.quote_high,performance?.quote_day,'장중 관측');
 add(performance?.highest_price,performance?.highest_day,'KIS 일봉');
 add(compared?.period_high,compared?.period_high_day,compared?.high_complete?'수집 기간':'부분 관측');
 add(recent?.price,recent?.day,'최근 관측 가격');
 return candidates.sort((a,b)=>b.price-a.price||a.day.localeCompare(b.day))[0]||null;
}

export function lowestObservedPrice(discoveryDay:string,compared?:{
 period_low?:number|null;period_low_day?:string|null;period_low_source?:string|null
}|null):ObservedPrice|null{
 const price=compared?.period_low,day=compared?.period_low_day;
 return typeof price==='number'&&Number.isFinite(price)&&price>0&&day&&day>discoveryDay?
  {price,day,source:compared?.period_low_source||'저가 출처 미상'}:null;
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

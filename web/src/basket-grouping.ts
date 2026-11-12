/** R1.5.9.5: presentation-only grouping. The originals stay independent. */
export type BasketGroup<T>={key:string;code:string;name:string;records:T[]};
export function groupBasketRecords<T extends {id:string;code:string;name:string}>(records:readonly T[],grouped=true):BasketGroup<T>[]{
 if(!grouped)return records.map(item=>({key:item.id,code:item.code,name:item.name,records:[item]}));
 const map=new Map<string,BasketGroup<T>>();
 for(const item of records){
  let group=map.get(item.code);
  if(!group){group={key:item.code,code:item.code,name:item.name,records:[]};map.set(item.code,group);}
  group.records.push(item);
 }
 return [...map.values()];
}

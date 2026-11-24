/** Deterministic factual context, not a model forecast or buy/sell signal. */
export type Flow={day:string;foreign:string|null;institution:string|null;individual:string|null};
export function flowWindow(rows:Flow[],key:'foreign'|'institution',n:number){
 const v=rows.slice(0,n),known=v.filter(x=>['BUY','SELL','FLAT'].includes(x[key]||''));
 return {observed:v.length,known:known.length,buy:known.filter(x=>x[key]==='BUY').length,sell:known.filter(x=>x[key]==='SELL').length,
  flat:known.filter(x=>x[key]==='FLAT').length,complete:known.length===n,latest:v[0]?.day??null,earliest:v.at(-1)?.day??null};
}
type Global={symbol:string;summary:{day:string;close:number;change_pct:number;change5_pct:number|null}|null};
type Market={market:string;change_pct:number;breadth_pct:number|null;flows:Flow[]};
export function marketBriefing(markets:Market[],global:Global[],stale:boolean){
 const vix=global.find(x=>x.symbol==='.VIX')?.summary??null;
 const sp=global.find(x=>x.symbol==='.SPX')?.summary??null;
 const ndx=global.find(x=>x.symbol==='.NDX')?.summary??null;
 const sox=global.find(x=>x.symbol==='.SOX')?.summary??null;
 const same=!!vix&&!!sp&&!!ndx&&vix.day===sp.day&&sp.day===ndx.day;
 const broadUp=markets.length===2&&markets.every(m=>m.change_pct>0&&m.breadth_pct!==null&&m.breadth_pct>=55);
 const broadDown=markets.length===2&&markets.every(m=>m.change_pct<0&&m.breadth_pct!==null&&m.breadth_pct<=45);
 const flowUp=markets.length===2&&markets.every(m=>{const f=flowWindow(m.flows,'foreign',3);return f.complete&&f.buy>=2;});
 const flowDown=markets.length===2&&markets.every(m=>{const f=flowWindow(m.flows,'foreign',3);return f.complete&&f.sell>=2;});
 const usUp=same&&sp!.change_pct>0&&ndx!.change_pct>0&&vix!.change_pct<0;
 const usDown=same&&sp!.change_pct<0&&ndx!.change_pct<0&&vix!.change_pct>0;
 const scenario=stale||!same?'HOLD':broadUp&&flowUp&&usUp?'REBOUND_OBSERVATION':broadDown&&flowDown&&usDown?'DECLINE_OBSERVATION':'MIXED';
 return {vix,sp,ndx,sox,same,broadUp,broadDown,flowUp,flowDown,usUp,usDown,scenario};
}

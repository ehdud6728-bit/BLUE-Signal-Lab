export type DirectionRow={window:number;actual_sessions:number;covered_sessions:number;horizon:number;pattern:string;direction:'UPSIDE'|'DOWNSIDE';status:string;train:{n:number;up_pct:number|null;median_pct:number|null;loss_5_pct:number|null};train_base:{n:number;up_pct:number|null};holdout:{n:number;up_pct:number|null};holdout_lift_pp:number|null};
const shapes=new Set(['BULL','BEAR','LONG_BULL','LONG_BEAR','DOJI','LOWER_WICK','UPPER_WICK','FLAT']);
export function withinPattern(data:unknown,signals:string[],features:unknown){
 if(!data||typeof data!=='object'||!Array.isArray(features))return null;
 const d=data as {asof:string;rows:DirectionRow[]};
 if(!Array.isArray(d.rows)||!/^\d{4}-\d{2}-\d{2}$/.test(d.asof))return null;
 // Only exact audited candle features are currently supplied by the search API.
 // Never infer turnover or market conditions from candle shape.
 const eligible=d.rows.filter(r=>{const [base,shape,...rest]=r.pattern.split('|');return rest.length===0&&shapes.has(shape)&&signals.includes(base)&&features.includes(shape)&&r.train.n>=30&&r.train_base.n>=30&&r.train.up_pct!=null&&r.train_base.up_pct!=null&&r.status!=='HOLDOUT_DISAGREES';});
 const choose=(direction:DirectionRow['direction'])=>eligible.filter(r=>r.direction===direction).sort((a,b)=>Number(b.status==='HOLDOUT_AGREES_EXPLORATORY')-Number(a.status==='HOLDOUT_AGREES_EXPLORATORY')||Number(b.horizon===3)-Number(a.horizon===3)||b.actual_sessions-a.actual_sessions||b.train.n-a.train.n||a.pattern.localeCompare(b.pattern)||a.horizon-b.horizon)[0];
 return {asof:d.asof,up:choose('UPSIDE'),down:choose('DOWNSIDE')};
}

/** Match only the exact supported same-day conditions from audited EOD search.
 * Missing values are not false; provisional or stale research is not linked.
 */
export function matchesJointBases(signals:readonly string[],features:unknown,extras:Record<string,unknown>|undefined,provisional:boolean|undefined):string[]{
 if(provisional||!Array.isArray(features)||!features.includes('LONG_BULL')||features.some(x=>['FLAT','DOJI','LOWER_WICK','UPPER_WICK','LONG_BEAR','BULL','BEAR'].includes(String(x))))return [];
 const gc=extras?.rsi_gc;
 if(!(gc===true||gc===1||gc==='True'||gc==='true'||gc==='1'))return [];
 const vals=[extras?.ma20,extras?.ma40,extras?.ma60].map(x=>typeof x==='number'||typeof x==='string'&&/^\d+(?:\.\d+)?$/.test(x)?Number(x):NaN);
 if(!vals.every(x=>Number.isFinite(x)&&x>0)||!(vals[0]<vals[1]&&vals[1]<vals[2]))return [];
 return ['ENV20','ENV20_LOWER_TOUCH'].filter(x=>signals.includes(x));
}

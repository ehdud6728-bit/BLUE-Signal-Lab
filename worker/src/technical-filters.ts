/** Verified search-day trend filters. Operate on D1 extras BEFORE result paging. */
export const TECHNICAL_KEYS=['inverse','ma112','ma224'] as const;
export type TechnicalKey=typeof TECHNICAL_KEYS[number];
const safeJson="(CASE WHEN json_valid(extras_json) THEN extras_json ELSE '{}' END)";
const field=(name:string)=>`json_extract(${safeJson},'$.${name}')`;
const numeric=(name:string)=>`CAST(${field(name)} AS REAL)`;
// csv_to_d1.py serializes diagnostics through CSV, so even correctly calculated
// moving averages arrive in D1 as JSON strings (e.g. "3580.125"). Accept
// those *validated* numeric strings as well as JSON numbers. Reject arbitrary
// text and absent values before CAST, otherwise SQLite turns junk into zero.
const validNum=(name:string)=>{
 const kind=`json_type(${safeJson},'$.${name}')`;
 const value=`TRIM(CAST(${field(name)} AS TEXT))`;
 return `(${numeric(name)}>0 AND (${kind} IN ('integer','real') OR `+
   `(${kind}='text' AND ${value} GLOB '*[0-9]*' AND ${value} NOT GLOB '*[^0-9.eE+-]*')))`;
};
const clauses:Record<TechnicalKey,string>={
 inverse:`(${validNum('ma20')} AND ${validNum('ma40')} AND ${validNum('ma60')} AND ${numeric('ma20')}<${numeric('ma40')} AND ${numeric('ma40')}<${numeric('ma60')})`,
 ma112:`LOWER(CAST(json_extract(${safeJson},'$.ma112_cross') AS TEXT)) IN ('true','1')`,
 ma224:`LOWER(CAST(json_extract(${safeJson},'$.ma224_cross') AS TEXT)) IN ('true','1')`
};

export function technicalFilterWhere(raw:string,logic:string):string|null{
 const names=raw?raw.split(',').map(x=>x.trim()):[];
 if(!['any','all'].includes(logic)||names.length>TECHNICAL_KEYS.length||
    new Set(names).size!==names.length||names.some(x=>!TECHNICAL_KEYS.includes(x as TechnicalKey)))return null;
 if(!names.length)return '';
 return '('+names.map(x=>clauses[x as TechnicalKey]).join(logic==='all'?' AND ':' OR ')+')';
}

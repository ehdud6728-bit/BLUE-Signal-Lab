/** Verified search-day trend filters. Operate on D1 extras BEFORE result paging. */
export const TECHNICAL_KEYS=['inverse','ma112','ma224'] as const;
export type TechnicalKey=typeof TECHNICAL_KEYS[number];
const safeJson="(CASE WHEN json_valid(extras_json) THEN extras_json ELSE '{}' END)";
const numeric=(name:string)=>`CAST(json_extract(${safeJson},'$.${name}') AS REAL)`;
const validNum=(name:string)=>`json_type(${safeJson},'$.${name}') IN ('integer','real') AND ${numeric(name)}>0`;
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

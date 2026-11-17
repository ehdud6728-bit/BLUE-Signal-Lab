/** Isolated, read-only per-symbol diagnostics. Independent of matched signals. */
export const validAnalysisCode=(code:string)=>/^[0-9A-Z]{6}$/.test(code);
export const validAnalysisDate=(day:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(day)&&
  !Number.isNaN(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;

const storedName=(extras:string):string=>{
  try{
    const data=JSON.parse(extras||'{}') as Record<string,unknown>;
    const name=data.name||data.Name;
    return typeof name==='string'&&name.trim().length<=100?name.trim():'';
  }catch{return '';}
};

/** Best-effort search among previously matched stocks until the full directory is seeded. */
async function lookupMatchedSymbolNames(db:D1Database,q:string):Promise<Array<{code:string;name:string;market:string}>>{
  const safeJson=`CASE WHEN json_valid(extras_json) THEN extras_json ELSE '{}' END`;
  const nameExpr=`COALESCE(NULLIF(TRIM(CAST(json_extract(${safeJson},'$.name') AS TEXT)),''),
    NULLIF(TRIM(CAST(json_extract(${safeJson},'$.Name') AS TEXT)),''))`;
  const rows=await db.prepare(`SELECT code,${nameExpr} AS name,
    COALESCE(json_extract(${safeJson},'$.market'),'') AS market
    FROM signals WHERE ${nameExpr} IS NOT NULL
      AND (instr(lower(${nameExpr}),lower(?))>0 OR instr(code,upper(?))>0)
    GROUP BY code ORDER BY MAX(day) DESC LIMIT 12`).bind(q,q)
    .all<{code:string;name:string;market:string}>();
  return (rows.results||[]).filter(x=>validAnalysisCode(x.code)&&!!x.name);
}

/** Bounded, read-only name/code lookup; never relies on matched signals. */
export async function lookupSymbolDirectory(db:D1Database, query:string):Promise<Record<string,unknown>>{
  const q=query.trim();
  if(!q||q.length>40||/[\u0000-\u001f]/.test(q))return {status:'INVALID_QUERY'};
  const table=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_symbol_directory_v1'").first();
  if(!table){
    try{
      const matches=await lookupMatchedSymbolNames(db,q);
      return {status:'PARTIAL_CATALOG',results:matches,
        message:'전체 종목명 목록 저장 전입니다. 기존 검색 기록에 있는 종목부터 검색할 수 있습니다.'};
    }catch{
      return {status:'CATALOG_NOT_READY',results:[],message:'종목명 목록이 아직 설치되지 않았습니다. 종목코드는 직접 입력할 수 있습니다.'};
    }
  }
  const response=await db.prepare(`SELECT code,name,market FROM blue_symbol_directory_v1
    WHERE instr(lower(name),lower(?))>0 OR instr(code,upper(?))>0
    ORDER BY CASE WHEN code=upper(?) THEN 0
      WHEN lower(name)=lower(?) THEN 1
      WHEN substr(code,1,length(?))=upper(?) THEN 2
      WHEN substr(lower(name),1,length(?))=lower(?) THEN 3 ELSE 4 END,
      name,code LIMIT 12`)
    .bind(q,q,q,q,q,q,q,q).all<{code:string;name:string;market:string}>();
  return {status:'READY',results:response.results||[]};
}

export async function lookupSymbolAnalysis(db:D1Database,code:string,day:string):Promise<Record<string,unknown>>{
  if(!validAnalysisCode(code)||!validAnalysisDate(day))return {status:'INVALID_QUERY'};
  const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_symbol_analysis_v1'").first();
  if(!exists)return {status:'NOT_STORED',message:'정밀분석 저장소가 아직 설치되지 않았습니다. 분석 요청 후 등록됩니다.'};
  const row=await db.prepare(`SELECT run_id,source,quality_status,diagnosis_json,chart_json,stats_json,created_at_utc
    FROM blue_symbol_analysis_v1 WHERE code=? AND day=?
    ORDER BY created_at_utc DESC,run_id DESC LIMIT 1`).bind(code,day)
    .first<{run_id:string;source:string;quality_status:string;diagnosis_json:string;
      chart_json:string;stats_json:string;created_at_utc:string}>();
  if(!row)return {status:'NOT_STORED',message:'이 날짜·종목의 분석 기록이 없습니다. 분석 요청 버튼으로 생성할 수 있습니다.'};
  try{
    const diagnosis=JSON.parse(row.diagnosis_json) as Record<string,unknown>;
    if(!diagnosis.name){
      // Older isolated diagnostic records predate the name field. Resolve only
      // same-day or earlier matched names; never borrow future-day names.
      try{
        const named=await db.prepare(`SELECT extras_json FROM signals
          WHERE code=? AND day<=? ORDER BY day DESC LIMIT 1`).bind(code,day)
          .first<{extras_json:string}>();
        const resolved=storedName(named?.extras_json||'');
        if(resolved)diagnosis.name=resolved;
      }catch{/* Older databases may not have a matching source; keep code. */}
    }
    const chart=JSON.parse(row.chart_json) as {asof?:string;bars?:Array<{t:string}>}|null;
    const stats=JSON.parse(row.stats_json) as {asof?:string}|null;
    if(diagnosis.code!==code||diagnosis.asof!==day)throw Error('KEY_MISMATCH');
    if(chart&&(chart.asof!==day||!Array.isArray(chart.bars)||chart.bars.some(b=>b.t>day)))
      throw Error('FUTURE_BAR');
    if(stats&&stats.asof!==day)throw Error('FUTURE_STATS');
    return {status:'READY',code,day,diagnosis,chart,stats,
      source:row.source,quality_status:row.quality_status,stored_at:row.created_at_utc,
      message:row.quality_status==='CORPORATE_ACTION_REVIEW_REQUIRED'
        ?'과거 가격 단절·주식병합 가능성이 있어 원본 차트만 참고하세요. 통계는 보류합니다.'
        :'미수정 일봉 기반 탐색적 분석이며 실제 매매 신호로 확정되지 않았습니다.'};
  }catch{return {status:'CORRUPT_STORED_ANALYSIS',message:'저장된 분석 무결성을 확인할 수 없습니다.'};}
}

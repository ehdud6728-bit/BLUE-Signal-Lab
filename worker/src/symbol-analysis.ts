/** Isolated, read-only per-symbol diagnostics. Independent of matched signals. */
export const validAnalysisCode=(code:string)=>/^[0-9A-Z]{6}$/.test(code);
export const validAnalysisDate=(day:string)=>/^20\d{2}-\d{2}-\d{2}$/.test(day)&&
  !Number.isNaN(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;

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

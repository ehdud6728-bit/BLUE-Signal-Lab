/** Display only. No filtering, ranking, scoring or recommendation.
 * Research matched 61-bar validated histories; stored scanner flag has the
 * same oscillator formula but its history coverage is not yet parity-proven.
 */
export const SEARCH_TIP_ASOF='2026-11-27';
export const SEARCH_TIP_EVIDENCE=Object.freeze({
 horizon:5,entry:'NEXT_OPEN',cohort:1676,observed:798,yes:68,no:675,unknown:55,
 yesPeak:7.0673,noPeak:5.9049,yesMedian:4.2468,noMedian:3.5185,
 yesHit15:9,noHit15:71,yesDown10:11,noDown10:270,mature10:0
});
export function exploratorySearchTip(day:string,extras:Record<string,unknown>|undefined,provisional:boolean|undefined){
 if(provisional||!extras||!/^20\d{2}-\d{2}-\d{2}$/.test(day)||extras.slow_12_5_5_last_gc!==day)return null;
 const flag=extras.slow_12_5_5_gc;
 if(flag!==true&&flag!==1&&flag!=='1'&&flag!=='true'&&flag!=='True')return null;
 if(extras.diagnostic_status!=='R08_RESEARCH_EOD')return null;
 return {title:'연구 중 · Stoch 12·5·5 GC',retrospective:day<=SEARCH_TIP_ASOF,evidence:SEARCH_TIP_EVIDENCE};
}

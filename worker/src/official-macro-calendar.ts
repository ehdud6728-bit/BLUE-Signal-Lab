/** Reviewed official release schedule, not a live calendar feed.
 * Only scheduled times, never results or consensus estimates.
 * Refresh the reviewed snapshot after source changes; expire model use after 14 days.
 */
const REVIEWED_DAY='2026-11-25';
const VALID_THROUGH='2026-12-09';
const SOURCE={
 FED:'https://www.federalreserve.gov/newsevents/2026-december.htm',
 BLS:'https://www.bls.gov/schedule/2026/12_sched_list.htm',
 BEA:'https://www.bea.gov/news/schedule/'
} as const;
type Source=keyof typeof SOURCE;
type Event={id:string;name:string;kind:string;reference_period:string;scheduled_et:string;source:Source;meeting_et?:string};
const EVENTS:Event[]=[
 {id:'E_PCE_OCT',name:'미국 개인소득·소비지출(PCE)',kind:'INFLATION',reference_period:'2026-10',scheduled_et:'2026-11-25T08:30:00-05:00',source:'BEA'},
 {id:'E_JOLTS_OCT',name:'미국 JOLTS 구인·이직',kind:'LABOR',reference_period:'2026-10',scheduled_et:'2026-12-01T10:00:00-05:00',source:'BLS'},
 {id:'E_JOBS_NOV',name:'미국 고용보고서',kind:'LABOR',reference_period:'2026-11',scheduled_et:'2026-12-04T08:30:00-05:00',source:'BLS'},
 {id:'E_FOMC_DEC',name:'FOMC 정책 결정 예정',kind:'MONETARY_POLICY',reference_period:'2026-12',scheduled_et:'2026-12-09T14:00:00-05:00',source:'FED',meeting_et:'2026-12-08~09'},
 {id:'E_FED_PRESS_DEC',name:'연준 기자회견',kind:'MONETARY_POLICY',reference_period:'2026-12',scheduled_et:'2026-12-09T14:30:00-05:00',source:'FED',meeting_et:'2026-12-08~09'},
 {id:'E_CPI_NOV',name:'미국 소비자물가지수(CPI)',kind:'INFLATION',reference_period:'2026-11',scheduled_et:'2026-12-10T08:30:00-05:00',source:'BLS'},
 {id:'E_PPI_NOV',name:'미국 생산자물가지수(PPI)',kind:'INFLATION',reference_period:'2026-11',scheduled_et:'2026-12-15T08:30:00-05:00',source:'BLS'},
 {id:'E_PCE_NOV',name:'미국 개인소득·소비지출(PCE)',kind:'INFLATION',reference_period:'2026-11',scheduled_et:'2026-12-23T08:30:00-05:00',source:'BEA'},
 {id:'E_FOMC_MIN_DEC',name:'FOMC 의사록 공개 예정',kind:'MONETARY_POLICY',reference_period:'2026-12',scheduled_et:'2026-12-30T14:00:00-05:00',source:'FED',meeting_et:'2026-12-08~09'}
];
export function officialMacroCalendar(now=new Date()){
 const today=new Date(now.getTime()+32400000).toISOString().slice(0,10);
 const status=today<REVIEWED_DAY?'NOT_AVAILABLE':today>VALID_THROUGH?'REVIEW_REQUIRED':'REVIEWED_SCHEDULE';
 const until=now.getTime()+45*86400000;
 const events=status==='NOT_AVAILABLE'?[]:EVENTS.filter(e=>Date.parse(e.scheduled_et)>now.getTime()&&Date.parse(e.scheduled_et)<=until)
 .map(e=>({...e,scheduled_utc:new Date(e.scheduled_et).toISOString(),source_url:SOURCE[e.source],status:'SCHEDULED_NOT_RESULT'}));
 return {status,reviewed_day:REVIEWED_DAY,review_required_after:VALID_THROUGH,update_mode:'MANUALLY_REVIEWED_SNAPSHOT',events,
  vix_futures:{status:'ACCESS_RIGHTS_UNVERIFIED',f1:null,f2:null,spread_points:null,spread_pct:null,structure:null,source_url:'https://www.cboe.com/markets/us/futures/market-statistics/settlement/futures/daily',terms_url:'https://www.cboe.com/terms/'}};
}

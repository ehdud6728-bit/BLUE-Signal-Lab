import type {PriceCompare} from './price-compare';
import {sourceName} from './price-compare';
import './r1593-price-compare.css';

const cash=(n:number|null|undefined)=>typeof n==='number'&&Number.isFinite(n)&&n>0?n.toLocaleString('ko-KR')+'원':'—';
const difference=(n:number|null|undefined,base:number|null|undefined)=>{
 if(typeof n!=='number'||typeof base!=='number'||!Number.isFinite(n)||!Number.isFinite(base)||n<=0||base<=0)return null;
 const pct=(n/base-1)*100;
 const tone=pct>0?'r1593-delta-up':pct<0?'r1593-delta-down':'r1593-delta-flat';
 return <span className={'r1593-delta '+tone}> · 발견가 대비 {pct>0?'+':''}{pct.toFixed(2)}%</span>;
};
const received=(s:string|null|undefined)=>{if(!s)return '';const d=new Date(s);return Number.isFinite(d.valueOf())?' · 수집 '+new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d):'';};
const issueLabel:Record<string,string>={
 KIS_CONFIG_MISSING:'KIS 설정 누락',
 TOKEN_VAULT_MISSING:'KIS 토큰 저장본 없음 (키·범위 확인)',
 TOKEN_EXPIRED:'KIS 토큰 만료',
 TOKEN_VAULT_INVALID_METADATA:'KIS 토큰 저장 정보 오류',
 TOKEN_DECRYPT_FAILED:'KIS 토큰 복호화 실패 (설정 확인)',
 TOKEN_VAULT_DB_UNAVAILABLE:'토큰 DB 조회 실패',
 KIS_AUTH_REJECTED:'KIS 시세 API 인증 거부',
 KIS_PRICE_RESPONSE_UNAVAILABLE:'KIS 시세 응답 확인 필요',
};
export const quoteWarning=(status:string|null|undefined,reason:string|null|undefined)=>{
 if(status==='WAITING_TOKEN')return issueLabel[reason||'']||'KIS 토큰/인증 확인 필요';
 if(status==='RETRY')return issueLabel[reason||'']||'시세 수집 재시도 예정';
 return null;
};
export default function PriceCompareMini({data,baseline,loading=false,compact=false,onRequest,requesting=false,requestDisabled=false,requestLabel='↻ 시세 갱신'}: {data?:PriceCompare;baseline?:number|null;loading?:boolean;compact?:boolean;onRequest?:()=>void;requesting?:boolean;requestDisabled?:boolean;requestLabel?:string}){
 const hasLatest=typeof data?.latest_price==='number'&&data.latest_price>0&&!!data.latest_day;
 const sameDayLatest=hasLatest&&data!.latest_day===data!.day;
 const hasHigh=typeof data?.period_high==='number'&&data.period_high>0&&!!data.period_high_day;
 const kstParts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(new Date());
 const kst=Object.fromEntries(kstParts.map(x=>[x.type,x.value]));
 const today=`${kst.year}-${kst.month}-${kst.day}`;
 // A saved quote from a prior date is not advertised as today's price.
 // Weekend or pre-open snapshots remain clearly dated without false stale alarms.
 const oldQuote=hasLatest&&['Mon','Tue','Wed','Thu','Fri'].includes(kst.weekday)&&Number(kst.hour)>=10&&String(data!.latest_day)<today;
 const showRequest=!!onRequest;
 const queueWarning=quoteWarning(data?.quote_status,data?.quote_error);
 return <div className={'r1593-compare'+(compact?' r1593-compare-compact':'')}>
  <div className="r1593-compare-line"><span>최근 확인가</span><strong>{hasLatest?cash(data!.latest_price):'—'}</strong>
   {showRequest&&<button type="button" className="r1596-inline-request" disabled={requestDisabled||requesting} onClick={e=>{e.stopPropagation();onRequest?.();}} onKeyDown={e=>e.stopPropagation()}>{requesting?'확인 중…':requestLabel}</button>}
   <small>{hasLatest?<>{data!.latest_day} 기준 · {sourceName(data!.latest_source)}{data!.latest_market?' · '+(data!.latest_market==='J'?'KRX':data!.latest_market==='NX'?'NXT':data!.latest_market):''}{received(data!.latest_at)}{sameDayLatest?' · 검색일 당일 관측 (이후 수익률 아님)':difference(data!.latest_price,baseline)}{oldQuote&&<span className="r1596-stale"> · {today} 최신 시세 미확인</span>}</>:loading?'저장 시세 조회 중':data?.status==='NO_LATER_PRICE'?'검색일 이후 검증된 시세 없음':'후속 시세 미수집'}{queueWarning&&<span className="r1596-stale"> · {queueWarning}</span>}</small></div>
  <div className="r1593-compare-line"><span>검색 이후 기간 최고가</span><strong>{hasHigh?cash(data!.period_high):'—'}</strong>
   <small>{hasHigh?<>{data!.period_high_day} · {data!.high_complete?'저장된 전 기간 확인':'확인된 구간만'}{data!.high_coverage_to?' ('+data!.high_coverage_to+'까지)':''}{difference(data!.period_high,baseline)}</>:loading?'고가 조회 중':'기간 고가 미확인'}</small></div>
 </div>;
}

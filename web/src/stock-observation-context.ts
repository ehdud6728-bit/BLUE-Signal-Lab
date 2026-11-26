/** Interpret only existing discovery-day fields. No calls, prediction,
 * scoring, position recommendation or inference from missing indicators.
 */
type Fields=Record<string,unknown>|undefined;
const number=(x:unknown):number|null=>{
 if(typeof x!=='number'&&(typeof x!=='string'||!x.trim()))return null;
 const v=Number(x);return Number.isFinite(v)?v:null;
};
const positive=(x:unknown)=>{const v=number(x);return v!==null&&v>0?v:null;};
const boolean=(x:unknown):boolean|null=>{
 if(x===true||x===1||x==='1'||x==='true'||x==='True')return true;
 if(x===false||x===0||x==='0'||x==='false'||x==='False')return false;
 return null;
};
export function stockObservationContext(extras:Fields,referencePrice:number|null|undefined){
 const e=extras||{};
 const ma=[positive(e.ma20),positive(e.ma40),positive(e.ma60)];
 const trend=ma.every(x=>x!==null)?(ma[0]!<ma[1]!&&ma[1]!<ma[2]!?'역배열':ma[0]!>ma[1]!&&ma[1]!>ma[2]!?'정배열':'혼재'):'미계산';
 const amount=number(e.traded_amount_krw),r=number(e.amount_ratio20);
 const amountRatio=amount!==null&&amount>=0&&r!==null&&r>=0&&((amount===0)===(r===0))?r:null;
 const turnover=amountRatio===null?'미확인':amountRatio.toFixed(2)+'배 · '+(amountRatio<1?'평균 미만':amountRatio>1?'평균 초과':'평균 수준');
 const rawRsi=number(e.rsi),rsi=rawRsi!==null&&rawRsi>=0&&rawRsi<=100?rawRsi:null;
 const crosses=[['RSI',boolean(e.rsi_gc)],['Slow',boolean(e.slow_14_3_3_gc)],['MACD',boolean(e.macd_gc)]] as const;
 const occurred=crosses.filter(x=>x[1]===true).map(x=>x[0]);
 const unknown=crosses.filter(x=>x[1]===null).map(x=>x[0]);
 const momentum=(occurred.length?occurred.join('·')+' GC 발생':unknown.length?'확인된 GC 없음':'당일 GC 없음')+(unknown.length?' · '+unknown.join('·')+' 미계산':'');
 const reference=positive(referencePrice),supplyPrice=positive(e.supply_reference_price);
 const grade=e.supply_strength_grade;
 const supply=e.supply_strength_method==='DAILY_HL_UNIFORM_120_V2'&&supplyPrice!==null&&typeof grade==='string'&&['강','중','약'].includes(grade)?{grade,price:supplyPrice,distancePct:reference===null?null:100*(supplyPrice/reference-1)}:null;
 const checks:string[]=[];
 if(trend==='역배열')checks.push('하락 배열 완화 여부');
 else if(trend==='미계산')checks.push('이동평균 배열 확인');
 if(amountRatio===null)checks.push('거래대금 확인');
 else if(amountRatio<1)checks.push('거래대금 회복 여부');
 if(!occurred.length)checks.push('골든크로스 추가 확인');
 if(supply)checks.push('추정 매물대 기준가 주변의 종가·거래대금 확인');
 const headline=trend==='역배열'?(occurred.length?'역배열 속 단기 모멘텀 개선 관측':'역배열 · 추세 회복 미확인'):trend==='정배열'?(occurred.length?'정배열 · 단기 GC 동반':'정배열 · 추가 움직임 확인'):trend==='혼재'?'이평 배열 혼재 · 방향 확인 필요':'이평 자료 부족 · 추세 판단 보류';
 const explanation=trend==='역배열'&&occurred.length?'골든크로스가 발생했지만 이동평균 배열 전환이나 반등 지속을 확인한 것은 아닙니다.':trend==='정배열'?'이평 정배열은 신호일의 관측이며 추가 상승을 보장하지 않습니다.':'확정된 배열 및 지표만 설명하며 현재 시세 방향을 추정하지 않습니다.';
 const scenarios=supply&&reference!==null?[
  '상승 시: 추정 매물대 '+Math.round(supply.price).toLocaleString('ko-KR')+'원 주변 종가 유지 및 거래대금 확인.',
  '눌림 시: 신호 기준가 '+Math.round(reference).toLocaleString('ko-KR')+'원 및 추정 매물대 주변 반응 관찰.',
  '이탈 시: 기존 가격대 회복 여부 확인. 검증된 손절가 아님.'
 ]:['가격 기준 확인 후 지지·저항 유지 여부 관찰.'];
 return {trend,turnover,amountRatio,rsi,momentum,supply,checks,headline,explanation,scenarios};
}

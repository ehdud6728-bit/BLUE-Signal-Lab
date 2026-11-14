import {ChevronDown} from 'lucide-react';
import type {BasketSupplyRecord,BasketSupplyOutlook} from './basket-supply-record';
import './basket-supply-record.css';

const cash=(v:number|null)=>v===null?'—':Math.round(v).toLocaleString('ko-KR')+'원';
const shares=(v:number|null)=>v===null?'—':Math.round(v).toLocaleString('ko-KR')+'주';
const percent=(v:number|null)=>v===null?'—':v.toFixed(v<10?2:1)+'%';
const outlook=(v:BasketSupplyOutlook|undefined,days:number)=>{
 if(!v)return <p className="r15113-supply-empty">{days}일 참고 전망은 저장된 당시 분석에 없습니다.</p>;
 if(v.breakout===null||v.pullback===null||v.undecided===null)return <p className="r15113-supply-empty">{days}거래일: {v.direction||'정성적 방향만 가능'} · 표본 {v.basisN}건</p>;
 return <div className="r15113-outlook-row"><strong>{days}거래일</strong><span>돌파 {percent(v.breakout)}</span><span>눌림 {percent(v.pullback)}</span><span>미정 {percent(v.undecided)}</span><small>신뢰도 {v.confidence} · 유사 사례 {v.basisN}건 · 미검증 참고 추정</small></div>;
};
export default function BasketSupplyRecordRow({record,day,baseline,note,loading,onFetch,onNoteChange}:{
 record?:BasketSupplyRecord;day:string;baseline:number;note:string;loading:boolean;
 onFetch:()=>void;onNoteChange:(text:string)=>void;
}){
 const isReady=record?.status==='READY';
 const isPartial=record?.status==='PARTIAL';
 const hasZone=record?.low!=null&&record.high!=null&&record.low>0&&record.high>0;
 const zone=hasZone?record.low===record.high?cash(record.low):`${cash(record.low)}~${cash(record.high)}`:'매물대 미확인';
 return <details className="r15113-supply-record">
   <summary className="r15113-supply-summary">
     <span className="r15113-supply-label">매물대 기록</span>
     <strong>{loading&&!record?'기록 중…':zone}</strong>
     {hasZone&&<span className={'r15113-supply-grade '+(record?.grade==='강'?'strong':record?.grade==='중'?'medium':'weak')}>{record?.grade}</span>}
     <span className="r15113-supply-toggle">상세 <ChevronDown size={13}/></span>
   </summary>
   <div className="r15113-supply-body">
     <p className="r15113-supply-meta">발견일 {day} · 당시 기준 종가 {cash(baseline)} · {record?'저장 시각 '+new Date(record.capturedAt).toLocaleString('ko-KR'):'미기록'}</p>
     {hasZone?<>
       <div className="r15113-supply-grid">
         <div><span>상단 매물대</span><b>{zone}</b></div>
         <div><span>밀집 강도</span><b>{record?.grade||'미확인'} · 최대 구간 대비 {percent(record?.relativePct??null)}</b></div>
         <div><span>구간 추정 누적 거래량</span><b>{shares(record?.volume??null)}</b></div>
         <div><span>전체 120일 거래량 비중</span><b>{percent(record?.sharePct??null)}</b></div>
         <div><span>최대 거래량 구간(POC)</span><b>{cash(record?.poc??null)}</b></div>
         <div><span>데이터 출처</span><b>{isReady?'발견일 저장 일봉':isPartial?'검색 당시 기록(일부)':'미확인'}</b></div>
       </div>
       {Boolean(record?.bins.length)&&<div className="r15113-supply-bins"><b>상단 가격대별 추정 거래량</b>{record!.bins.map((x,i)=><div className="r15113-supply-bin" key={`${i}:${x.price}`}><span>{cash(x.price)}</span><div><i style={{width:`${Math.min(100,x.relative_pct)}%`}}/></div><small>{Math.round(x.relative_pct)}% · {shares(x.volume_shares)}</small></div>)}</div>}
       <div className="r15113-supply-outlooks"><b>담을 당시 5·10일 매물대 참고 전망</b>
         {outlook(record?.outlook5,5)}{outlook(record?.outlook10,10)}
       </div>
     </>:<p className="r15113-supply-empty">당시 날짜에 검증된 상단 매물대가 없거나 차트 자료가 부족합니다. 임의 가격은 기록하지 않습니다.</p>}
     {!isReady&&<button type="button" className="r15113-supply-retry" disabled={loading} onClick={onFetch}>{loading?'당시 차트 확인 중…':'당시 매물대 기록 가져오기'}</button>}
     <label className="r15113-supply-note">내 매물대 관찰 메모
       <textarea maxLength={400} rows={2} placeholder="예: 상단 매물대 재돌파 확인, 거래량 증가, 눌림 기준 등" value={note} onChange={e=>onNoteChange(e.target.value)}/>
     </label>
     <small className="r15113-supply-foot">이 기록은 발견일 확정 일봉을 기준으로 저장되며 이후 시세에 따라 자동 변경되지 않습니다. 일봉 고가~저가 거래량 균등 배분 추정이며 실제 남은 매도 물량이 아닙니다. 돌파·눌림 비율도 검증된 예측 확률이 아닙니다. 메모와 기록은 장바구니 JSON 백업에 포함됩니다.</small>
   </div>
 </details>;
}

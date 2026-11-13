import type {SupplyProfile,SupplyBin} from './supply-profile';
import './supply-profile-panel.css';

const shares=(n:number)=>n.toLocaleString('ko-KR')+'주';
const price=(n:number)=>Math.round(n).toLocaleString('ko-KR')+'원';
function gradeClass(b:SupplyBin){return b.grade==='강'?'strong':b.grade==='중'?'medium':b.grade==='약'?'weak':'low';}
export default function SupplyProfilePanel({profile}:{profile:SupplyProfile|null}){
  return <section className="blue-supply-panel" aria-label="가격대별 추정 거래량 분포">
    <div className="blue-supply-heading"><strong>가격대별 추정 거래량</strong><small>이전 120거래일 · 일봉 기반</small></div>
    {!profile&&<p className="blue-supply-warning">계산에 필요한 이전 일봉 100개 이상이 없습니다. 임의 물량은 표시하지 않습니다.</p>}
    {profile&&<>
      <div className="blue-supply-summary">
        <div><span>상단 밀집 구간</span><b>{profile.reference?`${price(profile.reference.low)}~${price(profile.reference.high)}`:'뚜렷한 상단 구간 없음'}</b></div>
        <div><span>물량 집중도</span><b className={profile.reference?'blue-supply-'+gradeClass(profile.reference):''}>{profile.reference?profile.reference.grade:'미확인'}</b></div>
        <div><span>해당 구간 추정 거래량</span><b>{profile.reference?shares(profile.reference.volume_shares):'—'}</b></div>
        <div><span>전체 거래량 중 비중</span><b>{profile.reference?profile.reference.share_pct.toFixed(2)+'%':'—'}</b></div>
        <div><span>최대 구간 대비</span><b>{profile.reference?profile.reference.relative_pct.toFixed(1)+'%':'—'}</b></div>
        <div><span>최다 거래량 구간(POC)</span><b>{price(profile.pocPrice)}</b></div>
      </div>
      {profile.bins.length>0&&<div className="blue-supply-bars">
        <div className="blue-supply-bar-heading">현재 종가 위 가격대 · 가까운 순</div>
        {profile.bins.map((b,i)=><div className="blue-supply-bar-row" key={`${b.price}-${i}`}>
          <span className="blue-supply-bar-price">{price(b.price)}</span>
          <div className="blue-supply-bar-track"><div className={'blue-supply-bar-fill blue-supply-'+gradeClass(b)} style={{width:`${Math.max(1,b.relative_pct)}%`}}/></div>
          <strong>{b.relative_pct.toFixed(0)}%</strong>
        </div>)}
      </div>}
      <p className="blue-supply-footnote">등급은 최대 거래량 가격대 대비 강 75%↑ · 중 50%↑ · 약 25%↑입니다. 각 일봉 거래량을 그날 고가~저가 구간에 균등 분배해 추정했습니다. <b>실제 체결가격별 물량이나 현재 매도 잔량이 아니며, 돌파·반락 확률도 아닙니다.</b></p>
    </>}
  </section>;
}

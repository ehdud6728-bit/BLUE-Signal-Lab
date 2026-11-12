import {useEffect,useRef,useState} from 'react';
import {CandlestickSeries,HistogramSeries,LineSeries,createChart,createSeriesMarkers, type IChartApi, type Time} from 'lightweight-charts';
import './stock-chart.css';

const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
type Bar={t:string;o:number;h:number;l:number;c:number;v:number;r:number|null;rs:number|null;sk:number|null;sd:number|null;m:number|null;ms:number|null;env20:number|null;env40:number|null;bb40:number|null;ma112?:number|null;ma224?:number|null};
type CaseRow={signal_day:string;entry_day:string;exit_day:string;return_pct:number};
type Horizon={n:number;up_pct:number|null;down_pct:number|null;mean_return_pct:number|null;median_return_pct:number|null;mean_mae_pct:number|null;mean_mfe_pct:number|null;small_sample:boolean;holdout?:{n:number;up_pct:number;mean_return_pct:number}|null;cases?:CaseRow[]};
type Setup={code:string;label:string;factors:string[];factor_count:number;total_signals_seen:number;horizons:Record<string,Horizon>;quality:'EXPLORATORY'|'INSUFFICIENT_SAMPLE';up_lift_vs_baseline_10d_pp:number|null};
type Stats={version:string;asof:string;status:string;history_start:string|null;history_end:string;method?:string;limitations?:string[];active_factors?:{code:string;label:string}[];candidate_count?:number;eligible_candidate_count?:number;baseline?:Record<string,Horizon>;sector_lag?:{status:string;reason?:string};setups:Setup[]};
type Payload={status:string;chart?:{bars:Bar[];asof:string};stats?:Stats;message?:string};
type LineCandidate={signal:string;price:number};
type Props={code:string;day:string;name:string;supplyPrice?:number|null;supplyGrade?:string;lineCandidates?:LineCandidate[];highlightThreshold?:number|null;highlightSamplesMin?:number};

function useChartResize(container:React.RefObject<HTMLDivElement|null>, fn:(element:HTMLDivElement)=>IChartApi, deps:unknown[]){
  useEffect(()=>{
    const el=container.current;if(!el)return;
    const chart=fn(el);
    const obs=new ResizeObserver(entries=>{for(const e of entries){
      if(e.contentRect.width>0)chart.applyOptions({width:Math.max(280,Math.floor(e.contentRect.width))});
    }});
    obs.observe(el);
    return ()=>{obs.disconnect();chart.remove();};
  // Only rerender on new immutable bar snapshot or chart selection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },deps);
}
const time=(d:string):Time=>d as Time;
function mk(el:HTMLDivElement,height:number){return createChart(el,{width:Math.max(280,el.clientWidth),height,
  layout:{background:{color:'#ffffff'},textColor:'#74829a',fontSize:10},
  grid:{vertLines:{color:'#f2f5fa'},horzLines:{color:'#f2f5fa'}},
  timeScale:{borderColor:'#dde6f2',timeVisible:false,fixLeftEdge:true,fixRightEdge:true},
  rightPriceScale:{borderColor:'#e2e9f3'},
  crosshair:{vertLine:{color:'#b1c8ed'},horzLine:{color:'#b1c8ed'}}});}

function PriceChart({bars,day,supplyPrice,lineCandidates}:{bars:Bar[];day:string;supplyPrice?:number|null;lineCandidates?:LineCandidate[]}){
  const ref=useRef<HTMLDivElement>(null);
  // Keep the important moving averages visible, but hide the far-away BLUE40
  // band and multiple static price levels until selected. This protects the
  // candle scale on a narrow phone screen.
  const [layers,setLayers]=useState({env20:true,env40:true,ma112:false,ma224:false,bb40:false,supply:false,candidates:false});
  const toggle=(k:keyof typeof layers)=>setLayers(v=>({...v,[k]:!v[k]}));
  const last=bars[bars.length-1];
  const fmt=(n:number|null|undefined)=>n==null||!Number.isFinite(n)?'—':Math.round(n).toLocaleString('ko-KR')+'원';
  const candidates=(lineCandidates||[]).filter(x=>Number.isFinite(x.price)&&x.price>0).slice(0,3);
  useChartResize(ref,el=>{
    const chart=mk(el,300);
    const candles=chart.addSeries(CandlestickSeries,{upColor:'#e34055',downColor:'#2671e8',borderVisible:false,
      wickUpColor:'#e34055',wickDownColor:'#2671e8',priceLineVisible:false});
    candles.setData(bars.map(b=>({time:time(b.t),open:b.o,high:b.h,low:b.l,close:b.c})));
    if(bars.some(b=>b.t===day))createSeriesMarkers(candles,[{time:time(day),position:'belowBar',shape:'arrowUp',color:'#245fe2',text:''}]);
    const addLevel=(p:number,color:string)=>{
      if(p>0) candles.createPriceLine({price:p,color,title:'',axisLabelVisible:false,
        lineWidth:1,lineStyle:2});
    };
    if(layers.supply&&supplyPrice!=null&&supplyPrice>0)addLevel(supplyPrice,'#e5a13c');
    if(layers.candidates)candidates.forEach((x,i)=>addLevel(x.price,['#2262df','#5f87e3','#90b1f5'][i]));
    for(const [field,color,enabled] of [
      ['env20','#21a786',layers.env20],['env40','#845bd6',layers.env40],
      ['ma112','#d65d64',layers.ma112],['ma224','#af5da3',layers.ma224],['bb40','#f28d2f',layers.bb40]
    ] as const){
      if(!enabled)continue;
      const line=chart.addSeries(LineSeries,{color,lineWidth:2,priceLineVisible:false,lastValueVisible:false});
      line.setData(bars.filter(b=>b[field]!=null).map(b=>({time:time(b.t),value:b[field]!})));
    }
    chart.timeScale().fitContent();return chart;
  },[bars,day,supplyPrice,lineCandidates,layers.env20,layers.env40,layers.ma112,layers.ma224,layers.bb40,layers.supply,layers.candidates]);
  return <>
    <div className="blue-chart-label">일봉 캔들 · 표시할 선 선택</div>
    <div className="blue-layer-tools" role="group" aria-label="캔들 차트 선 표시 설정">
      <button type="button" aria-pressed={layers.env20} className={layers.env20?'on':''} onClick={()=>toggle('env20')}><i style={{background:'#21a786'}}/>ENV20</button>
      <button type="button" aria-pressed={layers.env40} className={layers.env40?'on':''} onClick={()=>toggle('env40')}><i style={{background:'#845bd6'}}/>ENV40</button>
      <button type="button" aria-pressed={layers.ma112} className={layers.ma112?'on':''} onClick={()=>toggle('ma112')}><i style={{background:'#d65d64'}}/>112일선</button>
      <button type="button" aria-pressed={layers.ma224} className={layers.ma224?'on':''} onClick={()=>toggle('ma224')}><i style={{background:'#af5da3'}}/>224일선</button>
      <button type="button" aria-pressed={layers.bb40} className={layers.bb40?'on':''} onClick={()=>toggle('bb40')}><i style={{background:'#f28d2f'}}/>BLUE40 상단</button>
      {supplyPrice!=null&&supplyPrice>0&&<button type="button" aria-pressed={layers.supply} className={layers.supply?'on':''} onClick={()=>toggle('supply')}><i style={{background:'#e5a13c'}}/>추정 매물대</button>}
      {candidates.length>0&&<button type="button" aria-pressed={layers.candidates} className={layers.candidates?'on':''} onClick={()=>toggle('candidates')}><i style={{background:'#2262df'}}/>돌파선 후보</button>}
    </div>
    <div ref={ref} className="blue-chart-canvas" aria-label="선택한 가격선이 표시된 실제 과거 캔들 차트"/>
    <div className="blue-chart-legend" aria-label="가격선 범례 및 설명">
      <div><i style={{background:'#21a786'}}/><span><b>ENV20</b> · 최근 20거래일 종가 평균</span><strong>{fmt(last?.env20)}</strong></div>
      <div><i style={{background:'#845bd6'}}/><span><b>ENV40</b> · 최근 40거래일 종가 평균</span><strong>{fmt(last?.env40)}</strong></div>
      <div><i style={{background:'#d65d64'}}/><span><b>112일선</b> · 112거래일 종가 평균</span><strong>{fmt(last?.ma112)}</strong></div>
      <div><i style={{background:'#af5da3'}}/><span><b>224일선</b> · 224거래일 종가 평균</span><strong>{fmt(last?.ma224)}</strong></div>
      <div><i style={{background:'#f28d2f'}}/><span><b>BLUE40 상단</b> · 40일 평균+2σ, 26거래일 이전 값 기준의 이동 밴드</span><strong>{fmt(last?.bb40)}</strong></div>
      {supplyPrice!=null&&supplyPrice>0&&<div><i style={{background:'#e5a13c'}}/><span><b>상단 매물대 중심</b> · 120봉 대표가격·거래량 추정 (실제 호가 매물대 아님)</span><strong>{fmt(supplyPrice)}</strong></div>}
      {candidates.length>0&&<div className="blue-chart-candidate-legend"><i style={{background:'#2262df'}}/><span><b>돌파 기준선 후보</b> · 당일 관측값, 추세선 유효성 미검증</span><strong>{candidates.map(x=>`${x.signal}: ${fmt(x.price)}`).join(' / ')}</strong></div>}
    </div>
    <p className="blue-chart-hint">상단의 버튼으로 선을 켜고 끌 수 있습니다. BLUE40 상단처럼 현재가와 먼 선은 캔들이 작게 보이는 문제를 막기 위해 기본적으로 숨깁니다. 가격 라벨은 차트 밖의 범례에 표시합니다.</p>
  </>;
}
function IndicatorChart({bars,type}:{bars:Bar[];type:'volume'|'rsi'|'slow'|'macd'}){
  const ref=useRef<HTMLDivElement>(null);
  useChartResize(ref,el=>{
    const chart=mk(el,type==='volume'?90:125);
    if(type==='volume'){
      const s=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false,lastValueVisible:false});
      s.setData(bars.map(b=>({time:time(b.t),value:b.v,color:b.c>=b.o?'#e8959e':'#a2bbee'})));
    } else {
      const fields=type==='rsi'?(['r','rs'] as const):type==='slow'?(['sk','sd'] as const):(['m','ms'] as const);
      fields.forEach((field,i)=>{
        const line=chart.addSeries(LineSeries,{color:i===0?'#3369dd':'#ee9a2b',lineWidth:2,priceLineVisible:false,lastValueVisible:false});
        line.setData(bars.filter(b=>b[field]!=null).map(b=>({time:time(b.t),value:b[field]!})));
      });
      if(type==='rsi'||type==='slow'){
        const guide=chart.addSeries(LineSeries,{color:'#cbd4e2',lineWidth:1,lineStyle:2,lastValueVisible:false,priceLineVisible:false});
        guide.setData(bars.map(b=>({time:time(b.t),value:50})));
      }
    }
    chart.timeScale().fitContent();return chart;
  },[bars,type]);
  const meta=({volume:['거래량',''],rsi:['RSI(14) · 시그널(9)','파랑: RSI / 주황: 시그널'],slow:['Slow Stochastic(14,3,3)','파랑: %K / 주황: %D'],macd:['MACD(12,26,9)','파랑: MACD / 주황: 시그널']} as const)[type];
  return <><div className="blue-chart-label blue-indicator-caption"><span>{meta[0]}</span><small>{meta[1]}</small></div><div ref={ref} className="blue-chart-canvas"/></>;
}
function Evidence({stats,highlightThreshold,highlightSamplesMin}:{stats:Stats;highlightThreshold:number|null;highlightSamplesMin:number}){
  const [days,setDays]=useState<'5'|'10'|'20'>('10');
  const base=stats.baseline?.[days];
  return <div className="blue-evidence">
    <div className="blue-evidence-head"><h4>다중 조건 과거 패턴 검증</h4>
      <div className="blue-horizons">{(['5','10','20'] as const).map(x=><button type="button" key={x} className={days===x?'selected':''} onClick={()=>setDays(x)}>{x}거래일</button>)}</div>
    </div>
    <p className="blue-chart-info">{stats.history_start}~{stats.history_end} · 당일 관측된 돌파/교차 신호 + 거래량·추세·모멘텀·매물대 조건을 자동 조합합니다. 다음 거래일 시가부터 {days}거래일째 종가까지 비교합니다.</p>
    {(stats.active_factors||[]).length>0&&<div className="blue-active-factors">{stats.active_factors!.map(a=><span key={a.code}>{a.label}</span>)}</div>}
    {base&&<p className="blue-chart-info">같은 종목의 단순 거래일 기준선 ({days}거래일): 표본 {base.n}건 · 상승 {base.up_pct==null?'—':base.up_pct+'%'} · 평균 수익률 {base.mean_return_pct==null?'—':base.mean_return_pct+'%'}. 시장·업종 벤치마크는 아닙니다.</p>}
    <p className="r159-order-note">상승 비율 → 중앙 수익률 → 평균 수익률 순 · 선택한 최소 표본 수 우선 · 3~7건은 소표본 주의 · 과거 사례를 눌러 날짜 확인</p>
    {stats.setups.length?<div className="r159-pattern-list">{[...stats.setups].sort((a,b)=>{
      const x=a.horizons[days],y=b.horizons[days];
      const validX=x.n>=highlightSamplesMin&&x.up_pct!==null,validY=y.n>=highlightSamplesMin&&y.up_pct!==null;
      return Number(validY)-Number(validX)||(y.up_pct??-1)-(x.up_pct??-1)||
        (y.median_return_pct??-10000)-(x.median_return_pct??-10000)||
        (y.mean_return_pct??-10000)-(x.mean_return_pct??-10000)||y.n-x.n;
    }).map(s=>{const x=s.horizons[days];const hot=highlightThreshold!==null&&x.n>=highlightSamplesMin&&x.up_pct!==null&&x.up_pct>=highlightThreshold;
      return <details className={'r159-pattern-card'+(hot?' r159-tomato':'')} key={s.code}>
        <summary>
          <span className="r159-pattern-left"><strong>{s.label}</strong>
            <small>{x.n}건 · {x.n<8?'표본 부족':'탐색적 과거 관측'} · 눌러서 날짜 보기</small></span>
          <span className="r159-pattern-score"><small>상승 비율</small>
            <b>{x.up_pct===null?'—':x.up_pct.toFixed(1)+'%'}</b></span>
        </summary>
        <div className="r159-pattern-detail">
          <div className="r159-returns"><span>평균 수익률 <b>{x.mean_return_pct==null?'—':x.mean_return_pct.toFixed(2)+'%'}</b></span>
            <span>중앙 수익률 <b>{x.median_return_pct==null?'—':x.median_return_pct.toFixed(2)+'%'}</b></span>
            <span>하락 비율 <b>{x.down_pct==null?'—':x.down_pct.toFixed(1)+'%'}</b></span></div>
          {x.holdout&&<p className="r159-data-note">최근 분리표본 {x.holdout.n}건 · 상승 {x.holdout.up_pct}% (독립 검증 아님)</p>}
          {x.cases?.length?<><p className="r159-data-note">과거 {x.n}건 중 최근 {x.cases.length}건 · 진입: 신호 다음 거래일 시가 / 평가: {days}거래일째 종가</p>
            <div className="r159-case-table"><table><thead><tr><th>신호 발생일</th><th>진입일</th><th>평가 종료일</th><th>수익률</th></tr></thead>
              <tbody>{x.cases.map(c=><tr key={c.signal_day}><td>{c.signal_day}</td><td>{c.entry_day}</td><td>{c.exit_day}</td>
                <td className={c.return_pct>0?'r159-positive':'r159-negative'}>{c.return_pct>0?'+':''}{c.return_pct.toFixed(2)}%</td></tr>)}</tbody></table></div></>:
            <p className="r159-data-note">이전에 저장된 분석에는 날짜별 사례가 없습니다. 해당 거래일을 재검색하고 D1에 등록해야 합니다.</p>}
        </div>
      </details>})}</div>:<p className="blue-chart-info">현재 종목의 과거 이력에서 비교 가능한 조합이 충분하지 않습니다. 신호가 유리하다고 단정할 수 없습니다.</p>}
    <p className="blue-caution">이 결과는 당일 조건을 보고 과거 사례를 찾아본 탐색적 비교입니다. 여러 조합을 시험한 선택 편향, 짧은 표본, 20거래일 결과 중첩, 수정주가·거래비용 미반영으로 인해 미래 성과를 보장하지 않습니다. 업종 대장주 선행/후발 여부는 별도 업종과 과거 시계열이 확보되기 전에는 판정하지 않습니다.</p>
  </div>;
}
export default function StockChart({code,day,name,supplyPrice,supplyGrade,lineCandidates,highlightThreshold=70,highlightSamplesMin=8}:Props){
  const [data,setData]=useState<Payload|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
  useEffect(()=>{
    const ctrl=new AbortController();setLoading(true);setData(null);setError('');
    const url=new URL(API+'/api/chart');url.searchParams.set('code',code);url.searchParams.set('date',day);
    fetch(url.toString(),{credentials:'include',cache:'no-store',signal:ctrl.signal}).then(async r=>{
      const x=await r.json() as Payload;if(!r.ok)throw new Error(x.message||`차트 API ${r.status}`);return x;
    }).then(x=>setData(x)).catch(e=>{if(!ctrl.signal.aborted)setError(String(e));}).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[code,day]);
  const hasR159Highlight=!!data?.stats?.setups?.some(s=>{
    const x=s.horizons?.['10'];return highlightThreshold!==null&&!!x&&x.n>=highlightSamplesMin&&x.up_pct!==null&&x.up_pct>=highlightThreshold;
  });
  return <section className={'blue-chart-panel'+(hasR159Highlight?' r159-tomato-stock':'')}>
    <div className="blue-chart-header"><h3>{name} · 실제 과거 일봉 차트</h3><span>종가(EOD) · {day}까지</span></div>
    {loading&&<p className="blue-chart-info">실제 일봉을 불러오고 있습니다…</p>}
    {error&&<p className="blue-chart-error">{error}</p>}
    {data?.status==='READY'&&data.chart&&<>
      <PriceChart bars={data.chart.bars} day={day} supplyPrice={supplyPrice} lineCandidates={lineCandidates}/>
      <IndicatorChart bars={data.chart.bars} type="volume"/>
      <IndicatorChart bars={data.chart.bars} type="rsi"/>
      <IndicatorChart bars={data.chart.bars} type="slow"/>
      <IndicatorChart bars={data.chart.bars} type="macd"/>
      <div className="blue-chart-note">상단 매물대: {supplyPrice==null?'미확인':supplyPrice.toLocaleString('ko-KR')+'원'} · 강도: {supplyGrade||'미확인'} (일봉 120개 기반 추정). 기준선은 검증 전 후보입니다. 모든 차트는 수정주가가 아닌 원본 시세이며 미래 날짜를 포함하지 않습니다.</div>
      {data.stats&&<Evidence stats={data.stats} highlightThreshold={highlightThreshold} highlightSamplesMin={highlightSamplesMin}/>}
      <p className="blue-attribution">차트 제공: <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts™</a></p>
    </>}
  </section>;
}

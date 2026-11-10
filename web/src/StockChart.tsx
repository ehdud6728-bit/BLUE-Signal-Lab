import {useEffect,useRef,useState} from 'react';
import {CandlestickSeries,HistogramSeries,LineSeries,createChart,createSeriesMarkers, type IChartApi, type Time} from 'lightweight-charts';
import './stock-chart.css';

const API=(import.meta.env.VITE_API_BASE||'https://blue-signal-lab-api-v2.ehdud6728.workers.dev').replace(/\/+$/,'');
type Bar={t:string;o:number;h:number;l:number;c:number;v:number;r:number|null;rs:number|null;sk:number|null;sd:number|null;m:number|null;ms:number|null;env20:number|null;env40:number|null;bb40:number|null};
type Horizon={n:number;up_pct:number|null;down_pct:number|null;mean_return_pct:number|null;median_return_pct:number|null;mean_mae_pct:number|null;mean_mfe_pct:number|null;small_sample:boolean;holdout?:{n:number;up_pct:number;mean_return_pct:number}|null};
type Setup={code:string;label:string;factors:string[];factor_count:number;total_signals_seen:number;horizons:Record<string,Horizon>;quality:'EXPLORATORY'|'INSUFFICIENT_SAMPLE';up_lift_vs_baseline_10d_pp:number|null};
type Stats={version:string;asof:string;status:string;history_start:string|null;history_end:string;method?:string;limitations?:string[];active_factors?:{code:string;label:string}[];candidate_count?:number;eligible_candidate_count?:number;baseline?:Record<string,Horizon>;sector_lag?:{status:string;reason?:string};setups:Setup[]};
type Payload={status:string;chart?:{bars:Bar[];asof:string};stats?:Stats;message?:string};
type LineCandidate={signal:string;price:number};
type Props={code:string;day:string;name:string;supplyPrice?:number|null;supplyGrade?:string;lineCandidates?:LineCandidate[]};

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
  useChartResize(ref,el=>{
    const chart=mk(el,315);
    const candles=chart.addSeries(CandlestickSeries,{upColor:'#e34055',downColor:'#2671e8',borderVisible:false,
      wickUpColor:'#e34055',wickDownColor:'#2671e8'});
    candles.setData(bars.map(b=>({time:time(b.t),open:b.o,high:b.h,low:b.l,close:b.c})));
    createSeriesMarkers(candles,[{time:time(day),position:'belowBar',shape:'arrowUp',color:'#245fe2',text:'BLUE 검색일'}]);
    const addLine=(p:number,color:string,title:string)=>{if(p>0){candles.createPriceLine({price:p,color,title,axisLabelVisible:true,lineWidth:1,lineStyle:2});}};
    if(supplyPrice!=null)addLine(supplyPrice,'#e5a13c','상단 매물대 중심(추정)');
    (lineCandidates||[]).slice(0,3).forEach(x=>addLine(x.price,'#2563eb',x.signal+' 기준선 후보'));
    for(const [field,color] of [['env20','#21a786'],['env40','#845bd6'],['bb40','#f28d2f']] as const){
      const line=chart.addSeries(LineSeries,{color,lineWidth:1,priceLineVisible:false,lastValueVisible:false});
      line.setData(bars.filter(b=>b[field]!=null).map(b=>({time:time(b.t),value:b[field]!})));
    }
    chart.timeScale().fitContent();return chart;
  },[bars,day,supplyPrice,lineCandidates]);
  return <><div className="blue-chart-label">일봉 · 캔들 / ENV20 / ENV40 / BLUE40 기준선</div><div ref={ref} className="blue-chart-canvas"/></>;
}
function IndicatorChart({bars,type}:{bars:Bar[];type:'volume'|'rsi'|'slow'|'macd'}){
  const ref=useRef<HTMLDivElement>(null);
  useChartResize(ref,el=>{
    const chart=mk(el,type==='volume'?90:125);
    if(type==='volume'){
      const s=chart.addSeries(HistogramSeries,{priceFormat:{type:'volume'},priceLineVisible:false});
      s.setData(bars.map(b=>({time:time(b.t),value:b.v,color:b.c>=b.o?'#e8959e':'#a2bbee'})));
    } else {
      const fields=type==='rsi'?(['r','rs'] as const):type==='slow'?(['sk','sd'] as const):(['m','ms'] as const);
      fields.forEach((field,i)=>{
        const line=chart.addSeries(LineSeries,{color:i===0?'#3369dd':'#ee9a2b',lineWidth:2,priceLineVisible:false});
        line.setData(bars.filter(b=>b[field]!=null).map(b=>({time:time(b.t),value:b[field]!})));
      });
      if(type==='rsi'||type==='slow'){
        const guide=chart.addSeries(LineSeries,{color:'#cbd4e2',lineWidth:1,lineStyle:2,lastValueVisible:false,priceLineVisible:false});
        guide.setData(bars.map(b=>({time:time(b.t),value:type==='rsi'?50:50})));
      }
    }
    chart.timeScale().fitContent();return chart;
  },[bars,type]);
  return <><div className="blue-chart-label">{({volume:'거래량',rsi:'RSI(14) · RSI 시그널(9)',slow:'Slow Stochastic(14,3,3) · %K/%D',macd:'MACD(12,26,9) · Signal'} as const)[type]}</div><div ref={ref} className="blue-chart-canvas"/></>;
}
function Evidence({stats}:{stats:Stats}){
  const [days,setDays]=useState<'5'|'10'|'20'>('10');
  const base=stats.baseline?.[days];
  return <div className="blue-evidence">
    <div className="blue-evidence-head"><h4>다중 조건 과거 패턴 검증</h4>
      <div className="blue-horizons">{(['5','10','20'] as const).map(x=><button type="button" key={x} className={days===x?'selected':''} onClick={()=>setDays(x)}>{x}거래일</button>)}</div>
    </div>
    <p className="blue-chart-info">{stats.history_start}~{stats.history_end} · 당일 관측된 돌파/교차 신호 + 거래량·추세·모멘텀·매물대 조건을 자동 조합합니다. 다음 거래일 시가부터 {days}거래일째 종가까지 비교합니다.</p>
    {(stats.active_factors||[]).length>0&&<div className="blue-active-factors">{stats.active_factors!.map(a=><span key={a.code}>{a.label}</span>)}</div>}
    {base&&<p className="blue-chart-info">같은 종목의 단순 거래일 기준선 ({days}거래일): 표본 {base.n}건 · 상승 {base.up_pct==null?'—':base.up_pct+'%'} · 평균 수익률 {base.mean_return_pct==null?'—':base.mean_return_pct+'%'}. 시장·업종 벤치마크는 아닙니다.</p>}
    {stats.setups.length?<div className="blue-evidence-tablewrap"><table className="blue-evidence-table"><thead><tr><th>당일 조건 조합 (최대 4개)</th><th>과거 표본</th><th>상승 / 하락</th><th>평균·중앙 수익률</th></tr></thead>
      <tbody>{stats.setups.map(s=>{const x=s.horizons[days];return <tr key={s.code}>
        <td><strong>{s.label}</strong><small>{s.quality==='INSUFFICIENT_SAMPLE'?'표본 부족 · 해석 보류':'탐색적 비교 · 확정 예측 아님'}</small></td>
        <td>{x.n}건<small>{x.holdout?`최근 분리표본 ${x.holdout.n}건`:'별도 검증 부족'}</small></td>
        <td>{x.up_pct==null?'—':x.up_pct.toFixed(1)+'%'} / {x.down_pct==null?'—':x.down_pct.toFixed(1)+'%'}</td>
        <td>{x.mean_return_pct==null?'—':x.mean_return_pct.toFixed(2)+'%'} / {x.median_return_pct==null?'—':x.median_return_pct.toFixed(2)+'%'}</td>
      </tr>;})}</tbody></table></div>:<p className="blue-chart-info">현재 종목의 과거 이력에서 비교 가능한 조합이 충분하지 않습니다. 신호가 유리하다고 단정할 수 없습니다.</p>}
    <p className="blue-caution">이 결과는 당일 조건을 보고 과거 사례를 찾아본 탐색적 비교입니다. 여러 조합을 시험한 선택 편향, 짧은 표본, 20거래일 결과 중첩, 수정주가·거래비용 미반영으로 인해 미래 성과를 보장하지 않습니다. 업종 대장주 선행/후발 여부는 별도 업종과 과거 시계열이 확보되기 전에는 판정하지 않습니다.</p>
  </div>;
}
export default function StockChart({code,day,name,supplyPrice,supplyGrade,lineCandidates}:Props){
  const [data,setData]=useState<Payload|null>(null);const [error,setError]=useState('');const [loading,setLoading]=useState(true);
  useEffect(()=>{
    const ctrl=new AbortController();setLoading(true);setData(null);setError('');
    const url=new URL(API+'/api/chart');url.searchParams.set('code',code);url.searchParams.set('date',day);
    fetch(url.toString(),{credentials:'include',cache:'no-store',signal:ctrl.signal}).then(async r=>{
      const x=await r.json() as Payload;if(!r.ok)throw new Error(x.message||`차트 API ${r.status}`);return x;
    }).then(x=>setData(x)).catch(e=>{if(!ctrl.signal.aborted)setError(String(e));}).finally(()=>{if(!ctrl.signal.aborted)setLoading(false);});
    return ()=>ctrl.abort();
  },[code,day]);
  return <section className="blue-chart-panel">
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
      {data.stats&&<Evidence stats={data.stats}/>}
      <p className="blue-attribution">차트 제공: <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts™</a></p>
    </>}
  </section>;
}

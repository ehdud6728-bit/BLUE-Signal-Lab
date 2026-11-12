#!/usr/bin/env python3
"""R1.5.9 self-contained, anchored and fail-closed installer.
Changes only research diagnostics, evidence/CSV metadata and presentation.
Never changes original BLUE signal-selection logic or KIS/live/basket code.
"""
from __future__ import annotations
import argparse
from pathlib import Path


def update(path, old, new, check_only=False):
    f = Path(path)
    if not f.is_file():
        raise SystemExit('R159_MISSING_FILE '+path)
    src = f.read_text(encoding='utf-8')
    occurrences = src.count(old)
    if occurrences != 1:
        if new in src and occurrences == 0:
            print('R159_ALREADY_PATCHED', path)
            return
        raise SystemExit(f'R159_ANCHOR_MISMATCH {path} occurrences={occurrences} anchor={old[:75]!r}')
    if not check_only:
        f.write_text(src.replace(old,new,1),encoding='utf-8')
    print('R159_CHECK' if check_only else 'R159_PATCHED',path)


def install(check_only=False):
    diag='scripts/market_scan_r08_diagnostics.py'
    update(diag,
        "def scan_r08(raw: pd.DataFrame, asof: str) -> tuple[list[dict],dict]:",
        '''def ma_event_diagnostics(rich: pd.DataFrame) -> dict:
    """R159: compare prior/current completed EOD candles only (never future bars)."""
    if len(rich)<225:
        return {'ma_down':False,'ma_up':False,'ma_to_up':False,
                'ma112_cross':False,'ma224_cross':False}
    prev,now=rich.iloc[-2],rich.iloc[-1]
    def finite(*vals):
        return all(pd.notna(v) and np.isfinite(float(v)) for v in vals)
    def up(row):
        return finite(row.ma20,row.ma40,row.ma60) and row.ma20>row.ma40>row.ma60
    def down(row):
        return finite(row.ma20,row.ma40,row.ma60) and row.ma20<row.ma40<row.ma60
    def cross(n):
        key=f'ma{n}'
        return finite(prev.close,prev[key],now.close,now[key]) and prev.close<=prev[key] and now.close>now[key]
    return {'ma_down':bool(down(now)),'ma_up':bool(up(now)),
            'ma_to_up':bool(up(now) and not up(prev)),
            'ma112_cross':bool(cross(112)),'ma224_cross':bool(cross(224))}


def scan_r08(raw: pd.DataFrame, asof: str) -> tuple[list[dict],dict]:''',check_only)
    update(diag,
        "        rich=enrich(hist)\n        r.update(macd_metrics(hist))",
        "        rich=enrich(hist)\n        r.update(ma_event_diagnostics(rich))\n        r.update(macd_metrics(hist))",check_only)

    research='scripts/chart_research_r10.py'
    update(research,
        " 'MA_UP':'중기 이동평균 상승 배열','MA_DOWN':'중기 이동평균 하락 배열',",
        " 'MA_UP':'정배열 (MA20>MA40>MA60)','MA_DOWN':'역배열 (MA20<MA40<MA60)',\n"
        " 'MA_TO_UP':'정배열 전환 (전일 미정배열 → 당일 정배열)',\n"
        " 'MA112_CROSS':'112일 이동평균선 종가 상향 돌파',\n"
        " 'MA224_CROSS':'224일 이동평균선 종가 상향 돌파',",check_only)
    update(research,
        "    f['MA_DOWN']=yes(d.ma20.lt(d.ma40)&d.ma40.lt(d.ma60))",
        "    f['MA_DOWN']=yes(d.ma20.lt(d.ma40)&d.ma40.lt(d.ma60))\n"
        "    f['MA_TO_UP']=yes(f['MA_UP'] & ~np.roll(f['MA_UP'],1))\n"
        "    f['MA_TO_UP'][0]=False\n"
        "    for nline in (112,224):\n"
        "        mline=d[f'ma{nline}']\n"
        "        f[f'MA{nline}_CROSS']=yes(d.close.shift(1).le(mline.shift(1)) & d.close.gt(mline))",check_only)
    update(research,
        "    anchors=[k for k in f if k.startswith('BB') or k.startswith('ENV') or\n"
        "             k in ('RSI_GC','RSI_DC','SLOW_14_GC','SLOW_14_DC','SLOW_12_GC','SLOW_20_GC','MACD_GC','MACD_DC','HIGH20_BREAK')]",
        "    anchors=[k for k in f if k.startswith('BB') or k.startswith('ENV') or\n"
        "             k in ('RSI_GC','RSI_DC','SLOW_14_GC','SLOW_14_DC','SLOW_12_GC','SLOW_20_GC','MACD_GC','MACD_DC','HIGH20_BREAK',\n"
        "                   'MA_TO_UP','MA112_CROSS','MA224_CROSS')]",check_only)
    update(research,
        "def backtest(history:pd.DataFrame,asof:str):",
        '''def _case_examples(d, indices, horizon, limit=12):
    """Recently completed, cooldown-deduplicated events; share entry/exit prices with outcomes.
    At most 12 examples per setup/horizon to stay below D1 statement size limits.
    """
    size=len(d)
    candidates=indices[indices+horizon<size]
    op=d.open.to_numpy(dtype=float);close=d.close.to_numpy(dtype=float)
    dates=d.date
    cases=[]
    for pos in candidates:
        start=float(op[pos+1]);finish=float(close[pos+horizon])
        if not np.isfinite(start) or not np.isfinite(finish) or start<=0:continue
        cases.append({'signal_day':str(dates.iloc[pos].date()),
                      'entry_day':str(dates.iloc[pos+1].date()),
                      'exit_day':str(dates.iloc[pos+horizon].date()),
                      'return_pct':fnum(100*(finish/start-1),2)})
    return cases[-limit:]


def backtest(history:pd.DataFrame,asof:str):''',check_only)
    update(research,
        "    anchor_now=[name for name in anchor_names if bool(f[name][-1])][:MAX_ANCHORS]",
        "    # Include rare MA transitions/crosses before the crowded BB signal family.\n"
        "    anchor_priority=('MA_TO_UP','MA112_CROSS','MA224_CROSS')\n"
        "    anchor_now=[n for n in anchor_priority if n in anchor_names and f[n][-1]]\n"
        "    anchor_now += [name for name in anchor_names if bool(f[name][-1]) and name not in anchor_now]\n"
        "    anchor_now=anchor_now[:MAX_ANCHORS]",check_only)
    update(research,
        "                    'quality':'EXPLORATORY' if n>=MIN_SUPPORT else 'INSUFFICIENT_SAMPLE'})",
        "                    'quality':'EXPLORATORY' if n>=MIN_SUPPORT else 'INSUFFICIENT_SAMPLE',\n"
        "                     '_indices':selected})",check_only)
    update(research,
        "    candidates.sort(key=lambda v:(v['quality']=='EXPLORATORY',v['factor_count'],v['horizons']['10']['n']),reverse=True)",
        '''    # R159: within the exploratory candidates, order by 10d win-rate,
    # then median/mean return; smaller than 8 cases are always ranked behind.
    candidates.sort(key=lambda v:(
        v['quality']=='EXPLORATORY',
        v['horizons']['10']['up_pct'] if v['horizons']['10']['up_pct'] is not None else -1,
        v['horizons']['10']['median_return_pct'] if v['horizons']['10']['median_return_pct'] is not None else -10000,
        v['horizons']['10']['mean_return_pct'] if v['horizons']['10']['mean_return_pct'] is not None else -10000,
        v['horizons']['10']['n'], -v['factor_count']),reverse=True)''',check_only)
    update(research,
        "        keys.add(key);selected.append(v)",
        "        keys.add(key)\n"
        "        for horizon in HORIZONS:\n"
        "            v['horizons'][str(horizon)]['cases']=_case_examples(d,v['_indices'],horizon)\n"
        "        v.pop('_indices',None)\n"
        "        selected.append(v)",check_only)
    update(research,
        "          'bb40':fnum(row.BB40_UPPER,2)})",
        "          'bb40':fnum(row.BB40_UPPER,2),\n"
        "           'ma112':fnum(row.ma112,2),'ma224':fnum(row.ma224,2)})",check_only)

    importer='scripts/csv_to_d1.py'
    update(importer,
        "def export(src,out,run_id,source,is_demo=False):",
        '''def pattern_highlights(src):
    """Optional R159 snapshot metadata, computed from the very same verified run.
    Never implies that 70% in-sample was a validated prediction.
    """
    path=Path(src)/'chart_snapshots.jsonl'
    if not path.is_file():return {}
    found={}
    for line in path.read_text(encoding='utf-8').splitlines():
        if not line.strip():continue
        item=json.loads(line)
        best=[]
        for setup in item.get('stats',{}).get('setups',[]):
            h=setup.get('horizons',{}).get('10',{})
            if h.get('n',0)>=8 and isinstance(h.get('up_pct'),(int,float)) and h['up_pct']>=70:
                best.append((h['up_pct'],h.get('median_return_pct') or 0,h.get('mean_return_pct') or 0,
                             setup.get('label',''),h['n']))
        if best:
            p,med,avg,label,n=max(best)
            found[(item['code'],item['day'])]={
                'r159_pattern_up_10d':p,'r159_pattern_n_10d':n,
                'r159_pattern_median_10d':med,'r159_pattern_mean_10d':avg,
                'r159_pattern_label_10d':label[:150]}
    return found


def export(src,out,run_id,source,is_demo=False):''',check_only)
    update(importer,
        "    seen=set()\n    for r in rows:",
        "    seen=set()\n    highlighted=pattern_highlights(src)\n    for r in rows:",check_only)
    update(importer,
        "        extras={k:v for k,v in r.items() if k not in FIELDS and v is not None}",
        "        extras={k:v for k,v in r.items() if k not in FIELDS and v is not None}\n"
        "        extras.update(highlighted.get((r['code'],d),{}))",check_only)

    chart='web/src/StockChart.tsx'
    update(chart,
        "type Horizon={n:number;up_pct:number|null;down_pct:number|null;mean_return_pct:number|null;median_return_pct:number|null;mean_mae_pct:number|null;mean_mfe_pct:number|null;small_sample:boolean;holdout?:{n:number;up_pct:number;mean_return_pct:number}|null};",
        "type CaseRow={signal_day:string;entry_day:string;exit_day:string;return_pct:number};\n"
        "type Horizon={n:number;up_pct:number|null;down_pct:number|null;mean_return_pct:number|null;median_return_pct:number|null;mean_mae_pct:number|null;mean_mfe_pct:number|null;small_sample:boolean;holdout?:{n:number;up_pct:number;mean_return_pct:number}|null;cases?:CaseRow[]};",check_only)
    update(chart,
        "type Bar={t:string;o:number;h:number;l:number;c:number;v:number;r:number|null;rs:number|null;sk:number|null;sd:number|null;m:number|null;ms:number|null;env20:number|null;env40:number|null;bb40:number|null};",
        "type Bar={t:string;o:number;h:number;l:number;c:number;v:number;r:number|null;rs:number|null;sk:number|null;sd:number|null;m:number|null;ms:number|null;env20:number|null;env40:number|null;bb40:number|null;ma112?:number|null;ma224?:number|null};",check_only)
    update(chart,
        "  const [layers,setLayers]=useState({env20:true,env40:true,bb40:false,supply:false,candidates:false});",
        "  const [layers,setLayers]=useState({env20:true,env40:true,ma112:false,ma224:false,bb40:false,supply:false,candidates:false});",check_only)
    update(chart,
        "      ['env20','#21a786',layers.env20],['env40','#845bd6',layers.env40],['bb40','#f28d2f',layers.bb40]",
        "      ['env20','#21a786',layers.env20],['env40','#845bd6',layers.env40],\n"
        "      ['ma112','#d65d64',layers.ma112],['ma224','#af5da3',layers.ma224],['bb40','#f28d2f',layers.bb40]",check_only)
    update(chart,
        "  },[bars,day,supplyPrice,lineCandidates,layers.env20,layers.env40,layers.bb40,layers.supply,layers.candidates]);",
        "  },[bars,day,supplyPrice,lineCandidates,layers.env20,layers.env40,layers.ma112,layers.ma224,layers.bb40,layers.supply,layers.candidates]);",check_only)
    update(chart,
        "      <button type=\"button\" aria-pressed={layers.env40} className={layers.env40?'on':''} onClick={()=>toggle('env40')}><i style={{background:'#845bd6'}}/>ENV40</button>",
        "      <button type=\"button\" aria-pressed={layers.env40} className={layers.env40?'on':''} onClick={()=>toggle('env40')}><i style={{background:'#845bd6'}}/>ENV40</button>\n"
        "      <button type=\"button\" aria-pressed={layers.ma112} className={layers.ma112?'on':''} onClick={()=>toggle('ma112')}><i style={{background:'#d65d64'}}/>112일선</button>\n"
        "      <button type=\"button\" aria-pressed={layers.ma224} className={layers.ma224?'on':''} onClick={()=>toggle('ma224')}><i style={{background:'#af5da3'}}/>224일선</button>",check_only)
    update(chart,
        "      <div><i style={{background:'#845bd6'}}/><span><b>ENV40</b> · 최근 40거래일 종가 평균</span><strong>{fmt(last?.env40)}</strong></div>",
        "      <div><i style={{background:'#845bd6'}}/><span><b>ENV40</b> · 최근 40거래일 종가 평균</span><strong>{fmt(last?.env40)}</strong></div>\n"
        "      <div><i style={{background:'#d65d64'}}/><span><b>112일선</b> · 112거래일 종가 평균</span><strong>{fmt(last?.ma112)}</strong></div>\n"
        "      <div><i style={{background:'#af5da3'}}/><span><b>224일선</b> · 224거래일 종가 평균</span><strong>{fmt(last?.ma224)}</strong></div>",check_only)

    old='''    {stats.setups.length?<div className="blue-evidence-tablewrap"><table className="blue-evidence-table"><thead><tr><th>당일 조건 조합 (최대 4개)</th><th>과거 표본</th><th>상승 / 하락</th><th>평균·중앙 수익률</th></tr></thead>
      <tbody>{stats.setups.map(s=>{const x=s.horizons[days];return <tr key={s.code}>
        <td><strong>{s.label}</strong><small>{s.quality==='INSUFFICIENT_SAMPLE'?'표본 부족 · 해석 보류':'탐색적 비교 · 확정 예측 아님'}</small></td>
        <td>{x.n}건<small>{x.holdout?`최근 분리표본 ${x.holdout.n}건`:'별도 검증 부족'}</small></td>
        <td>{x.up_pct==null?'—':x.up_pct.toFixed(1)+'%'} / {x.down_pct==null?'—':x.down_pct.toFixed(1)+'%'}</td>
        <td>{x.mean_return_pct==null?'—':x.mean_return_pct.toFixed(2)+'%'} / {x.median_return_pct==null?'—':x.median_return_pct.toFixed(2)+'%'}</td>
      </tr>;})}</tbody></table></div>:<p className="blue-chart-info">현재 종목의 과거 이력에서 비교 가능한 조합이 충분하지 않습니다. 신호가 유리하다고 단정할 수 없습니다.</p>}'''
    new='''    <p className="r159-order-note">상승 비율 → 중앙 수익률 → 평균 수익률 순 · 표본 8건 미만은 뒤로 · 과거 사례를 눌러 날짜 확인</p>
    {stats.setups.length?<div className="r159-pattern-list">{[...stats.setups].sort((a,b)=>{
      const x=a.horizons[days],y=b.horizons[days];
      const validX=x.n>=8&&x.up_pct!==null,validY=y.n>=8&&y.up_pct!==null;
      return Number(validY)-Number(validX)||(y.up_pct??-1)-(x.up_pct??-1)||
        (y.median_return_pct??-10000)-(x.median_return_pct??-10000)||
        (y.mean_return_pct??-10000)-(x.mean_return_pct??-10000)||y.n-x.n;
    }).map(s=>{const x=s.horizons[days];const hot=x.n>=8&&x.up_pct!==null&&x.up_pct>=70;
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
      </details>})}</div>:<p className="blue-chart-info">현재 종목의 과거 이력에서 비교 가능한 조합이 충분하지 않습니다. 신호가 유리하다고 단정할 수 없습니다.</p>}'''
    update(chart,old,new,check_only)
    update(chart,
        '  return <section className="blue-chart-panel">',
        '''  const hasR159Highlight=!!data?.stats?.setups?.some(s=>{
    const x=s.horizons?.['10'];return !!x&&x.n>=8&&x.up_pct!==null&&x.up_pct>=70;
  });
  return <section className={'blue-chart-panel'+(hasR159Highlight?' r159-tomato-stock':'')}>''',check_only)

    main='web/src/main.tsx'
    update(main,
        "// R157_UI_FILTERS\nimport './r157-ui.css';",
        "// R157_UI_FILTERS\nimport './r157-ui.css';\n// R159_MA_EVIDENCE\nimport './r159-ma-evidence.css';",check_only)
    update(main,
        "  const num=(r:Signal,k:string):number|null=>{const v=extra(r,k);if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};",
        "  const num=(r:Signal,k:string):number|null=>{const v=extra(r,k);if(v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;};\n"
        "  // The highlighted metric comes only from actual in-sample EOD pattern counts (n>=8).\n"
        "  const patternUp=(r:Signal)=>{const p=num(r,'r159_pattern_up_10d');const n=num(r,'r159_pattern_n_10d');return n!==null&&n>=8&&p!==null&&p>=70?p:null;};\n"
        "  const techFlag=(r:Signal,k:string)=>extra(r,k)===undefined?'미계산':flag(r,k)?'발생':'해당 없음';\n"
        "  const maDown=(r:Signal)=>{const a=num(r,'ma20'),b=num(r,'ma40'),c=num(r,'ma60');return a===null||b===null||c===null?'미계산':a<b&&b<c?'해당':'해당 없음';};",check_only)
    update(main,
        '''<tr key={`${r.code}-${r.day}-${i}`} className="clickable" tabIndex={0}''',
        '''<tr key={`${r.code}-${r.day}-${i}`} className={'clickable'+(patternUp(r)!==null?' r159-tomato-stock':'')} tabIndex={0}''',check_only)
    update(main,
        '''<div className="r151-mobile-row" key={`${r.code}-${r.day}-${i}`}>''',
        '''<div className={'r151-mobile-row'+(patternUp(r)!==null?' r159-tomato-stock':'')} key={`${r.code}-${r.day}-${i}`}>''',check_only)
    update(main,
        '''<div className="stock-tags">{r.signals.slice(0,4).map(s=><span className="tag" key={s}>{showSignal(s)}</span>)}{r.signals.length>4&&<span className="tag tag-more">+{r.signals.length-4}</span>}</div>''',
        '''<div className="stock-tags">{r.signals.slice(0,4).map(s=><span className="tag" key={s}>{showSignal(s)}</span>)}{r.signals.length>4&&<span className="tag tag-more">+{r.signals.length-4}</span>}{patternUp(r)!==null&&<span className="r159-prob-chip">과거 10일 상승 {patternUp(r)!.toFixed(1)}% · {num(r,'r159_pattern_n_10d')}건</span>}</div>''',check_only)
    update(main,
        '''        <h3 className="detail-section-title"><CheckCircle2 size={17}/> 돌파 기준선 후보</h3>''',
        '''        <h3 className="detail-section-title"><BarChart3 size={17}/> 이동평균 배열·돌파 (확정 일봉)</h3>
         <div className="r159-tech-grid">
           <div><b>역배열 (20&lt;40&lt;60)</b><strong>{maDown(selected)}</strong></div>
           <div><b>정배열 전환</b><strong>{techFlag(selected,'ma_to_up')}</strong></div>
           <div><b>112일선 상향 돌파</b><strong>{techFlag(selected,'ma112_cross')}</strong><small>MA112 {fmt(selected,'ma112',0)}원</small></div>
           <div><b>224일선 상향 돌파</b><strong>{techFlag(selected,'ma224_cross')}</strong><small>MA224 {fmt(selected,'ma224',0)}원</small></div>
         </div>
         <p className="r159-data-note">상향 돌파는 전일 종가가 전일 이평선 이하이고, 당일 종가가 당일 이평선을 초과한 경우입니다. 이전 분석일은 재검색해야 전환 이벤트가 표시됩니다.</p>
        <h3 className="detail-section-title"><CheckCircle2 size={17}/> 돌파 기준선 후보</h3>''',check_only)

    # Apply CSS separately: integrity checked and tracked in workflow.
    if not check_only:
        css=Path('web/src/r159-ma-evidence.css').read_text(encoding='utf-8')
        if 'R159_TOMATO_EVIDENCE' not in css:
            raise SystemExit('R159_BAD_CSS')
    print('R159_STATIC_PATCH_OK')


if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--check',action='store_true');ap.add_argument('--apply',action='store_true')
    args=ap.parse_args()
    if not args.check and not args.apply:ap.error('--check or --apply')
    install(check_only=args.check)

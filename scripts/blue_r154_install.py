#!/usr/bin/env python3
"""R1.5.4 verified UI/data provenance-only installer; no KIS/scan algorithm changes.

Fails closed whenever a production anchor differs from reviewed R1.5.3.
"""
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = 'R154_CLARITY'

class SafePatch:
    def __init__(self, rel):
        self.rel = rel
        self.path = ROOT / rel
        self.text = self.path.read_text(encoding='utf-8')
        self.old = self.text
        if MARKER in self.text:
            raise SystemExit('Already installed: ' + rel)
    def one(self, needle, replacement):
        count=self.text.count(needle)
        if count!=1:
            raise SystemExit(f'R154_ANCHOR_MISMATCH {self.rel}: {needle[:75]!r}, found={count}')
        self.text=self.text.replace(needle,replacement,1)
        return self
    def write(self,check):
        if not check:
            self.path.write_text(self.text,encoding='utf-8')
        print('R154_' + ('CHECK' if check else 'PATCH'), self.rel, 'modified=',self.old!=self.text)


def main(check):
    main=SafePatch('web/src/main.tsx')
    main.one("import './r153-performance.css';", "import './r153-performance.css';\n// R154_CLARITY: technical signal chips and verified tracking metadata.\nimport './r154-clarity.css';")

    basket=SafePatch('web/src/SmartBasket.tsx')
    basket.one(' quote_at?:string|null;quote_market?:string|null;last_error?:string|null};',
               ' quote_at?:string|null;quote_market?:string|null;last_error?:string|null;signal_names?:string|null};')
    basket.one("const statusText=(s:string)=>({QUEUED:",
'''// R154_CLARITY: distinguish original scan signals from later AI commentary.
const discoveredSignals=(stored:string[]|undefined,verified:string|null|undefined):string[]=>{
 const source=stored?.length?stored:(verified||'').split(',');
 return [...new Set(source.flatMap(s=>String(s).split(',')).map(s=>s.trim())
   .filter(s=>/^[A-Za-z0-9_\\-]{2,48}$/.test(s)).map(s=>s.replace(/^BB/i,'BLUE')))];
};
const statusText=(s:string)=>({QUEUED:''')
    basket.one('<small>R1.5.2</small></h2>', '<small>R1.5.4</small></h2>')
    basket.one('     const pr=performance[perfId(it)];',
               '     const pr=performance[perfId(it)];\n     const signalChips=discoveredSignals(it.signals,pr?.signal_names);')
    basket.one('       <strong>{it.name}</strong> <small>{it.code} · 발견가 {cash(it.baseline)}원 ({it.day})</small></div>',
               '       <strong>{it.name}</strong> <small>{it.code}</small></div>')
    basket.one('       onClick={()=>setItems(old=>old.filter(x=>x.id!==it.id))}><Trash2 size={16}/></button></div>\n     <div className="basket-record-stats r153-price-grid">',
'''       onClick={()=>setItems(old=>old.filter(x=>x.id!==it.id))}><Trash2 size={16}/></button></div>
     <div className="r154-origin-strip">
       <div className="r154-discovery-price"><span>발견가</span><strong>{cash(it.baseline)}원</strong><small>{it.day} · 확정 종가</small></div>
       <div className="r154-discovery-signals"><span>발견 당시 기술 신호</span>
         <div>{signalChips.length?signalChips.slice(0,5).map(t=><span className="r154-signal-chip" key={t}>{t}</span>):
           <small className="r154-no-signal">원본 신호 확인 불가</small>}
           {signalChips.length>5&&<small className="r154-more-signals">+{signalChips.length-5}</small>}</div>
       </div>
     </div>
     <div className="basket-record-stats r153-price-grid">''')

    # Fetch EOD signal list for existing manual/AI basket items; NEVER assume missing = no signals.
    api=SafePatch('worker/src/performance.ts')
    api.one("  const complete=x.status==='READY'||x.status==='WAITING_NEXT_SESSION';\n  out.push({code:x.code,day:x.base_day,baseline:x.baseline_close,status:x.status,",
'''  // R154_CLARITY: server-verified discovery signals, including old locally saved baskets.
  const origin=await db.prepare(`SELECT s.signal_names FROM signals s JOIN runs r ON r.run_id=s.run_id
    WHERE s.code=? AND s.day=? AND r.is_demo=0 AND r.latest_price_date=s.day
    ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1`).bind(it.code,it.day)
    .first<{signal_names:string|null}>();
  const complete=x.status==='READY'||x.status==='WAITING_NEXT_SESSION';
  out.push({code:x.code,day:x.base_day,baseline:x.baseline_close,status:x.status,
   signal_names:typeof origin?.signal_names==='string'?origin.signal_names.slice(0,240):null,''')

    collector=SafePatch('collector/src/core.mjs')
    collector.one("  await db.prepare('INSERT OR IGNORE INTO blue_kis_collector_lock_r142(id,lease_until_ms) VALUES(1,0)').run();",
'''  await db.prepare('INSERT OR IGNORE INTO blue_kis_collector_lock_r142(id,lease_until_ms) VALUES(1,0)').run();
  // R154_CLARITY: preserve first *observed* KIS collection; old 20d retained history is a lower-bound only.
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS blue_kis_first_seen_r154 (
      market TEXT NOT NULL, code TEXT NOT NULL, first_observed_at_utc TEXT NOT NULL,
      source TEXT NOT NULL, PRIMARY KEY(market,code))`).run();
    await db.prepare(`INSERT OR IGNORE INTO blue_kis_first_seen_r154(market,code,first_observed_at_utc,source)
      SELECT market,code,MIN(received_at_utc),'RETAINED_HISTORY'
      FROM blue_kis_live_history_r141 GROUP BY market,code`).run();
  } catch { console.warn('BLUE_R154_FIRST_SEEN_INIT_UNAVAILABLE'); }''')
    collector.one('    for(const stmt of batchStatements(db,quotes))await stmt.run();',
'''    for(const stmt of batchStatements(db,quotes))await stmt.run();
    // Tracking provenance is optional. Failure cannot interrupt the original quote pipeline.
    try {
      for(const q of quotes) {
        await db.prepare(`INSERT OR IGNORE INTO blue_kis_first_seen_r154
          (market,code,first_observed_at_utc,source) VALUES(?,?,?,'FIRST_COLLECTED')`)
          .bind(q.market,q.code,q.received_at_utc).run();
      }
    } catch { console.warn('BLUE_R154_FIRST_SEEN_SAVE_UNAVAILABLE'); }''')

    liveApi=SafePatch('worker/src/live.ts')
    liveApi.one('  exchange_tick_time_verified:boolean;source?:string;research_only:boolean;',
                '  exchange_tick_time_verified:boolean;source?:string;research_only:boolean;\n  tracking_started_at_utc?:string|null;tracking_start_source?:string|null;')
    liveApi.one('  const received=latest.reduce((acc,x)=>x.received_at_utc>acc?x.received_at_utc:acc,\'\');',
'''  // R154_CLARITY: first observed quote date, never substitute the EOD signal date.
  try {
    const check=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='blue_kis_first_seen_r154'").first();
    const codes=[...new Set(latest.map(x=>x.code))];
    if(codes.length){
      const seen=check ? await db.prepare(`SELECT market,code,first_observed_at_utc,source
        FROM blue_kis_first_seen_r154 WHERE code IN (${codes.map(()=>'?').join(',')})`)
          .bind(...codes).all<{market:string;code:string;first_observed_at_utc:string;source:string}>()
        : await db.prepare(`SELECT market,code,MIN(received_at_utc) AS first_observed_at_utc,
          'RETAINED_HISTORY' AS source FROM blue_kis_live_history_r141
          WHERE code IN (${codes.map(()=>'?').join(',')}) GROUP BY market,code`)
          .bind(...codes).all<{market:string;code:string;first_observed_at_utc:string;source:string}>();
      const map=new Map<string,{market:string;code:string;first_observed_at_utc:string;source:string}>(
        seen.results.map(r=>[r.market+':'+r.code,r] as const));
      for(const row of latest){const first=map.get(row.market+':'+row.code);
        if(first){row.tracking_started_at_utc=first.first_observed_at_utc;
          row.tracking_start_source=first.source;}}
    }
  } catch { /* metadata unavailable: preserve verified existing quotes */ }
  const received=latest.reduce((acc,x)=>x.received_at_utc>acc?x.received_at_utc:'');''')

    ui=SafePatch('web/src/LiveMarket.tsx')
    ui.one(' exchange_tick_time_verified:boolean;\n};',
''' exchange_tick_time_verified:boolean;
 tracking_started_at_utc?:string|null;tracking_start_source?:string|null;
};''')
    ui.one("const phaseName:Record<string,string>=",'''// R154_CLARITY: provenance-based reason, never an AI recommendation or ranking.
const signalLabels=(raw:string|null|undefined)=>[...new Set((raw||'').split(',')
 .map(s=>s.trim()).filter(s=>/^[A-Za-z0-9_\\-]{2,48}$/.test(s))
 .map(s=>s.replace(/^BB/i,'BLUE')))];
const firstDate=(stamp:string|null|undefined)=>{
 if(!stamp)return '기록 없음';
 const d=new Date(stamp);if(!Number.isFinite(d.valueOf()))return '기록 없음';
 return new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
};
const phaseName:Record<string,string>=''')
    ui.one('<h2 id="blue-live-heading"><Activity size={19}/> KIS KRX·NXT 종목 추적 <small>R1.4.1</small></h2>',
           '<h2 id="blue-live-heading"><Activity size={19}/> KIS KRX·NXT 종목 추적 <small>R1.5.4 UI</small></h2>')
    ui.one('  <div className="blue-live-summary">',
'''  <p className="r154-auto-selection-note">자동 추적 후보는 최근 검증된 검색 결과에서 종목코드 순으로 최대 12개 선정됩니다. 수익률 또는 AI 추천 순위가 아닙니다.</p>
  <div className="blue-live-summary">''')
    ui.one("    <td><strong>{q.name||q.code}</strong><small>{q.code} · {q.market_label} {phaseName[q.phase]||q.phase}</small>\n      <small>거래일 {q.reported_trade_day_matches_today===true?'일치':q.reported_trade_day_matches_today===false?'불일치':'미확인'}</small></td>",
'''    <td><strong>{q.name||q.code}</strong><small>{q.code} · {q.market_label} {phaseName[q.phase]||q.phase}</small>
      <small className="r154-track-dates">추적 최초 확인 {firstDate(q.tracking_started_at_utc)}{q.tracking_start_source==='RETAINED_HISTORY'?' (보관 기록 기준)':''}</small>
      <small className="r154-track-dates">신호 기준일 {q.eod_asof||'미확인'} · 거래일 {q.reported_trade_day_matches_today===true?'일치':q.reported_trade_day_matches_today===false?'불일치':'미확인'}</small>
      <small className="r154-track-perspective">관찰 근거: {signalLabels(q.eod_signals).length?
        `${signalLabels(q.eod_signals).slice(0,4).join(' · ')} 기술 신호 발생`:'이전 검색 기록 기반 · 개별 신호 확인 불가'}</small>
      <small className="r154-track-perspective">관찰 관점: 신호 이후 가격·변동 및 추세 유지 확인</small></td>''')

    for obj in [main,basket,api,collector,liveApi,ui]:obj.write(check)
    print('R154_VALIDATED', 'CHECK_ONLY' if check else 'APPLIED')

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--check',action='store_true');ap.add_argument('--apply',action='store_true')
    a=ap.parse_args();
    if not a.check and not a.apply:ap.error('Choose --check or --apply')
    main(a.check)

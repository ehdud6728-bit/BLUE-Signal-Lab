// BLUE R1.4.2 — Cloudflare Cron collector (read-only KIS REST -> existing D1 R1.4.1 tables)
// No order endpoints, no /oauth2/tokenP, no GitHub schedule dependency.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export const NAME = 'BLUE_R142';
export const MAX_STOCKS = 12;
const MAX_EOD_AGE_DAYS = 7;
const VAULT_SCOPE = 'KIS_PROD_READONLY_V1_';
const HKDF_INFO = 'BLUE-Signal-Lab encrypted KIS access-token D1 v1';
const KIS_BASE = 'https://openapi.koreainvestment.com:9443';

export function kstParts(now) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone:'Asia/Seoul', year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit',hourCycle:'h23',weekday:'short'
  });
  const p=Object.fromEntries(fmt.formatToParts(now).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`, seconds:Number(p.hour)*3600+Number(p.minute)*60+Number(p.second), weekday:p.weekday};
}
export function marketsFor(now, closedDates='') {
  const k=kstParts(now),t=k.seconds;
  if(k.weekday==='Sat'||k.weekday==='Sun'||closedDates.split(',').map(x=>x.trim()).includes(k.date))return [];
  const h=(h,m=0,s=0)=>h*3600+m*60+s;
  if(t>=h(8)&&t<h(8,50))return [['NX','NXT_PRE']];
  if(t>=h(9)&&t<h(9,0,30))return [['J','KRX_REGULAR']];
  if(t>=h(9,0,30)&&t<h(15,20))return [['J','KRX_REGULAR'],['NX','NXT_MAIN']];
  if(t>=h(15,40)&&t<h(16))return [['NX','NXT_AFTER']];
  if(t>=h(16)&&t<h(20))return [['J','KRX_AFTER'],['NX','NXT_AFTER']];
  return [];
}
export function ageDays(today,day){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(today)||!/^\d{4}-\d{2}-\d{2}$/.test(day))return Infinity;
  return Math.round((Date.parse(`${today}T00:00:00Z`)-Date.parse(`${day}T00:00:00Z`))/86400000);
}
async function digest(text){return new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)));}
function hex(bytes){return [...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');}
function b64bytes(b64){
  // atob is available in Workers and Node 22; the base64url vault is produced by Python.
  const fixed=b64.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(fixed),c=>c.charCodeAt(0));
}
export async function vaultScope(appkey){return VAULT_SCOPE+hex(await digest(appkey)).slice(0,20);}
export async function decryptVault(encoded, appkey, appsecret){
  if(!encoded||!appkey||!appsecret)throw Error('TOKEN_VAULT_MISSING');
  const blob=b64bytes(encoded);
  if(blob.length<29)throw Error('TOKEN_VAULT_FORMAT_INVALID');
  const salt=await digest('BLUE_KIS_R131_VAULT_'+appkey);
  const base=await crypto.subtle.importKey('raw',encoder.encode(appsecret),'HKDF',false,['deriveKey']);
  const key=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:encoder.encode(HKDF_INFO)},base,{name:'AES-GCM',length:256},false,['decrypt']);
  const scope=await vaultScope(appkey);
  try{
    const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv:blob.subarray(0,12),additionalData:encoder.encode(scope)},key,blob.subarray(12));
    const token=decoder.decode(clear);
    if(!token||token.length>4096)throw Error('TOKEN_VAULT_INVALID');
    return token;
  }catch{throw Error('TOKEN_DECRYPT_FAILED');}
}
export async function cachedToken(db,appkey,appsecret,now){
  const scope=await vaultScope(appkey);
  const row=await db.prepare('SELECT ciphertext, expires_at_utc FROM blue_kis_token_vault_v1 WHERE scope = ?').bind(scope).first();
  if(!row||typeof row.ciphertext!=='string'||!Number.isFinite(Date.parse(row.expires_at_utc)))return null;
  if(Date.parse(row.expires_at_utc)<=now.getTime()+5*60000)return null;
  return decryptVault(row.ciphertext,appkey,appsecret);
}
export function normalizeCandidate(raw,origin){
  const code=String(raw.code??'');const close=Number(raw.eod_close);
  const asof=String(raw.eod_asof??'');
  if(!/^[0-9A-Z]{6}$/.test(code)||!Number.isFinite(close)||close<=0||!/^\d{4}-\d{2}-\d{2}$/.test(asof))return null;
  return {code,name:String(raw.name??'').slice(0,70),eod_close:close,eod_asof:asof,
    eod_signals:String(raw.eod_signals??'').slice(0,500),source_krx_run_id:raw.source_krx_run_id??null, origin};
}
export async function candidateSelection(db, now, limit=MAX_STOCKS){
  const today=kstParts(now).date;
  const tables=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('blue_kis_live_quotes_r141','runs','signals')").all();
  const has=new Set((tables.results||[]).map(x=>x.name));
  let snapshot=[];let sig=[];
  if(has.has('blue_kis_live_quotes_r141')){
    const rows=await db.prepare('SELECT payload_json FROM blue_kis_live_quotes_r141 WHERE trade_date = (SELECT MAX(trade_date) FROM blue_kis_live_quotes_r141) ORDER BY market,code LIMIT 80').all();
    const unique=new Map();
    for(const x of rows.results||[]){try{
      const p=JSON.parse(x.payload_json);
      // Only previously validated research snapshots that carry the original EOD evidence.
      if(typeof p.source_krx_run_id!=='number')continue;
      const c=normalizeCandidate(p,'R141_VERIFIED_EOD_ARTIFACT');
      if(c&&!unique.has(c.code))unique.set(c.code,c);
    }catch{ /* ignore malformed snapshot */ }}
    snapshot=[...unique.values()];
  }
  if(has.has('runs')&&has.has('signals')){
    const run=await db.prepare('SELECT run_id,latest_price_date FROM runs WHERE is_demo=0 AND latest_price_date < ? ORDER BY latest_price_date DESC,created_at DESC,run_id DESC LIMIT 1').bind(today).first();
    if(run&&typeof run.latest_price_date==='string'){
      const rows=await db.prepare('SELECT code,day,signal_names,close_price,extras_json FROM signals WHERE run_id=? AND day=? ORDER BY code LIMIT 100').bind(run.run_id,run.latest_price_date).all();
      sig=(rows.results||[]).map(x=>{
        let extra={};try{extra=JSON.parse(x.extras_json||'{}')||{};}catch{}
        return normalizeCandidate({code:x.code,name:extra.name||extra.Name||'',eod_close:x.close_price,eod_asof:x.day,eod_signals:x.signal_names},'D1_NONDEMO_EOD');
      }).filter(Boolean);
    }
  }
  const snapshotDate=snapshot.length?snapshot[0].eod_asof:'';
  const signalDate=sig.length?sig[0].eod_asof:'';
  // Prefer exact verified artifact snapshots on ties; never describe an older date as current.
  const chosen=sig.length&&signalDate>snapshotDate?sig:snapshot;
  if(!chosen.length)return {status:'NO_VERIFIED_CANDIDATES',items:[],asof:null,source:null};
  const asof=chosen[0].eod_asof;
  const delta=ageDays(today,asof);
  if(delta<1||delta>MAX_EOD_AGE_DAYS)return {status:'STALE_OR_FUTURE_EOD',items:[],asof,source:chosen[0].origin};
  return {status:'OK',items:chosen.filter(x=>x.eod_asof===asof).slice(0,limit),asof,source:chosen[0].origin};
}
export function parseQuote(candidate, market, phase, json, received, day){
  if(json?.rt_cd!=='0'||typeof json.output!=='object'||!json.output)throw Error('KIS_RESPONSE_INVALID');
  const o=json.output;
  if(['stck_prpr','stck_oprc','stck_hgpr','stck_lwpr','acml_vol'].some(k=>o[k]==null||String(o[k]).trim()===''))throw Error('QUOTE_MISSING_FIELD');
  const price=Number(o.stck_prpr),open=Number(o.stck_oprc),high=Number(o.stck_hgpr),low=Number(o.stck_lwpr),volume=Number(o.acml_vol);
  if(![price,open,high,low,volume].every(Number.isSafeInteger)||price<=0||open<=0||high<=0||low<=0||volume<0||low>high||price<low||price>high)throw Error('QUOTE_INCONSISTENT');
  const reported=String(o.stck_bsop_date||'');
  if(reported&&reported!==day.replaceAll('-',''))throw Error('PROVIDER_TRADE_DAY_MISMATCH');
  const hhmmss=String(o.stck_cntg_hour||'');
   // R157_PREV_CLOSE: KIS provider-supplied percentage, NOT the scanner signal-day return.
   // Absence or invalid values remain null for older snapshots; never fabricate a prior close.
   const prevRaw=String(o.prdy_ctrt??'').trim();
   const prevPct=prevRaw!==''?Number(prevRaw):NaN;
   const changeFromPrev=Number.isFinite(prevPct)&&prevPct>=-100&&prevPct<=1000
     ?Math.round(prevPct*100)/100:null;
  return {code:candidate.code,name:candidate.name,market,market_label:market==='J'?'KRX':'NXT',phase,
    trade_date_kst:day,received_at_utc:received.toISOString(),
    price,open,high,low,accumulated_volume:volume,
    change_from_eod_pct:Math.round((price/candidate.eod_close-1)*1e6)/1e4,
    change_from_prev_close_pct:changeFromPrev,
    day_range_position_pct:high>low?Math.round((price-low)/(high-low)*1e4)/100:null,
    eod_asof:candidate.eod_asof,eod_close:candidate.eod_close,eod_signals:candidate.eod_signals,
    source_krx_run_id:candidate.source_krx_run_id,
    candidate_source:candidate.origin,reported_trade_date:reported||null,
    reported_trade_day_matches_today:reported?true:null,
    reported_trade_clock:/^\d{6}$/.test(hhmmss)?hhmmss:null,
    exchange_tick_time_verified:false,market_phase_verified:false,
    source:'KIS_REST_INQUIRE_PRICE',research_only:true};
}
export async function getKisQuote(env, token, market, code){
  const url=new URL('/uapi/domestic-stock/v1/quotations/inquire-price',KIS_BASE);
  url.searchParams.set('FID_COND_MRKT_DIV_CODE',market);
  url.searchParams.set('FID_INPUT_ISCD',code);
  const controller=new AbortController();const abort=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(url,{method:'GET',headers:{
      authorization:'Bearer '+token,appkey:env.KIS_APP_KEY,appsecret:env.KIS_APP_SECRET,
      tr_id:'FHKST01010100',custtype:'P',accept:'application/json'
    },signal:controller.signal});
    if(!response.ok)throw Error(`KIS_HTTP_${response.status}`);
    const data=await response.json();
    if(!data||data.rt_cd!=='0')throw Error('KIS_RESPONSE_INVALID');
    return data;
  }finally{clearTimeout(abort);}
}
export async function ensureTables(db){
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS blue_kis_live_quotes_r141 (trade_date TEXT NOT NULL, market TEXT NOT NULL,code TEXT NOT NULL,received_at_utc TEXT NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(trade_date,market,code))'),
    db.prepare('CREATE TABLE IF NOT EXISTS blue_kis_live_history_r141 (trade_date TEXT NOT NULL,market TEXT NOT NULL,code TEXT NOT NULL,received_at_utc TEXT NOT NULL,price INTEGER NOT NULL,volume INTEGER NOT NULL,phase TEXT NOT NULL,PRIMARY KEY(trade_date,market,code,received_at_utc))'),
    db.prepare('CREATE TABLE IF NOT EXISTS blue_kis_collector_lock_r142 (id INTEGER PRIMARY KEY CHECK(id=1),lease_until_ms INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS blue_kis_collector_runs_r142 (id TEXT PRIMARY KEY,started_at_utc TEXT NOT NULL,status TEXT NOT NULL,source_date TEXT,source_kind TEXT,markets TEXT,attempted INTEGER NOT NULL,saved INTEGER NOT NULL,rejected INTEGER NOT NULL,reason TEXT)')
  ]);
  await db.prepare('INSERT OR IGNORE INTO blue_kis_collector_lock_r142(id,lease_until_ms) VALUES(1,0)').run();
  // R154_CLARITY: preserve first *observed* KIS collection; old 20d retained history is a lower-bound only.
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS blue_kis_first_seen_r154 (
      market TEXT NOT NULL, code TEXT NOT NULL, first_observed_at_utc TEXT NOT NULL,
      source TEXT NOT NULL, PRIMARY KEY(market,code))`).run();
    await db.prepare(`INSERT OR IGNORE INTO blue_kis_first_seen_r154(market,code,first_observed_at_utc,source)
      SELECT market,code,MIN(received_at_utc),'RETAINED_HISTORY'
      FROM blue_kis_live_history_r141 GROUP BY market,code`).run();
  } catch { console.warn('BLUE_R154_FIRST_SEEN_INIT_UNAVAILABLE'); }
}
export async function takeLease(db,now){
  const x=await db.prepare('UPDATE blue_kis_collector_lock_r142 SET lease_until_ms=? WHERE id=1 AND lease_until_ms<?').bind(now.getTime()+240000,now.getTime()).run();
  return x.meta?.changes===1;
}
export async function releaseLease(db){await db.prepare('UPDATE blue_kis_collector_lock_r142 SET lease_until_ms=0 WHERE id=1').run();}
export function batchStatements(db,quotes){
  // Cloudflare D1 SQL bind limit: batch 14 rows x 7 fields <= 100.
  const commands=[];
  for(let offset=0;offset<quotes.length;offset+=14){
    const part=quotes.slice(offset,offset+14);
    const latest=part.map(x=>[x.trade_date_kst,x.market,x.code,x.received_at_utc,JSON.stringify(x)]).flat();
    const history=part.map(x=>[x.trade_date_kst,x.market,x.code,x.received_at_utc,x.price,x.accumulated_volume,x.phase]).flat();
    commands.push(db.prepare(`INSERT INTO blue_kis_live_quotes_r141(trade_date,market,code,received_at_utc,payload_json) VALUES ${part.map(()=>'(?,?,?,?,?)').join(',')} ON CONFLICT(trade_date,market,code) DO UPDATE SET received_at_utc=excluded.received_at_utc,payload_json=excluded.payload_json WHERE excluded.received_at_utc>blue_kis_live_quotes_r141.received_at_utc`).bind(...latest));
    commands.push(db.prepare(`INSERT OR IGNORE INTO blue_kis_live_history_r141(trade_date,market,code,received_at_utc,price,volume,phase) VALUES ${part.map(()=>'(?,?,?,?,?,?,?)').join(',')}`).bind(...history));
  }
  return commands;
}
async function storeReport(db,report){
  // No credentials, ciphertext, raw API bodies, or raw provider errors in reports.
  await db.prepare('INSERT INTO blue_kis_collector_runs_r142(id,started_at_utc,status,source_date,source_kind,markets,attempted,saved,rejected,reason) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .bind(report.id,report.started_at_utc,report.status,report.source_date,report.source_kind,report.markets,report.attempted,report.saved,report.rejected,report.reason).run();
  const cutoff=new Date(Date.parse(report.started_at_utc)-14*86400000).toISOString();
  await db.prepare('DELETE FROM blue_kis_collector_runs_r142 WHERE started_at_utc < ?').bind(cutoff).run();
}
export async function collect(env, now=new Date(),deps={}){
  const active=String(env.COLLECTOR_ENABLED||'false').toLowerCase()==='true';
  if(!active)return {status:'DISABLED'};
  const phases=marketsFor(now,env.CLOSED_DATES||'');
  if(!phases.length)return {status:'OUTSIDE_MARKET_WINDOW'};
  const db=env.DB;
  const report={id:crypto.randomUUID(),started_at_utc:now.toISOString(),status:'STARTED',source_date:null,source_kind:null,
    markets:phases.map(x=>x[0]).join(','),attempted:0,saved:0,rejected:0,reason:null};
  let locked=false;
  try{
    await ensureTables(db);
    locked=await takeLease(db,now);
    if(!locked)return {status:'SKIPPED_LOCKED'};
    const selection=await candidateSelection(db,now,Math.min(MAX_STOCKS,Math.max(1,Number(env.CANDIDATE_LIMIT)||12)));
    report.source_date=selection.asof;
    report.source_kind=selection.source;
    if(selection.status!=='OK'||!selection.items.length){report.status='PAUSED_NO_FRESH_CANDIDATES';report.reason=selection.status;return {...report};}
    if(!env.KIS_APP_KEY||!env.KIS_APP_SECRET){report.status='PAUSED_MISSING_SECRETS';return {...report};}
    const token=await cachedToken(db,env.KIS_APP_KEY,env.KIS_APP_SECRET,now);
    if(!token){report.status='PAUSED_TOKEN_EXPIRED_OR_MISSING';return {...report};}
    const quotes=[];
    let lastKisCall=0;
    for(const [market,phase] of phases){
      for(const candidate of selection.items){
        report.attempted++;
        try{
          // Match the verified Python KIS client's ~0.4 s request spacing.
          // Delays do not consume CPU time and do not run during unit-test mocks.
          if(!deps.quote && lastKisCall){
            const remain=450-(Date.now()-lastKisCall);
            if(remain>0)await new Promise(resolve=>setTimeout(resolve,remain));
          }
          if(!deps.quote)lastKisCall=Date.now();
          const data=await (deps.quote||getKisQuote)(env,token,market,candidate.code);
          quotes.push(parseQuote(candidate,market,phase,data,new Date(),kstParts(now).date));
        }catch{report.rejected++;}
      }
    }
    if(!quotes.length){report.status='NO_VALID_QUOTES';return {...report};}
    // Validate the entire group before beginning any DB writes.
    const keys=new Set();
    for(const x of quotes){const k=x.market+':'+x.code;if(keys.has(k))throw Error('DUPLICATE_KEY');keys.add(k);}
    for(const stmt of batchStatements(db,quotes))await stmt.run();
    // Tracking provenance is optional. Failure cannot interrupt the original quote pipeline.
    try {
      for(const q of quotes) {
        await db.prepare(`INSERT OR IGNORE INTO blue_kis_first_seen_r154
          (market,code,first_observed_at_utc,source) VALUES(?,?,?,'FIRST_COLLECTED')`)
          .bind(q.market,q.code,q.received_at_utc).run();
      }
    } catch { console.warn('BLUE_R154_FIRST_SEEN_SAVE_UNAVAILABLE'); }
    report.saved=quotes.length;
    report.status=report.rejected?'PARTIAL_QUOTES':'OK';
    const cutoff=kstParts(new Date(now.getTime()-20*86400000)).date;
    await db.prepare('DELETE FROM blue_kis_live_history_r141 WHERE trade_date < ?').bind(cutoff).run();
    await db.prepare('DELETE FROM blue_kis_live_quotes_r141 WHERE trade_date < ?').bind(cutoff).run();
    return {...report};
  }catch{
    report.status='COLLECTOR_ERROR';report.reason='SANITIZED_RUNTIME_FAILURE';
    return {...report};
  }finally{
    if(locked){
      try{await storeReport(db,report);}catch{console.warn('BLUE_R142_LOG_WRITE_FAILED');}
      try{await releaseLease(db);}catch{console.warn('BLUE_R142_LOCK_RELEASE_FAILED');}
    }
    console.log(`BLUE_R142 status=${report.status} attempted=${report.attempted} saved=${report.saved} rejected=${report.rejected}`);
  }
}

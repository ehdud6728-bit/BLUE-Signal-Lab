import { handleAi, getCachedAi } from './ai';
import { liveQuotes } from './live';
import { handleBasketAi } from './basket';
import {basketWatch} from './performance';
import {comparePrices} from './price-compare';
import {requestSearchQuotes} from './search-quote-priority';
import {technicalFilterWhere} from './technical-filters';
import {validChartCode} from './chart-query';
import {lookupSymbolAnalysis,lookupSymbolDirectory,validAnalysisCode} from './symbol-analysis';
import {lookupSymbolLive,requestSymbolLive,validLiveCode} from './symbol-live';
import {runEodCloudflareCron} from './eod-cron';
import {InvalidEodQuery,tursoEodDates,tursoEodSearch,tursoEodCompare} from './turso-eod';
import {tursoMarketRotation} from './turso-market-rotation';
import {InvalidResearchQuery,tursoResearchDates,tursoResearchSearch,tursoResearchChart,tursoResearchCoverage,tursoPatternPulse,tursoExitStudyReport} from './turso-research';
import {InvalidTursoResearchRequest,requestTursoResearch,tursoResearchRequestStatus} from './turso-research-request';
import {InvalidProvisionalQuery,tursoProvisionalSearch} from './turso-provisional-search';
import {tursoPublishedProvisional,tursoProvisionalDetail} from './turso-published-provisional';
interface Env {
  DB: D1Database;
  TURSO_DATABASE_URL?:string;
  TURSO_AUTH_TOKEN?:string;
  KIS_COLLECTOR?: {collectNow(code:string):Promise<{status:string;code?:string}>;
    collectNowTurso?(code:string):Promise<{status:string;code?:string;market?:string;
      price?:number;trade_date?:string;received_at_utc?:string}>};
  CORS_ORIGIN?: string;
  GITHUB_TOKEN?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
}

const OWNER = 'ehdud6728-bit';
const REPO = 'BLUE-Signal-Lab';
const WORKFLOW = 'blue_market_scan_research_only.yml';
const ALLOWED = new Set([
  'BB20','BB30','BB40','ENV20','ENV40',
  'BB20_LOWER','BB30_LOWER','BB40_LOWER',
  'BB20_ALT','BB30_ALT','BB40_ALT',
  'BB20_LOWER_ALT','BB30_LOWER_ALT','BB40_LOWER_ALT',
  'BB30_LOWER_RECLAIM',
  'ENV20_LOWER_TOUCH',
]);
const isoPattern = /^\d{4}-\d{2}-\d{2}$/;
const inFlightMs = 45 * 60 * 1000;

function validDate(s: string): boolean {
  if (!isoPattern.test(s)) return false;
  const dt = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(dt.valueOf()) && dt.toISOString().slice(0, 10) === s;
}
function todayKST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function clockKST(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(new Date());
}
function normalizedSignals(s: string | null): string[] {
  return (s || '').split(',').map(x => x.trim().toUpperCase())
    .filter(Boolean).map(x => x.startsWith('BLUE') ? x.replace(/^BLUE/, 'BB') : x);
}
function githubHeaders(env: Env): HeadersInit {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'BLUE-Signal-Lab-R07',
  };
}
/** GitHub dispatch commonly returns 204 without an ID. Best-effort link a
 * pending request to a unique recent run, never guess when runs overlap. */
async function findPendingScanRun(env: Env, requestedAt: string): Promise<{id:number;url:string}|null> {
  if (!env.GITHUB_TOKEN) return null;
  const since = Date.parse(requestedAt);
  if (!Number.isFinite(since)) return null;
  try {
    const result = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=12`, {
      headers: githubHeaders(env)
    });
    if (!result.ok) return null;
    const body = await result.json() as {workflow_runs?:Array<{id?:number;html_url?:string;created_at?:string;event?:string}>};
    const candidates=(body.workflow_runs||[]).filter(run=>
      run.event==='workflow_dispatch' && typeof run.id==='number' &&
      typeof run.html_url==='string' && typeof run.created_at==='string' &&
      Date.parse(run.created_at)>=since-5_000 &&
      Date.parse(run.created_at)<=since+90_000);
    return candidates.length===1?{id:candidates[0].id!,url:candidates[0].html_url!}:null;
  } catch { return null; }
}
function availableSQL(): string {
  return `SELECT 1 AS found FROM daily_counts d JOIN runs r ON d.run_id=r.run_id
    WHERE d.day=? AND r.latest_price_date=d.day AND r.is_demo=0 LIMIT 1`;
}
function scanDateOK(day: string): boolean {
  // Verified KRX EOD is not a live quote. The provider's same-day data may
  // become available at or after 15:40 KST, never during the regular session.
  const today=todayKST();
  return validDate(day) && day >= '2025-01-01' && day <= '2026-12-31'
    && (day<today || (day===today && clockKST()>='15:40'));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = env.CORS_ORIGIN || 'http://localhost:5173';
    const cors: HeadersInit = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
    };
    const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const u = new URL(request.url), p = u.pathname;
    // ctx.access is provided only when Cloudflare Access has authenticated this Worker request.
    // An Origin header alone never grants permission to dispatch a GitHub workflow.
    const access = (ctx as ExecutionContext & { access?: unknown } | undefined)?.access;
    try {
      // Independently audited research snapshots: no D1 queries, KIS requests,
      // or API-side writes. The existing /api/search remains the D1 fallback.
      if(p==='/api/research/dates'&&request.method==='GET'){
        try{return respond(await tursoResearchDates(env));}
        catch{return respond({error:'TURSO_RESEARCH_UNAVAILABLE',fallback:'D1'},503);}
      }
      // KIS quotes are an explicitly PARTIAL, provisional view of the current
      // KST date; neither a KRX EOD search nor a verified technical signal.
      if(p==='/api/research/provisional-detail'&&request.method==='GET'){
        try{return respond(await tursoProvisionalDetail(env,u.searchParams));}
        catch(e){if(e instanceof InvalidProvisionalQuery)return respond({error:e.message},400);
          return respond({error:'TURSO_PROVISIONAL_DETAIL_UNAVAILABLE'},503);}
      }
      if(p==='/api/research/provisional-patterns'&&request.method==='GET'){
        try{return respond(await tursoPublishedProvisional(env,u.searchParams));}
        catch(e){if(e instanceof InvalidProvisionalQuery)return respond({error:e.message},400);
          return respond({error:'TURSO_PROVISIONAL_PATTERNS_UNAVAILABLE'},503);}
      }
      if(p==='/api/research/provisional'&&request.method==='GET'){
        try{return respond(await tursoProvisionalSearch(env,u.searchParams));}
        catch(e){if(e instanceof InvalidProvisionalQuery)return respond({error:e.message},400);
          return respond({error:'TURSO_PROVISIONAL_UNAVAILABLE'},503);}
      }
      if(p==='/api/research/market-rotation'&&request.method==='GET'){
        try{return respond(await tursoMarketRotation(env));}
        catch{return respond({error:'TURSO_MARKET_ROTATION_UNAVAILABLE'},503);}
      }
      if(p==='/api/research/coverage'&&request.method==='GET'){
        try{return respond(await tursoResearchCoverage(env));}
        catch{return respond({error:'TURSO_RESEARCH_COVERAGE_UNAVAILABLE'},503);}
      }
      if(p==='/api/research/pulse'&&request.method==='GET'){
        try{return respond(await tursoPatternPulse(env));}
        catch{return respond({error:'TURSO_PATTERN_PULSE_UNAVAILABLE'},503);}
      }
      if(p==='/api/research/exit-study'&&request.method==='GET'){
        try{return respond(await tursoExitStudyReport(env));}
        catch{return respond({error:'TURSO_EXIT_STUDY_UNAVAILABLE'},503);}
      }
      if(p==='/api/research/search'&&request.method==='GET'){
        try{return respond(await tursoResearchSearch(env,u.searchParams));}
        catch(e){if(e instanceof InvalidResearchQuery)return respond({error:e.message},400);
          return respond({error:'TURSO_RESEARCH_UNAVAILABLE',fallback:'D1'},503);}
      }
      if(p==='/api/research/chart'&&request.method==='GET'){
        try{
          const chart=await tursoResearchChart(env,u.searchParams);
          return respond(chart,chart.status==='READY'?200:404);
        }catch(e){if(e instanceof InvalidResearchQuery)return respond({error:e.message},400);
          return respond({error:'TURSO_RESEARCH_CHART_UNAVAILABLE'},503);}
      }
      // A user's explicit search of an unimported date may start the same
      // audited KRX EOD + research workflow. Queue state lives in Turso only;
      // the legacy D1 scan queue is deliberately not touched.
      if(p==='/api/research/request'&&request.method==='POST'){
        if(request.headers.get('Origin')!==origin)return respond({error:'ORIGIN_DENIED'},403);
        if(!access)return respond({error:'ACCESS_REQUIRED'},401);
        let body:{date?:unknown};
        try{body=await request.json() as typeof body;}catch{return respond({error:'INVALID_JSON'},400);}
        const day=typeof body?.date==='string'?body.date:'';
        try{
          const result=await requestTursoResearch(env,day);
          return respond(result,result.status==='PENDING'?202:200);
        }catch(e){
          if(e instanceof InvalidTursoResearchRequest)return respond({error:e.message},400);
          const reason=e instanceof Error?e.message:'';
          const safe=new Set(['GITHUB_DISPATCH_NOT_CONFIGURED','GITHUB_DISPATCH_FAILED',
            'TURSO_RESEARCH_QUEUE_FULL']);
          return respond({error:safe.has(reason)?reason:'TURSO_RESEARCH_REQUEST_UNAVAILABLE'},503);
        }
      }
      if(p==='/api/research/request/status'&&request.method==='GET'){
        if(!access)return respond({error:'ACCESS_REQUIRED'},401);
        try{return respond(await tursoResearchRequestStatus(env,u.searchParams.get('date')||''));}
        catch(e){if(e instanceof InvalidTursoResearchRequest)return respond({error:e.message},400);
          return respond({error:'TURSO_RESEARCH_STATUS_UNAVAILABLE'},503);}
      }
      // Fully independent of D1. A successful, audited EOD read has no implied
      // technical signals; the PWA switches to the existing D1 UI on failure.
      if(p==='/api/eod/dates'&&request.method==='GET'){
        try{return respond(await tursoEodDates(env));}
        catch{return respond({error:'TURSO_EOD_UNAVAILABLE',fallback:'D1',
          message:'Turso 확정 일봉 조회 실패. 기존 D1 조회를 시도하세요.'},503);}
      }
      if(p==='/api/eod/search'&&request.method==='GET'){
        try{return respond(await tursoEodSearch(env,u.searchParams));}
        catch(e){if(e instanceof InvalidEodQuery)return respond({error:e.message},400);
          return respond({error:'TURSO_EOD_UNAVAILABLE',fallback:'D1',
            message:'Turso 확정 일봉 조회 실패. 기존 D1 조회를 시도하세요.'},503);}
      }
      // Basket discovery dates stay in the browser. Read only Turso's
      // independently audited later candles; if unavailable, the client may
      // explicitly use its existing Access-protected D1 comparison endpoint.
      if(p==='/api/eod/prices/compare'&&request.method==='GET'){
        if(!access)return respond({error:'ACCESS_REQUIRED'},401);
        try{return respond(await tursoEodCompare(env,u.searchParams,todayKST()));}
        catch(e){if(e instanceof InvalidEodQuery)return respond({error:e.message},400);
          return respond({error:'TURSO_EOD_COMPARE_UNAVAILABLE',fallback:'D1',
            message:'Turso 검증 일봉 가격 비교가 불가능합니다.'},503);}
      }
      // Turso-first manual KIS quote refresh: never access D1 or dispatch
      // tokenP. Access + same-origin POST and the collector's Turso rate limits
      // are mandatory; GET remains a separately audited saved-data read.
      if(p==='/api/eod/quotes/refresh'&&request.method==='POST'){
        if(request.headers.get('Origin')!==origin)return respond({error:'ORIGIN_DENIED'},403);
        if(!access)return respond({error:'ACCESS_REQUIRED'},401);
        let payload:{code?:unknown};
        try{payload=await request.json() as typeof payload;}
        catch{return respond({error:'INVALID_JSON'},400);}
        const code=payload&&typeof payload.code==='string'?payload.code.trim().toUpperCase():'';
        if(!validLiveCode(code))return respond({error:'INVALID_CODE'},400);
        let result:{status:string;code?:string;market?:string;price?:number;
          trade_date?:string;received_at_utc?:string}={status:'NOT_CONNECTED'};
        try{
          if(env.KIS_COLLECTOR?.collectNowTurso)
            result=await env.KIS_COLLECTOR.collectNowTurso(code);
        }catch{result={status:'QUOTE_UNAVAILABLE'};}
        const notice:Record<string,string>={
          SAVED:'KIS 최신 조회 결과를 Turso에 저장했습니다. 실제 체결 시각은 미검증입니다.',
          COOLDOWN:'이 종목은 최근 조회했습니다. Turso 저장 시세를 확인하세요.',
          RATE_LIMITED:'KIS 조회 요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.',
          MARKET_CLOSED:'KIS 장중 조회 가능 시간이 아닙니다. 저장 시세를 확인하세요.',
          DISABLED:'Turso 즉시조회가 아직 운영에서 승인되지 않았습니다.',
          NO_VERIFIED_EOD_REFERENCE:'Turso의 이전 검증 일봉이 없어 조회하지 않았습니다.',
          STALE_OR_INVALID_EOD_REFERENCE:'Turso의 기준 일봉이 오래됐거나 유효하지 않습니다.',
          TURSO_TOKEN_MISSING:'Turso 금고에서 KIS 토큰을 찾을 수 없습니다. 새로 발급하지 않았습니다.',
          TURSO_TOKEN_EXPIRED:'Turso 금고의 KIS 토큰이 만료됐습니다. 발급 관리자 점검이 필요합니다.',
          TURSO_TOKEN_VAULT_UNAVAILABLE:'Turso KIS 토큰 금고에 접근할 수 없습니다.',
          TURSO_TOKEN_DECRYPT_FAILED:'Turso KIS 토큰을 복호화하지 못했습니다.',
          TURSO_NOT_CONFIGURED:'Turso 저장소 연결 설정이 필요합니다.',
          KIS_CONFIG_MISSING:'Collector의 KIS 인증 설정이 필요합니다.',
          NOT_CONNECTED:'Collector의 Turso 즉시조회 기능 배포가 필요합니다.',
          QUOTE_UNAVAILABLE:'KIS 조회 또는 Turso 저장에 실패했습니다. 기존 시세는 유지됩니다.'
        };
        const status=result.status||'QUOTE_UNAVAILABLE';
        const http=status==='SAVED'||status==='COOLDOWN'||status==='MARKET_CLOSED'?200:
          status==='RATE_LIMITED'?429:status==='INVALID_CODE'?400:
          status==='NO_VERIFIED_EOD_REFERENCE'?404:503;
        return respond({status,storage:'TURSO',code,
          price:status==='SAVED'&&typeof result.price==='number'&&
            Number.isSafeInteger(result.price)&&result.price>0?result.price:null,
          market:status==='SAVED'?result.market||null:null,
          trade_date:result.trade_date||null,received_at_utc:result.received_at_utc||null,
          message:notice[status]||'Turso KIS 시세를 새로 확보하지 못했습니다.'},http);
      }
      // Current KIS quote research is independent of today's confirmed KRX EOD.
      // The saved quote is always available immediately. The optional private
      // RPC call refreshes it synchronously, without sending KIS keys to API.
      if (p === '/api/analysis/live' && request.method === 'GET') {
        if(!access)return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        const code=(u.searchParams.get('code')||'').trim().toUpperCase();
        if(!validLiveCode(code))return respond({error:'INVALID_CODE'},400);
        const data=await lookupSymbolLive(env.DB,code);
        return respond(data,data.status==='UNKNOWN_SYMBOL'?404:200);
      }
      if (p === '/api/analysis/live/request' && request.method === 'POST') {
        if(request.headers.get('Origin')!==origin)return respond({error:'ORIGIN_DENIED'},403);
        if(!access)return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        let payload:{code?:unknown};
        try{payload=await request.json() as typeof payload;}catch{return respond({error:'INVALID_JSON'},400);}
        const code=typeof payload.code==='string'?payload.code.trim().toUpperCase():'';
        if(!validLiveCode(code))return respond({error:'INVALID_CODE'},400);
        const data=await requestSymbolLive(env.DB,code);
        return respond(data,data.status==='UNKNOWN_SYMBOL'?404:
          data.status==='QUEUE_FULL'?429:202);
      }
      if (p === '/api/analysis/live/refresh' && request.method === 'POST') {
        if(request.headers.get('Origin')!==origin)return respond({error:'ORIGIN_DENIED'},403);
        if(!access)return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        let payload:{code?:unknown};
        try{payload=await request.json() as typeof payload;}
        catch{return respond({error:'INVALID_JSON'},400);}
        const code=typeof payload.code==='string'?payload.code.trim().toUpperCase():'';
        if(!validLiveCode(code))return respond({error:'INVALID_CODE'},400);
        const before=await lookupSymbolLive(env.DB,code);
        if(before.status==='UNKNOWN_SYMBOL')return respond(before,404);
        let outcome='NOT_CONNECTED';
        if(env.KIS_COLLECTOR){
          try{
            const result=await env.KIS_COLLECTOR.collectNow(code);
            outcome=result?.status||'QUOTE_UNAVAILABLE';
          }catch{outcome='QUOTE_UNAVAILABLE';}
        }
        // The one-off read succeeds without touching the minute queue. Only
        // an unavailable provider/service falls back to normal Cron recovery.
        if(!['SAVED','COOLDOWN','RATE_LIMITED'].includes(outcome)){
          const queued=await requestSymbolLive(env.DB,code);
          if(queued.status==='UNKNOWN_SYMBOL')return respond(queued,404);
        }
        const latest=await lookupSymbolLive(env.DB,code);
        const notice:Record<string,string>={
          SAVED:'KIS 시세를 직접 조회해 저장했습니다. 확정 일봉은 아닙니다.',
          MARKET_CLOSED:'현재 KIS 즉시 수집 시간이 아닙니다. 기존 저장 시세를 표시합니다.',
          WAITING_TOKEN:'KIS 토큰을 확인하지 못해 자동 수집을 대기합니다.',
          COOLDOWN:'최근 요청한 종목입니다. 저장 시세를 먼저 확인해 주세요.',
          RATE_LIMITED:'시세 호출 제한에 도달해 저장 시세를 표시합니다.',
          NOT_CONNECTED:'즉시 조회 연결이 아직 배포되지 않아 자동 수집으로 대기합니다.',
          QUOTE_UNAVAILABLE:'KIS 응답을 검증하지 못했습니다. 자동 수집 대기 상태입니다.'
        };
        return respond({...latest,refresh_status:outcome,
          message:notice[outcome]||'저장된 시세를 표시하며 자동 수집을 기다립니다.'},200);
      }
      if (p === '/api/analysis/symbols' && request.method === 'GET') {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        const q=u.searchParams.get('q')||'';
        const data=await lookupSymbolDirectory(env.DB,q);
        return respond(data,data.status==='INVALID_QUERY'?400:200);
      }
      if (p === '/api/analysis/symbol' && request.method === 'GET') {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        const code=(u.searchParams.get('code')||'').trim().toUpperCase();
        const day=u.searchParams.get('asof')||'';
        if(!validAnalysisCode(code)||!validDate(day)||day>todayKST())
          return respond({error:'INVALID_ANALYSIS_QUERY'},400);
        const data=await lookupSymbolAnalysis(env.DB,code,day);
        return respond(data,data.status==='INVALID_QUERY'?400:200);
      }
      if (p === '/api/analysis/request' && request.method === 'POST') {
        if(request.headers.get('Origin')!==origin)return respond({error:'ORIGIN_DENIED'},403);
        if(!access)return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        if(!env.GITHUB_TOKEN)return respond({error:'GITHUB_DISPATCH_NOT_CONFIGURED'},503);
        let payload:{code?:unknown;asof?:unknown};
        try{payload=await request.json() as typeof payload;}catch{return respond({error:'INVALID_JSON'},400);}
        const code=typeof payload.code==='string'?payload.code.trim().toUpperCase():'';
        const day=typeof payload.asof==='string'?payload.asof:'';
        if(!validAnalysisCode(code)||!scanDateOK(day))return respond({error:'INVALID_ANALYSIS_QUERY'},400);
        const ready=await lookupSymbolAnalysis(env.DB,code,day);
        if(ready.status==='READY')return respond({status:'READY',code,asof:day});
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS blue_symbol_analysis_requests_v1 (
          code TEXT NOT NULL,day TEXT NOT NULL,requested_at_utc TEXT NOT NULL,
          status TEXT NOT NULL,PRIMARY KEY(code,day))`).run();
        const stamp=new Date().toISOString();
        const cutoff=new Date(Date.now()-45*60000).toISOString();
        const claim=await env.DB.prepare(`INSERT INTO blue_symbol_analysis_requests_v1
          (code,day,requested_at_utc,status) VALUES(?,?,?,'PENDING')
          ON CONFLICT(code,day) DO UPDATE SET
          requested_at_utc=excluded.requested_at_utc,status='PENDING'
          WHERE requested_at_utc<? OR status='FAILED'`)
          .bind(code,day,stamp,cutoff).run();
        if(claim.meta?.changes!==1)return respond({status:'PENDING',code,asof:day,deduplicated:true},202);
        try{
          const gh=await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,{
            method:'POST',headers:{...githubHeaders(env),'Content-Type':'application/json'},
            body:JSON.stringify({ref:'main',inputs:{asof_date:day,diagnose_code:code,
              publish_to_d1:'false',publish_diagnostic_only:'true'}})});
          if(!gh.ok)throw Error('GITHUB_DISPATCH_'+gh.status);
        }catch{
          await env.DB.prepare(`UPDATE blue_symbol_analysis_requests_v1 SET status='FAILED'
            WHERE code=? AND day=? AND requested_at_utc=?`).bind(code,day,stamp).run();
          return respond({error:'GITHUB_DISPATCH_FAILED'},502);
        }
        return respond({status:'PENDING',code,asof:day,
          message:'과거 일봉 분석을 요청했습니다. 등록되면 이 화면에서 다시 조회하세요.'},202);
      }
      // AI requires Cloudflare Access at the API Worker edge. Origin alone is not authentication.
      if (p === '/api/ai/status' && request.method === 'GET') {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        const rows=await env.DB.prepare(`SELECT name FROM sqlite_master
          WHERE type='table' AND name IN ('ai_analysis_cache','ai_daily_usage')`).all<{name:string}>();
        const present=new Set((rows.results||[]).map(r=>r.name));
        return respond({status:'READY',gemini_key_configured:Boolean(env.GEMINI_API_KEY),
          ai_schema_ready:present.has('ai_analysis_cache')&&present.has('ai_daily_usage'),
          model:env.GEMINI_MODEL||'gemini-3.5-flash-lite',
          note:'키 값이나 API 응답 본문은 반환하지 않습니다. 키 존재 여부와 D1 테이블만 확인합니다.'});
      }
      if (p === '/api/ai/report' && request.method === 'GET') {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        const upstream=await getCachedAi(request,env);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      if ((p === '/api/ai/market' || p === '/api/ai/stock') && request.method === 'POST') {
        if (request.headers.get('Origin') !== origin) return respond({error:'ORIGIN_DENIED'},403);
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        const upstream=await handleAi(request,env,p.endsWith('/market')?'market':'stock');
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      // R1.0: verified archived EOD candles for a matched symbol on a selected date.
      if (p === '/api/chart' && request.method === 'GET') {
        const day=u.searchParams.get('date')||'';
        const code=u.searchParams.get('code')||'';
        if(!validDate(day)||!validChartCode(code))return respond({error:'INVALID_CHART_QUERY'},400);
        const r=await env.DB.prepare(`SELECT c.chart_json,c.stats_json,c.created_at
          FROM chart_snapshots c
          JOIN runs r ON r.run_id=c.run_id
          JOIN signals s ON s.run_id=c.run_id AND s.day=c.day AND s.code=c.code
          WHERE c.day=? AND c.code=? AND r.is_demo=0 AND r.latest_price_date=c.day
          ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1`).bind(day,code)
          .first<{chart_json:string;stats_json:string;created_at:string}>();
        if(r)return respond({status:'READY',chart:JSON.parse(r.chart_json),stats:JSON.parse(r.stats_json),
          snapshot_time:r.created_at});
        // R1.5.10.8: another verified snapshot for this symbol may contain
        // *historical* bars for the requested day. Return only bars <= day.
        // Never reuse a later date's backtest stats: it would leak future data.
        const proof=await env.DB.prepare(`SELECT s.close_price AS close_price
                    FROM signals s JOIN runs rr ON rr.run_id=s.run_id
                    WHERE s.day=? AND s.code=? AND rr.is_demo=0 AND rr.latest_price_date=s.day
                    ORDER BY rr.created_at DESC,rr.run_id DESC LIMIT 1`).bind(day,code)
                    .first<{close_price:number|null}>();
                  if(!proof||typeof proof.close_price!=='number'||!Number.isFinite(proof.close_price)||proof.close_price<=0)
                    return respond({status:'NOT_AVAILABLE',message:'검증된 검색일 종가가 없어 다른 날짜의 차트를 대체하지 않습니다.'},404);
                  const nearby=await env.DB.prepare(`SELECT c.chart_json,c.day,c.created_at
          FROM chart_snapshots c JOIN runs r ON r.run_id=c.run_id
          WHERE c.code=? AND c.day>? AND r.is_demo=0 AND r.latest_price_date=c.day
          ORDER BY c.day ASC,r.created_at DESC,r.run_id DESC LIMIT 30`).bind(code,day)
          .all<{chart_json:string;day:string;created_at:string}>();
        for(const saved of nearby.results||[]){
          try{
            const source=JSON.parse(saved.chart_json) as {bars?:Array<{t?:string}>,[key:string]:unknown};
            if(!Array.isArray(source.bars))continue;
            const bars=source.bars.filter(b=>b&&typeof b.t==='string'&&b.t<=day);
            if(bars.length<5||bars[bars.length-1]?.t!==day)continue;
                      // Confirm exact as-of close to prevent mismatched adjustments.
                      const last=bars[bars.length-1] as {c?:number};
                      if(typeof last.c!=='number'||!Number.isFinite(last.c)||last.c<=0||
                         Math.abs(last.c-proof.close_price)>Math.max(0.01,proof.close_price*0.001))continue;
            return respond({status:'READY',chart:{...source,asof:day,bars},
              message:'동일 종목의 다른 검증된 일봉 저장본에서 기준일까지의 가격만 복원했습니다. 과거 패턴 통계는 날짜별 별도 검증이 필요합니다.',
              chart_source_day:saved.day,snapshot_time:saved.created_at});
          }catch{/* Skip corrupt older snapshots rather than invent data. */}
        }
        return respond({status:'NOT_AVAILABLE',message:'해당 날짜의 차트 저장본을 확인하지 못했습니다. 같은 종목의 다른 저장본에도 기준일 일봉이 없어 해당 날짜의 분석·차트 등록이 필요합니다.'},404);
      }
      // BLUE R1.5: AI picks from server-verified historical EOD; no order entry.
      if (p === '/api/basket/ai' && (request.method === 'GET' || request.method === 'POST')) {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        if (request.method === 'POST' && request.headers.get('Origin') !== origin)
          return respond({error:'ORIGIN_DENIED'},403);
        const upstream = await handleBasketAi(request,env);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      // R1.5.3: never accept arbitrary price data or arbitrary KIS requests.
      // Only Access-authenticated requests on verified scan symbols may enroll.
      if (p === '/api/basket/watch' && (request.method === 'GET'||request.method === 'POST')) {
        if (!access) return respond({error:'ACCESS_REQUIRED'},401);
        if (request.method==='POST' && request.headers.get('Origin')!==origin)
          return respond({error:'ORIGIN_DENIED'},403);
        const upstream=await basketWatch(request,env);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      // R1.4: D1-only intraday snapshots; same Cloudflare Access guard as BLUE AI.
      // Never forward KIS credentials or the encrypted token vault to browsers.
      // R1593_PRICE_COMPARE: Access-protected, read-only saved price/history.
      if (p === '/api/prices/compare' && request.method === 'GET') {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        const upstream=await comparePrices(env.DB,u);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      // R1.5.9.4: authenticated batch request, no direct browser KIS access.
      if (p === '/api/prices/request' && request.method === 'POST') {
        if (!access) return respond({error:'ACCESS_REQUIRED'},401);
        if (request.headers.get('Origin')!==origin) return respond({error:'ORIGIN_DENIED'},403);
        const upstream=await requestSearchQuotes(request,env.DB);
        return new Response(upstream.body,{status:upstream.status,headers:{...cors,
          'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      }
      if (p === '/api/live/quotes' && request.method === 'GET') {
        if (!access) return respond({error:'ACCESS_REQUIRED',message:'Cloudflare Access 로그인 필요'},401);
        return respond(await liveQuotes(env.DB));
      }
      if (p === '/api/health' && request.method === 'GET') {
        return respond({ status:'ok', mode:'RESEARCH_ONLY', storage:'D1', api_version:'R1.0.2' });
      }
      if (p === '/api/runs' && request.method === 'GET') {
        const r = await env.DB.prepare('SELECT run_id,created_at,source,latest_price_date,notes,is_demo FROM runs ORDER BY created_at DESC LIMIT 50').all();
        return respond({ items: r.results });
      }
      if (p === '/api/dates' && request.method === 'GET') {
        const r = await env.DB.prepare(`SELECT latest_price_date AS day,COUNT(*) AS versions FROM runs
          WHERE latest_price_date IS NOT NULL AND is_demo=0
          GROUP BY latest_price_date ORDER BY latest_price_date DESC LIMIT 500`).all();
        return respond({ items:r.results, latest:(r.results[0] as { day?: string } | undefined)?.day || null });
      }
      if (p === '/api/search' && request.method === 'GET') {
        const mode = u.searchParams.get('mode') || 'single';
        if (mode !== 'single' && mode !== 'range') return respond({ error:'Invalid mode' },400);
        const start = mode === 'single' ? u.searchParams.get('date') || '' : u.searchParams.get('start') || '';
        const end = mode === 'single' ? start : u.searchParams.get('end') || '';
        if (!validDate(start) || !validDate(end) || start > end) return respond({ error:'Valid date interval required' },400);
        const runId = u.searchParams.get('run_id') || '';
        const runFilter = runId ? 'run_id=?' : `run_id IN (
          SELECT r.run_id FROM runs r WHERE r.is_demo=0 AND r.latest_price_date=signals.day
          ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1)`;
        const args: (string | number)[] = runId ? [runId,start,end] : [start,end];
        const filters = [runFilter, 'day BETWEEN ? AND ?'];
        const code = (u.searchParams.get('code') || '').trim();
        if (code) {
          if (!/^[A-Za-z0-9._-]{1,24}$/.test(code)) return respond({error:'Invalid code'},400);
          filters.push('code=?'); args.push(code);
        }
        // A name/code lookup applies to the complete D1 result set BEFORE
        // LIMIT/OFFSET. Never silently search only the 100 visible browser rows.
        const nameQuery=(u.searchParams.get('q')||'').trim();
        if(nameQuery.length>60)return respond({error:'INVALID_STOCK_QUERY'},400);
        if(nameQuery){
          const escaped=nameQuery.replace(/[\\%_]/g,'\\$&');
          filters.push(`(code LIKE ? ESCAPE '\\' OR
            (CASE WHEN json_valid(extras_json) THEN
              COALESCE(CAST(json_extract(extras_json,'$.name') AS TEXT),
                CAST(json_extract(extras_json,'$.Name') AS TEXT),'') ELSE '' END)
              LIKE ? ESCAPE '\\')`);
          args.push('%'+escaped+'%','%'+escaped+'%');
        }
        const tags = normalizedSignals(u.searchParams.get('signals'));
        if (tags.some(tag => !ALLOWED.has(tag))) return respond({error:'Unsupported signal'},400);
        const logic = u.searchParams.get('logic') || 'any';
        if (!['any','all'].includes(logic)) return respond({error:'Invalid signal logic'},400);
        if (tags.length) {
          filters.push('(' + tags.map(() => "(','||signal_names||',') LIKE ?").join(logic === 'all' ? ' AND ' : ' OR ') + ')');
          args.push(...tags.map(tag => '%,' + tag + ',%'));
        }
        // Result-side golden-cross filters. Indexed result paging must be applied
        // AFTER SQL filtering so later pages are not silently missed.
        const gcAllowed:Record<string,string>={
          rsi:'rsi_gc',slow14:'slow_14_3_3_gc',slow12:'slow_12_5_5_gc',
          slow20:'slow_20_12_12_gc',macd:'macd_gc'
        };
        // R1.5.9.9: exact historical turnover in hundred-million KRW.
        // No inferred amounts for old EOD rows. Omitted param keeps API backward compatible.
        const amountText=(u.searchParams.get('min_amount_eok')||'0').trim();
        if(!/^\d{1,5}$/.test(amountText)||Number(amountText)>50000)
          return respond({error:'INVALID_MIN_AMOUNT'},400);
        const minAmount=Number(amountText);
        if(minAmount>0){
          filters.push(`(CASE WHEN json_valid(extras_json) THEN
            CAST(json_extract(extras_json,'$.traded_amount_krw') AS REAL) ELSE NULL END) >= ?`);
          args.push(minAmount*100000000);
        }
        const onlyPattern=(u.searchParams.get('only_pattern')||'0').trim();
        const minPattern=(u.searchParams.get('min_pattern_up')||'70').trim();
        const minPatternN=(u.searchParams.get('min_pattern_n')||'8').trim();
        if(!['0','1'].includes(onlyPattern)||!['60','70','80','90'].includes(minPattern)||
           !['3','4','5','6','7','8','10','15','20','30'].includes(minPatternN))
          return respond({error:'INVALID_PATTERN_FILTER'},400);
        // R1.5.10.4: real chart snapshots are the authoritative historical evidence.
        // Legacy signals.extras_json may predate pattern metadata. Search the SAME
        // chart setup that supplies the detail view, never infer a win percentage.
        const sampleFloor=Number(minPatternN); // allowlisted 3-30 choices; default 8
        const chartSetupTable=`chart_snapshots cs,
          json_each(CASE WHEN json_valid(cs.stats_json) THEN cs.stats_json
            ELSE '{"setups":[]}' END,'$.setups') setup`;
        const chartJoin=`cs.run_id=signals.run_id AND cs.code=signals.code AND cs.day=signals.day`;
        const setupN=`CAST(json_extract(setup.value,'$.horizons."10".n') AS INTEGER)`;
        const setupUp=`CAST(json_extract(setup.value,'$.horizons."10".up_pct') AS REAL)`;
        const setupValid=`json_type(setup.value,'$.horizons."10".up_pct') IN ('integer','real')`;
        if(onlyPattern==='1'){
          // Count and paging apply this *before* LIMIT/OFFSET; GC and amount stay ANDed.
          filters.push(`(EXISTS (SELECT 1 FROM ${chartSetupTable}
             WHERE ${chartJoin} AND ${setupValid} AND ${setupN}>=? AND ${setupUp}>=?)
           OR (NOT EXISTS (SELECT 1 FROM chart_snapshots cs WHERE ${chartJoin})
             AND CAST(json_extract(CASE WHEN json_valid(extras_json) THEN extras_json ELSE '{}' END,
               '$.r159_pattern_n_10d') AS INTEGER)>=?
             AND CAST(json_extract(CASE WHEN json_valid(extras_json) THEN extras_json ELSE '{}' END,
               '$.r159_pattern_up_10d') AS REAL)>=?))`);
          args.push(sampleFloor,Number(minPattern),sampleFloor,Number(minPattern));
        }
        // Select the best supported 10-day pattern *at the currently selected sample
        // floor*, not the one frozen when the D1 row was first imported.
        const bestSetupSql=`(SELECT setup.value FROM ${chartSetupTable}
          WHERE ${chartJoin} AND ${setupValid} AND ${setupN}>=${sampleFloor}
          ORDER BY ${setupUp} DESC,
            CAST(json_extract(setup.value,'$.horizons."10".median_return_pct') AS REAL) DESC,
            CAST(json_extract(setup.value,'$.horizons."10".mean_return_pct') AS REAL) DESC,
            ${setupN} DESC LIMIT 1)`;
        const gcRaw=(u.searchParams.get('gc')||'').trim();
        const gcNames=gcRaw?gcRaw.split(',').map(x=>x.trim()).filter(Boolean):[];
        if(gcNames.length>5||new Set(gcNames).size!==gcNames.length||gcNames.some(k=>!gcAllowed[k]))
          return respond({error:'Unsupported GC filter'},400);
        const gcLogic=u.searchParams.get('gc_logic')||'any';
        if(!['any','all'].includes(gcLogic))return respond({error:'Invalid GC logic'},400);
        if(gcNames.length){
          const gcWhere=gcNames.map(k=>`LOWER(CAST(json_extract(extras_json,'$.${gcAllowed[k]}') AS TEXT)) IN ('true','1')`);
          filters.push('('+gcWhere.join(gcLogic==='all'?' AND ':' OR ')+')');
        }
        // Search-day trend/breakout filters are applied in SQL BEFORE LIMIT,
        // just like the GC filters. Missing historical MA data never qualifies.
        const technicalWhere=technicalFilterWhere(u.searchParams.get('tech')||'',u.searchParams.get('tech_logic')||'any');
        if(technicalWhere===null)return respond({error:'INVALID_TECH_FILTER'},400);
        if(technicalWhere)filters.push(technicalWhere);
        const where = filters.join(' AND ');
        const order=(u.searchParams.get('sort')||'recent').trim();
        if(!['recent','highest_gain','lowest_return','amount_surge','amount_decline'].includes(order))
          return respond({error:'INVALID_RESULT_SORT'},400);
        // Chart-derived high/low is an *observed portion*, not proof that every
        // intervening trading session has been captured. A missing chart is NULL.
        // Select only the latest independently verified, later EOD chart.
        // Include isolated symbol analyses too: an un-matched stock can have a
        // verified newer chart without any later *search-signal* chart row.
        const laterChart=`(SELECT latest.chart_json FROM (
          SELECT cs.chart_json,cs.day,cr.created_at AS stamped FROM chart_snapshots cs
            JOIN runs cr ON cr.run_id=cs.run_id WHERE cs.code=signals.code
              AND cs.day>signals.day AND cr.is_demo=0 AND cr.latest_price_date=cs.day
          UNION ALL
          SELECT sa.chart_json,sa.day,sa.created_at_utc AS stamped FROM blue_symbol_analysis_v1 sa
            WHERE sa.code=signals.code AND sa.day>signals.day
              AND sa.quality_status<>'CORPORATE_ACTION_REVIEW_REQUIRED'
        ) latest ORDER BY latest.day DESC,latest.stamped DESC LIMIT 1)`;
        const chartMax=`(SELECT MAX(CAST(json_extract(b.value,'$.h') AS REAL))
          FROM json_each(${laterChart},'$.bars') b
          WHERE json_extract(b.value,'$.t')>signals.day AND
            CAST(json_extract(b.value,'$.h') AS REAL)>0)`;
        const chartMin=`(SELECT MIN(CAST(json_extract(b.value,'$.l') AS REAL))
          FROM json_each(${laterChart},'$.bars') b
          WHERE json_extract(b.value,'$.t')>signals.day AND
            CAST(json_extract(b.value,'$.l') AS REAL)>0)`;
        const amountRatio=`(CASE WHEN json_valid(extras_json) THEN
          CAST(json_extract(extras_json,'$.amount_ratio20') AS REAL) ELSE NULL END)`;
        const safeGain=(value:string)=>`(CASE WHEN close_price>0
          THEN ROUND(100*((${value})/close_price-1),3) ELSE NULL END)`;
        const metricColumn=order==='highest_gain'?`${safeGain(chartMax)} AS observed_high_pct,`:
          order==='lowest_return'?`${safeGain(chartMin)} AS observed_low_pct,`:
          order==='amount_surge'||order==='amount_decline'?`${amountRatio} AS amount_ratio20_sort,`:'';
        const ordering=order==='highest_gain'?'observed_high_pct DESC NULLS LAST,day DESC,code':
          order==='lowest_return'?'observed_low_pct ASC NULLS LAST,day DESC,code':
          order==='amount_surge'?'amount_ratio20_sort DESC NULLS LAST,day DESC,code':
          order==='amount_decline'?'amount_ratio20_sort ASC NULLS LAST,day DESC,code':
          'day DESC,code';
        const limit = Math.min(500, Math.max(1, Math.floor(Number(u.searchParams.get('limit')) || 100)));
        const page = Math.min(10000, Math.max(1, Math.floor(Number(u.searchParams.get('page')) || 1)));
        const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM signals WHERE ' + where)
          .bind(...args).first<{ n:number }>();
        const rows = await env.DB.prepare(`SELECT run_id,code,day,signal_names,close_price,supply_distance_pct,extras_json,
          ${metricColumn}
          ${bestSetupSql} AS verified_pattern_setup_json
          FROM signals WHERE ${where} ORDER BY ${ordering} LIMIT ? OFFSET ?`)
          .bind(...args,limit,(page-1)*limit).all();
        const countFilter = runId ? 'run_id=?' : `run_id IN (
          SELECT r.run_id FROM runs r WHERE r.is_demo=0 AND r.latest_price_date=daily_counts.day
          ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1)`;
        const counts = await env.DB.prepare(`SELECT day,observed_stocks,signal_events,matched_stocks
          FROM daily_counts WHERE ${countFilter} AND day BETWEEN ? AND ? ORDER BY day DESC LIMIT 370`)
          .bind(...(runId ? [runId,start,end] : [start,end])).all();
        const items = rows.results.map((x:any) => {
          let extras: Record<string,unknown> = {};
          try { extras = JSON.parse(x.extras_json || '{}'); } catch { /* legacy record */ }
          // Reconcile old search rows with the stored chart (same run/code/date).
          // Only export verified 10-session observations and their real signal dates.
          if(typeof x.verified_pattern_setup_json==='string'){
            try{
              const setup=JSON.parse(x.verified_pattern_setup_json) as any;
              const h=setup?.horizons?.['10'];
              const n=Number(h?.n),up=Number(h?.up_pct);
              if(Number.isInteger(n)&&n>=sampleFloor&&Number.isFinite(up)&&up>=0&&up<=100){
                const days=Array.isArray(h?.cases)?h.cases
                  .map((c:any)=>c?.signal_day)
                  .filter((d:unknown):d is string=>typeof d==='string'&&
                    /^20\d{2}-\d{2}-\d{2}$/.test(d)&&d<=String(x.day)) : [];
                extras.r159_pattern_up_10d=up;
                extras.r159_pattern_n_10d=n;
                extras.r159_pattern_label_10d=String(setup?.label||'').slice(0,150);
                extras.r159_pattern_signal_days_10d_json=JSON.stringify([...new Set(days)].sort().slice(-12));
              }
            }catch{/* Invalid historical JSON never fabricates evidence. */}
          }
          const record={...x};
          delete record.verified_pattern_setup_json;
          return { ...record, name:extras.name || extras.Name || null,
            signals:String(x.signal_names || '').split(',').filter(Boolean), extras };
        });
        return respond({mode,start,end,q:nameQuery,sort:order,total:total?.n || 0,page,limit,items,
          daily_counts:counts.results,data_status:counts.results.length ? 'AVAILABLE' : 'NOT_IMPORTED',
          note:'Missing source days are never silently replaced by another trading day.'});
      }
      if (p === '/api/symbol' && request.method === 'GET') {
        const code = u.searchParams.get('code') || '', runId = u.searchParams.get('run_id');
        if (!/^[A-Za-z0-9._-]{1,24}$/.test(code)) return respond({error:'Invalid code'},400);
        const rows = runId
          ? await env.DB.prepare('SELECT day,signal_names,close_price,supply_distance_pct,extras_json FROM signals WHERE run_id=? AND code=? ORDER BY day DESC LIMIT 3000').bind(runId,code).all()
          : await env.DB.prepare(`SELECT day,signal_names,close_price,supply_distance_pct,extras_json FROM signals
            WHERE code=? AND run_id IN (SELECT r.run_id FROM runs r WHERE r.is_demo=0
            AND r.latest_price_date=signals.day ORDER BY r.created_at DESC,r.run_id DESC LIMIT 1)
            ORDER BY day DESC LIMIT 3000`).bind(code).all();
        return respond({code,signals:rows.results,price_data_available:false});
      }
      if (p === '/api/scan/status' && request.method === 'GET') {
        // Keep GitHub status polling private to avoid exhausting the API token rate limit.
        if (!access) return respond({error:'Cloudflare Access login required'},401);
        const day = u.searchParams.get('date') || '';
        if (!validDate(day)) return respond({error:'Invalid date'},400);
        if (await env.DB.prepare(availableSQL()).bind(day).first()) return respond({date:day,status:'READY'});
        const row = await env.DB.prepare(`SELECT status,requested_at,github_run_id,github_run_url,failure_reason
          FROM scan_requests WHERE day=?`).bind(day).first<{
            status:string; requested_at:string; github_run_id:number | null;
            github_run_url:string | null; failure_reason:string | null;
          }>();
        if (!row) return respond({date:day,status:'NOT_IMPORTED'});
        if (row.status === 'failed') return respond({date:day,status:'FAILED',reason:row.failure_reason || '분석 실패',actions_url:row.github_run_url});
        const age = Date.now() - Date.parse(row.requested_at);
        if (age > inFlightMs) {
          await env.DB.prepare(`UPDATE scan_requests SET status='failed',failure_reason='45분 내 등록 결과 없음',updated_at=? WHERE day=? AND status='pending'`)
            .bind(new Date().toISOString(),day).run();
          return respond({date:day,status:'FAILED',reason:'45분 내 D1 등록 결과가 확인되지 않았습니다.',actions_url:row.github_run_url});
        }
        // A successful 204 dispatch has no run ID. Recover it only when there
        // is exactly one matching run in the narrow dispatch time window.
        let runId=row.github_run_id;
        let runUrl=row.github_run_url;
        if (!runId && age>15_000 && env.GITHUB_TOKEN) {
          const found=await findPendingScanRun(env,row.requested_at);
          if (found) {
            runId=found.id;
            runUrl=found.url;
            await env.DB.prepare(`UPDATE scan_requests SET github_run_id=?,github_run_url=?,updated_at=?
              WHERE day=? AND status='pending' AND github_run_id IS NULL`)
              .bind(runId,runUrl,new Date().toISOString(),day).run();
          }
        }
        // When a run ID is known, detect Actions failure before 45 minutes.
        if (runId && env.GITHUB_TOKEN) {
          try {
            const gh = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/runs/${runId}`, {
              headers:githubHeaders(env)
            });
            if (gh.ok) {
              const job = await gh.json() as {status?:string;conclusion?:string;updated_at?:string};
              if (job.status === 'completed' && job.conclusion !== 'success') {
                const reason = 'GitHub Actions ' + (job.conclusion || '실패');
                await env.DB.prepare('UPDATE scan_requests SET status=?,failure_reason=?,updated_at=? WHERE day=?')
                  .bind('failed',reason,new Date().toISOString(),day).run();
                return respond({date:day,status:'FAILED',reason,actions_url:runUrl});
              }
              if (job.status === 'completed' && job.conclusion === 'success'
                && job.updated_at && Date.now() - Date.parse(job.updated_at) > 120_000) {
                await env.DB.prepare('UPDATE scan_requests SET status=?,failure_reason=?,updated_at=? WHERE day=?')
                  .bind('failed','Actions는 완료됐으나 해당 날짜의 D1 데이터가 없습니다.',new Date().toISOString(),day).run();
                return respond({date:day,status:'FAILED',reason:'Actions 완료 후 D1 등록 데이터가 없습니다.',actions_url:runUrl});
              }
            }
          } catch { /* GitHub status lookup is best-effort; never fabricate success. */ }
        }
        return respond({date:day,status:'PENDING',actions_url:runUrl});
      }
      if (p === '/api/scan' && request.method === 'POST') {
        if (request.headers.get('Origin') !== origin) return respond({error:'Origin not allowed'},403);
        if (!access) return respond({error:'Cloudflare Access login required'},401);
        if (!env.GITHUB_TOKEN) return respond({error:'GitHub token is not configured'},503);
        let body: {date?:unknown};
        try { body = await request.json() as {date?:unknown}; }
        catch { return respond({error:'JSON body expected'},400); }
        const day = body.date;
        if (typeof day !== 'string' || !scanDateOK(day)) {
          return respond({error:'확정 일봉은 당일 15:40(KST) 이후 또는 과거 거래일에만 요청할 수 있습니다.'},400);
        }
        if (await env.DB.prepare(availableSQL()).bind(day).first()) return respond({date:day,status:'READY'});
        const cutoff = new Date(Date.now() - inFlightMs).toISOString();
        const live = await env.DB.prepare(`SELECT COUNT(*) AS n FROM scan_requests
          WHERE status='pending' AND requested_at>=?`).bind(cutoff).first<{n:number}>();
        if ((live?.n || 0) >= 3) return respond({error:'동시 진행 분석 3건 제한. 완료 후 다시 요청하세요.'},429);
        const now = new Date().toISOString();
        const claim = await env.DB.prepare(`INSERT INTO scan_requests(day,status,requested_at,updated_at)
          VALUES(?,'pending',?,?)
          ON CONFLICT(day) DO UPDATE SET status='pending',requested_at=excluded.requested_at,
            updated_at=excluded.updated_at,github_run_id=NULL,github_run_url=NULL,failure_reason=NULL
          WHERE scan_requests.status='failed' OR scan_requests.requested_at<?`)
          .bind(day,now,now,cutoff).run();
        if (!claim.meta.changes) return respond({date:day,status:'PENDING',deduplicated:true},202);
        let gh: Response;
        try {
          gh = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
            method:'POST',
            headers:{...githubHeaders(env),'Content-Type':'application/json'},
            body:JSON.stringify({ref:'main',inputs:{asof_date:day,publish_to_d1:'true'},return_run_details:true}),
          });
        } catch {
          await env.DB.prepare('UPDATE scan_requests SET status=?,failure_reason=?,updated_at=? WHERE day=?')
            .bind('failed','GitHub 연결 실패',new Date().toISOString(),day).run();
          return respond({error:'GitHub dispatch network error'},502);
        }
        if (!gh.ok) {
          await env.DB.prepare('UPDATE scan_requests SET status=?,failure_reason=?,updated_at=? WHERE day=?')
            .bind('failed','GitHub dispatch HTTP '+gh.status,new Date().toISOString(),day).run();
          return respond({error:'GitHub dispatch failed',github_status:gh.status},502);
        }
        let workflowRunId: number | null = null;
        let workflowRunUrl: string | null = null;
        if (gh.status === 200) {
          try {
            const ghData = await gh.json() as {workflow_run_id?:number;html_url?:string};
            workflowRunId = ghData.workflow_run_id || null;
            workflowRunUrl = ghData.html_url || null;
          } catch { /* 204/empty response is also a valid dispatch */ }
        }
        await env.DB.prepare('UPDATE scan_requests SET github_run_id=?,github_run_url=?,updated_at=? WHERE day=?')
          .bind(workflowRunId,workflowRunUrl,new Date().toISOString(),day).run();
        return respond({date:day,status:'PENDING',actions_url:workflowRunUrl},202);
      }
      return respond({error:'Not found'},404);
    } catch (err) {
      if (p.startsWith('/api/ai/')) return respond({error:'AI_SETUP_REQUIRED',message:'BLUE AI R0.9 D1 스키마 및 Worker 배포를 확인하세요.'},500);
      // Never print credentials or user-supplied headers to the response.
      return respond({error:'Request failed; confirm D1 R0.7 migration and Worker deployment',
        category:err instanceof Error ? err.name : 'Unknown'},500);
    }
  },
  async scheduled(event:ScheduledController,env:Env,ctx:ExecutionContext):Promise<void>{
    ctx.waitUntil(runEodCloudflareCron(event,env).catch(error=>{
      console.warn('BLUE_EOD_CRON_FAILED',error instanceof Error?error.name:'Unknown');
    }));
  },
} satisfies ExportedHandler<Env>;
